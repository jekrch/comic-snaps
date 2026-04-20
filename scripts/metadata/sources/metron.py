import json
import os
import re
import sys
import time
from pathlib import Path

import requests

from ..disambiguation import (
    get_disambiguation_id,
    load_disambiguation,
    record_disambiguation_candidates,
    save_disambiguation,
)
from ..health import IntegrationHealth
from ..references import (
    SOURCE_METRON,
    _set_if_missing,
    ensure_reference,
    has_source,
    mark_source,
)
from ..text import extract_year, is_meaningful_description, strip_html
from . import API_HEADERS, MAX_COVER_IMAGES, pick_exact_match

METRON_BASE = "https://metron.cloud/api"


def metron_get(endpoint: str, params: dict, username: str, password: str,
               health: IntegrationHealth | None = None) -> dict | None:
    """Make an authenticated GET request to the Metron API."""
    try:
        resp = requests.get(
            f"{METRON_BASE}/{endpoint}",
            params=params,
            auth=(username, password),
            headers=API_HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"    WARN: Metron request timed out ({endpoint})", file=sys.stderr)
        return None
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"    WARN: Metron request failed ({endpoint}): {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    WARN: Metron request failed ({endpoint}): {e}", file=sys.stderr)
        return None


def metron_search(resource: str, name: str, username: str, password: str,
                  health: IntegrationHealth | None = None) -> list:
    """Search Metron for a resource by name. Returns the results list."""
    data = metron_get(f"{resource}/", {"name": name}, username, password, health=health)
    if not data:
        return []
    return data.get("results", []) or []


def extract_metron_artist_fields(match: dict) -> dict:
    """Pull supplemental fields from a Metron creator result."""
    aliases_raw = match.get("alias") or []
    aliases = [a.strip() for a in aliases_raw if isinstance(a, str) and a.strip()] if aliases_raw else []
    return {
        "birthYear": extract_year(match.get("birth")),
        "deathYear": extract_year(match.get("death")),
        "aliases": aliases or None,
    }


def extract_metron_series_fields(match: dict) -> dict:
    """Pull supplemental fields from a Metron series result."""
    publisher = None
    pub_obj = match.get("publisher")
    if isinstance(pub_obj, dict):
        publisher = pub_obj.get("name")
    elif isinstance(pub_obj, str):
        publisher = pub_obj

    start_year = match.get("year_began")
    try:
        start_year = int(start_year) if start_year else None
    except (TypeError, ValueError):
        start_year = None

    issue_count = match.get("issue_count")
    try:
        issue_count = int(issue_count) if issue_count else None
    except (TypeError, ValueError):
        issue_count = None

    return {
        "startYear": start_year,
        "publisher": publisher,
        "issueCount": issue_count,
    }


def metron_resource_url(resource: str, match: dict) -> str | None:
    """Build the metron.cloud web URL for a matched resource."""
    mid = match.get("id")
    if not mid:
        return None
    kind = "series" if resource == "series" else "creator"
    return f"https://metron.cloud/{kind}/{mid}/"


