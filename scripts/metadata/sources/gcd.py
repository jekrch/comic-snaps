import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

from ..disambiguation import (
    get_disambiguation_id,
    load_disambiguation,
    record_disambiguation_candidates,
    save_disambiguation,
)
from ..health import IntegrationHealth
from ..references import (
    SOURCE_GCD,
    _set_if_missing,
    ensure_reference,
    has_source,
    mark_source,
)
from ..text import is_meaningful_description, strip_html
from . import API_HEADERS

GCD_BASE = "https://www.comics.org/api"
GCD_MAX_RETRIES = 4
GCD_BASE_SLEEP = 5.0  # seconds between GCD requests


def _gcd_request(url: str, params: dict | None = None,
                 health: IntegrationHealth | None = None) -> requests.Response | None:
    """
    Make a GCD API request with retry + exponential backoff on 429s.
    Returns the Response on success, or None after exhausting retries.
    """
    for attempt in range(GCD_MAX_RETRIES):
        if health and health.should_bail:
            return None
        try:
            resp = requests.get(url, params=params, headers=API_HEADERS, timeout=15)
            if resp.status_code == 429:
                if health:
                    health.mark_throttled("rate limited (429)")
                    return None
                wait = GCD_BASE_SLEEP * (2 ** attempt)
                print(f"    rate-limited by GCD, waiting {wait:.0f}s…", file=sys.stderr)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        except requests.exceptions.Timeout:
            if health:
                health.mark_throttled("request timed out")
            print(f"    WARN: GCD request timed out ({url})", file=sys.stderr)
            return None
        except requests.exceptions.HTTPError:
            # non-429 HTTP error — already raised, don't retry
            raise
        except Exception as e:
            print(f"    WARN: GCD request failed ({url}): {e}", file=sys.stderr)
            return None
    print(f"    WARN: GCD request still 429 after {GCD_MAX_RETRIES} retries ({url})", file=sys.stderr)
    return None


def gcd_search_series(name: str, health: IntegrationHealth | None = None) -> list | None:
    """Search the Grand Comics Database for series by name.
    Returns a list of results, or None if the request failed entirely."""
    try:
        resp = _gcd_request(
            f"{GCD_BASE}/series/name/{quote(name, safe='')}/",
            params={"format": "json"},
            health=health,
        )
        if not resp:
            return None
        data = resp.json()
        # GCD returns paginated results with a 'results' key
        if isinstance(data, dict):
            return data.get("results", []) or []
        if isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"    WARN: GCD series search failed for {name!r}: {e}", file=sys.stderr)
        return None


def gcd_fetch_json(url: str, health: IntegrationHealth | None = None) -> dict | None:
    """Fetch a GCD API URL and return the parsed JSON."""
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}format=json" if "format=" not in url else url
    try:
        resp = _gcd_request(full, health=health)
        if not resp:
            return None
        return resp.json()
    except Exception as e:
        print(f"    WARN: GCD fetch failed ({url}): {e}", file=sys.stderr)
        return None


def pick_gcd_series_match(results: list, name: str, start_year: int | None) -> dict | None:
    """
    Pick the best GCD series match. Prefers exact name match; uses start_year
    to disambiguate when multiple series share the same name.
    """
    norm = name.strip().lower()
    exact = [r for r in results if (r.get("name") or "").strip().lower() == norm]
    if not exact:
        return None
    if len(exact) == 1:
        return exact[0]
    if start_year:
        for r in exact:
            if r.get("year_began") == start_year:
                return r
    # Fall back to the one with the most issues (active_issues length or any count field)
    return exact[0]


def gcd_series_web_url(match: dict) -> str | None:
    """Build a comics.org web URL from a GCD series match."""
    api_url = match.get("api_url") or ""
    # api_url looks like https://www.comics.org/api/series/12345/
    m = re.search(r"/series/(\d+)", api_url)
    if m:
        return f"https://www.comics.org/series/{m.group(1)}/"
    return None


