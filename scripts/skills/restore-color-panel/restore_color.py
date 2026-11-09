#!/usr/bin/env python3
"""Restore a phone photo of a color comic panel.

Subcommands (see SKILL.md for the workflow):
  check    say whether the art is color, black-and-white, or needs a look
  enhance  remove the light's color and falloff from the photo, keeping the art's

Measuring edges and installing are shared with restore-bw-panel's restore.py, and
finding panels, recovering originals, and probing regions with restore-panel's panel.py.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "restore-bw-panel"))
import restore as bw  # noqa: E402

# Calibrated on all 341 gallery panels plus 8 known B&W source photos. B&W photos
# under a strong cast reach 5; subtle watercolor and spot color start at 3.
BW_BELOW = 3.0
COLOR_ABOVE = 7.0
MAX_BW_PATCH_SHARE = 1.0  # % of pixels; spot color passes the RMS but not this.
PATCH_CHROMA = 8.0

MIN_WHITE_COVERAGE = 0.01  # Fewer anchors than this can't tell light from art.
MIN_INK_COVERAGE = 0.005
INK_GRID = 16
MAX_VEIL = 0.08  # Of the paper's luminance: real glare over ink rarely lifts it past L 30.
# Painted darks lighter than the line work read as glare too. Capping the veil at
# 0.02-0.03 kept the charcoal paint on Bleeding Hearts #7 and The Beauty #5.
# Lab chroma limits on trusting the anchors, set from panels this got wrong: a
# yellow area read as paper (55), and a lone yellowed balloon that turned a face
# purple (31, on 1.3% coverage).
UNBELIEVABLE_CAST = 40.0
WEAK_EVIDENCE_CAST = 15.0
WEAK_WHITE_COVERAGE = 0.03
MAX_CAST_REMOVED = 18.0
MAX_CAST_DRIFT = 8.0
MAX_BRIGHTENING = 8.0  # Lab L above the anchors.
FIELD_LONG_SIDE = 512  # The fields are smooth, so fit them small and fast.
# With --white-box, anchors are only pixels this close in Lab chroma to the named
# whites. Bijou Funnies #6's yellow flats sat ~35 from its balloons, the paper 0-10.
WHITE_GATE = 12.0
BOX_DISAGREE = 8.0  # Chroma between the named whites and the field fitted at them.
# Named whites are aged stock too: taking all of their cast turned Bijou Funnies
# #6's grey shirt blue. This with the aged-paper tint matched the version kept.
NAMED_WHITE_STRENGTH = 0.85
# --keep-dark-hue: the source hue is kept fully below this L, fading out by the next.
DARK_HUE_FULL_L = 26.0
DARK_HUE_NONE_L = 38.0
# --glare-box: the paint around the box is read from this far out, and the field
# fades to nothing over the last few pixels inside each side that isn't the frame.
GLARE_MARGIN = 40
GLARE_FEATHER = 12
GLARE_MEDIAN = 13  # Wider than specks and thin lines, narrower than the glare's peak.
GLARE_PAINT_CHROMA = 12.0  # Margin pixels this close to its commonest color count as paint.
GLARE_PAINT_L = 18.0
GLARE_NOISE_SIGMAS = 3.0  # Darker than the paint's texture allows means ink or other art.
GLARE_AT_EDGE = 0.35  # Of the peak; more than this at a box side means the box is too small.


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def lab_to_linear(l, a, b):
    px = np.float32([[[l, a, b]]])
    return srgb_to_linear(cv2.cvtColor(px, cv2.COLOR_Lab2BGR)[0, 0].astype(np.float64))


def to_lab(bgr8):
    return cv2.cvtColor(bgr8.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)


def shrink(im, long_side):
    f = long_side / max(im.shape[:2])
    return cv2.resize(im, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else im


def classify(image):
    """Ink on tinted paper has color that depends only on brightness and position.

    Returns the unexplained chroma, the % of pixels in colored patches, and a
    verdict of "bw", "color", or "unsure".
    """
    bgr = cv2.imread(str(image), cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"cannot read {image}")
    lab = to_lab(shrink(bgr, 480))
    H, W = lab.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    L, x, y = lab[..., 0].ravel() / 100, xx.ravel() / W - 0.5, yy.ravel() / H - 0.5
    X = np.stack([L ** 0, L, L ** 2, L ** 3, x, y, x * x, x * y, y * y, L * x, L * y, L * x * x, L * x * y, L * y * y], axis=1)
    residuals = []
    for channel in (1, 2):
        values = lab[..., channel].ravel()
        coef, *_ = np.linalg.lstsq(X, values, rcond=None)
        residuals.append(values - X @ coef)
    rms = float(np.sqrt(sum(np.mean(r ** 2) for r in residuals)))
    patches = float((np.hypot(*residuals) > PATCH_CHROMA).mean() * 100)
    if rms < BW_BELOW and patches < MAX_BW_PATCH_SHARE:
        return rms, patches, "bw"
    if rms > COLOR_ABOVE:
        return rms, patches, "color"
    return rms, patches, "unsure"


VERDICTS = {
    "bw": "bw: use restore-bw-panel",
    "color": "color: use restore-color-panel",
    "unsure": "unsure: view it. A cast on B&W and subtle or spot color both land here",
}


def cmd_check(args):
    rms, patches, verdict = classify(args.image)
    print(f"unexplained chroma {rms:.2f}, patches {patches:.2f}%")
    print(VERDICTS[verdict])


def basis(x, y):
    return np.stack([x ** 0, x, y, x * x, x * y, y * y], axis=-1)


def white_candidates(lab, gate=None):
    """Bright, flat pixels that might be paper. gate=(L, a, b) of known whites
    keeps only pixels near that color, so painted flats can't vote at all."""
    L = lab[..., 0]
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    threshold = np.percentile(L, 97) - 18
    if gate is not None:
        # Named whites in the dim corner of a falloff still count.
        threshold = min(threshold, gate[0] - 15)
    bright = L > threshold
    mean = cv2.blur(L, (9, 9))
    flat = np.sqrt(np.maximum(cv2.blur(L * L, (9, 9)) - mean * mean, 0)) < 3.5
    candidates = bright & flat
    if gate is not None:
        candidates &= np.hypot(lab[..., 1] - gate[1], lab[..., 2] - gate[2]) < WHITE_GATE
    return cv2.erode(candidates.astype(np.uint8), kernel) > 0


