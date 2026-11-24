#!/usr/bin/env python3
"""
Compute the worked examples for the Guide's pHash lesson.

The lesson follows one panel photographed once and restored once: the phone
photo as first posted ("before") and the restored image now in the gallery
("after"). Each EXAMPLE was also reframed by its restoration, so the pair
shows what pHash shrugs off (lamp colour, exposure, contrast) next to what
it doesn't (a different crop). Every intermediate the lesson draws is
recorded here, so the figures show the real numbers rather than a sketch:

  public/data/phash-examples.json
  public/data/phash-examples/<id>-before.jpg       the original photo, shrunk
  public/data/phash-examples/<id>-before-luma.jpg  its luminance (PIL "L")
  public/data/phash-examples/<id>-after-luma.jpg   the restoration's luminance

The restored colour image is the gallery's own file, so it isn't copied.

For each side the JSON has what imagehash.phash computes, step by step:
  grid    the 32 x 32 luminance image it hashes, base64 uint8, row-major
  dct     the top-left 8 x 8 of that image's 2-D DCT, row-major, rounded
  median  the median of those 64 numbers
  hash    the 16 hex digits (bit = coefficient above the median)
The script recomputes the hash with imagehash itself and stops if the two
disagree, and checks the "after" hash against gallery.json's phash.

`quad` is where the restored frame sits inside the original photo: its four
corners (top-left, top-right, bottom-right, bottom-left) as fractions of the
photo's width and height, from an ORB feature match and a RANSAC homography.
The figure outlines it on the photo to show the crop.

`stats` holds the gallery-wide numbers the lesson quotes: the spread of
distances between different panels, each panel's nearest other panel, and
what every restoration so far did to its own hash, split by whether it
kept the photo's framing. Restored originals are recovered from git with
the restore-panel skill's panel.py.

The examples were picked 2026-11-23 from a survey of every restoration:
the 61 that kept the framing moved their hash 0-6 bits, the 11 that
reframed it 4-18.

Usage
-----
    python scripts/compute-phash-examples.py
"""

import base64
import io
import json
import sys
from pathlib import Path

import cv2
import imagehash
import numpy as np
import scipy.fftpack
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "skills" / "restore-panel"))
import panel as panel_tools  # noqa: E402

VERSION = "phash-examples-v1"
OUT_JSON = REPO_ROOT / "public" / "data" / "phash-examples.json"
OUT_DIR = REPO_ROOT / "public" / "data" / "phash-examples"
IMAGE_EDGE = 720  # long edge of the images written for the figures

# In the order the lesson shows them.
EXAMPLES = [
    # Justin Green. B&W; dark grey paper lifted to white and the borders trimmed. 16 bits.
    "bijou-funnies-6-1792968043",
    # Trina Robbins. A strong pink cast removed and the frame nudged. 8 bits.
    "trina-s-women-n-a-1793573911",
]


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=np.uint8).tobytes()).decode("ascii")


def phash_steps(img: Image.Image) -> dict:
    """imagehash.phash, keeping what it computes along the way."""
    grid = img.convert("L").resize((32, 32), Image.LANCZOS)
    pixels = np.asarray(grid)
    dct = scipy.fftpack.dct(scipy.fftpack.dct(pixels, axis=0), axis=1)[:8, :8]
    median = float(np.median(dct))
    bits = (dct > median).flatten()
    hex_digits = "".join(f"{int(''.join('1' if b else '0' for b in bits[i:i + 4]), 2):x}" for i in range(0, 64, 4))
    reference = str(imagehash.phash(img))
    if hex_digits != reference:
        sys.exit(f"recomputed hash {hex_digits} != imagehash's {reference}")
    return {
        "width": img.width,
        "height": img.height,
        "grid": b64(pixels),
        "dct": [round(float(v), 1) for v in dct.flatten()],
        "median": round(median, 2),
        "hash": hex_digits,
    }


