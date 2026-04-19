#!/usr/bin/env python3
"""
Compute image dimensions, perceptual hashes, dominant colors, and a
colorfulness score for gallery panels missing any of these fields.

Reads gallery.json, finds entries missing any metadata field, computes all
fields from the corresponding image files, and writes the updated gallery.json
back. Panels that already have every field are skipped.

Dominant colors are extracted via k-means clustering in CIELAB color space,
stored as arrays of [L, a, b] values rounded to one decimal place.

Colorfulness is the root-mean-square of the standard deviations of the a* and
b* channels across all pixels. Truly achromatic images (B&W line art, greyscale
washes) score very low (~0–5) regardless of paper yellowing or scan tint,
because the chromatic channels have almost no *variance* even if their mean is
slightly nonzero. Richly colored panels typically score 15+.
"""

import argparse
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests
from PIL import Image
from sklearn.cluster import KMeans
from skimage import color as skcolor
import imagehash

GALLERY_PATH = Path("public/data/gallery.json")
ARTISTS_PATH = Path("public/data/artists.json")
SERIES_PATH = Path("public/data/series.json")
DISAMBIGUATION_PATH = Path("public/data/disambiguation.json")
IMAGE_ROOT = Path("public")

HASH_FUNCTIONS = {
    "phash": imagehash.phash, # DCT-based, good structural similarity
    "ahash": imagehash.average_hash, # brightness-based
    "dhash": imagehash.dhash,  # gradient/edge-based
}

NUM_DOMINANT_COLORS = 3

METADATA_FIELDS = (
    {"width", "height", "dominantColors", "colorfulness"}
    | set(HASH_FUNCTIONS.keys())
)


class IntegrationHealth:
    """Per-integration bail-out tracker.

    Once an integration hits a timeout or rate-limit, `mark_throttled` flips
    `should_bail` so the outer loop can stop after the current entry instead
    of burning through every remaining entry's retry/backoff cycle.
    """

    def __init__(self, name: str):
        self.name = name
        self.should_bail = False

    def mark_throttled(self, reason: str) -> None:
        if self.should_bail:
            return
        print(
            f"    {self.name}: {reason} — skipping remaining entries after this one",
            file=sys.stderr,
        )
        self.should_bail = True


def needs_update(panel: dict) -> bool:
    """Return True if any metadata field is missing or null."""
    return any(panel.get(field) is None for field in METADATA_FIELDS)


def extract_dominant_colors(pixels_lab: np.ndarray, k: int = NUM_DOMINANT_COLORS) -> list:
    """
    Extract k dominant colors from CIELAB pixel data using k-means.

    Returns a list of [L, a, b] arrays sorted by cluster size (most dominant
    first), with values rounded to one decimal place.
    """
    kmeans = KMeans(n_clusters=k, n_init=10, random_state=42)
    kmeans.fit(pixels_lab)

    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    order = np.argsort(-counts)
    centers = kmeans.cluster_centers_[order]

    return [[round(float(v), 1) for v in c] for c in centers]


def compute_colorfulness(pixels_lab: np.ndarray) -> float:
    """
    Compute a colorfulness score from CIELAB pixel data.

    Uses the RMS of the standard deviations of the a* and b* channels.
    This captures how much chromatic variation exists in the image:
      - B&W art with warm paper tint: low variance in a,b → low score
      - Richly colored panels: high variance in a,b → high score

    Returns a float rounded to one decimal place.
    """
    std_a = np.std(pixels_lab[:, 1])
    std_b = np.std(pixels_lab[:, 2])
    score = np.sqrt(std_a ** 2 + std_b ** 2)
    return round(float(score), 1)


def compute_metadata(image_path: Path) -> dict:
    """Open an image and return dimensions, perceptual hashes, dominant colors,
    and colorfulness score."""
    img = Image.open(image_path)

    # Shared thumbnail for color analysis
    thumb = img.copy()
    thumb.thumbnail((64, 64))
    thumb = thumb.convert("RGB")

    pixels_rgb = np.array(thumb).reshape(-1, 3) / 255.0
    pixels_lab = skcolor.rgb2lab(pixels_rgb.reshape(1, -1, 3)).reshape(-1, 3)

    result = {
        "width": img.width,
        "height": img.height,
        "dominantColors": extract_dominant_colors(pixels_lab),
        "colorfulness": compute_colorfulness(pixels_lab),
    }
    for name, fn in HASH_FUNCTIONS.items():
        result[name] = str(fn(img))
    return result