def fit_white(lab, lin, gate=None):
    """Fit the light's color and falloff to solid bright regions: paper, balloons.

    A low-order surface is what keeps this off the art: it can follow a lamp's
    gradient across the page, but not a yellow sky's edge. Returns log-linear
    coefficients per channel (or None if nothing bright and flat enough exists),
    the coverage of the anchors kept, and a mask of them for --anchors.
    """
    L = lab[..., 0]
    H, W = L.shape
    mask = white_candidates(lab, gate)
    coverage = float(mask.mean())
    if coverage < MIN_WHITE_COVERAGE:
        return None, coverage, mask

    yy, xx = np.nonzero(mask)
    pick = np.random.default_rng(0).permutation(len(yy))[:20000]
    yy, xx = yy[pick], xx[pick]
    X = basis(xx / W - 0.5, yy / H - 0.5)
    logs = np.log(np.maximum(lin[yy, xx], 1e-4))
    samples = lab[yy, xx]
    keep = np.ones(len(yy), bool)
    # Reject what doesn't sit on one smooth light: pale shading below the surface,
    # and colored areas off it. Painted flats are the minority wherever paper shows.
    for _ in range(6):
        fits = [np.linalg.lstsq(X[keep], samples[keep, c], rcond=None)[0] for c in range(3)]
        res = [samples[:, c] - X @ fits[c] for c in range(3)]
        sigma = [max(1.4826 * np.median(np.abs(res[c][keep])), 1.0) for c in range(3)]
        keep = (res[0] > -2.5 * sigma[0]) & (np.abs(res[1]) < 2.5 * sigma[1]) & (np.abs(res[2]) < 2.5 * sigma[2])
    coefs = np.stack([np.linalg.lstsq(X[keep], logs[keep, c], rcond=None)[0] for c in range(3)])
    # The same acceptance test over every candidate, for the overlay.
    ay, ax = np.nonzero(mask)
    full = lab[ay, ax]
    fX = basis(ax / W - 0.5, ay / H - 0.5)
    fres = [full[:, c] - fX @ fits[c] for c in range(3)]
    kept = np.zeros_like(mask)
    kept[ay, ax] = (fres[0] > -2.5 * sigma[0]) & (np.abs(fres[1]) < 2.5 * sigma[1]) & (np.abs(fres[2]) < 2.5 * sigma[2])
    return coefs, float(mask.mean() * keep.mean()), kept


