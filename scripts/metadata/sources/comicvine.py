import json
import os
import re
import sys
import time
from pathlib import Path

import requests

from ..health import IntegrationHealth
from ..references import (
    SOURCE_COMICVINE,
    _set_if_missing,
    ensure_reference,
    has_source,
    mark_source,
)
from ..text import extract_year, is_meaningful_description, strip_html
from . import API_HEADERS, MAX_COVER_IMAGES, pick_exact_match

COMIC_VINE_BASE = "https://comicvine.gamespot.com/api"
COMIC_VINE_HEADERS = API_HEADERS

COMIC_VINE_VOLUME_ID_RE = re.compile(r"/4050-(\d+)")


def comic_vine_search(resource: str, name: str, api_key: str,
                      health: IntegrationHealth | None = None) -> list:
    """
    Search a Comic Vine resource (e.g. 'people', 'volumes') by name.

    Returns the raw results list, or [] on any failure.
    """
    params = {
        "api_key": api_key,
        "format": "json",
        "filter": f"name:{name}",
        "limit": 20,
    }
    try:
        resp = requests.get(
            f"{COMIC_VINE_BASE}/{resource}/",
            params=params,
            headers=COMIC_VINE_HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status_code") != 1:
            error = str(data.get("error") or "")
            if health and ("rate" in error.lower() or "limit" in error.lower()):
                health.mark_throttled(f"API error: {error}")
            print(f"    WARN: Comic Vine {resource} error: {error}", file=sys.stderr)
            return []
        return data.get("results", []) or []
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"    WARN: Comic Vine {resource} fetch timed out for {name!r}", file=sys.stderr)
        return []
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"    WARN: Comic Vine {resource} fetch failed for {name!r}: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"    WARN: Comic Vine {resource} fetch failed for {name!r}: {e}", file=sys.stderr)
        return []


def ensure_comicvine_reference(entry: dict, site_url: str) -> None:
    """Add a Comic Vine reference to `entry` if one isn't already present."""
    ensure_reference(entry, "Comic Vine", site_url)


def extract_comicvine_image(match: dict) -> str | None:
    """Return the best available image URL from a Comic Vine result's `image` object."""
    image = match.get("image") or {}
    for field in ("super_url", "original_url", "screen_large_url", "screen_url", "medium_url"):
        url = image.get(field)
        if url:
            return url
    return None


def extract_comicvine_volume_id(series_entry: dict) -> str | None:
    """Pull the Comic Vine volume ID from the stored reference URL."""
    for ref in series_entry.get("references", []):
        if (ref.get("name") or "").strip().lower() == "comic vine":
            m = COMIC_VINE_VOLUME_ID_RE.search(ref.get("url") or "")
            if m:
                return m.group(1)
    return None


def extract_artist_fields(match: dict) -> dict:
    """Pull supplemental fields from a Comic Vine `/people/` result."""
    aliases_raw = (match.get("aliases") or "").strip()
    aliases = [a.strip() for a in aliases_raw.splitlines() if a.strip()] if aliases_raw else []
    return {
        "birthYear": extract_year(match.get("birth")),
        "deathYear": extract_year(match.get("death")),
        "country": (match.get("country") or "").strip() or None,
        "aliases": aliases or None,
    }


def extract_series_fields(match: dict) -> dict:
    """Pull supplemental fields from a Comic Vine `/volumes/` result."""
    aliases_raw = (match.get("aliases") or "").strip()
    aliases = [a.strip() for a in aliases_raw.splitlines() if a.strip()] if aliases_raw else []
    publisher = (match.get("publisher") or {}).get("name")
    start_year = match.get("start_year")
    try:
        start_year = int(start_year) if start_year else None
    except (TypeError, ValueError):
        start_year = None
    issue_count = match.get("count_of_issues")
    try:
        issue_count = int(issue_count) if issue_count else None
    except (TypeError, ValueError):
        issue_count = None
    return {
        "startYear": start_year,
        "publisher": publisher,
        "issueCount": issue_count,
        "aliases": aliases or None,
    }