def get_wikipedia_title(url: str) -> str | None:
    """Extract the article title from a Wikipedia URL."""
    m = re.match(r"https?://en\.wikipedia\.org/wiki/(.+)", url)
    return m.group(1) if m else None


def fetch_wikipedia_intro(url: str, health: IntegrationHealth | None = None) -> str | None:
    """
    Fetch the introductory section of a Wikipedia article as plain text.

    Uses the MediaWiki API to get the full intro section (everything before
    the first heading), removes bracketed reference markers like [1][2],
    and converts newlines to \\r\\n.
    """
    title = get_wikipedia_title(url)
    if not title:
        return None

    api_url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "titles": title.replace("_", " "),
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "format": "json",
    }
    try:
        resp = requests.get(api_url, params=params, headers={"User-Agent": "comic-snaps/1.0"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        pages = data.get("query", {}).get("pages", {})
        page = next(iter(pages.values()), {})
        text = page.get("extract", "")
        if not text:
            return None
        # Remove reference markers like [1], [2], [note 1], etc.
        text = re.sub(r"\[[\w\s]*\d+\]", "", text)
        # Normalize whitespace that may result from removed refs
        text = re.sub(r"  +", " ", text).strip()
        # Convert newlines to \r\n
        text = text.replace("\n", "\r\n\r\n")
        return text
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"  WARN: Wikipedia fetch timed out for {url}", file=sys.stderr)
        return None
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None


COMIC_VINE_BASE = "https://comicvine.gamespot.com/api"
COMIC_VINE_HEADERS = {"User-Agent": "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)"}

METRON_BASE = "https://metron.cloud/api"
GCD_BASE = "https://www.comics.org/api"
API_HEADERS = {"User-Agent": "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)"}

# Source identifiers for tracking which sources have processed an entry
SOURCE_WIKIPEDIA = "wikipedia"
SOURCE_COMICVINE = "comicvine"
SOURCE_METRON = "metron"
SOURCE_GCD = "gcd"

MAX_COVER_IMAGES = 4


MIN_DESCRIPTION_CHARS = 40
MIN_DESCRIPTION_WORDS = 5


def strip_html(raw: str) -> str:
    """
    Convert a Comic Vine HTML description to plain text with \\r\\n\\r\\n paragraph
    separators, preserving paragraph breaks and list items while discarding images
    and trailing "List of issues"-style sections.
    """
    text = raw
    # Drop figures/images entirely — they carry no textual content
    text = re.sub(r"<figure[^>]*>.*?</figure>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<img[^>]*/?>", "", text, flags=re.IGNORECASE)
    # Comic Vine descriptions often end with headings like "List of issues" or
    # "Collected editions" — truncate at the first heading to keep the intro only.
    text = re.split(r"<h[1-6][^>]*>", text, maxsplit=1, flags=re.IGNORECASE)[0]
    # Preserve structural breaks before stripping remaining tags
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    # Collapse whitespace and rebuild paragraphs
    text = re.sub(r"[ \t]+", " ", text)
    paragraphs = [re.sub(r"\s*\n\s*", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    paragraphs = [p for p in paragraphs if p]
    return "\r\n\r\n".join(paragraphs)


def is_meaningful_description(text: str) -> bool:
    """Reject descriptions that are too short to be useful (e.g. "Artist.")."""
    stripped = text.strip()
    if len(stripped) < MIN_DESCRIPTION_CHARS:
        return False
    if len(stripped.split()) < MIN_DESCRIPTION_WORDS:
        return False
    return True


def extract_year(raw) -> int | None:
    """
    Extract a 4-digit year from a Comic Vine birth/death field. The field may
    be a string ('Dec 1, 1957'), a dict ({'date': '1957-02-01 00:00:00', ...}),
    or None.
    """
    if not raw:
        return None
    if isinstance(raw, dict):
        raw = raw.get("date") or raw.get("year") or ""
    if not isinstance(raw, str):
        raw = str(raw)
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", raw)
    return int(m.group(1)) if m else None


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


def pick_exact_match(results: list, name: str, tiebreak_key: str | None = None) -> dict | None:
    """
    Pick the result whose name matches `name` case-insensitively.

    If multiple exact matches exist and `tiebreak_key` is provided, pick the
    one with the highest numeric value for that key (e.g. count_of_issues).
    Returns None if no exact match.
    """
    norm = name.strip().lower()
    exact = [r for r in results if (r.get("name") or "").strip().lower() == norm]
    if not exact:
        return None
    if len(exact) == 1 or not tiebreak_key:
        return exact[0]
    return max(exact, key=lambda r: int(r.get(tiebreak_key) or 0))


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


def _set_if_missing(entry: dict, field: str, value) -> bool:
    """Set `entry[field] = value` only if missing/empty. Returns True if changed."""
    if value in (None, "", [], {}):
        return False
    existing = entry.get(field)
    if existing not in (None, "", [], {}):
        return False
    entry[field] = value
    return True


def has_source(entry: dict, source_id: str) -> bool:
    """Check if an entry has already been processed by the given source."""
    return source_id in entry.get("sources", [])


def mark_source(entry: dict, source_id: str) -> None:
    """Record that a source has processed this entry (even if nothing was found)."""
    sources = entry.setdefault("sources", [])
    if source_id not in sources:
        sources.append(source_id)


def ensure_reference(entry: dict, name: str, url: str) -> None:
    """Add a reference to `entry` if one with the same name isn't already present."""
    refs = entry.setdefault("references", [])
    for ref in refs:
        if (ref.get("name") or "").strip().lower() == name.strip().lower():
            return
    refs.append({"name": name, "url": url})


# ---------------------------------------------------------------------------
# Disambiguation — manual overrides for ambiguous search results
# ---------------------------------------------------------------------------

def load_disambiguation() -> dict:
    """Load the disambiguation file. Returns the parsed dict or empty structure."""
    if DISAMBIGUATION_PATH.exists():
        return json.loads(DISAMBIGUATION_PATH.read_text())
    return {}


def save_disambiguation(data: dict) -> None:
    """Write the disambiguation file back to disk."""
    DISAMBIGUATION_PATH.write_text(json.dumps(data, indent=2) + "\n")


def get_disambiguation_id(data: dict, source: str, resource: str, name: str) -> int | None:
    """
    Look up a manually-assigned ID for (source, resource, name).
    Returns the ID if resolved, None otherwise.
    """
    key = f"{source}:{resource}"
    entry = data.get(key, {}).get(name)
    if isinstance(entry, dict) and entry.get("id"):
        return entry["id"]
    return None


def record_disambiguation_candidates(
    data: dict, source: str, resource: str, name: str, candidates: list
) -> None:
    """
    Record unresolved candidates so the user can pick the right one later.
    Only writes if there isn't already an entry for this name.
    """
    key = f"{source}:{resource}"
    section = data.setdefault(key, {})
    if name in section:
        return  # don't overwrite existing entry (may already be resolved)
    section[name] = {
        "id": None,
        "candidates": [
            {"id": c.get("id"), "name": c.get("name")}
            for c in candidates[:10]  # cap at 10 to keep file manageable
        ],
    }


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
    supplemental_keys = ("birthYear", "deathYear", "country", "aliases") if resource == "people" \
        else ("startYear", "publisher", "issueCount", "aliases")

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


def backfill_wikipedia_descriptions(path: Path, key: str) -> int:
    """
    For entries in the given JSON file that have a Wikipedia reference
    but no description, fetch the intro from Wikipedia and fill it in.

    Returns the number of entries updated.
    """
    if not path.exists():
        return 0

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    health = IntegrationHealth("Wikipedia")

    for entry in entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_WIKIPEDIA):
            continue

        wiki_url = None
        for ref in entry.get("references", []):
            if ref.get("name", "").lower() == "wikipedia":
                wiki_url = ref.get("url")
                break

        if not wiki_url:
            continue

        desc = entry.get("description", "")
        if desc and desc.strip():
            mark_source(entry, SOURCE_WIKIPEDIA)
            updated += 1
            continue

        print(f"  Fetching Wikipedia intro for {entry.get('name', entry.get('id'))}...")
        intro = fetch_wikipedia_intro(wiki_url, health=health)
        if intro and is_meaningful_description(intro):
            entry["description"] = intro
            print(f"    OK: {intro[:80]}...")
        elif intro:
            print(f"    SKIP: intro too short ({len(intro)} chars)")
        else:
            print(f"    SKIP: no intro text found")

        mark_source(entry, SOURCE_WIKIPEDIA)
        updated += 1

        # Be polite to Wikipedia
        time.sleep(0.5)

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Updated {updated} entr(ies) in {path} from Wikipedia.")

    return updated


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


# ---------------------------------------------------------------------------
# GCD (Grand Comics Database) backfill — series only
# ---------------------------------------------------------------------------

GCD_MAX_RETRIES = 4
GCD_BASE_SLEEP = 5.0  # seconds between GCD requests


def _gcd_request(url: str, params: dict | None = None,
                 health: IntegrationHealth | None = None) -> requests.Response | None:
    """
    Make a GCD API request with retry + exponential backoff on 429s.
    Returns the Response on success, or None after exhausting retries.
    """
    for attempt in range(GCD_MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, headers=API_HEADERS, timeout=15)
            if resp.status_code == 429:
                if health:
                    health.mark_throttled("rate limited (429)")
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

        # Store the GCD API URL for later use (cover image fetching)
        if not entry.get("_gcd_api_url"):
            entry["_gcd_api_url"] = match.get("api_url")

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


# ---------------------------------------------------------------------------
# Cover image fetching (Metron + GCD)
# ---------------------------------------------------------------------------

def get_gallery_issues_for_series(panels: list, series_slug: str) -> list[int]:
    """Return sorted list of issue numbers from the gallery for a given series."""
    issues = set()
    for panel in panels:
        if panel.get("slug") == series_slug:
            issue = panel.get("issue")
            if isinstance(issue, (int, float)):
                issues.add(int(issue))
    return sorted(issues)


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


def fetch_gcd_covers(series_entry: dict, gallery_issues: list[int],
                     health: IntegrationHealth | None = None) -> list[str]:
    """
    Fetch cover image URLs from GCD for a series. Prioritizes issues
    that appear in the gallery, then fills remaining slots.
    """
    api_url = series_entry.get("_gcd_api_url")
    if not api_url:
        # Reconstruct the API URL from the stored GCD reference
        for ref in series_entry.get("references", []):
            if (ref.get("name") or "").strip().lower() == "grand comics database":
                m = re.search(r"/series/(\d+)", ref.get("url", ""))
                if m:
                    api_url = f"{GCD_BASE}/series/{m.group(1)}/"
                    break
    if not api_url:
        # No stored reference — search GCD by name
        name = series_entry.get("name")
        if not name:
            return []
        results = gcd_search_series(name, health=health)
        time.sleep(GCD_BASE_SLEEP)
        if not results:
            return []
        match = pick_gcd_series_match(results, name, series_entry.get("startYear"))
        if not match:
            return []
        api_url = match.get("api_url")
        # Store the reference for future runs
        web_url = gcd_series_web_url(match)
        if web_url:
            ensure_reference(series_entry, "Grand Comics Database", web_url)
    if not api_url:
        return []

    series_data = gcd_fetch_json(api_url, health=health)
    time.sleep(GCD_BASE_SLEEP)
    if not series_data:
        return []

    # active_issues is a list of issue API URLs
    issue_urls = series_data.get("active_issues") or []
    if not issue_urls:
        return []

    # Fetch a limited sample of issues to find covers
    gallery_covers = []
    other_covers = []
    fetched = 0
    max_fetches = min(len(issue_urls), 15)  # cap to avoid excessive requests

    for issue_url in issue_urls[:max_fetches]:
        issue_data = gcd_fetch_json(issue_url, health=health)
        time.sleep(GCD_BASE_SLEEP)
        fetched += 1
        if not issue_data:
            continue

        cover_url = issue_data.get("cover")
        if not cover_url:
            continue

        issue_num = issue_data.get("number")
        try:
            issue_num = int(issue_num) if issue_num else None
        except (TypeError, ValueError):
            issue_num = None

        if issue_num and issue_num in gallery_issues:
            gallery_covers.append(cover_url)
        else:
            other_covers.append(cover_url)

        # Stop early if we have enough
        if len(gallery_covers) + len(other_covers) >= MAX_COVER_IMAGES:
            break

    covers = gallery_covers[:MAX_COVER_IMAGES]
    remaining = MAX_COVER_IMAGES - len(covers)
    if remaining > 0:
        covers.extend(other_covers[:remaining])

    return covers


def backfill_cover_images(path: Path, panels: list) -> int:
    """
    For series entries missing coverImages, fetch up to 4 cover image URLs
    from Metron and/or GCD. Prioritizes covers for issues that appear in
    the gallery.
    """
    if not path.exists():
        return 0

    username = os.environ.get("METRON_USERNAME")
    password = os.environ.get("METRON_PASSWORD")

    data = json.loads(path.read_text())
    entries = data.get("series", [])
    updated = 0

    metron_health = IntegrationHealth("Metron")
    gcd_health = IntegrationHealth("GCD")

    for entry in entries:
        existing = entry.get("coverImages") or []
        if len(existing) >= MAX_COVER_IMAGES:
            continue

        series_slug = entry.get("id")
        if not series_slug:
            continue

        # Both integrations are bailed — nothing more we can do
        if metron_health.should_bail and gcd_health.should_bail:
            break

        gallery_issues = get_gallery_issues_for_series(panels, series_slug)
        covers = list(existing)

        # Try Metron first
        if username and password and not metron_health.should_bail and len(covers) < MAX_COVER_IMAGES:
            metron_covers = fetch_metron_covers(
                entry, gallery_issues, username, password, health=metron_health
            )
            for url in metron_covers:
                if url not in covers and len(covers) < MAX_COVER_IMAGES:
                    covers.append(url)

        # Supplement with GCD
        if not gcd_health.should_bail and len(covers) < MAX_COVER_IMAGES:
            gcd_covers = fetch_gcd_covers(entry, gallery_issues, health=gcd_health)
            for url in gcd_covers:
                if url not in covers and len(covers) < MAX_COVER_IMAGES:
                    covers.append(url)

        if covers and covers != existing:
            entry["coverImages"] = covers
            updated += 1
            print(f"  {entry.get('name')}: {len(covers)} cover(s)")

    # Clean up temporary _gcd_api_url fields
    has_temp_fields = any("_gcd_api_url" in e for e in entries)
    for entry in entries:
        entry.pop("_gcd_api_url", None)

    if updated or has_temp_fields:
        data["series"] = entries
        path.write_text(json.dumps(data, indent=2) + "\n")
        if updated:
            print(f"  Fetched covers for {updated} series.")

    return updated


def slugify(name: str) -> str:
    """Convert a name to a URL-friendly slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def seed_artists(panels: list) -> None:
    """Create artists.json with distinct artist names from the gallery."""
    if ARTISTS_PATH.exists():
        return

    seen = set()
    artists = []
    for panel in panels:
        name = panel.get("artist", "")
        if name and name not in seen:
            seen.add(name)
            artists.append({
                "id": slugify(name),
                "name": name,
                "description": "",
                "imageUrl": None,
                "references": [],
            })

    artists.sort(key=lambda a: a["name"])
    ARTISTS_PATH.write_text(json.dumps({"artists": artists}, indent=2) + "\n")
    print(f"Seeded {ARTISTS_PATH} with {len(artists)} artist(s).")


def seed_series(panels: list) -> None:
    """Create series.json with distinct series names from the gallery."""
    if SERIES_PATH.exists():
        return

    seen = set()
    series_list = []
    for panel in panels:
        title = panel.get("title", "")
        slug = panel.get("slug", "")
        if title and slug and slug not in seen:
            seen.add(slug)
            series_list.append({
                "id": slug,
                "name": title,
                "parentSeries": None,
                "description": "",
                "imageUrl": None,
                "references": [],
            })

    series_list.sort(key=lambda s: s["name"])
    SERIES_PATH.write_text(json.dumps({"series": series_list}, indent=2) + "\n")
    print(f"Seeded {SERIES_PATH} with {len(series_list)} series.")


def main():
    parser = argparse.ArgumentParser(
        description="Compute image metadata and backfill series/artist data from external sources."
    )
    parser.add_argument(
        "--skip-gcd", action="store_true",
        help="Skip Grand Comics Database backfill and GCD cover image fetching. "
             "Useful in CI where GCD's strict rate limits cause 429 errors.",
    )
    args = parser.parse_args()

    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

    # Seed artists.json and series.json if they don't exist
    seed_artists(panels)
    seed_series(panels)

    # Backfill descriptions from Wikipedia where available
    print("Backfilling Wikipedia descriptions...")
    wiki_updated = 0
    wiki_updated += backfill_wikipedia_descriptions(ARTISTS_PATH, "artists")
    wiki_updated += backfill_wikipedia_descriptions(SERIES_PATH, "series")
    if wiki_updated:
        print(f"Backfilled {wiki_updated} Wikipedia description(s) total.")
    else:
        print("No Wikipedia descriptions needed backfilling.")

    # Backfill remaining descriptions from Comic Vine
    print("Backfilling Comic Vine data...")
    cv_updated = 0
    cv_updated += backfill_comicvine(ARTISTS_PATH, "artists", "people", tiebreak_key=None)
    cv_updated += backfill_comicvine(SERIES_PATH, "series", "volumes", tiebreak_key="count_of_issues")
    if cv_updated:
        print(f"Processed {cv_updated} entr(ies) via Comic Vine.")
    else:
        print("No Comic Vine entries needed processing.")

    # Backfill from Metron
    print("Backfilling Metron data...")
    mt_updated = 0
    mt_updated += backfill_metron(ARTISTS_PATH, "artists", "creator", tiebreak_key=None)
    mt_updated += backfill_metron(SERIES_PATH, "series", "series", tiebreak_key=None)
    if mt_updated:
        print(f"Processed {mt_updated} entr(ies) via Metron.")
    else:
        print("No Metron entries needed processing.")

    # Backfill from Grand Comics Database (series only)
    if args.skip_gcd:
        print("Skipping GCD backfill (--skip-gcd).")
    else:
        print("Backfilling GCD data...")
        gcd_updated = backfill_gcd(SERIES_PATH, "series")
        if gcd_updated:
            print(f"Processed {gcd_updated} series via GCD.")
        else:
            print("No GCD entries needed processing.")

    # Fetch cover images for series from Metron and GCD
    print("Fetching cover images...")
    covers_updated = backfill_cover_images(SERIES_PATH, panels)
    if covers_updated:
        print(f"Fetched covers for {covers_updated} series.")
    else:
        print("No cover images needed fetching.")

    updated_count = 0
    error_count = 0

    for panel in panels:
        if not needs_update(panel):
            continue

        image_path = IMAGE_ROOT / panel["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {panel['image']}", file=sys.stderr)
            error_count += 1
            continue

        try:
            meta = compute_metadata(image_path)
            panel.update(meta)
            updated_count += 1
            colors_preview = " | ".join(
                f"L={c[0]} a={c[1]} b={c[2]}" for c in meta["dominantColors"]
            )
            print(
                f"  OK: {panel['image']} → "
                f"{meta['width']}x{meta['height']} "
                f"phash={meta['phash']} "
                f"colorfulness={meta['colorfulness']} "
                f"colors=[{colors_preview}]"
            )
        except Exception as e:
            print(f"  ERROR: {panel['image']} → {e}", file=sys.stderr)
            error_count += 1

    if updated_count == 0:
        print("No panels needed updating.")
        sys.exit(0)

    GALLERY_PATH.write_text(json.dumps(gallery, indent=2) + "\n")
    print(f"\nUpdated {updated_count} panel(s). Errors: {error_count}.")


if __name__ == "__main__":
    main()