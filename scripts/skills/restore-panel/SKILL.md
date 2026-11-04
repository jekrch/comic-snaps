---
name: restore-panel
description: Start here to restore, improve, fix, clean up, or enhance a comic panel's image in the comic-snaps gallery, usually named by series, issue, and artist. Finds the panel, recovers the original photo if it was restored before, checks whether the art is color or black-and-white, and hands off to restore-color-panel or restore-bw-panel. Also covers re-restoring a panel and restoring several at once. Keeps the photo's framing unless the user asks to crop or straighten.
---

# Restoring a panel

This skill picks the right restorer and sets it up. The enhancing and installing
happen in one of two child skills:

| Art | Skill | Why |
| --- | --- | --- |
| One ink on one paper | `restore-bw-panel` | Models paper and ink separately and discards all color, so it gets far more out of B&W |
| Any painted color, even one spot | `restore-color-panel` | Divides out the lamp and keeps the art's colors. The B&W path would erase them |

`panel.py` beside this file finds panels, recovers originals, and measures regions. Run it
from the repo root. It needs OpenCV (`cv2`), which is installed locally but isn't in
`scripts/requirements.txt`. Write all working files to the scratchpad.

## Rules for every restoration

- **Keep the framing.** No cropping, straightening, rotating, or perspective correction
  unless the user asks. If a crop looks worthwhile, mention it and leave it undone.
- **Never commit or stage.** Leave the change in the working tree and say what changed.
- **The user judges the look.** Don't drive a browser to check it. Do read the compare
  images the scripts write, since that's how you choose settings.
- **Repainting the art is the worst outcome.** A photo left a little warm is fine; a
  face turned purple isn't. When unsure, take less.

## Workflow

### 1. Find the panel and check it

```bash
python3 scripts/skills/restore-panel/panel.py find bleeding hearts 8 morian --scratch SCRATCHPAD
```

Every word must match. Numbers match the issue, and other words match the title,
artist, slug, or id. A series often has several panels per issue, so add the artist,
or show the user the matches and ask which one. Each match prints its id, image path,
whether it was restored before, and the color check:

```text
bleeding-hearts-8-1791159081
  Bleeding Hearts #8, Stipan Morian
  public/images/bleeding-hearts/issue-8-1791159081-v2.jpg  819x1280
  restored before (v2): restore from `original`, not this file
  check: unsure (unexplained chroma 6.68, patches 14.76%) -> view it, then choose
```

For a restored panel the check runs on the original photo, because B&W restorations
measure as neutral.

### 2. Get the photo to work from

```bash
python3 scripts/skills/restore-panel/panel.py original PANEL_ID SCRATCHPAD/source.jpg
```

Always work from this file. For a panel that was never restored, it's a copy of the
current image. For one that was, it's the photo as first posted, recovered from git,
including when a fix renamed the file. **Never restore a `-vN` image again**: its
stretched blacks and removed cast compound, and lost detail can't return. `install`
names the next version correctly either way.

If the panel was restored before, ask what the user didn't like about the current
version unless they've said. Settings that worked last time may be in memory.

### 3. Route on the check

| Check | Do |
| --- | --- |
| `bw` | Use `restore-bw-panel` |
| `color` | Use `restore-color-panel` |
| `unsure` | View the source. B&W under a colored lamp lands here, and so do subtle or spot color. Any painted color at all goes to `restore-color-panel`. Ask if you can't tell |

Load the chosen skill with the Skill tool and follow it from its enhance step, using
`source.jpg` as `PHOTO.jpg`. Its "find the panel" step is done.

Grey-toned art (wash, heavy zipatone) is B&W, but the B&W flat-field can halo around
shapes on it. If that shows, `restore_color.py --no-balance` levels it without the
flat-field.

### 4. Measure instead of guessing

`probe` prints median Lab, chroma, hue, and texture (L std) for regions, and with
`--against` the change at each:

```bash
python3 scripts/skills/restore-panel/panel.py probe SCRATCHPAD/source.jpg \
  --box 620,55,230,60 --box 150,550,80,80 --against SCRATCHPAD/out.jpg
```

Use it to:

- measure balloons or other known whites before trusting or overriding a cast
- check a dark painted area's hue survived. Taking out a cast moves every hue a little,
  so compare against a face or a flat color: if the darks moved much further, they were
  recolored. Bleeding Hearts #8's glove moved 16° while the rest held, and looked fine
  at full frame
- tell ink from paint: true ink sits near the darkest L in the panel with little
  chroma, while paint is lighter and carries hue
- confirm mottling: L std rising in a solid black means its noise was stretched

### 5. Install and finish

Install with the command in the child skill. Then report what changed, the settings
used and why, and what the user should look at in the app.

## Several panels at once

For "restore everything by X" or a gallery sweep, don't rank candidates by metrics.
Cast, falloff, black lift, and size of change only reached AUC 0.69 against the
panels the user picked, and a hue-drift score couldn't tell defaults that repaint the
art from ones that were kept. Instead:

1. Run `find` for each panel, and skip the ones restored already unless asked.
2. Dry-run the right script on each original into the scratchpad, with `--compare`.
3. Look at every compare image yourself and sort them into clear gains, small gains,
   and ones the defaults damage. Name the damage, such as a recolored face or mottled
   blacks.
4. Give the user the list before installing anything, and install only what they pick.
