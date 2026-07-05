"""
Backfill per-issue creator credits (writer, penciller, inker, colorist,
letterer, etc.) into issues.json for every (series, issue) pair that appears
in the gallery.

Metron is tried first because its credits are structured (creator + role
objects); Comic Vine's person_credits are used as a fallback, with its
comma-separated role strings normalized to the same canonical role names.

Every credited creator is promoted to a first-class entry in artists.json
(matched case-insensitively against existing names/aliases), so the regular
Wikipedia/Comic Vine/Metron artist backfills enrich them on subsequent
passes. Metron-sourced creators additionally get a resolved disambiguation
ID so their enrichment fetch hits the exact creator record instead of a
name search.
"""

import json
import os
import re
import sys
import time

from .disambiguation import (
    get_disambiguation_id,
    load_disambiguation,
    save_disambiguation,
)
from .health import IntegrationHealth
from .paths import ARTISTS_PATH, ISSUES_PATH, SERIES_PATH
from .references import (
    SOURCE_COMICVINE,
    SOURCE_METRON,
    ensure_reference,
    has_source,
    mark_source,
)
from .text import slugify
from .sources.comicvine import comic_vine_get, extract_comicvine_volume_id
from .sources.metron import metron_get

# Canonical role names, in the order they should display. Metron mostly uses
# these already; Comic Vine's lowercase strings are mapped onto them.
ROLE_ORDER = [
    "Writer", "Artist", "Penciller", "Inker", "Painter", "Colorist",
    "Letterer", "Cover", "Editor", "Assistant Editor", "Associate Editor",
    "Editor in Chief", "Designer", "Translator", "Production",
]

ROLE_MAP = {
    "writer": "Writer", "script": "Writer", "scripter": "Writer",
    "plot": "Writer", "plotter": "Writer", "story": "Writer",
    "artist": "Artist",
    "penciller": "Penciller", "penciler": "Penciller", "pencils": "Penciller",
    "breakdowns": "Penciller",
    "inker": "Inker", "inks": "Inker", "finishes": "Inker",
    "embellisher": "Inker",
    "colorist": "Colorist", "colourist": "Colorist", "colors": "Colorist",
    "colours": "Colorist", "color separations": "Colorist",
    "letterer": "Letterer", "letters": "Letterer",
    "cover": "Cover", "covers": "Cover", "cover artist": "Cover",
    "editor": "Editor", "editing": "Editor",
    "editor in chief": "Editor in Chief", "editor-in-chief": "Editor in Chief",
    "assistant editor": "Assistant Editor",
    "associate editor": "Associate Editor",
    "painter": "Painter",
    "translator": "Translator",
    "designer": "Designer",
    "production": "Production",
}

METRON_SERIES_URL_RE = re.compile(r"metron\.cloud/series/(\d+)")
# When Metron throttles (429/timeout), wait out the rate-limit window and
# retry instead of bailing — a full credits sync makes hundreds of calls,
# so hitting the limit at least once is expected.
METRON_THROTTLE_RETRIES = 5
METRON_THROTTLE_WAIT = 65.0
# Metron series search results use a display string like "Hup (1987)".
METRON_DISPLAY_YEAR_RE = re.compile(r"^(.*?)\s*\((\d{4})\)\s*$")


def metron_get_patient(endpoint: str, params: dict, username: str, password: str,
                       health: IntegrationHealth) -> dict | None:
    """
    metron_get, but on a throttle (which flips health.should_bail) waits out
    the rate-limit window and retries instead of giving up.
    """
    for attempt in range(METRON_THROTTLE_RETRIES):
        data = metron_get(endpoint, params, username, password, health=health)
        time.sleep(3.0)  # 20 requests/min limit
        if data is not None:
            return data
        if not health.should_bail:
            return None  # hard failure (404 etc.), not a throttle
        print(f"    Metron throttled — waiting {METRON_THROTTLE_WAIT:.0f}s "
              f"(retry {attempt + 1}/{METRON_THROTTLE_RETRIES})", file=sys.stderr)
        time.sleep(METRON_THROTTLE_WAIT)
        health.should_bail = False
    health.should_bail = True
    return None


