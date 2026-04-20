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

In addition to metadata, this script orchestrates backfill steps that enrich
artists.json and series.json from Wikipedia, Comic Vine, Metron, and the Grand
Comics Database, and downloads cover images. Each integration lives in its own
module under the `metadata/` package.
"""

import argparse
import json
import sys

from metadata.covers import backfill_cover_images, localize_cover_images
from metadata.image_metadata import compute_metadata, needs_update
from metadata.paths import ARTISTS_PATH, GALLERY_PATH, IMAGE_ROOT, SERIES_PATH
from metadata.seed import seed_artists, seed_series
from metadata.sources.comicvine import backfill_comicvine
from metadata.sources.gcd import backfill_gcd
from metadata.sources.metron import backfill_metron
from metadata.sources.wikipedia import backfill_wikipedia_descriptions


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

    # Localize any previously-fetched remote cover URLs first, so a later
    # rate-limit/timeout in this run doesn't leave the UI with broken
    # hotlinked images.
    print("Localizing existing cover images...")
    covers_prelocalized = localize_cover_images(SERIES_PATH)
    if covers_prelocalized:
        print(f"Localized covers for {covers_prelocalized} series.")
    else:
        print("No existing cover images needed localizing.")

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

    # Fetch cover images for series from Metron and Comic Vine
    print("Fetching cover images...")
    covers_updated = backfill_cover_images(SERIES_PATH, panels)
    if covers_updated:
        print(f"Fetched covers for {covers_updated} series.")
    else:
        print("No cover images needed fetching.")

    # Localize any newly-fetched remote covers from this run
    print("Localizing newly-fetched cover images...")
    covers_localized = localize_cover_images(SERIES_PATH)
    if covers_localized:
        print(f"Localized covers for {covers_localized} series.")
    else:
        print("No cover images needed localizing.")

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
