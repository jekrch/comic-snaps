---
name: restore-bw-panel
description: Restore a phone photo of an old black-and-white comic panel in the comic-snaps gallery. Evens the lighting, seats washed-out ink at black, removes color casts, and swaps the result into gallery.json with its metadata and embeddings handled. Keeps the photo's framing unless the user asks to crop or straighten. Usually reached from restore-panel, which finds the panel and checks it first. Use directly only when the panel is known to be black-and-white. For color art, or if you don't know which it is, use restore-panel.
---

# Restoring a black-and-white panel

Everything runs through `restore.py` beside this file, from the repo root. It
needs OpenCV (`cv2`), which is installed locally but isn't in
`scripts/requirements.txt`. Write working files to the scratchpad.

**This discards all color.** It suits one ink on one paper stock. Color art, however
faded, belongs to the `restore-color-panel` skill, and its `check` command settles
which one a panel needs.

## Framing

Don't reframe unless the user asks for it. Reframing is anything that changes what's
in the picture or how it sits: cropping (neighbouring panels, margins, and page edges
included), straightening, rotating, and perspective correction. What a photo includes
is the user's choice, and this work is about the light and the ink.

With no edge flags, the output has the photo's exact framing and dimensions. If a crop
or straighten looks worthwhile, mention it when you finish and leave it undone.

## Workflow

### 1. Find the panel and look at it

If you came from `restore-panel`, this is done: start at step 2 or 3 with the
`original` it wrote. Otherwise run `restore-panel`'s `find` and `original` steps, which
match the artist and recover the first-posted photo of a panel restored before. Never
enhance a `-vN` image again: its stretched blacks compound.

Read the image and check that it needs this at all: see "Skip it" below.

### 2. Measure the borders, only if asked to reframe

Skip this unless the user asked to crop or straighten. Then give a `START:END` band for
each side they asked about, wide enough to reach from the page margin into the border
line, and narrow enough to stop before solid art. Scanning runs from outside the
panel inward to the first dark pixel. Leave out sides with no border.

```bash
python3 scripts/skills/restore-bw-panel/restore.py measure PHOTO.jpg \
  --top 5:90 --bottom 1150:1225 --right 790:836
```

It prints each edge's fit and the flags for the next step. If an edge warns about
few inliers, narrow its band. If it warns about bow, the page curls: one warp won't
flatten that edge, so tell the user the result will keep some curve.

### 3. Enhance into the scratchpad

```bash
python3 scripts/skills/restore-bw-panel/restore.py enhance PHOTO.jpg OUT.jpg \
  --compare CMP.jpg --zoom 260,300,190,60 --zoom 370,490,190,220
```

If you measured edges, add the flags it printed: `--top=-0.01781,46.52`. Use `=` with
these, or a negative slope reads as a new option. A side with no flag bleeds to the
frame, leaning like the opposite side.

`--compare` writes the source beside the result, pixel-aligned. `--zoom`
takes `X,Y,W,H` in output pixels and replaces the full view with those crops. Zoom
on the smallest lettering, a face, and the largest black area.

### 4. Check it, comparing against the source

Read the compare image. A flaw that's also in the source is not your fault to fix,
so check before tuning: on the panel this was built from, clogged lettering turned
out to be in the photo all along.

| You see | Do |
| --- | --- |
| Black areas mottled or splotchy | Raise `--ink-sigmas` (default 2.5) |
| Black areas lost real texture, or fine lines broke up | Lower `--ink-sigmas` |
| Small lettering clogged, worse than the source | Lower `--gamma` (default 0.9) |
| Halos along the lines | Lower `--sharpen` (default 0.5) |
| Page tint wrong, or colored stock neutralized | `--tint A,B`, or `--tint 0,0` for neutral |
| Hard shadow left in a corner | Not fixable here: it's excluded from the paper model. Tell the user, who may want it cropped |
| Halo around shapes on grey-toned art | The flat-field read the tones as uneven light. Use `restore_color.py enhance --no-balance`, which only sets levels |
| Show-through from the next page more visible | Expected: it's in the photo and the stretch reveals it. Tell the user |

### 5. Install

```bash
python3 scripts/skills/restore-bw-panel/restore.py install PANEL_ID OUT.jpg
```

This writes the image as `...-v2.jpg` (or the next version) and removes the old
file, which stays in git. The panel keeps its id, so links and ratings survive. It
patches only that panel in `gallery.json`, preserving CRLF, with fresh size, colors,
and hashes. It also drops the panel's three embedding entries, because embeddings
are only computed for absent ids: **the next push of gallery.json regenerates
them**, and until then the panel sits out of similarity sorts like any new panel.

Add `--root COPY_OF_REPO` to rehearse against a copy. Check `git status` and
`git diff public/data/gallery.json` afterwards: only this panel should appear.

### 6. Finish

Don't commit or stage. Tell the user what changed and what to look at. They make
the visual call in the app, so don't drive a browser to judge it.

## What its warnings mean

- **"looks colored" (exit 1).** View the source. Refusal is deliberately cautious, and
  plain B&W art on a warm or uneven page can trip it. Use `--force` only once you've
  seen that the color isn't in the art. Faded watercolor scores as low as 4.6 here and
  would be erased, so if you're unsure, ask. If the color is in the art, switch to
  `restore-color-panel`.
- **"strong page color was reduced".** The page's color may be the light or the paper.
  Blue or violet pages are lighting, and neutral is right. A strongly orange or pink
  page could be colored stock, and that's the user's call: ask if you can't tell, and
  keep it with `--tint`.
- **"already high contrast with blown whites".** Someone has already pushed this image.
  It will gain little, and detail lost to clipping can't return, so skip it.
- **"greys carry this art".** Zipatone and stipple held up well in testing, but zoom in
  and confirm. It's unverified on true ink wash, so check that one closely.
- **"not enough solid paper or ink".** The panel has too little of one to model the
  lighting, so this method doesn't apply.

## Skip it

- Color art, including faded or hand-tinted panels: use `restore-color-panel`.
- Clean scans: white paper and true blacks. There's nothing to take out.
- Blur or heavy compression as the main problem. This restores contrast, not lost
  detail. Ask for a better photo instead.

## How it works

Worth knowing before changing the script:

- **Rectify:** only with edge flags, which only come from a request to reframe. One
  perspective warp from the fitted border lines, inset 1px so the crop lands on the border
  ink. Output has a long side of up to 1280, the gallery's norm, enlarging at most 1.25×.
  With no flags the pixels pass through untouched.
- **Flat-field:** smooth paper and ink level fields are fitted separately, from eroded
  masks so only solid regions vote.
- **Black point:** it's set 2.5 local standard deviations above the ink level. Glare
  makes ink noisier in some areas than others, and a single global toe left splotches.
- **Targets only widen the range:** paper L≥91 and ink L≤9, but a brighter or darker
  source keeps its own. Fixed targets greyed clean pages and made true blacks milky.
- **Color:** the tint is a uniform paper color scaled by tone, so ink goes neutral. Warm
  tints are kept within a mild range and blue ones are removed.
