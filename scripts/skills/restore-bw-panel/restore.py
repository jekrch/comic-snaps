#!/usr/bin/env python3
"""Restore a phone photo of an old black-and-white comic panel.

Subcommands (see SKILL.md for the workflow):
  measure  fit the panel's border lines in the photo
  enhance  rectify, flat-field paper and ink separately, and sharpen
  install  swap the result into the gallery, byte-exact, and queue re-embedding
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
MAX_LONG_SIDE = 1280  # Telegram's cap, and so the size nearly every panel has.
MAX_UPSCALE = 1.25  # Past this, enlarging invents softness rather than detail.
MAX_COLORFULNESS = 8.0  # Old B&W panels measure under 6; this discards all chroma.
# Most B&W pages score 0-2, but unevenly lit ones reach 4.2 and faded watercolor
# scored 4.6. There's no clean gap, so stay cautious: a false alarm costs a look
# and --force, while a miss erases the art's color.
MAX_PATCHY_CHROMA = 3.0
STRONG_TINT = 15.0  # Lab chroma past which a page's color may be the stock, not the light.
EDGE_INSET = 1  # Lands the crop on the border ink, not a hairline of page.
# The restore workflow sets this to shrink --compare sheets. There, a model reads
# every sheet, and each one it has read is resent with every later turn. Unset,
# sheets keep full resolution.
COMPARE_MAX_ENV = "RESTORE_COMPARE_MAX"


def load_gray(path):
    im = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if im is None:
        sys.exit(f"cannot read {path}")
    return im.astype(np.float32)


def parse_band(text):
    a, b = (int(v) for v in text.split(":"))
    return a, b


def fit_edge(t, s):
    """Fit s(t) with outlier rejection; returns slope, intercept, and fit quality."""
    t, s = np.asarray(t, float), np.asarray(s, float)
    keep = np.ones(len(t), bool)
    for _ in range(6):
        p = np.polyfit(t[keep], s[keep], 1)
        r = s - np.polyval(p, t)
        sigma = max(np.median(np.abs(r[keep])) * 1.5, 0.5)
        keep = np.abs(r) < 3 * sigma
    q = np.polyfit(t[keep], s[keep], 2)
    bow = np.abs(np.polyval(q, t[keep]) - np.polyval(p, t[keep])).max()
    rms = np.std(s[keep] - np.polyval(p, t[keep]))
    return p[0], p[1], keep.mean(), rms, bow


def cmd_measure(args):
    im = load_gray(args.image)
    H, W = im.shape
    dark = args.dark or 0.5 * (np.percentile(im, 5) + np.percentile(im, 90))
    # Horizontal edges are sampled between the vertical bands, and vice versa,
    # so a neighbouring panel's border can't get fitted by mistake.
    x0 = parse_band(args.left)[1] if args.left else 0
    x1 = parse_band(args.right)[0] if args.right else W
    y0 = parse_band(args.top)[1] if args.top else 0
    y1 = parse_band(args.bottom)[0] if args.bottom else H

    flags = []
    # Each band is scanned from outside the panel inward to the first dark pixel.
    for side, band in (("top", args.top), ("bottom", args.bottom), ("left", args.left), ("right", args.right)):
        if not band:
            print(f"{side:>6}: no band given; this side will bleed to the frame")
            continue
        a, b = parse_band(band)
        horizontal = side in ("top", "bottom")
        ts, ss = [], []
        for t in range(*((x0, x1, 3) if horizontal else (y0, y1, 3))):
            line = im[a:b, t] if horizontal else im[t, a:b]
            hits = np.nonzero(line < dark)[0]
            if len(hits):
                ts.append(t)
                ss.append(a + (hits[0] if side in ("top", "left") else hits[-1]))
        if len(ts) < 20:
            print(f"{side:>6}: FAILED, only {len(ts)} dark samples in band {band}")
            continue
        slope, intercept, inliers, rms, bow = fit_edge(ts, ss)
        warn = ""
        if inliers < 0.6:
            warn += "  <-- few inliers: the band is catching art, narrow it"
        if bow > 2:
            warn += "  <-- bowed: page curl, one warp won't flatten this edge"
        print(f"{side:>6}: slope {slope:+.5f} intercept {intercept:.2f}  inliers {inliers:.0%} rms {rms:.2f} bow {bow:.2f}px{warn}")
        flags.append(f"--{side}={slope:.5f},{intercept:.2f}")
    print("\nenhance flags:", " ".join(flags) or "(none: full frame)")


def bleed_line(side, slope, W, H):
    """Line along a side with no border, leaning by slope and staying inside the frame."""
    if side == "left":
        return slope, max(0.0, -slope * H)
    if side == "right":
        return slope, min(float(W), W - slope * H)
    if side == "top":
        return slope, max(0.0, -slope * W)
    return slope, min(float(H), H - slope * W)


def panel_quad(args, W, H):
    """Corners of the panel in the photo: measured sides inset, the rest bleeding."""
    measured = {}
    for side in ("top", "bottom", "left", "right"):
        value = getattr(args, side)
        if value:
            slope, intercept = (float(v) for v in value.split(","))
            inward = EDGE_INSET if side in ("top", "left") else -EDGE_INSET
            measured[side] = (slope, intercept + inward)

    lines = dict(measured)
    for side, opposite in (("top", "bottom"), ("bottom", "top"), ("left", "right"), ("right", "left")):
        if side not in lines:
            slope = measured[opposite][0] if opposite in measured else 0.0
            lines[side] = bleed_line(side, slope, W, H)

    def corner(h, v):
        # y = h(x), x = v(y); fixed point converges fast on near-axis-aligned lines.
        x, y = lines[v][0] * 600.0 + lines[v][1], 0.0
        for _ in range(8):
            y = lines[h][0] * x + lines[h][1]
            x = lines[v][0] * y + lines[v][1]
        return [x, y]

    return np.float32(
        [corner("top", "left"), corner("top", "right"), corner("bottom", "right"), corner("bottom", "left")]
    )


def normalized_blur(values, weights, sigma):
    """Gaussian blur averaging only weighted pixels, so gaps fill from their surroundings."""
    num = cv2.GaussianBlur(values * weights, (0, 0), sigma)
    den = cv2.GaussianBlur(weights, (0, 0), sigma)
    return num / np.maximum(den, 1e-4), den


def field(values, mask):
    """Smooth field of values at masked pixels, falling back to wider scales in gaps."""
    w = mask.astype(np.float32)
    fine, den = normalized_blur(values, w, 45)
    wide, _ = normalized_blur(values, w, 180)
    alpha = np.clip(den / 0.05, 0, 1)
    return alpha * fine + (1 - alpha) * wide


def patchy_chroma(lab, paper_mask):
    """Chroma left on bright pixels after removing a smooth fit.

    Light casts vary smoothly across a page and painted color changes region by
    region, so this catches faded color that overall colorfulness scores as B&W.
    """
    H, W = paper_mask.shape
    yy, xx = np.mgrid[0:H, 0:W]
    x, y = xx[paper_mask] / W - 0.5, yy[paper_mask] / H - 0.5
    basis = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=1)
    weights = paper_mask.astype(np.float32)
    total = 0.0
    for channel in (1, 2):
        smooth = normalized_blur(lab[..., channel], weights, 8)[0][paper_mask]
        coef, *_ = np.linalg.lstsq(basis, smooth, rcond=None)
        total += float(np.mean((smooth - basis @ coef) ** 2))
    return float(np.sqrt(total))


def rectify(args, bgr):
    """Warp to the measured edges. With no edge flags the framing is untouched."""
    H, W = bgr.shape[:2]
    if not any(getattr(args, side) for side in ("top", "bottom", "left", "right")):
        print(f"source {W}x{H}: framing kept")
        return bgr
    quad = panel_quad(args, W, H)
    src_w = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2
    src_h = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2
    scale = min(MAX_LONG_SIDE / max(src_w, src_h), MAX_UPSCALE)
    out_w, out_h = int(round(src_w * scale)), int(round(src_h * scale))
    dst = np.float32([[0, 0], [out_w, 0], [out_w, out_h], [0, out_h]])
    warped = cv2.warpPerspective(
        bgr,
        cv2.getPerspectiveTransform(quad, dst),
        (out_w, out_h),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REPLICATE,
    )
    print(f"source {W}x{H} -> {out_w}x{out_h} (scale {scale:.3f})")
    return warped


def cmd_enhance(args):
    bgr = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")

    warped = rectify(args, bgr)
    out_h, out_w = warped.shape[:2]

    lab = cv2.cvtColor(warped.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    L = lab[..., 0]

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    threshold = 0.5 * (np.percentile(L, 5) + np.percentile(L, 90))
    # Erode so only solid regions vote: thin lines never reach true black, and
    # the soft edges around them never reach true paper.
    paper_mask = cv2.erode((L > threshold + 15).astype(np.uint8), kernel) > 0
    ink_mask = cv2.erode((L < threshold - 10).astype(np.uint8), kernel) > 0
    if paper_mask.mean() < 0.02 or ink_mask.mean() < 0.005:
        sys.exit(f"not enough solid paper ({paper_mask.mean():.1%}) or ink ({ink_mask.mean():.1%}) to model the lighting")

    # Everything below discards chroma, so make sure there's no art in it. These
    # run on the crop, so a colored neighbouring panel can't trip them.
    colorfulness = float(np.hypot(lab[..., 1].std(), lab[..., 2].std()))
    patchy = patchy_chroma(lab, paper_mask)
    print(f"colorfulness {colorfulness:.1f}, patchy chroma {patchy:.2f}")
    if (colorfulness > MAX_COLORFULNESS or patchy > MAX_PATCHY_CHROMA) and not args.force:
        sys.exit(
            f"looks colored (limits: colorfulness {MAX_COLORFULNESS}, patchy chroma {MAX_PATCHY_CHROMA}) "
            "and this discards all chroma. View the source; --force only if the color is not in the art, otherwise use restore-color-panel."
        )

    paper = field(L, paper_mask)
    ink = field(L, ink_mask)
    # Glare leaves the ink noisier in some regions than others, so the black
    # point sits a fixed number of local standard deviations above the ink
    # level: the stretch then has no low-contrast texture to blow up.
    ink_sigma = np.sqrt(field((L - ink) ** 2, ink_mask))
    print(f"paper L {paper.min():.1f}-{paper.max():.1f}, ink L {ink.min():.1f}-{ink.max():.1f}, ink sigma {ink_sigma.min():.2f}-{ink_sigma.max():.2f}")
    ink = ink + args.ink_sigmas * ink_sigma

    t = (L - ink) / np.maximum(paper - ink, 1)
    # A short toe seats what's left of the ink at black, and lifted midtones keep
    # small lettering's counters open. Paper grain passes through above 1.
    t_c = np.clip(t, 0, 1.15)
    base = np.clip((t_c - args.toe) / (1 - args.toe), 0, 1)
    toe_blend = np.clip(base / 0.25, 0, 1)
    curved = base ** args.gamma * (toe_blend * toe_blend * (3 - 2 * toe_blend)) + np.maximum(t_c - 1, 0)

    midtones = float(((curved > 0.15) & (curved < 0.85)).mean())
    note = "  <-- high: greys carry this art (wash, halftone, zipatone); check it survived" if midtones > args.midtone_warn else ""
    print(f"midtone share {midtones:.1%}{note}")

    # Targets only ever widen the range: a clean source keeps its white paper and
    # true blacks instead of being pulled to the targets a washed-out photo needs.
    source_paper_l = float(np.median(L[paper_mask]))
    source_ink_l = float(np.median(L[ink_mask]))
    paper_l = max(args.paper_l, source_paper_l)
    ink_l = min(args.ink_l, source_ink_l)
    print(f"targets: ink L {ink_l:.1f} (source {source_ink_l:.1f}), paper L {paper_l:.1f} (source {source_paper_l:.1f})")
    if source_paper_l > 96 and source_ink_l < 6:
        print("  <-- already high contrast with blown whites: expect little gain, and lost paper detail can't return")

    out_L = ink_l + (paper_l - ink_l) * curved
    blurred = cv2.GaussianBlur(out_L, (0, 0), 1.0)
    out_L = np.clip(out_L + args.sharpen * (out_L - blurred), 0, 100)

    # One ink on one paper stock: all chroma here is paper tint or light cast.
    # Aged paper is warm and mild, so keep the page's tint within that range; a
    # blue page is the light, not the stock, and goes fully neutral.
    measured_a = float(np.median(lab[..., 1][paper_mask]))
    measured_b = float(np.median(lab[..., 2][paper_mask]))
    if args.tint:
        paper_a, paper_b = (float(v) for v in args.tint.split(","))
    elif measured_b < 0:
        paper_a, paper_b = 0.0, 0.0
    else:
        paper_a, paper_b = float(np.clip(measured_a, -1.5, 3.0)), min(measured_b, 10.0)
    print(f"paper tint a={paper_a:.2f} b={paper_b:.2f} (measured a={measured_a:.2f} b={measured_b:.2f})")
    if np.hypot(measured_a, measured_b) > STRONG_TINT and not args.tint:
        print("  <-- strong page color was reduced: if it's colored stock rather than the light, keep it with --tint")
    weight = np.clip(curved, 0, 1)
    result = np.dstack([out_L, paper_a * weight, paper_b * weight])
    bgr_out = cv2.cvtColor(result.astype(np.float32), cv2.COLOR_Lab2BGR)
    out8 = np.clip(bgr_out * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(
        str(args.output),
        out8,
        [cv2.IMWRITE_JPEG_QUALITY, 92, cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1],
    )
    print(f"wrote {args.output} ({Path(args.output).stat().st_size // 1024} KB)")

    if args.compare:
        write_compare(args, warped, out8)


def compare_max():
    """The long-side cap for --compare sheets, or None for full resolution."""
    value = os.environ.get(COMPARE_MAX_ENV, "").strip()
    if not value:
        return None
    if not value.isdigit() or int(value) < 256:
        sys.exit(f"{COMPARE_MAX_ENV} must be a whole number of pixels, at least 256; got {value!r}")
    return int(value)


def fit_long_side(image, cap):
    """Shrink `image` so its long side is at most `cap`. It is never enlarged."""
    long_side = max(image.shape[:2])
    if cap is None or long_side <= cap:
        return image
    f = cap / long_side
    return cv2.resize(image, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)


def write_compare(args, before, after):
    """Rectified source beside the result. They're pixel-aligned, so zooms line up."""
    gutter = np.full((after.shape[0], 12, 3), 128, np.uint8)
    rows = [np.hstack([before, gutter, after])]
    for region in args.zoom or []:
        x, y, w, h = (int(v) for v in region.split(","))
        pair = [cv2.resize(im[y:y + h, x:x + w], None, fx=2.6, fy=2.6, interpolation=cv2.INTER_CUBIC) for im in (before, after)]
        rows.append(np.hstack([pair[0], np.full((pair[0].shape[0], 12, 3), 128, np.uint8), pair[1]]))
    if args.zoom:
        rows = rows[1:]  # Zooms answer a specific question; the whole frame just shrinks them.
    width = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 12), (0, width - r.shape[1]), (0, 0)), constant_values=128) for r in rows]
    sheet = fit_long_side(np.vstack(rows), compare_max())
    cv2.imwrite(str(args.compare), sheet)
    print(f"wrote {args.compare}")