def backfill_comicvine(path: Path, key: str, resource: str, tiebreak_key: str | None) -> int:
    """
    For entries in `path` missing a description, imageUrl, or supplemental
    fields, search Comic Vine and fill in whichever fields are missing. Adds
    a Comic Vine reference whenever any field is populated from Comic Vine.

    `resource` is the Comic Vine endpoint ('people' or 'volumes').
    """
    api_key = os.environ.get("COMIC_VINE_API_KEY")
    if not api_key:
        print(f"  SKIP Comic Vine backfill for {path} (COMIC_VINE_API_KEY not set).")
        return 0
    if not path.exists():
        return 0

    extract_supplemental = extract_artist_fields if resource == "people" else extract_series_fields

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    health = IntegrationHealth("Comic Vine")

    for entry in entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_COMICVINE):
            continue

        name = entry.get("name")
        if not name:
            continue

        print(f"  Searching Comic Vine ({resource}) for {name}...")
        results = comic_vine_search(resource, name, api_key, health=health)
        time.sleep(1.0)  # be polite — Comic Vine rate-limits per resource

        match = pick_exact_match(results, name, tiebreak_key=tiebreak_key)
        if not match:
            print(f"    SKIP: no exact match ({len(results)} candidate(s))")
            mark_source(entry, SOURCE_COMICVINE)
            updated += 1
            continue

        site_url = match.get("site_detail_url")
        if not site_url:
            print(f"    SKIP: match has no site_detail_url")
            mark_source(entry, SOURCE_COMICVINE)
            updated += 1
            continue

        changed = False

        if not is_meaningful_description(entry.get("description") or ""):
            raw_desc = match.get("description") or match.get("deck") or ""
            clean = strip_html(raw_desc) if raw_desc else ""
            if is_meaningful_description(clean):
                entry["description"] = clean
                changed = True
                print(f"    desc: {clean[:80]}...")
            elif clean:
                print(f"    skip desc: too short ({len(clean)} chars)")

        if not entry.get("imageUrl"):
            img_url = extract_comicvine_image(match)
            if img_url:
                entry["imageUrl"] = img_url
                changed = True
                print(f"    image: {img_url}")

        for field, value in extract_supplemental(match).items():
            if _set_if_missing(entry, field, value):
                changed = True
                print(f"    {field}: {value}")

        if changed:
            ensure_comicvine_reference(entry, site_url)

        mark_source(entry, SOURCE_COMICVINE)
        updated += 1
        if not changed:
            print(f"    SKIP: match found but no new fields")

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Processed {updated} entr(ies) in {path} via Comic Vine.")

    return updated


def fetch_comicvine_covers(series_entry: dict, gallery_issues: list[int],
                           api_key: str,
                           health: IntegrationHealth | None = None) -> list[str]:
    """
    Fetch cover image URLs from Comic Vine for a series, prioritizing
    issues that appear in the gallery. Returns at most MAX_COVER_IMAGES URLs.
    """
    volume_id = extract_comicvine_volume_id(series_entry)
    if not volume_id:
        return []

    params = {
        "api_key": api_key,
        "format": "json",
        "filter": f"volume:{volume_id}",
        "field_list": "image,issue_number",
        "limit": 100,
    }
    try:
        resp = requests.get(
            f"{COMIC_VINE_BASE}/issues/",
            params=params,
            headers=COMIC_VINE_HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"    WARN: Comic Vine issues fetch timed out for volume {volume_id}", file=sys.stderr)
        return []
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"    WARN: Comic Vine issues fetch failed for volume {volume_id}: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"    WARN: Comic Vine issues fetch failed for volume {volume_id}: {e}", file=sys.stderr)
        return []
    finally:
        time.sleep(1.0)

    if data.get("status_code") != 1:
        return []
    issues = data.get("results", []) or []

    gallery_covers: list[str] = []
    other_covers: list[str] = []
    for issue in issues:
        img_url = extract_comicvine_image(issue)
        if not img_url:
            continue
        issue_num = issue.get("issue_number")
        try:
            issue_num = int(issue_num) if issue_num else None
        except (TypeError, ValueError):
            issue_num = None
        if issue_num and issue_num in gallery_issues:
            gallery_covers.append(img_url)
        else:
            other_covers.append(img_url)

    covers = gallery_covers[:MAX_COVER_IMAGES]
    remaining = MAX_COVER_IMAGES - len(covers)
    if remaining > 0:
        covers.extend(other_covers[:remaining])
    return covers
