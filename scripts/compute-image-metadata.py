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

import html
import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from sklearn.cluster import KMeans
from skimage import color as skcolor
import imagehash

GALLERY_PATH = Path("public/data/gallery.json")
ARTISTS_PATH = Path("public/data/artists.json")
SERIES_PATH = Path("public/data/series.json")
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


def fetch_wikipedia_intro(url: str) -> str | None:
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
    except Exception as e:
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None


COMIC_VINE_BASE = "https://comicvine.gamespot.com/api"
COMIC_VINE_HEADERS = {"User-Agent": "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)"}


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


def extract_year(raw: str | None) -> int | None:
    """Extract a 4-digit year from a free-form date string like 'Dec 1, 1957'."""
    if not raw:
        return None
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", raw)
    return int(m.group(1)) if m else None


def comic_vine_search(resource: str, name: str, api_key: str) -> list:
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
            print(f"    WARN: Comic Vine {resource} error: {data.get('error')}", file=sys.stderr)
            return []
        return data.get("results", []) or []
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
    refs = entry.setdefault("references", [])
    for ref in refs:
        if (ref.get("name") or "").strip().lower() == "comic vine":
            return
    refs.append({"name": "Comic Vine", "url": site_url})


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

    for entry in entries:
        has_desc = is_meaningful_description(entry.get("description") or "")
        has_image = bool(entry.get("imageUrl"))
        has_all_supplemental = all(entry.get(k) not in (None, "", [], {}) for k in supplemental_keys)
        if has_desc and has_image and has_all_supplemental:
            continue

        name = entry.get("name")
        if not name:
            continue

        print(f"  Searching Comic Vine ({resource}) for {name}...")
        results = comic_vine_search(resource, name, api_key)
        time.sleep(1.0)  # be polite — Comic Vine rate-limits per resource

        match = pick_exact_match(results, name, tiebreak_key=tiebreak_key)
        if not match:
            print(f"    SKIP: no exact match ({len(results)} candidate(s))")
            continue

        site_url = match.get("site_detail_url")
        if not site_url:
            print(f"    SKIP: match has no site_detail_url")
            continue

        changed = False

        if not has_desc:
            raw_desc = match.get("description") or match.get("deck") or ""
            clean = strip_html(raw_desc) if raw_desc else ""
            if is_meaningful_description(clean):
                entry["description"] = clean
                changed = True
                print(f"    desc: {clean[:80]}...")
            elif clean:
                print(f"    skip desc: too short ({len(clean)} chars)")

        if not has_image:
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
            updated += 1
        else:
            print(f"    SKIP: match found but no new fields")

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Updated {updated} entr(ies) in {path} from Comic Vine.")

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

    for entry in entries:
        desc = entry.get("description", "")
        if desc and desc.strip():
            continue

        wiki_url = None
        for ref in entry.get("references", []):
            if ref.get("name", "").lower() == "wikipedia":
                wiki_url = ref.get("url")
                break

        if not wiki_url:
            continue

        print(f"  Fetching Wikipedia intro for {entry.get('name', entry.get('id'))}...")
        intro = fetch_wikipedia_intro(wiki_url)
        if intro and is_meaningful_description(intro):
            entry["description"] = intro
            updated += 1
            print(f"    OK: {intro[:80]}...")
        elif intro:
            print(f"    SKIP: intro too short ({len(intro)} chars)")
        else:
            print(f"    SKIP: no intro text found")

        # Be polite to Wikipedia
        time.sleep(0.5)

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Updated {updated} description(s) in {path}.")

    return updated


def slugify(name: str) -> str:
    """Convert a name to a URL-friendly slug."""
    import re
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
    print("Backfilling Comic Vine descriptions...")
    cv_updated = 0
    cv_updated += backfill_comicvine(ARTISTS_PATH, "artists", "people", tiebreak_key=None)
    cv_updated += backfill_comicvine(SERIES_PATH, "series", "volumes", tiebreak_key="count_of_issues")
    if cv_updated:
        print(f"Backfilled {cv_updated} Comic Vine description(s) total.")
    else:
        print("No Comic Vine descriptions needed backfilling.")

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