def fit_ink(lab, lin_y):
    """Glare over the ink, as a smooth luminance floor. None if there's no ink.

    Reads the darkest pixels of each cell and fits under them, because the ink is
    often only thin lines: any solid dark region left to vote is paint, and
    reading a charcoal shape as glare turned it navy and crushed everything near it.
    """
    H, W = lin_y.shape
    xs, ys, floors, cells = [], [], [], []
    for row in np.array_split(np.arange(H), INK_GRID):
        for col in np.array_split(np.arange(W), INK_GRID):
            cell = np.ix_(row, col)
            floor = np.percentile(lin_y[cell], 2)
            if np.percentile(lab[..., 0][cell], 2) < 35:
                xs.append(col.mean() / W - 0.5)
                ys.append(row.mean() / H - 0.5)
                floors.append(floor)
                cells.append((row[0], row[-1], col[0], col[-1]))
    if len(floors) < INK_GRID // 2:
        return None, []
    X, y = basis(np.array(xs), np.array(ys)), np.array(floors)
    keep = np.ones(len(y), bool)
    coef = np.zeros(X.shape[1])
    for _ in range(4):
        coef = np.linalg.lstsq(X[keep], y[keep], rcond=None)[0]
        r = y - X @ coef
        keep = r < 1.5 * max(1.4826 * np.median(np.abs(r[keep])), 1e-4)
    return coef, [c + (bool(k),) for c, k in zip(cells, keep)]


def parse_box(text, W, H):
    x, y, w, h = (int(v) for v in text.split(","))
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        sys.exit(f"box {text} is outside the {W}x{H} image")
    return x0, y0, x1, y1


def named_white(lab, boxes):
    """Median Lab over the --white-box regions, after dropping their lettering."""
    picks = []
    for x0, y0, x1, y1 in boxes:
        region = lab[y0:y1, x0:x1].reshape(-1, 3)
        region = region[region[:, 0] >= np.percentile(region[:, 0], 40)]
        L, a, b = np.median(region, axis=0)
        print(f"white box {x0},{y0},{x1 - x0},{y1 - y0}: L {L:.1f} a {a:.1f} b {b:.1f}")
        picks.append(region)
    return tuple(float(v) for v in np.median(np.concatenate(picks), axis=0))


def keep_dark_hue(out_lab, src_lab):
    """Turn dark painted color back to the source's hue, keeping the restored L and chroma.

    Glare removal pulls dark browns toward red: Bleeding Hearts #8's glove went from
    hue 56 to 30, whatever the black point. Neutral darks have no hue to keep.
    """
    src = cv2.GaussianBlur(src_lab, (0, 0), 1.5)
    t = np.clip((DARK_HUE_NONE_L - src[..., 0]) / (DARK_HUE_NONE_L - DARK_HUE_FULL_L), 0, 1)
    src_chroma = np.hypot(src[..., 1], src[..., 2])
    weight = (t * t * (3 - 2 * t)) * np.clip((src_chroma - 3) / 5, 0, 1)
    out_chroma = np.hypot(out_lab[..., 1], out_lab[..., 2])
    unit_out = out_lab[..., 1:] / np.maximum(out_chroma, 1e-6)[..., None]
    unit_src = src[..., 1:] / np.maximum(src_chroma, 1e-6)[..., None]
    mixed = (1 - weight)[..., None] * unit_out + weight[..., None] * unit_src
    mixed /= np.maximum(np.hypot(mixed[..., 0], mixed[..., 1]), 1e-6)[..., None]
    result = out_lab.copy()
    result[..., 1:] = mixed * out_chroma[..., None]
    return result, weight


def write_anchors(path, small, white_mask, ink_cells, boxes, scale):
    """The source, dimmed, with the white anchors kept in green and ink cells outlined."""
    view = (small.astype(np.float32) * 0.45).astype(np.uint8)
    if white_mask is not None:
        view[white_mask] = (0.4 * view[white_mask] + [0, 150, 0]).astype(np.uint8)
    for r0, r1, c0, c1, kept in ink_cells:
        cv2.rectangle(view, (int(c0), int(r0)), (int(c1), int(r1)), (255, 160, 0) if kept else (0, 0, 220), 1)
    for x0, y0, x1, y1 in boxes:
        cv2.rectangle(view, (int(x0 * scale), int(y0 * scale)), (int(x1 * scale), int(y1 * scale)), (0, 255, 255), 2)
    cv2.imwrite(str(path), view)
    print(f"wrote {path}: green = white anchors, blue = ink cells used, red = ink cells rejected, yellow = --white-box")