def shrink(img: Image.Image) -> Image.Image:
    scale = IMAGE_EDGE / max(img.size)
    if scale >= 1:
        return img.copy()
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def save_jpeg(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    shrink(img).save(path, "JPEG", quality=84, optimize=True, progressive=True)


def crop_quad(before: Image.Image, after: Image.Image) -> list[list[float]] | None:
    """The after image's corners inside the before photo, as fractions of its size."""
    def grey(img):
        s = shrink(img).convert("L")
        return np.asarray(s), img.width / s.width

    a, a_scale = grey(before)
    b, b_scale = grey(after)
    # Equalise so the restoration's stretched contrast still finds the same corners.
    a, b = cv2.equalizeHist(a), cv2.equalizeHist(b)
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(db, da, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 30:
        return None
    src = np.float32([kb[m.queryIdx].pt for m in good]) * b_scale
    dst = np.float32([ka[m.trainIdx].pt for m in good]) * a_scale
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if H is None or mask.sum() < 30:
        return None
    w, h = after.size
    corners = cv2.perspectiveTransform(np.float32([[[0, 0], [w, 0], [w, h], [0, h]]]), H)[0]
    print(f"    crop match: {int(mask.sum())} inliers of {len(good)}")
    return [[round(float(x) / before.width, 4), round(float(y) / before.height, 4)] for x, y in corners]


def hash_bits(hex_hash: str) -> np.ndarray:
    return np.array([int(c, 16) >> s & 1 for c in hex_hash for s in (3, 2, 1, 0)], dtype=np.uint8)


def gallery_stats(panels: list[dict]) -> dict:
    hashed = [p for p in panels if p.get("phash")]
    bits = np.stack([hash_bits(p["phash"]) for p in hashed])
    dist = (bits[:, None, :] != bits[None, :, :]).sum(-1)
    pairs = dist[np.triu_indices(len(hashed), 1)]
    np.fill_diagonal(dist, 64)
    nearest = dist.min(1)

    kept, reframed = [], []
    for p in panels:
        if not panel_tools.restored_version(p["image"]):
            continue
        data, _ = panel_tools.original_bytes(p["image"])
        if not data:
            continue
        before = Image.open(io.BytesIO(data))
        after = Image.open(REPO_ROOT / "public" / p["image"])
        d = int(imagehash.phash(before) - imagehash.phash(after))
        (kept if before.size == after.size else reframed).append(d)

    def spread(a):
        a = np.asarray(a)
        return {"n": int(a.size), "min": int(a.min()), "median": float(np.median(a)), "max": int(a.max())}

    return {
        "panels": len(hashed),
        "pairs": {**spread(pairs), "p5": float(np.percentile(pairs, 5)), "p95": float(np.percentile(pairs, 95))},
        "nearest": spread(nearest),
        "restoredKeptFrame": spread(kept),
        "restoredReframed": spread(reframed),
    }


def main() -> None:
    panels = panel_tools.load_panels()
    by_id = {p["id"]: p for p in panels}
    examples = []
    for pid in EXAMPLES:
        p = by_id.get(pid)
        if p is None:
            sys.exit(f"{pid} is no longer in the gallery; pick another example")
        print(f"  {pid}")
        data, source = panel_tools.original_bytes(p["image"])
        if not data:
            sys.exit(f"  couldn't recover {pid}'s original photo")
        print(f"    original from {source}")
        before = Image.open(io.BytesIO(data))
        before.load()
        after = Image.open(REPO_ROOT / "public" / p["image"])
        after.load()

        b, a = phash_steps(before), phash_steps(after)
        if a["hash"] != p["phash"]:
            sys.exit(f"  {pid}: after hash {a['hash']} != gallery.json's {p['phash']}; rerun the metadata step first")

        rel = OUT_DIR.relative_to(REPO_ROOT / "public")
        save_jpeg(before.convert("RGB"), OUT_DIR / f"{pid}-before.jpg")
        save_jpeg(before.convert("L"), OUT_DIR / f"{pid}-before-luma.jpg")
        save_jpeg(after.convert("L"), OUT_DIR / f"{pid}-after-luma.jpg")
        b.update(image=f"{rel}/{pid}-before.jpg", luma=f"{rel}/{pid}-before-luma.jpg")
        a.update(image=p["image"], luma=f"{rel}/{pid}-after-luma.jpg")

        distance = int((hash_bits(b["hash"]) != hash_bits(a["hash"])).sum())
        print(f"    {b['hash']} -> {a['hash']}: {distance} bits")
        examples.append({
            "id": pid,
            "title": p["title"],
            "issue": p.get("issue"),
            "artist": p.get("artist"),
            "before": b,
            "after": a,
            "quad": crop_quad(before, after),
        })

    # Drop files left by examples no longer in the list.
    keep = {f"{pid}-{suffix}.jpg" for pid in EXAMPLES for suffix in ("before", "before-luma", "after-luma")}
    for f in OUT_DIR.glob("*.jpg"):
        if f.name not in keep:
            f.unlink()
            print(f"  removed {f.relative_to(REPO_ROOT)}")

    print("  gallery stats")
    stats = gallery_stats(panels)
    print(f"    {json.dumps(stats)}")
    out = {"version": VERSION, "examples": examples, "stats": stats}
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(REPO_ROOT)} ({OUT_JSON.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