def extract_gcd_series_fields(match: dict) -> dict:
    """Pull supplemental fields from a GCD series result."""
    start_year = match.get("year_began")
    try:
        start_year = int(start_year) if start_year else None
    except (TypeError, ValueError):
        start_year = None

    publisher = None
    pub = match.get("publisher")
    if isinstance(pub, str) and pub:
        publisher = pub
    elif isinstance(pub, dict):
        publisher = pub.get("name")

    return {
        "startYear": start_year,
        "publisher": publisher,
    }


def backfill_gcd(path: Path, key: str) -> int:
    """
    For series entries missing data, search the Grand Comics Database and
    fill in whichever fields are missing. GCD has no creator/people endpoint
    so this is series-only.

    If a disambiguation entry with a resolved ID exists for a name, the entry
    is fetched directly by ID. Entries previously marked as processed are
    re-processed when a disambiguation ID becomes available.
    """
    if not path.exists():
        return 0

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    disambig = load_disambiguation()
    disambig_changed = False

    gcd_supplemental_keys = ("startYear", "publisher")

    health = IntegrationHealth("GCD")

    for entry in entries:
        if health.should_bail:
            break
        name = entry.get("name")
        if not name:
            continue

        resolved_id = get_disambiguation_id(disambig, SOURCE_GCD, "series", name)

        if has_source(entry, SOURCE_GCD) and not resolved_id:
            continue

        # Skip entries that already have all fields GCD could provide —
        # cover image fetching handles its own GCD lookups separately.
        has_desc = is_meaningful_description(entry.get("description") or "")
        has_all_supplemental = all(
            entry.get(k) not in (None, "", [], {}) for k in gcd_supplemental_keys
        )
        if has_desc and has_all_supplemental:
            mark_source(entry, SOURCE_GCD)
            updated += 1
            continue

        match = None

        if resolved_id:
            print(f"  Fetching GCD series ID {resolved_id} for {name}...")
            match = gcd_fetch_json(f"{GCD_BASE}/series/{resolved_id}/", health=health)
            time.sleep(GCD_BASE_SLEEP)
            if match:
                dkey = f"{SOURCE_GCD}:series"
                disambig.get(dkey, {}).pop(name, None)
                disambig_changed = True
            else:
                print(f"    WARN: disambiguation ID {resolved_id} returned no result")
                mark_source(entry, SOURCE_GCD)
                updated += 1
                continue
        else:
            print(f"  Searching GCD for {name}...")
            results = gcd_search_series(name, health=health)
            time.sleep(GCD_BASE_SLEEP)

            if results is None:
                print(f"    SKIP: request failed, will retry next run")
                continue

            match = pick_gcd_series_match(results, name, entry.get("startYear"))
            if not match:
                if results:
                    print(f"    SKIP: no exact match ({len(results)} candidate(s))")
                    record_disambiguation_candidates(
                        disambig, SOURCE_GCD, "series", name, results
                    )
                    disambig_changed = True
                else:
                    print(f"    SKIP: no exact match (0 candidate(s))")
                mark_source(entry, SOURCE_GCD)
                updated += 1
                continue

        changed = False

        # GCD series notes can serve as a description
        if not is_meaningful_description(entry.get("description") or ""):
            notes = match.get("notes") or ""
            clean = strip_html(notes) if notes else ""
            if is_meaningful_description(clean):
                entry["description"] = clean
                changed = True
                print(f"    desc: {clean[:80]}...")

        for field, value in extract_gcd_series_fields(match).items():
            if _set_if_missing(entry, field, value):
                changed = True
                print(f"    {field}: {value}")

        web_url = gcd_series_web_url(match)
        if web_url:
            ensure_reference(entry, "Grand Comics Database", web_url)

        mark_source(entry, SOURCE_GCD)
        updated += 1
        if not changed:
            print(f"    SKIP: match found but no new fields")

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Processed {updated} entr(ies) in {path} via GCD.")

    if disambig_changed:
        save_disambiguation(disambig)

    return updated