def normalize_role(raw: str) -> str | None:
    """Map a source role string onto a canonical role name."""
    key = (raw or "").strip().lower()
    if not key:
        return None
    return ROLE_MAP.get(key, raw.strip().title())


def role_rank(role: str) -> int:
    try:
        return ROLE_ORDER.index(role)
    except ValueError:
        return len(ROLE_ORDER)


def sort_credits(credits: list[dict]) -> None:
    """Order credits by their most prominent role, then name."""
    credits.sort(key=lambda c: (
        min((role_rank(r) for r in c.get("roles", [])), default=len(ROLE_ORDER)),
        (c.get("name") or "").lower(),
    ))


def merge_credit(credits_by_name: dict, name: str, roles: list[str],
                 metron_id: int | None = None, cv_url: str | None = None) -> None:
    """Accumulate roles for a creator, merging duplicate appearances."""
    key = name.strip().lower()
    entry = credits_by_name.setdefault(key, {
        "name": name.strip(),
        "roles": [],
        "metronId": None,
        "cvUrl": None,
    })
    for role in roles:
        if role and role not in entry["roles"]:
            entry["roles"].append(role)
    if metron_id and not entry["metronId"]:
        entry["metronId"] = metron_id
    if cv_url and not entry["cvUrl"]:
        entry["cvUrl"] = cv_url


def _metron_series_display(result: dict) -> str:
    return result.get("series") or result.get("name") or ""


def resolve_metron_series_id(series_entry: dict, username: str, password: str,
                             disambig: dict, health: IntegrationHealth) -> tuple[int | None, bool]:
    """
    Find the Metron series ID for a series entry.

    Checks the stored Metron reference URL first, then a manually-resolved
    disambiguation ID, then falls back to a name search. When an ID is found
    via disambiguation or search, a Metron reference is persisted on the
    entry so future runs skip the lookup. Returns (id, disambig_changed).
    """
    name = series_entry.get("name") or ""

    for ref in series_entry.get("references", []):
        m = METRON_SERIES_URL_RE.search(ref.get("url") or "")
        if m:
            return int(m.group(1)), False

    resolved_id = get_disambiguation_id(disambig, SOURCE_METRON, "series", name)
    if resolved_id:
        ensure_reference(series_entry, "Metron", f"https://metron.cloud/series/{resolved_id}/")
        disambig.get(f"{SOURCE_METRON}:series", {}).pop(name, None)
        return int(resolved_id), True

    data = metron_get_patient("series/", {"name": name}, username, password, health)
    results = (data or {}).get("results") or []

    norm = name.strip().lower()
    start_year = series_entry.get("startYear")
    exact = []
    for r in results:
        display = _metron_series_display(r)
        m = METRON_DISPLAY_YEAR_RE.match(display)
        base = m.group(1) if m else display
        year = int(m.group(2)) if m else r.get("year_began")
        if base.strip().lower() == norm:
            exact.append((r, year))

    match = None
    if len(exact) == 1:
        match = exact[0][0]
    elif len(exact) > 1 and start_year:
        year_hits = [r for r, year in exact if year == start_year]
        if len(year_hits) == 1:
            match = year_hits[0]

    if match:
        mid = int(match["id"])
        ensure_reference(series_entry, "Metron", f"https://metron.cloud/series/{mid}/")
        return mid, False

    if results:
        # Record candidates (with proper display names — the raw results
        # carry the name under "series") so the user can resolve manually.
        dkey = f"{SOURCE_METRON}:series"
        bucket = disambig.setdefault(dkey, {})
        existing = bucket.get(name)
        # Refresh entries whose candidates were recorded without names by
        # the older series backfill; never clobber a pending resolution.
        has_useful = isinstance(existing, dict) and (
            existing.get("id") or any(c.get("name") for c in existing.get("candidates", []))
        )
        if not has_useful:
            bucket[name] = {
                "id": None,
                "candidates": [
                    {"id": r.get("id"), "name": _metron_series_display(r) or None}
                    for r in results[:8]
                ],
            }
            return None, True
    return None, False


