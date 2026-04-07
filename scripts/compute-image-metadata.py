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

import json
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

    Uses the Wikipedia REST API to get the extract, removes bracketed
    reference markers like [1][2], and converts newlines to \\r\\n.
    """
    title = get_wikipedia_title(url)
    if not title:
        return None

    api_url = (
        f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
    )
    try:
        resp = requests.get(api_url, headers={"User-Agent": "comic-snaps/1.0"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        text = data.get("extract", "")
        if not text:
            return None
        # Remove reference markers like [1], [2], [note 1], etc.
        text = re.sub(r"\[[\w\s]*\d+\]", "", text)
        # Normalize whitespace that may result from removed refs
        text = re.sub(r"  +", " ", text).strip()
        # Convert newlines to \r\n
        text = text.replace("\n", "\r\n")
        return text
    except Exception as e:
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None


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
        if intro:
            entry["description"] = intro
            updated += 1
            print(f"    OK: {intro[:80]}...")
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