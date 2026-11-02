---
name: restore-color-panel
description: Restore a phone photo of a color comic panel in the comic-snaps gallery. Takes out the lamp's color cast and falloff, lifts glare off the blacks, keeps the art's own colors, and swaps the result into gallery.json with its metadata and embeddings handled. Keeps the photo's framing unless the user asks to crop or straighten. Use whenever asked to improve, fix, clean up, enhance, or restore a panel's image and the art is in color, or when you don't yet know whether it is, usually named by series, issue, and artist. It checks first and hands black-and-white art to restore-bw-panel.
---

# Restoring a color panel

`restore_color.py` beside this file does the checking and enhancing, from the repo
root. Measuring edges and installing are shared with `restore-bw-panel/restore.py`.
Both need OpenCV (`cv2`), which is installed locally but isn't in
`scripts/requirements.txt`. Write working files to the scratchpad.

## Framing

Don't reframe unless the user asks for it. Reframing is anything that changes what's
in the picture or how it sits: cropping (neighbouring panels, margins, and page edges
included), straightening, rotating, and perspective correction. What a photo includes
is the user's choice, and this work is about the light, the ink, and the color.

With no edge flags, the output has the photo's exact framing and dimensions. If a crop
or straighten looks worthwhile, mention it when you finish and leave it undone.

## Workflow

### 1. Find the panel and look at it

Search `public/data/gallery.json` by title, issue, and artist. A series can have
several panels per issue, so match the artist. Read the image and note the light (any
overall tint, one side darker, glare) and whether it needs this at all: see "Skip it"
below.

### 2. Check that it's color

```bash
python3 scripts/skills/restore-color-panel/restore_color.py check PHOTO.jpg
```

| Verdict | Do |
| --- | --- |
| `bw` | Use the `restore-bw-panel` skill instead. It gets far more out of one ink on one paper, and discards all color |
| `color` | Carry on here |
| `unsure` | View it and decide. B&W under a colored lamp and subtle or spot color both land here. Any painted color at all, even a single red accent, stays here, since the B&W skill would erase it. Ask if you can't tell |

### 3. Enhance into the scratchpad

```bash
python3 scripts/skills/restore-color-panel/restore_color.py enhance PHOTO.jpg OUT.jpg \
  --compare CMP.jpg --zoom 60,130,330,200 --zoom 300,900,330,200
```

`--compare` writes the source beside the result, pixel-aligned. `--zoom` takes
`X,Y,W,H` and replaces the full view with those crops. Look at the whole frame once
too, then zoom on a face, a dark painted area, and the largest black area.

If the user did ask to reframe, get edge flags from `measure` as the `restore-bw-panel`
skill describes, and add only the sides they asked about, with `=`: `--top=-0.01,46.5`.

### 4. Check it, comparing against the source

Read the compare image. Ask whether the art's colors survived, since that's the failure
that matters: a photo left slightly warm is fine, and repainted art isn't. Compare hues
in skin, a dark painted area, and any large flat color. A flaw that's also in the source
is not yours to fix.

| You see | Do |
| --- | --- |
| Art lost its color, or everything shifted toward the opposite hue | The bright areas were paint, not paper. Lower `--strength`, or use `--no-balance` |
| A warm or sepia palette looks cold | Same: that warmth may be the art. Try `--strength 0.5` |
| Cast clearly remains, with paper visible | `--strength 1`, if the warning says it was limited |
| Colored page kept when it should be neutral, or the reverse | `--tint A,B`, or `--tint 0,0` for neutral. `--max-warmth` allows more yellow for aged stock |
| Black areas mottled | Raise `--ink-sigmas` (default 1.5) |
| Dark painted areas crushed to black | Lower `--ink-sigmas` |
| Highlights blown out | Lower `--paper-l` (default 91) |
| Halos along the lines | Lower `--sharpen` (default 0.35) |
| Faded art still looks flat | Only if the user asks: `--saturation 1.1`. It invents color, so never by default |
| Hard glare spot left behind | Not fixable here: the fields are too smooth to follow it. Tell the user |

### 5. Install

```bash
python3 scripts/skills/restore-bw-panel/restore.py install PANEL_ID OUT.jpg
```

This writes the image as `...-v2.jpg` (or the next version) and removes the old file,
which stays in git. A new name is what gets past the service worker, which never
revalidates an image it has cached, so don't overwrite a file in place. The panel keeps
its id, so links and ratings survive. It patches only that panel in `gallery.json`,
preserving CRLF, with fresh size, colors, and hashes. It also drops the panel's three
embedding entries: **the next push of gallery.json regenerates them**, and until then
the panel sits out of similarity sorts like any new panel.

Add `--root COPY_OF_REPO` to rehearse against a copy. Check `git status` and
`git diff public/data/gallery.json` afterwards: only this panel should appear.

### 6. Finish

Don't commit or stage. Tell the user what changed and what to look at. They make the
visual call in the app, so don't drive a browser to judge it.

## What its warnings mean

- **"no solid paper to read the light from".** Full-bleed paintings and dark panels have
  nothing known to be white, so color can't be corrected safely. It only sets levels.
  This is usually the right result, not a failure.
- **"this much cast is painted color" / "strong cast read from very little paper".** The
  bright areas it found are probably art. It only sets levels. Override with `--strength`
  only if you can see that those areas really are paper.
- **"removing N% of a strong cast".** The cast is strong enough that full removal risks
  the art, so it's capped and some warmth stays. Look before raising it.
- **"no solid ink".** There's nothing dark enough to read glare from, so the black point
  stays where it is.

## Skip it

- Black-and-white art: use `restore-bw-panel`.
- Clean scans: neutral white paper and true blacks. There's nothing to take out.
- Blur or heavy compression as the main problem. This corrects light and color, not lost
  detail. Ask for a better photo instead.

## How it works

Worth knowing before changing the script. The limits were all set by panels it got wrong.

- **Check:** ink on tinted paper has color that depends only on brightness and position,
  so it fits those and scores what's left over. Calibrated on the whole gallery.
- **White field:** the photo is reflectance times light, so dividing per channel by a
  white field removes the cast and falloff together, in proportion across all hues. It's
  fitted to bright, flat regions and held to a low-order surface, which can follow a
  lamp's gradient but not the edge of a yellow sky.
- **Evidence limits:** light and a painted flat look alike here. Above chroma 40 it's
  treated as paint (a yellow area read as paper ruined a Harley Quinn panel), and above
  15 it needs 3% coverage (one yellowed balloon turned a face purple). Removal is capped
  at chroma 18, drift across the frame at 8, and brightening at 8 L, which stopped ochre
  backgrounds bleaching out.
- **Glare:** a smooth floor fitted under the darkest pixels of each cell, because ink is
  often only thin lines and any solid dark left to vote is paint. Reading a charcoal shape
  as glare turned it navy. Glare takes the white field's color, not the dark pixels',
  which would strip the blue from a navy sky.
- **Black point:** like the B&W skill's, it sits above the ink's noise. It only applies
  when solid darks are the darkest thing in the panel, since otherwise they're paint.
- **No saturation boost:** removing glare restores most lost color by itself, and the rest
  would be invented.
