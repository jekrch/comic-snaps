---
name: restore-color-panel
description: Restore a phone photo of a color comic panel in the comic-snaps gallery. Takes out the lamp's color cast and falloff, lifts glare off the blacks, keeps the art's own colors, and swaps the result into gallery.json with its metadata and embeddings handled. Keeps the photo's framing unless the user asks to crop or straighten. Usually reached from restore-panel, which finds the panel and checks it first. Use directly when the art is known to be in color, including faded, hand-tinted, or spot-color panels.
---

# Restoring a color panel

`restore_color.py` beside this file does the checking and enhancing, from the repo
root. Measuring edges and installing are shared with `restore-bw-panel/restore.py`, and
finding panels, recovering originals, and measuring regions with `restore-panel/panel.py`.
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

If you came from `restore-panel`, this and step 2 are done: start at step 3 with the
`original` it wrote. Otherwise run `restore-panel`'s `find` and `original` steps, which
match the artist and recover the first-posted photo of a panel restored before. Never
enhance a `-vN` image again.

Read the image and note the light (any overall tint, one side darker, glare) and whether
it needs this at all: see "Skip it" below.

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

`--anchors ANCHORS.png` shows what it read the light from: white anchors in green, and
the ink cells it fitted glare to in blue (rejected ones red). Anchors on painted color
mean the cast is wrong, whatever the output looks like.

If the user did ask to reframe, get edge flags from `measure` as the `restore-bw-panel`
skill describes, and add only the sides they asked about, with `=`: `--top=-0.01,46.5`.

### 4. Check it, comparing against the source

Read the compare image. Ask whether the art's colors survived, since that's the failure
that matters: a photo left slightly warm is fine, and repainted art isn't. Compare hues
in skin, a dark painted area, and any large flat color, with `restore-panel`'s `probe
SOURCE --box ... --against OUT`: eyes miss a hue shift in darks. A flaw that's also in
the source is not yours to fix.

Before changing `--ink-sigmas` in either direction, zoom on the largest dark area and
decide whether it's ink or paint. Ink is the darkest, most neutral thing in the panel.
Paint is lighter than the line work and carries hue. They need opposite fixes.

| You see | Do |
| --- | --- |
| Art lost its color, or everything shifted toward the opposite hue | The bright areas were paint, not paper. Name the real whites with `--white-box`, or lower `--strength`, or use `--no-balance` |
| A warm or sepia palette looks cold | Same: that warmth may be the art. Try `--white-box`, or `--strength 0.5` |
| It refused a cast that balloons or other white things visibly share | Large bright flats were read as paper. `--white-box X,Y,W,H` on one or more balloons: see below |
| Cast clearly remains, with paper visible | `--strength 1`, if the warning says it was limited |
| Colored page kept when it should be neutral, or the reverse | `--tint A,B`, or `--tint 0,0` for neutral. `--max-warmth` allows more yellow for aged stock |
| True black ink mottled, such as glare on hair | Raise `--ink-sigmas` (default 1.5), up to 4 |
| Solid painted darks mottled, recolored, or crushed | Raising `--ink-sigmas` makes this worse. Use `--ink-sigmas=-1.5`, down to `-3`, with `--max-veil 0.03` or `0.02` |
| Dark browns turned red or maroon | `--keep-dark-hue`. The black point doesn't cause this, so `--ink-l` won't fix it |
| Highlights blown out | Lower `--paper-l` (default 91) |
| Halos along the lines | Lower `--sharpen` (default 0.35) |
| Faded art still looks flat | Only if the user asks: `--saturation 1.1`. It invents color, so never by default |
| Hard glare spot left behind | The whole-frame fields are too smooth to follow it. When working locally, `--glare-box` takes off a soft streak or patch: see "Taking off glare" below. Glare blown out to white can't be recovered: tell the user |

### Naming the whites

The script can't tell light from a painted flat, so by default it limits how much cast
it believes. When you can see white things in the panel, like balloons, captions,
teeth, or eyes, name them, which settles the question:

```bash
python3 scripts/skills/restore-color-panel/restore_color.py enhance PHOTO.jpg OUT.jpg \
  --white-box 620,55,230,60 --white-box 10,40,60,180 --anchors ANCHORS.png --compare CMP.jpg
```

Box the inside of each balloon. Lettering is dropped automatically, and so is the
outline if it's thin. Then only pixels within chroma 12 of their color anchor the
light, and the cast limits are lifted. It removes 85% of the cast with an aged-paper
tint by default. That was the version kept on Bijou Funnies #6, where full removal
turned a grey shirt blue. `--strength` and `--tint` still override it.

It prints the field's color at the boxes against what they measure. A gap past 8
means the light varies more than one box can tell it, so box whites in other parts
of the panel too. Check that `--anchors` shows green only on paper.

Don't name pale paint as white. A cream sky or a yellowed balloon the artist colored
is art. If the balloons are colored, leave the cast alone.

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

## Taking off glare

Local runs only: the `/restore` judge in Actions can't set this flag. A lamp reflecting
off the page leaves a soft, pale streak or patch: lighter, less saturated, and tinted
toward the lamp. `--glare-box X,Y,W,H` takes one off before anything else runs:

```bash
python3 scripts/skills/restore-color-panel/restore_color.py enhance PHOTO.jpg OUT.jpg \
  --glare-box 0,250,95,850 --glare-map MAP.png --compare CMP.jpg --zoom 0,230,220,420