def fetch_metron_issue_credits(metron_series_id: int, issue_number: int,
                               username: str, password: str,
                               health: IntegrationHealth) -> dict | None:
    """
    Fetch credits for one issue from Metron.

    Returns {"url": ..., "credits": [...]} (credits may be empty) when the
    issue was found, or None when the issue wasn't found / a request failed.
    """
    data = metron_get_patient(
        "issue/",
        {"series_id": metron_series_id, "number": str(issue_number)},
        username, password, health,
    )
    if data is None:
        return None
    results = data.get("results") or []
    issue = next((r for r in results if str(r.get("number")) == str(issue_number)), None)
    if not issue:
        return {"url": None, "credits": []}

    detail = metron_get_patient(f"issue/{issue['id']}/", {}, username, password, health)
    if detail is None:
        return None

    credits_by_name: dict = {}
    for credit in detail.get("credits") or []:
        name = (credit.get("creator") or "").strip()
        if not name:
            continue
        roles = [normalize_role(r.get("name")) for r in credit.get("role") or []]
        roles = [r for r in roles if r]
        merge_credit(credits_by_name, name, roles, metron_id=credit.get("id"))

    url = detail.get("resource_url") or f"https://metron.cloud/issue/{issue['id']}/"
    return {"url": url, "credits": list(credits_by_name.values())}


def fetch_comicvine_issue_credits(volume_id: str, issue_number: int, api_key: str,
                                  health: IntegrationHealth) -> dict | None:
    """
    Fetch person credits for one issue from Comic Vine.

    Returns {"url": ..., "credits": [...]} (credits may be empty) when the
    issue was found, or None when the issue wasn't found / a request failed.
    """
    data = comic_vine_get(
        "issues/",
        {
            "filter": f"volume:{volume_id},issue_number:{issue_number}",
            "field_list": "id,issue_number",
            "limit": 5,
        },
        api_key, health=health,
    )
    time.sleep(1.0)  # be polite — Comic Vine rate-limits per resource
    if data is None:
        return None
    results = data.get("results") or []
    issue = next(
        (r for r in results if str(r.get("issue_number")) == str(issue_number)),
        None,
    )
    if not issue:
        return {"url": None, "credits": []}

    detail = comic_vine_get(
        f"issue/4000-{issue['id']}/",
        {"field_list": "person_credits,site_detail_url"},
        api_key, health=health,
    )
    time.sleep(1.0)
    if detail is None:
        return None
    result = detail.get("results") or {}

    credits_by_name: dict = {}
    for person in result.get("person_credits") or []:
        name = (person.get("name") or "").strip()
        if not name:
            continue
        roles = [normalize_role(part) for part in (person.get("role") or "").split(",")]
        roles = [r for r in roles if r]
        merge_credit(credits_by_name, name, roles, cv_url=person.get("site_detail_url"))

    url = result.get("site_detail_url")
    return {"url": url, "credits": list(credits_by_name.values())}


