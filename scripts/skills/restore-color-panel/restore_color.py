#!/usr/bin/env python3
"""Restore a phone photo of a color comic panel.

Subcommands (see SKILL.md for the workflow):
  check    say whether the art is color, black-and-white, or needs a look
  enhance  remove the light's color and falloff from the photo, keeping the art's

Measuring edges and installing are shared with restore-bw-panel's restore.py.
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


def cmd_check(args):
    """Ink on tinted paper has color that depends only on brightness and position."""
    bgr = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")
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
        verdict = "bw: use restore-bw-panel"
    elif rms > COLOR_ABOVE:
        verdict = "color: carry on here"
    else:
        verdict = "unsure: view it. A cast on B&W and subtle or spot color both land here"
    print(f"unexplained chroma {rms:.2f}, patches {patches:.2f}%")
    print(verdict)


def basis(x, y):
    return np.stack([x ** 0, x, y, x * x, x * y, y * y], axis=-1)


def fit_white(lab, lin):
    """Fit the light's color and falloff to solid bright regions: paper, balloons.

    A low-order surface is what keeps this off the art: it can follow a lamp's
    gradient across the page, but not a yellow sky's edge. Returns log-linear
    coefficients per channel, or None if nothing bright and flat enough exists.
    """
    L = lab[..., 0]
    H, W = L.shape
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bright = L > np.percentile(L, 97) - 18
    mean = cv2.blur(L, (9, 9))
    flat = np.sqrt(np.maximum(cv2.blur(L * L, (9, 9)) - mean * mean, 0)) < 3.5
    mask = cv2.erode((bright & flat).astype(np.uint8), kernel) > 0
    coverage = float(mask.mean())
    if coverage < MIN_WHITE_COVERAGE:
        return None, coverage

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
    return coefs, float(mask.mean() * keep.mean())


def fit_ink(lab, lin_y):
    """Glare over the ink, as a smooth luminance floor. None if there's no ink.

    Reads the darkest pixels of each cell and fits under them, because the ink is
    often only thin lines: any solid dark region left to vote is paint, and
    reading a charcoal shape as glare turned it navy and crushed everything near it.
    """
    H, W = lin_y.shape
    xs, ys, floors = [], [], []
    for row in np.array_split(np.arange(H), INK_GRID):
        for col in np.array_split(np.arange(W), INK_GRID):
            cell = np.ix_(row, col)
            floor = np.percentile(lin_y[cell], 2)
            if np.percentile(lab[..., 0][cell], 2) < 35:
                xs.append(col.mean() / W - 0.5)
                ys.append(row.mean() / H - 0.5)
                floors.append(floor)
    if len(floors) < INK_GRID // 2:
        return None
    X, y = basis(np.array(xs), np.array(ys)), np.array(floors)
    keep = np.ones(len(y), bool)
    coef = np.zeros(X.shape[1])
    for _ in range(4):
        coef = np.linalg.lstsq(X[keep], y[keep], rcond=None)[0]
        r = y - X @ coef
        keep = r < 1.5 * max(1.4826 * np.median(np.abs(r[keep])), 1e-4)
    return coef


LUMA = np.array([0.0722, 0.7152, 0.2126])  # BGR


def cmd_enhance(args):
    bgr = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"cannot read {args.image}")

    warped = bw.rectify(args, bgr)
    H, W = warped.shape[:2]
    lin = srgb_to_linear(warped.astype(np.float64) / 255.0)
    yy, xx = np.mgrid[0:H, 0:W]
    full_basis = basis(xx / W - 0.5, yy / H - 0.5)

    small = shrink(warped, FIELD_LONG_SIDE)
    small_lab = to_lab(small)
    small_lin = srgb_to_linear(small.astype(np.float64) / 255.0)
    lab_full = to_lab(warped)
    source_ink_l = float(np.percentile(lab_full[..., 0], 1))

    # Everything here is reflectance times light, so dividing by a white field
    # takes out the cast and the falloff together, in proportion, across all hues.
    coefs, coverage = fit_white(small_lab, small_lin)
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
        if args.strength is not None:
            strength = args.strength
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
    ink_coef = fit_ink(small_lab, small_lin @ LUMA)
    if ink_coef is None:
        print("no solid ink: black point left where it is")
        veil_y = np.zeros((H, W))
    else:
        veil_y = np.clip(full_basis @ ink_coef, 0, MAX_VEIL * white_y)
    # Glare is the same lamp bouncing off the page, so it carries the white's color.
    # Reading it from the dark pixels instead would strip the blue from a navy sky.
    veil = veil_y[..., None] * white / white_y[..., None]

    # Partial removal leaves room above 1 for the cast it kept; the final clip is the limit.
    normal = np.clip((lin - veil) / np.maximum(white - veil, 1e-3), 0, 1.5)

    if args.tint:
        paper_a, paper_b = (float(v) for v in args.tint.split(","))
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
        bw.write_compare(args, warped, out8)


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