```

1. **Find it with numbers.** Print median-filtered Lab along rows across the streak, or
   `probe` boxes on it and beside it. Glare raises L and pulls a and b toward the lamp's
   color. On The Demon #2 it added up to 17 L to blue paint, and its b went from -38 to
   about -10.
2. **Box it generously.** The box must reach clean paint on every side that isn't the
   frame edge, because the glare is taken as zero there. A side on the frame edge is
   fine. If the paint just past one side is still lighter or warmer, extend the box past
   it: there, the box's top first sat in glare and left the core 2 L lighter.
3. **Check `--glare-map`.** Red is what came off, green the pixels it read the glare
   from, blue the paint around the box that it measured against. Red should follow the
   streak and fade out before the yellow outline.
4. **Probe the result** in the streak's core, on clean paint beside it, and on any art
   inside the box. The core should land within a few L of the paint beside it, and the
   clean paint and other art shouldn't move.

Several boxes are fine; maps get numbered. What it prints:

- **"took off up to N L".** The 99.5th percentile drop in the box. A few L means there
  was little glare. Twenty or more means check the map.
- **"dark pixels capped N% of the glare".** Added light can't leave a pixel darker than
  itself, so ink and dark paint under the glare cap it there and close by. A high share
  next to a dark shape is expected.
- **"the glare reaches a side of the box".** Widen the box on that side.
- **"too little clean paint around the box".** Most of the margin is figures or ink, so
  there's nothing to measure against. Move or widen the box.
- **"blown out to white".** Those pixels hold no art. What's around them still comes
  off, but the clipped core stays pale.

It reads the paint as one smooth color across the box, so a box over a hard color
change (sky into wall) takes the difference for glare. Keep each box on one paint, or
split it into boxes that each are.

## What its warnings mean

- **"no solid paper to read the light from".** Full-bleed paintings and dark panels have
  nothing known to be white, so color can't be corrected safely. It only sets levels.
  This is usually the right result, not a failure.
- **"this much cast is painted color" / "strong cast read from very little paper".** The
  bright areas it found are probably art. It only sets levels. If balloons or other white
  things show the same cast, name them with `--white-box`, which reads the light from them
  alone. `--strength` overrides it too, but keeps the wrong field's shape and hue.
- **"the field doesn't follow the named whites".** The fitted light misses the boxes'
  color by more than chroma 8. Look at `--anchors`, and box whites where the light differs.
- **"glare over the ink: up to N of the paper".** The glare it subtracts, against
  `--max-veil`. At the cap with painted darks in the panel, the cap is probably what's
  holding them, so lower it rather than raising it.
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
- **Named whites:** `--white-box` gates the anchors to the boxes' color instead of trusting
  brightness. That fixes the one case the evidence limits get wrong, where real light is
  stronger than chroma 40. Bijou Funnies #6's yellow flats read as a=26 b=68 while its
  balloons measured a=22 b=33.
- **Glare:** a smooth floor fitted under the darkest pixels of each cell, because ink is
  often only thin lines and any solid dark left to vote is paint. Reading a charcoal shape
  as glare turned it navy. Glare takes the white field's color, not the dark pixels',
  which would strip the blue from a navy sky. `--max-veil` caps it, because solid paint
  lighter than the line work still reads as glare.
- **Local glare (`--glare-box`):** photo = art + glare inside the box. The art is taken as
  the margin's commonest paint color, filled across the box by a Laplace membrane. A
  quadratic overshot at the frame edge and darkened clean paint by 9 L. The glare is the
  lift above that paint, read per channel so its tint can change along the streak. It's
  read only from pixels no darker than the paint's texture allows: a one-sided "every
  channel rose" test kept only upward noise and over-corrected. A 13 px median follows
  the peak where a blur flattened it. Dark pixels cap the glare's strength, not a single
  channel, on and near them: per-channel caps left the drip olive, and with no cap the
  drip went from L 17 to 6.
- **Dark hue:** `--keep-dark-hue` keeps the restored L and chroma below source L 38 but
  turns the hue back to the source's, fully below L 26. It's opt-in because a real cast
  is also in the source's darks.
- **Black point:** like the B&W skill's, it sits above the ink's noise. It only applies
  when solid darks are the darkest thing in the panel, since otherwise they're paint.
- **No saturation boost:** removing glare restores most lost color by itself, and the rest
  would be invented.