def promote_creators(credits: list[dict], artists: list, artist_index: dict,
                     existing_ids: set, disambig: dict) -> tuple[bool, bool]:
    """
    Ensure every credited creator has an entry in artists.json and stamp
    each credit with its artistId. New Metron-sourced creators get a
    resolved disambiguation ID so the artist backfill fetches the exact
    creator record. Returns (artists_changed, disambig_changed).
    """
    artists_changed = False
    disambig_changed = False

    for credit in credits:
        name = credit["name"]
        key = name.strip().lower()
        entry = artist_index.get(key)

        if entry is None:
            artist_id = slugify(name)
            suffix = 2
            while artist_id in existing_ids:
                artist_id = f"{slugify(name)}-{suffix}"
                suffix += 1
            entry = {
                "id": artist_id,
                "name": name,
                "description": "",
                "imageUrl": None,
                "references": [],
            }
            artists.append(entry)
            artist_index[key] = entry
            existing_ids.add(artist_id)
            artists_changed = True
            print(f"    new artist: {name} ({artist_id})")

            if credit.get("metronId"):
                dkey = f"{SOURCE_METRON}:creator"
                bucket = disambig.setdefault(dkey, {})
                if not isinstance(bucket.get(name), dict) or not bucket[name].get("id"):
                    bucket[name] = {"id": credit["metronId"]}
                    disambig_changed = True

        if credit.get("metronId"):
            before = len(entry.get("references", []))
            ensure_reference(entry, "Metron", f"https://metron.cloud/creator/{credit['metronId']}/")
            if len(entry.get("references", [])) != before:
                artists_changed = True
        if credit.get("cvUrl"):
            before = len(entry.get("references", []))
            ensure_reference(entry, "Comic Vine", credit["cvUrl"])
            if len(entry.get("references", [])) != before:
                artists_changed = True

        credit["artistId"] = entry["id"]

    return artists_changed, disambig_changed


def get_gallery_issue_pairs(panels: list) -> list[tuple[str, int]]:
    """Distinct (series slug, integer issue) pairs present in the gallery."""
    pairs = set()
    for panel in panels:
        slug = panel.get("slug")
        issue = panel.get("issue")
        if slug and isinstance(issue, (int, float)):
            pairs.add((slug, int(issue)))
    return sorted(pairs)


