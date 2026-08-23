#!/usr/bin/env python3
"""
The melt bench — does the melt keep a panel readable?

    python3 scripts/melt-jacobian.py
    python3 scripts/melt-jacobian.py --amount 0.85 --levels 4.5,6,7.5

## What it measures, and why this effect needs it

`post.melt` displaces every pixel along one heading by the *tone* of the page
at that pixel, read from a mip level. That makes the comic itself the
displacement field, which is the point of it — but it also means the effect's
local scale is set by the panel's own contrast rather than by anything authored,
and no amount of looking at one frame says whether it holds for the next page.

The number that decides it is the sampling Jacobian: how far the sample position
moves per pixel of frame. 1 is the page at native size, much under 0.5 is
over-magnified mush, much over 2.5 is mip-averaged to a wash, and a determinant
at or below zero is the map folding the picture back through itself. The whole
design of the block is one claim about that number — that tying the reach to the
level's own texel makes the Jacobian a function of the amount alone, so a coarse
grain and a fine one are equally readable — and this is that claim checked
against real pages instead of asserted.

Run it after touching MELT_REACH, the level range the cycler draws from, or the
ceiling on the amount.
"""
import argparse
import pathlib
import random
import sys

import numpy as np
from PIL import Image

# Kept in step with shaders/post.ts by hand; there is no way to import a
# constant out of a template literal, so it is asserted here instead.
MELT_REACH = 1.35
# The render target the post chain actually runs at: 1080p at the default 1.5
# render scale, short edge first because `span` is measured against it.
FRAME_H = 1620
FRAME_W = 2880


def mips(gray):
    """The chain GL would build: successive 2x box reductions."""
    levels = [gray]
    while min(levels[-1].shape) > 1:
        a = levels[-1]
        h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
        levels.append(a[:h, :w].reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3)))
    return levels


def tone_at(levels, level, shape):
    """Level `level` of the chain, blended between its two neighbours and
    resampled to the frame — which is what textureLod does."""
    lo, hi = int(np.floor(level)), int(np.ceil(level))
    frac = level - lo
    out = []
    for idx in (lo, hi):
        src = levels[min(idx, len(levels) - 1)]
        img = Image.fromarray((src * 255).astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.BILINEAR
        )
        out.append(np.asarray(img, dtype=np.float32) / 255.0)
    return out[0] * (1 - frac) + out[1] * frac


def survey(path, level, amount, angle):
    img = Image.open(path).convert("L").resize((FRAME_W, FRAME_H), Image.LANCZOS)
    gray = np.asarray(img, dtype=np.float32) / 255.0
    tone = tone_at(mips(gray), level, gray.shape) - 0.5

    # d(uv) = dir * tone * melt * span * MELT_REACH, with span the level's texel
    # as a fraction of the frame's short edge.
    span = (2.0**level) / FRAME_H
    reach = amount * span * MELT_REACH
    dx, dy = np.cos(angle) * reach, np.sin(angle) * reach

    # Gradients in frame units: one pixel of x is 1/FRAME_H of uv, because uv is
    # normalised on the short edge in the same way `span` is.
    gy, gx = np.gradient(tone)
    gx *= FRAME_H
    gy *= FRAME_H

    # Jacobian of uv -> uv + d.
    j11 = 1.0 + dx * gx
    j12 = dx * gy
    j21 = dy * gx
    j22 = 1.0 + dy * gy
    det = j11 * j22 - j12 * j21
    scale = np.sqrt(np.abs(det))
    return scale, det


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--amount", type=float, default=0.85, help="deepest the cycler draws")
    ap.add_argument("--levels", default="5.5,6.5,8", help="the cycler's draw range")
    ap.add_argument("--panels", type=int, default=24)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent / "public" / "images"
    files = sorted(p for p in root.rglob("*.jpg"))
    if not files:
        sys.exit("no panels under public/images")
    random.Random(args.seed).shuffle(files)
    files = files[: args.panels]

    print(f"{len(files)} panels, melt={args.amount}, reach={MELT_REACH}\n")
    print(f"{'level':>6}  {'in 0.5-2.5':>10}  {'median':>7}  {'p1':>6}  {'p99':>6}  {'folded':>7}")
    worst = 1.0
    for level in [float(x) for x in args.levels.split(",")]:
        keep, meds, p1s, p99s, folds = [], [], [], [], []
        for path in files:
            # Straight down the frame, which is what the cycler draws four times
            # in five and the heading that puts the most gradient in the map.
            scale, det = survey(path, level, args.amount, np.pi / 2)
            keep.append(np.mean((scale >= 0.5) & (scale <= 2.5)))
            meds.append(np.median(scale))
            p1s.append(np.percentile(scale, 1))
            p99s.append(np.percentile(scale, 99))
            folds.append(np.mean(det <= 0))
        print(
            f"{level:>6}  {100 * np.mean(keep):>9.1f}%  {np.mean(meds):>7.2f}  "
            f"{np.mean(p1s):>6.2f}  {np.mean(p99s):>6.2f}  {100 * np.mean(folds):>6.2f}%"
        )
        worst = min(worst, float(np.mean(keep)))

    print()
    if worst < 0.95:
        print(f"FAIL: a level put {100 * (1 - worst):.1f}% of the frame outside the readable band")
        return 1
    print("pass: every level keeps at least 95% of the frame in the readable band")
    return 0


if __name__ == "__main__":
    sys.exit(main())