def backfill_metron(path: Path, key: str, resource: str, tiebreak_key: str | None) -> int:
    """
    For entries missing data, search Metron and fill in whichever fields are
    missing. Adds a Metron reference whenever any field is populated.

    `resource` is the Metron endpoint ('creator' or 'series').

    If a disambiguation entry with a resolved ID exists for a name, the entry
    is fetched directly by ID instead of searched by name.  Entries that were
    previously marked as processed but now have a resolved disambiguation ID
    are re-processed.
    """
    username = os.environ.get("METRON_USERNAME")
    password = os.environ.get("METRON_PASSWORD")
    if not username or not password:
        print(f"  SKIP Metron backfill for {path} (METRON_USERNAME/METRON_PASSWORD not set).")
        return 0
    if not path.exists():
        return 0

    extract_supplemental = extract_metron_artist_fields if resource == "creator" else extract_metron_series_fields

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    disambig = load_disambiguation()
    disambig_changed = False

    health = IntegrationHealth("Metron")

    for entry in entries:
        if health.should_bail:
            break
        name = entry.get("name")
        if not name:
            continue

        # Check for a manually-resolved disambiguation ID
        resolved_id = get_disambiguation_id(disambig, SOURCE_METRON, resource, name)

        # Skip already-processed entries unless disambiguation provides a new ID
        if has_source(entry, SOURCE_METRON) and not resolved_id:
            continue

        match = None

        if resolved_id:
            print(f"  Fetching Metron ({resource}) ID {resolved_id} for {name}...")
            match = metron_get(f"{resource}/{resolved_id}/", {}, username, password, health=health)
            time.sleep(3.0)  # 20 requests/min limit
            if match:
                # Clear the disambiguation entry now that it's been used
                dkey = f"{SOURCE_METRON}:{resource}"
                disambig.get(dkey, {}).pop(name, None)
                disambig_changed = True
            else:
                print(f"    WARN: disambiguation ID {resolved_id} returned no result")
                mark_source(entry, SOURCE_METRON)
                updated += 1
                continue
        else:
            print(f"  Searching Metron ({resource}) for {name}...")
            results = metron_search(resource, name, username, password, health=health)
            time.sleep(3.0)  # 20 requests/min limit

            match = pick_exact_match(results, name, tiebreak_key=tiebreak_key)
            if not match and results:
                print(f"    SKIP: no exact match ({len(results)} candidate(s))")
                record_disambiguation_candidates(
                    disambig, SOURCE_METRON, resource, name, results
                )
                disambig_changed = True
                mark_source(entry, SOURCE_METRON)
                updated += 1
                continue
            elif not match:
                print(f"    SKIP: no exact match (0 candidate(s))")
                mark_source(entry, SOURCE_METRON)
                updated += 1
                continue

        ref_url = metron_resource_url(resource, match)
        changed = False

        if not is_meaningful_description(entry.get("description") or ""):
            raw_desc = match.get("desc") or ""
            clean = strip_html(raw_desc) if raw_desc else ""
            if is_meaningful_description(clean):
                entry["description"] = clean
                changed = True
                print(f"    desc: {clean[:80]}...")

        if not entry.get("imageUrl"):
            img_url = match.get("image")
            if img_url:
                entry["imageUrl"] = img_url
                changed = True
                print(f"    image: {img_url}")

        for field, value in extract_supplemental(match).items():
            if _set_if_missing(entry, field, value):
                changed = True
                print(f"    {field}: {value}")

        if changed and ref_url:
            ensure_reference(entry, "Metron", ref_url)

        mark_source(entry, SOURCE_METRON)
        updated += 1
        if not changed:
            print(f"    SKIP: match found but no new fields")

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Processed {updated} entr(ies) in {path} via Metron.")

    if disambig_changed:
        save_disambiguation(disambig)

    return updated


def fetch_metron_covers(series_entry: dict, gallery_issues: list[int],
                        username: str, password: str,
                        health: IntegrationHealth | None = None) -> list[str]:
    """
    Fetch cover image URLs from Metron for a series. Prioritizes issues
    that appear in the gallery, then fills remaining slots.
    """
    # Find the Metron series ID from the reference URL
    metron_id = None
    for ref in series_entry.get("references", []):
        if (ref.get("name") or "").strip().lower() == "metron":
            m = re.search(r"/series/(\d+)", ref.get("url", ""))
            if m:
                metron_id = m.group(1)
                break
    if not metron_id:
        return []

    # Fetch issues for this series (first page, up to 28 results)
    data = metron_get(f"issue/", {"series_id": metron_id}, username, password, health=health)
    time.sleep(3.0)
    if not data:
        return []

    issues = data.get("results", []) or []

    # Separate gallery issues from others
    gallery_covers = []
    other_covers = []
    for issue in issues:
        img = issue.get("image")
        if not img:
            continue
        issue_num = issue.get("number")
        try:
            issue_num = int(issue_num) if issue_num else None
        except (TypeError, ValueError):
            issue_num = None

        if issue_num and issue_num in gallery_issues:
            gallery_covers.append(img)
        else:
            other_covers.append(img)

    covers = gallery_covers[:MAX_COVER_IMAGES]
    remaining = MAX_COVER_IMAGES - len(covers)
    if remaining > 0:
        covers.extend(other_covers[:remaining])

    return covers
