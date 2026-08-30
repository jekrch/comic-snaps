"""Content-based duplicate detection for series cover images.

Metron and Comic Vine both carry covers for the same issues, and the
gallery-issue prioritisation in `covers.py` aims both of them at the same
issue — so the first cover each provider contributes is routinely the same
artwork, scanned twice at two resolutions.  The two URLs differ, so the
URL-keyed dedupe upstream never sees it; only the pixels give it away.
"""

import sys
from pathlib import Path
from typing import Iterable

import imagehash
from PIL import Image

# Hamming distance between two 64-bit pHashes below which two covers are
# treated as the same artwork.
#
# Measured over this collection: every pair scoring <= 8 is one Comic Vine
# scan and one Metron scan of a single cover, while the nearest pair that is
# genuinely two different covers sits at 10 (two variant covers of one issue,
# sharing their interior art).  Past ~14 the metric stops discriminating at
# all — covers from a single series share enough trade dress that unrelated
# issues score in the teens — so this stays deliberately tight and leaves the
# ambiguous middle alone rather than deleting real covers.
COVER_DUPLICATE_THRESHOLD = 8


def cover_phash(path: Path) -> imagehash.ImageHash | None:
    """Perceptual hash of a local cover, or None if it can't be read."""
    try:
        with Image.open(path) as img:
            return imagehash.phash(img.convert("L"))
    except Exception as e:
        print(f"    WARN: could not hash {path}: {e}", file=sys.stderr)
        return None


def cover_pixels(path: Path) -> int:
    """Pixel area of a local cover — the tiebreak between two scans of one
    cover, since the providers publish the same art at different sizes."""
    try:
        with Image.open(path) as img:
            return img.width * img.height
    except Exception:
        return 0


class CoverSet:
    """The covers one series keeps, deduplicated by content.

    Holds the ordered list of local cover paths alongside a pHash for each,
    so a newly downloaded cover is tested against everything already kept
    before it earns a slot.  A duplicate either replaces the cover it matches
    (when it is the higher-resolution scan) or is deleted from disk — either
    way the artwork ends up in the list exactly once, and no orphaned file is
    left behind in `public/data/covers`.
    """

    def __init__(self, root: Path, covers: Iterable[str] = ()):
        self.root = root
        self.covers: list[str] = []
        self.deduped = 0
        self._hashes: dict[str, imagehash.ImageHash] = {}
        # Seed through add() rather than straight into the list: an entry's
        # existing covers may already duplicate each other, and that is
        # exactly the backlog this pass exists to clear.
        for rel in covers:
            self.add(rel)

    def __len__(self) -> int:
        return len(self.covers)

    def add(self, rel: str) -> bool:
        """Fold one local cover path in. Returns True if the set grew."""
        if rel in self.covers:
            return False

        digest = cover_phash(self.root / rel)
        match = self._match(rel, digest)
        if match is None:
            self.covers.append(rel)
            if digest is not None:
                self._hashes[rel] = digest
            return True

        self.deduped += 1
        if cover_pixels(self.root / rel) > cover_pixels(self.root / match):
            self.covers[self.covers.index(match)] = rel
            self._hashes.pop(match, None)
            if digest is not None:
                self._hashes[rel] = digest
            self._remove_file(match)
            print(f"    dedupe: {_name(rel)} replaces {_name(match)} (higher resolution)")
        else:
            self._remove_file(rel)
            print(f"    dedupe: dropped {_name(rel)} (duplicate of {_name(match)})")
        return False

    def _match(self, rel: str, digest: imagehash.ImageHash | None) -> str | None:
        """The closest kept cover within the threshold, or None."""
        if digest is None:
            return None
        best: str | None = None
        best_distance = COVER_DUPLICATE_THRESHOLD + 1
        for other, other_digest in self._hashes.items():
            if other == rel:
                continue
            distance = digest - other_digest
            if distance <= COVER_DUPLICATE_THRESHOLD and distance < best_distance:
                best, best_distance = other, distance
        return best

    def _remove_file(self, rel: str) -> None:
        try:
            (self.root / rel).unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            print(f"    WARN: could not remove {rel}: {e}", file=sys.stderr)


def _name(rel: str) -> str:
    return rel.rsplit("/", 1)[-1]