def backfill_issue_credits(panels: list) -> int:
    """
    For every gallery (series, issue) pair without credits, fetch creator
    credits from Metron (preferred) or Comic Vine and write them to
    issues.json. Promotes credited creators into artists.json.
    """
    metron_username = os.environ.get("METRON_USERNAME")
    metron_password = os.environ.get("METRON_PASSWORD")
    cv_api_key = os.environ.get("COMIC_VINE_API_KEY")
    metron_enabled = bool(metron_username and metron_password)
    cv_enabled = bool(cv_api_key)
    if not metron_enabled and not cv_enabled:
        print("  SKIP issue credits backfill (no Metron or Comic Vine credentials set).")
        return 0

    series_data = json.loads(SERIES_PATH.read_text()) if SERIES_PATH.exists() else {"series": []}
    series_by_slug = {s.get("id"): s for s in series_data.get("series", [])}
    series_dirty = False

    if ISSUES_PATH.exists():
        issues_data = json.loads(ISSUES_PATH.read_text())
    else:
        issues_data = {"issues": []}
    issues = issues_data.get("issues", [])
    issues_by_key = {(e.get("series"), e.get("issue")): e for e in issues}

    artists_data = json.loads(ARTISTS_PATH.read_text()) if ARTISTS_PATH.exists() else {"artists": []}
    artists = artists_data.get("artists", [])
    artist_index: dict = {}
    for a in artists:
        artist_index[(a.get("name") or "").strip().lower()] = a
        for alias in a.get("aliases") or []:
            artist_index.setdefault(alias.strip().lower(), a)
    artist_ids = {a.get("id") for a in artists}
    artists_dirty = False

    disambig = load_disambiguation()
    disambig_dirty = False

    metron_health = IntegrationHealth("Metron")
    cv_health = IntegrationHealth("Comic Vine")
    metron_series_cache: dict[str, int | None] = {}

    updated = 0
    issues_dirty = False

    for slug, issue_number in get_gallery_issue_pairs(panels):
        if metron_health.should_bail and cv_health.should_bail:
            break

        series_entry = series_by_slug.get(slug)
        if not series_entry:
            continue

        entry = issues_by_key.get((slug, issue_number))
        if entry is None:
            entry = {
                "id": f"{slug}-{issue_number}",
                "series": slug,
                "issue": issue_number,
                "credits": [],
                "references": [],
            }
        if entry.get("credits"):
            continue

        result = None
        source_used = None
        entry_changed = False

        # --- Metron (preferred: structured roles) ---
        if (metron_enabled and not metron_health.should_bail
                and not has_source(entry, SOURCE_METRON)):
            if slug not in metron_series_cache:
                mid, dchanged = resolve_metron_series_id(
                    series_entry, metron_username, metron_password,
                    disambig, metron_health,
                )
                metron_series_cache[slug] = mid
                if dchanged:
                    disambig_dirty = True
                if mid:
                    series_dirty = True

            mid = metron_series_cache[slug]
            if mid:
                print(f"  Fetching Metron credits for {slug} #{issue_number}...")
                result = fetch_metron_issue_credits(
                    mid, issue_number, metron_username, metron_password, metron_health,
                )
                if result is not None:
                    # Only mark after a definite answer — a failed request
                    # (None) stays unmarked so the next run retries.
                    mark_source(entry, SOURCE_METRON)
                    entry_changed = True
                    source_used = "Metron"
                    if not result["credits"]:
                        print(f"    no credits found on Metron")
                        result = None
            # Unresolved series stay unmarked so a later manual
            # disambiguation (or a Metron ref appearing) retries them.

        # --- Comic Vine fallback ---
        if (result is None and cv_enabled and not cv_health.should_bail
                and not has_source(entry, SOURCE_COMICVINE)):
            volume_id = extract_comicvine_volume_id(series_entry)
            if volume_id:
                print(f"  Fetching Comic Vine credits for {slug} #{issue_number}...")
                result = fetch_comicvine_issue_credits(
                    volume_id, issue_number, cv_api_key, cv_health,
                )
                if result is not None:
                    mark_source(entry, SOURCE_COMICVINE)
                    entry_changed = True
                    source_used = "Comic Vine"
                    if not result["credits"]:
                        print(f"    no credits found on Comic Vine")
                        result = None

        if result and result["credits"]:
            credits = result["credits"]
            achanged, dchanged = promote_creators(
                credits, artists, artist_index, artist_ids, disambig,
            )
            artists_dirty = artists_dirty or achanged
            disambig_dirty = disambig_dirty or dchanged

            entry["credits"] = [
                {"artistId": c["artistId"], "name": c["name"], "roles": c["roles"]}
                for c in credits
            ]
            sort_credits(entry["credits"])
            if result.get("url") and source_used:
                ensure_reference(entry, source_used, result["url"])
            roles_summary = ", ".join(
                f"{c['name']} ({'/'.join(c['roles'])})" for c in entry["credits"][:4]
            )
            print(f"    credits: {roles_summary}"
                  + ("..." if len(entry["credits"]) > 4 else ""))

        if entry_changed:
            if (slug, issue_number) not in issues_by_key:
                issues.append(entry)
                issues_by_key[(slug, issue_number)] = entry
            issues_dirty = True
            updated += 1

    if issues_dirty:
        issues.sort(key=lambda e: (e.get("series") or "", e.get("issue") or 0))
        ISSUES_PATH.write_text(json.dumps({"issues": issues}, indent=2) + "\n")
        print(f"  Processed {updated} issue entr(ies) in {ISSUES_PATH}.")
    if artists_dirty:
        artists.sort(key=lambda a: a["name"])
        ARTISTS_PATH.write_text(json.dumps({"artists": artists}, indent=2) + "\n")
    if series_dirty:
        SERIES_PATH.write_text(json.dumps(series_data, indent=2) + "\n")
    if disambig_dirty:
        save_disambiguation(disambig)

    return updated