LUMA = np.array([0.0722, 0.7152, 0.2126])  # BGR


def membrane(values, known):
    """Fill the unknown pixels with the smoothest surface through the known ones.

    A Laplace fill with free edges where the image ends. Unlike a polynomial it
    can't overshoot what it's given: a quadratic fitted around The Demon #2's glare
    extrapolated to the frame edge and darkened clean paint by 9 L.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import spsolve

    h, w = known.shape
    unknown = ~known
    n = int(unknown.sum())
    if n == 0:
        return values.copy()
    index = np.full((h, w), -1)
    index[unknown] = np.arange(n)
    ys, xs = np.nonzero(unknown)
    rows, cols, data = [], [], []
    degree = np.zeros(n)
    rhs = np.zeros((n, values.shape[-1]))
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ny, nx = ys + dy, xs + dx
        inside = (ny >= 0) & (ny < h) & (nx >= 0) & (nx < w)
        degree += inside
        k = np.nonzero(inside)[0]
        ny, nx = ny[k], nx[k]
        fixed = known[ny, nx]
        np.add.at(rhs, k[fixed], values[ny[fixed], nx[fixed]])
        rows.append(k[~fixed])
        cols.append(index[ny[~fixed], nx[~fixed]])
        data.append(np.full(int((~fixed).sum()), -1.0))
    rows.append(np.arange(n))
    cols.append(np.arange(n))
    data.append(degree)
    A = coo_matrix((np.concatenate(data), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsr()
    out = values.copy()
    out[unknown] = spsolve(A, rhs).reshape(n, -1)
    return out


def remove_glare(bgr, box, map_path=None):
    """Take a soft additive glare off the paint inside one box, keeping its texture.

    Glare is the lamp reflecting off the page, so it adds light on top of the art:
    photo = art + glare. The box must reach clean paint on every side that isn't the
    frame edge, because the glare is taken as zero there. Inside, the art is taken
    as that paint (filled smoothly across), and the lift above it is the glare,
    read only from pixels the lift could explain: ink, other colors, and specks are
    filled from around them. A dark pixel caps the glare on and near it, since added
    light can't leave anything darker than itself; the cap scales the glare's
    strength, not one channel, so a red drip under it keeps its red.
    """
    from scipy.ndimage import median_filter

    H, W = bgr.shape[:2]
    x0, y0, x1, y1 = box
    X0, Y0 = max(x0 - GLARE_MARGIN, 0), max(y0 - GLARE_MARGIN, 0)
    X1, Y1 = min(x1 + GLARE_MARGIN, W), min(y1 + GLARE_MARGIN, H)
    crop = bgr[Y0:Y1, X0:X1]
    ch, cw = crop.shape[:2]
    lin = srgb_to_linear(crop.astype(np.float64) / 255.0)
    lab = to_lab(crop)
    inside = np.zeros((ch, cw), bool)
    inside[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    label = f"glare box {x0},{y0},{x1 - x0},{y1 - y0}"

    # The paint around the box is its margin's commonest color: a median would
    # mix it with the ink and figures the margin also crosses.
    pick = ~inside & (lab[..., 0] > 15)
    if pick.sum() < 200:
        print(f"{label}: no margin to read the paint from: left alone")
        return bgr
    bins = np.floor(lab[pick][:, 1:] / 6).astype(int)
    keys, counts = np.unique(bins, axis=0, return_counts=True)
    mode = (keys[counts.argmax()] + 0.5) * 6
    near = pick & (np.hypot(lab[..., 1] - mode[0], lab[..., 2] - mode[1]) < 10)
    paint_lab = np.median(lab[near], axis=0)
    paint = (
        ~inside
        & (np.hypot(lab[..., 1] - paint_lab[1], lab[..., 2] - paint_lab[2]) < GLARE_PAINT_CHROMA)
        & (np.abs(lab[..., 0] - paint_lab[0]) < GLARE_PAINT_L)
    )
    paint = cv2.erode(paint.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    print(f"{label}: paint around it L {paint_lab[0]:.1f} a {paint_lab[1]:.1f} b {paint_lab[2]:.1f} ({paint.sum()} px)")
    if paint.sum() < 200:
        print("  <-- too little clean paint around the box: widen it, or move it off the figures")
        return bgr

    # The paint with its texture averaged out, filled across the box at quarter size.
    weight = paint.astype(np.float32)
    density = cv2.GaussianBlur(weight, (0, 0), 4)
    averaged = cv2.GaussianBlur((lin * weight[..., None]).astype(np.float32), (0, 0), 4) / np.maximum(density, 1e-4)[..., None]
    sw, sh = (cw + 3) // 4, (ch + 3) // 4
    known = cv2.resize(np.where(density > 0.5, weight, 0), (sw, sh), interpolation=cv2.INTER_AREA) > 0.6
    filled = membrane(cv2.resize(averaged, (sw, sh), interpolation=cv2.INTER_AREA).astype(np.float64), known)
    reference = cv2.resize(filled.astype(np.float32), (cw, ch), interpolation=cv2.INTER_LINEAR).astype(np.float64)
    lift = lin - reference

    # Only pixels no darker than the paint's texture allows can say how much light
    # was added. A one-sided test (every channel up) kept only the upward noise and
    # darkened clean paint, so the threshold scales with that texture.
    texture = (lin - averaged)[paint]
    noise = 1.4826 * np.median(np.abs(texture - np.median(texture, axis=0)), axis=0)
    soft = cv2.GaussianBlur(lift.astype(np.float32), (0, 0), 1.5)
    usable = inside & np.all(soft > -GLARE_NOISE_SIGMAS * noise, axis=-1)
    weight = usable.astype(np.float32)
    density = cv2.GaussianBlur(weight, (0, 0), 8)
    near = cv2.GaussianBlur((lift * weight[..., None]).astype(np.float32), (0, 0), 8) / np.maximum(density, 1e-4)[..., None]
    far = cv2.GaussianBlur((lift * weight[..., None]).astype(np.float32), (0, 0), 32) / np.maximum(
        cv2.GaussianBlur(weight, (0, 0), 32), 1e-4
    )[..., None]
    alpha = np.clip(density / 0.3, 0, 1)[..., None]
    glare = alpha * near + (1 - alpha) * far
    # A local median follows the glare's peak, where a blur alone flattened it, and
    # ignores the specks the usable pixels still include.
    for _ in range(3):
        guess = np.where(usable[..., None], lift, glare)
        glare = np.stack(
            [cv2.GaussianBlur(median_filter(guess[..., c], size=GLARE_MEDIAN).astype(np.float32), (0, 0), 3) for c in range(3)],
            axis=-1,
        )
    glare = np.clip(glare, 0, None)

    uncapped_y = glare @ LUMA
    glared = inside & (uncapped_y > 0.25 * max(float(np.percentile(uncapped_y[inside], 99.5)), 1e-6))
    floor = cv2.erode(lin.astype(np.float32), np.ones((5, 5), np.uint8))
    cap = np.min(floor / np.maximum(glare, 1e-3), axis=-1)
    cap = np.clip(np.where(glare.max(axis=-1) > 2e-3, cap, 1.0), 0, 1).astype(np.float32)
    cap = np.minimum(cap, cv2.GaussianBlur(cv2.erode(cap, np.ones((9, 9), np.uint8)), (0, 0), 4))
    glare *= cap[..., None]

    # Fade out toward each side that isn't the frame, where the glare is taken as zero.
    yy, xx = np.mgrid[0:ch, 0:cw]
    far_away = np.full((ch, cw), 10**6)
    to_side = np.minimum.reduce([
        xx - (x0 - X0) if x0 > 0 else far_away,
        (x1 - X0) - 1 - xx if x1 < W else far_away,
        yy - (y0 - Y0) if y0 > 0 else far_away,
        (y1 - Y0) - 1 - yy if y1 < H else far_away,
    ]).astype(np.float32)
    fade = np.clip(to_side / GLARE_FEATHER, 0, 1)
    # Only where the glare was read, not filled in under art that sits on the side.
    rim = usable & (to_side >= GLARE_FEATHER) & (to_side < GLARE_FEATHER + 4)
    glare_y = glare @ LUMA
    peak = float(np.percentile(glare_y[inside], 99.5))
    glare *= (fade * fade * (3 - 2 * fade) * inside)[..., None]

    out = np.clip(lin - glare, 0, 1)
    out8 = np.clip(linear_to_srgb(out) * 255 + 0.5, 0, 255).astype(np.uint8)
    drop = (lab[..., 0] - to_lab(out8)[..., 0])[inside]
    print(
        f"  took off up to {np.percentile(drop, 99.5):.1f} L (median {np.median(drop):.1f}); "
        f"read from {usable[inside].mean():.0%} of the box; dark pixels capped {(cap[glared] < 0.95).mean():.0%} of the glare"
    )
    if rim.any() and peak > 0 and float(np.percentile(glare_y[rim], 95)) > GLARE_AT_EDGE * peak:
        print("  <-- the glare reaches a side of the box: widen it until that side is clean paint")
    blown = inside & (crop.max(axis=-1) >= 250) & (crop.min(axis=-1) >= 235)
    if blown.mean() > 0.002:
        print(f"  <-- {blown.mean():.1%} of the box is blown out to white: nothing is left there to recover")

    result = bgr.copy()
    result[Y0:Y1, X0:X1] = out8
    if map_path:
        shade = (np.clip(glare_y / max(peak, 1e-6), 0, 1) * 255).astype(np.uint8)
        view = (crop // 2).astype(np.uint8)
        view[usable] = (view[usable] * 0.6 + [0, 90, 0]).astype(np.uint8)
        view[paint] = (view[paint] * 0.6 + [90, 60, 0]).astype(np.uint8)
        view[..., 2] = np.maximum(view[..., 2], shade)
        cv2.rectangle(view, (x0 - X0, y0 - Y0), (x1 - X0 - 1, y1 - Y0 - 1), (0, 255, 255), 1)
        cv2.imwrite(str(map_path), cv2.resize(view, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
        print(f"  wrote {map_path}: red = glare taken off, green = pixels it was read from, blue = paint it was measured against")
    return result


def cmd_enhance(args):
    bgr = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")

    source = bw.rectify(args, bgr)
    H, W = source.shape[:2]
    # Glare comes off first: it's light on the page, and left in it would read as
    # paper to the white field and as lifted ink to the black point.
    warped = source
    for i, text in enumerate(args.glare_box or []):
        map_path = None
        if args.glare_map:
            p = Path(args.glare_map)
            map_path = p if len(args.glare_box) == 1 else p.with_name(f"{p.stem}-{i + 1}{p.suffix}")
        warped = remove_glare(warped, parse_box(text, W, H), map_path)
    lin = srgb_to_linear(warped.astype(np.float64) / 255.0)
    yy, xx = np.mgrid[0:H, 0:W]
    full_basis = basis(xx / W - 0.5, yy / H - 0.5)

    small = shrink(warped, FIELD_LONG_SIDE)
    scale = small.shape[1] / W
    small_lab = to_lab(small)
    small_lin = srgb_to_linear(small.astype(np.float64) / 255.0)
    lab_full = to_lab(warped)
    source_ink_l = float(np.percentile(lab_full[..., 0], 1))

    boxes = [parse_box(b, W, H) for b in args.white_box or []]
    gate = named_white(lab_full, boxes) if boxes else None

    # Everything here is reflectance times light, so dividing by a white field
    # takes out the cast and the falloff together, in proportion, across all hues.
    coefs, coverage, white_mask = fit_white(small_lab, small_lin, gate)
    balance = coefs is not None and not args.no_balance
    if coefs is None:
        print(f"  <-- no solid paper to read the light from ({coverage:.1%}): color left alone, levels only")
    strength = 0.0
    if balance:
        white = np.exp(full_basis @ coefs.T)
        white_lab = cv2.cvtColor(linear_to_srgb(shrink(white, 64)).astype(np.float32), cv2.COLOR_BGR2Lab)
        cast_a, cast_b = float(np.median(white_lab[..., 1])), float(np.median(white_lab[..., 2]))
        cast = float(np.hypot(cast_a, cast_b))
        spread = float(np.hypot(white_lab[..., 1].std(), white_lab[..., 2].std()))
        print(f"white anchors {coverage:.1%}; cast a={cast_a:.1f} b={cast_b:.1f} (chroma {cast:.1f}), varying {spread:.1f} across the frame")
        # The light and a painted flat look alike from here, so the stronger the
        # claimed cast, the more evidence it needs. Getting this wrong repaints
        # the art, which is far worse than leaving a photo a little warm.
        if gate is not None:
            at_boxes = np.median(np.concatenate([white_lab_at(white, b, W, H) for b in boxes]), axis=0)
            gap = float(np.hypot(at_boxes[1] - gate[1], at_boxes[2] - gate[2]))
            print(f"field at the white boxes a={at_boxes[1]:.1f} b={at_boxes[2]:.1f}, {gap:.1f} from what they measure")
            if gap > BOX_DISAGREE:
                print("  <-- the field doesn't follow the named whites: check --anchors, or add boxes where the light differs")
        if args.strength is not None:
            strength = args.strength
        elif gate is not None:
            # Named whites are the evidence the limits below stand in for.
            strength = NAMED_WHITE_STRENGTH
        elif cast > UNBELIEVABLE_CAST:
            print("  <-- this much cast is painted color, not light: color left alone, levels only")
            balance = False
        elif cast > WEAK_EVIDENCE_CAST and coverage < WEAK_WHITE_COVERAGE:
            print("  <-- strong cast read from very little paper: color left alone, levels only")
            balance = False
        else:
            strength = min(1.0, MAX_CAST_REMOVED / max(cast, 1e-3))
            if strength < 1:
                print(f"  <-- removing {strength:.0%} of a strong cast, to protect the art. --strength 1 takes it all")
    if balance:
        # A lamp's color drifts gently; a field that swings widely has found the art.
        y = (white @ LUMA)[..., None]
        tint = np.log(white / y)
        center = np.median(tint.reshape(-1, 3), axis=0)
        drift = min(1.0, MAX_CAST_DRIFT / max(spread, 1e-3))
        white = y * np.exp(strength * (center + drift * (tint - center)))
    else:
        cast_a, cast_b = 0.0, 0.0
        peak = np.percentile(lin @ LUMA, 99.5)
        white = np.full_like(lin, peak)

    white_y = white @ LUMA
    ink_coef, ink_cells = fit_ink(small_lab, small_lin @ LUMA)
    if args.anchors:
        write_anchors(args.anchors, small, white_mask, ink_cells, boxes, scale)
    if ink_coef is None:
        print("no solid ink: black point left where it is")
        veil_y = np.zeros((H, W))
    else:
        veil_y = np.clip(full_basis @ ink_coef, 0, args.max_veil * white_y)
        print(f"glare over the ink: up to {float((veil_y / white_y).max()):.3f} of the paper (cap {args.max_veil})")
    # Glare is the same lamp bouncing off the page, so it carries the white's color.
    # Reading it from the dark pixels instead would strip the blue from a navy sky.
    veil = veil_y[..., None] * white / white_y[..., None]

    # Partial removal leaves room above 1 for the cast it kept; the final clip is the limit.
    normal = np.clip((lin - veil) / np.maximum(white - veil, 1e-3), 0, 1.5)

    if args.tint:
        paper_a, paper_b = (float(v) for v in args.tint.split(","))
    elif gate is not None and balance and cast_b >= 0:
        # Below full strength a neutral target still cooled the greys here.
        paper_a, paper_b = float(np.clip(cast_a, -1.0, 2.0)), min(cast_b, args.max_warmth)
    elif not balance or strength < 1 or cast_b < 0:
        paper_a, paper_b = 0.0, 0.0  # A partial removal has kept its warmth already.
    else:
        paper_a, paper_b = float(np.clip(cast_a, -1.0, 2.0)), min(cast_b, args.max_warmth)
    print(f"paper tint a={paper_a:.2f} b={paper_b:.2f}")

    if balance:
        # Brighten only so far: if the anchors were pale paint, pushing them to
        # paper white blows out the art's own light tones.
        anchor_l = float(np.median(cv2.cvtColor(linear_to_srgb(shrink(white, 64)).astype(np.float32), cv2.COLOR_BGR2Lab)[..., 0]))
        paper_l = max(anchor_l, min(args.paper_l, anchor_l + MAX_BRIGHTENING))
    else:
        # The same white it divided by, so levels alone can't dim the highlights.
        paper_l = float(116 * np.cbrt(peak) - 16)
    target = lab_to_linear(paper_l, paper_a, paper_b)
    black = lab_to_linear(min(args.ink_l, source_ink_l), 0, 0)[0]
    out = black + (target - black) * normal

    lab = cv2.cvtColor(linear_to_srgb(out).astype(np.float32), cv2.COLOR_BGR2Lab)
    L = lab[..., 0]

    # A black point above the ink's own noise, as in restore-bw-panel: glare leaves
    # solid blacks mottled, and stretching them makes it worse. Chroma scales down
    # with lightness here, so what's left of the noise can't turn into color speckle.
    if ink_coef is not None:
        ink_mask = cv2.erode((L < np.percentile(L, 8) + 6).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        # Solid darks lighter than the line work are paint, whose texture is the art's.
        if ink_mask.mean() > MIN_INK_COVERAGE / 2 and np.median(L[ink_mask]) <= np.percentile(L, 1) + 8:
            floor = float(np.median(L[ink_mask]) + args.ink_sigmas * L[ink_mask].std())
            knee = floor + 12.0
            u = np.clip((L - floor) / (knee - floor), 0, 1)
            target_l = min(args.ink_l, source_ink_l)
            toe = target_l + (knee - target_l) * u ** 1.4
            new_l = np.where(L < knee, toe, L)
            ratio = np.clip(new_l / np.maximum(L, 1.0), 0, 1.5)[..., None]
            lab[..., 1:] *= ratio
            L = new_l
            print(f"ink floor L {floor:.1f}")

    if args.keep_dark_hue:
        lab, weight = keep_dark_hue(lab, lab_full)
        print(f"kept the source hue on {float((weight > 0.5).mean()):.1%} of the frame (dark painted color)")
    if args.saturation != 1:
        lab[..., 1:] *= args.saturation
    blurred = cv2.GaussianBlur(L.astype(np.float32), (0, 0), 1.0)
    lab[..., 0] = np.clip(L + args.sharpen * (L - blurred), 0, 100)

    bgr_out = cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_Lab2BGR)
    out8 = np.clip(bgr_out * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(
        str(args.output),
        out8,
        [cv2.IMWRITE_JPEG_QUALITY, 92, cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1],
    )
    print(f"wrote {args.output} ({Path(args.output).stat().st_size // 1024} KB)")
    if args.compare:
        bw.write_compare(args, source, out8)


def white_lab_at(white, box, W, H):
    x0, y0, x1, y1 = box
    region = shrink(white[y0:y1, x0:x1], 32)
    return cv2.cvtColor(linear_to_srgb(region).astype(np.float32), cv2.COLOR_BGR2Lab).reshape(-1, 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    c = sub.add_parser("check", help="color, black-and-white, or needs a look")
    c.add_argument("image")
    c.set_defaults(func=cmd_check)

    e = sub.add_parser("enhance", help="take out the light; side flags reframe, so only pass them when asked")
    e.add_argument("image")
    e.add_argument("output")
    for side in ("top", "bottom", "left", "right"):
        e.add_argument(f"--{side}", help="measured edge line; reframes the panel, so only when asked")
    e.add_argument("--strength", type=float, help="how much of the cast to remove, 0-1, overriding the safety limits; lower it if the art lost color")
    e.add_argument("--no-balance", action="store_true", help="leave color alone, only set levels")
    e.add_argument("--white-box", action="append", help="X,Y,W,H of something known white, like a balloon; repeatable. "
                   "Only pixels near its color anchor the light, and it overrides the cast limits")
    e.add_argument("--glare-box", action="append", help="X,Y,W,H around a soft glare streak or patch, reaching clean paint on every "
                   "side that isn't the frame edge; repeatable. Takes the glare off before anything else")
    e.add_argument("--glare-map", help="write what --glare-box took off and read from (numbered when there are several boxes)")
    e.add_argument("--keep-dark-hue", action="store_true", help="keep the source hue in dark painted color, which glare removal pulls toward red")
    e.add_argument("--max-veil", type=float, default=MAX_VEIL, help="most glare taken off the ink, as a share of the paper; 0.02-0.03 for painted darks")
    e.add_argument("--anchors", help="write the white anchors and ink cells it fitted, over the source")
    e.add_argument("--saturation", type=float, default=1.0, help="only when asked: removing glare usually restores color by itself")
    e.add_argument("--ink-sigmas", type=float, default=1.5, help="black point above the ink level; raise if blacks mottle")
    e.add_argument("--sharpen", type=float, default=0.35)
    e.add_argument("--ink-l", type=float, default=9.0, help="ink target; a darker source keeps its own")
    e.add_argument("--paper-l", type=float, default=91.0, help="paper target; a brighter source keeps its own")
    e.add_argument("--tint", help="A,B paper tint in Lab, overriding the measured one; 0,0 for neutral")
    e.add_argument("--max-warmth", type=float, default=6.0, help="most yellow a page keeps; aged stock may want more")
    e.add_argument("--compare", help="write a before/after image here")
    e.add_argument("--zoom", action="append", help="X,Y,W,H in output pixels; repeatable; zooms the compare image")
    e.set_defaults(func=cmd_enhance)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
