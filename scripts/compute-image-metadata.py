#!/usr/bin/env python3
"""
Compute image dimensions and perceptual hashes for gallery panels that lack them.

Reads gallery.json, finds entries missing width/height/phash/ahash/dhash,
computes those fields from the corresponding image files, and writes the
updated gallery.json back. Exits with code 0 if no changes were made (so
the calling workflow can skip the commit step).
"""

import json
import sys
from pathlib import Path

from PIL import Image
import imagehash

GALLERY_PATH = Path("public/data/gallery.json")
IMAGE_ROOT = Path("public")

HASH_FUNCTIONS = {
    "phash": imagehash.phash,      # DCT-based, good structural similarity
    "ahash": imagehash.average_hash,  # brightness-based
    "dhash": imagehash.dhash,      # gradient/edge-based
}

METADATA_FIELDS = {"width", "height"} | set(HASH_FUNCTIONS.keys())


def needs_update(panel: dict) -> bool:
    """Return True if any metadata field is missing or null."""
    return any(panel.get(field) is None for field in METADATA_FIELDS)


def compute_metadata(image_path: Path) -> dict:
    """Open an image and return dimensions + perceptual hashes."""
    img = Image.open(image_path)
    result = {
        "width": img.width,
        "height": img.height,
    }
    for name, fn in HASH_FUNCTIONS.items():
        result[name] = str(fn(img))
    return result


def main():
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

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
            print(f"  OK: {panel['image']} → {meta['width']}x{meta['height']} phash={meta['phash']}")
        except Exception as e:
            print(f"  ERROR: {panel['image']} → {e}", file=sys.stderr)
            error_count += 1

    if updated_count == 0:
        print("No panels needed updating.")
        # Exit code 0 — the workflow checks for file changes via git diff
        sys.exit(0)

    GALLERY_PATH.write_text(json.dumps(gallery, indent=2) + "\n")
    print(f"\nUpdated {updated_count} panel(s). Errors: {error_count}.")


if __name__ == "__main__":
    main()