def next_image_path(image):
    """images/x/issue-6-123.jpg -> -v2.jpg; -v2.jpg -> -v3.jpg."""
    path = Path(image)
    match = re.fullmatch(r"(.*)-v(\d+)", path.stem)
    stem, version = (match.group(1), int(match.group(2)) + 1) if match else (path.stem, 2)
    return str(path.with_name(f"{stem}-v{version}{path.suffix}"))


def whole_floats_to_ints(value):
    """The worker writes gallery.json from JS, which never prints 2.0."""
    if isinstance(value, list):
        return [whole_floats_to_ints(v) for v in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def cmd_install(args):
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from metadata.image_metadata import METADATA_FIELDS, compute_metadata

    root = Path(args.root).resolve()
    data_dir = root / "public" / "data"
    gallery_path = data_dir / "gallery.json"
    raw = gallery_path.read_bytes()
    if raw.count(b"\r\n") != raw.count(b"\n"):
        sys.exit("gallery.json is expected to be pure CRLF")
    text = raw.decode("utf-8").replace("\r\n", "\n")
    panels = json.loads(text)["panels"]
    index = next((i for i, p in enumerate(panels) if p["id"] == args.panel_id), None)
    if index is None:
        sys.exit(f"no panel {args.panel_id}")
    panel = panels[index]

    old_image = panel["image"]
    new_image = next_image_path(old_image)
    old_file, new_file = root / "public" / old_image, root / "public" / new_image
    if new_file.exists():
        sys.exit(f"{new_file} already exists")
    for other in data_dir.glob("*.json"):
        if other != gallery_path and old_image.encode() in other.read_bytes():
            sys.exit(f"{other.name} also references {old_image}; update it by hand first")

    shutil.copyfile(args.restored, new_file)
    meta = compute_metadata(new_file)

    # Re-render only this panel's object, so the diff can't reach any other.
    start = text.index(f'    {{\n      "seq": {panel["seq"]},\n      "id": "{args.panel_id}"')
    end = text.index("\n    }", start) + len("\n    }")
    panel["image"] = new_image
    panel.update({k: whole_floats_to_ints(meta[k]) for k in METADATA_FIELDS})
    rendered = "\n".join("    " + line for line in json.dumps(panel, indent=2, ensure_ascii=False).split("\n"))
    patched = text[:start] + rendered + text[end:]
    if json.loads(patched)["panels"][index] != panel:
        sys.exit("patch verification failed; nothing written")

    # Embeddings are keyed by id and only computed for absent ids, so dropping
    # the entry is what makes CI re-embed the new image. Validate all three
    # before writing any, so a failure can't leave them half updated.
    pattern = re.compile(rb'"' + re.escape(args.panel_id.encode()) + rb'":\s*\[[^\]]*\],?\s*')
    embedding_writes = []
    for name in ("embeddings.json", "embeddings-dino.json", "embeddings-gram.json"):
        path = data_dir / name
        before_raw = path.read_bytes()
        before = json.loads(before_raw)
        if args.panel_id not in before["embeddings"]:
            print(f"{name}: no entry, already pending")
            continue
        out = pattern.sub(b"", before_raw, count=1)
        # Removing the final entry would strand a comma before the closing braces.
        out = re.sub(rb",(\s*\}\s*\}\s*)$", rb"\1", out)
        after = json.loads(out)
        if set(before["embeddings"]) - set(after["embeddings"]) != {args.panel_id}:
            sys.exit(f"{name}: embedding removal touched other entries; nothing written")
        embedding_writes.append((path, out))
        print(f"{name}: {len(before['embeddings'])} -> {len(after['embeddings'])} entries")

    gallery_path.write_bytes(patched.replace("\n", "\r\n").encode("utf-8"))
    for path, out in embedding_writes:
        path.write_bytes(out)
    if old_file.exists():
        old_file.unlink()
    print(f"{old_image} -> {new_image}")
    print({k: panel[k] for k in sorted(METADATA_FIELDS)})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    m = sub.add_parser("measure", help="fit border lines; bands are START:END pixel ranges across the edge")
    m.add_argument("image")
    for side in ("top", "bottom", "left", "right"):
        m.add_argument(f"--{side}", help="band straddling the border, reaching out into the page margin")
    m.add_argument("--dark", type=float, help="gray level counted as ink (default: midpoint of the image)")
    m.set_defaults(func=cmd_measure)

    e = sub.add_parser("enhance", help="rectify and flat-field; side flags are SLOPE,INTERCEPT from measure")
    e.add_argument("image")
    e.add_argument("output")
    for side in ("top", "bottom", "left", "right"):
        e.add_argument(f"--{side}", help="measured edge line; omit to bleed this side to the frame")
    e.add_argument("--ink-sigmas", type=float, default=2.5, help="black point above the ink level; raise if blacks mottle")
    e.add_argument("--toe", type=float, default=0.02)
    e.add_argument("--gamma", type=float, default=0.9, help="below 1 lifts midtones; lower it if lettering clogs")
    e.add_argument("--sharpen", type=float, default=0.5)
    e.add_argument("--ink-l", type=float, default=9.0, help="ink target; a darker source keeps its own")
    e.add_argument("--paper-l", type=float, default=91.0, help="paper target; a brighter source keeps its own")
    e.add_argument("--tint", help="A,B paper tint in Lab, overriding the measured one; 0,0 for neutral")
    e.add_argument("--midtone-warn", type=float, default=0.15)
    e.add_argument("--force", action="store_true", help="process a panel that measures as colored")
    e.add_argument("--compare", help="write a before/after image here")
    e.add_argument("--zoom", action="append", help="X,Y,W,H in output pixels; repeatable; zooms the compare image")
    e.set_defaults(func=cmd_enhance)

    i = sub.add_parser("install", help="swap a restored image into the gallery")
    i.add_argument("panel_id")
    i.add_argument("restored")
    i.add_argument("--root", default=str(REPO_ROOT), help="repo root; point at a copy to rehearse")
    i.set_defaults(func=cmd_install)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
