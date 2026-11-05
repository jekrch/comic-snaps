#!/usr/bin/env python3
"""The deterministic half of .github/workflows/restore.yml.

Gemini CLI runs the restore skills in between; this script handles everything
around that run, so the parts that touch git and Telegram never depend on the model.

  lookup SEQ             panel id, label and image, as GITHUB_OUTPUT lines
  prepare SEQ WORK       write the photo to restore from to WORK/source.jpg and run
                         the color check on it, so the model starts at the right
                         skill's enhance step; prints source, check and start
  collect SEQ BEFORE_IMG OUT
                         copy the image the model's run installed for the panel to
                         OUT/restored.jpg; prints installed=true|false
  verify SEQ BEFORE_IMG  check what the install changed: exits 1 if gallery.json
                         was touched anywhere but this panel's image and
                         metadata, or the new image isn't beside the old one;
                         prints installed=true|false plus the paths to commit
  compare BEFORE AFTER OUT
                         side-by-side before/after for the Telegram reply
"""
import json
import posixpath
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS = REPO_ROOT / "scripts" / "skills"
GALLERY = "public/data/gallery.json"
EMBEDDINGS = ("embeddings.json", "embeddings-dino.json", "embeddings-gram.json")

# What `restore.py install` rewrites on a panel. The worker's /approve copies
# exactly these onto main, so a run that changed anything else is refused here,
# before anyone looks at it.
RESTORE_FIELDS = ("image", "width", "height", "dominantColors", "colorfulness", "phash", "ahash", "dhash")

# The paths `restore.py install` writes: a plain .jpg in a series folder. The
# worker's /approve applies the same rule (restoredImageProblem in restore.ts).
IMAGE_PATH = re.compile(r"images/[a-z0-9-]+/[A-Za-z0-9._-]+\.jpg")


def one_line(value):
    """A GITHUB_OUTPUT value: a newline in it would start another output."""
    return re.sub(r"\s*[\r\n]+\s*", " ", str(value)).strip()


def image_path_problem(before, after):
    """Why `after` isn't where a restoration of `before` may put its image, if it isn't."""
    if not IMAGE_PATH.fullmatch(after):
        return f"{after} isn't an image path a restoration writes"
    if posixpath.dirname(after) != posixpath.dirname(before):
        return f"{after} isn't in the same folder as {before}"
    return None


def load_panels(text):
    return json.loads(text.replace("\r\n", "\n"))["panels"]


def find_seq(panels, seq):
    return next((p for p in panels if p.get("seq") == seq), None)


def label(panel):
    issue = panel["issue"]
    issue = f"#{issue}" if isinstance(issue, int) else str(issue)
    artist = f" ({panel['artist']})" if panel.get("artist") else ""
    return f"{panel['title']} {issue}{artist}"


# The color check's verdict, as restore-panel's routing table reads it.
ROUTES = {"bw": "restore-bw-panel", "color": "restore-color-panel"}


def start_directions(verdict, source):
    """Where the model starts, given the color check on the source photo.

    This is restore-panel's routing step done ahead of time, so the model never
    loads that skill: every turn resends what it has loaded.
    """
    done = f"with {source} as PHOTO.jpg. Its find, original and check steps are done."
    skill = ROUTES.get(verdict)
    if skill:
        other = ROUTES["color" if verdict == "bw" else "bw"]
        return (f"The color check says {verdict}, so activate the {skill} skill and follow it from its enhance step, "
                f"{done} If the notes below say the art is {'in color' if verdict == 'bw' else 'black-and-white'}, "
                f"use {other} instead.")
    return (f"The color check is unsure. Look at {source} and choose: any painted color at all, even one spot, "
            f"goes to restore-color-panel, and one ink on one paper to restore-bw-panel. "
            f"Activate that skill and follow it from its enhance step, {done}")


def gallery_problems(before, after, panel_id):
    """Why the gallery change isn't a clean one-panel restoration, if it isn't."""
    problems = []
    if len(before) != len(after):
        return [f"panel count changed: {len(before)} -> {len(after)}"]
    for old, new in zip(before, after):
        if old.get("id") != new.get("id"):
            return [f"panels were reordered or replaced at {old.get('id')}"]
        if old == new:
            continue
        if old["id"] != panel_id:
            problems.append(f"{old['id']} changed too")
            continue
        changed = {k for k in old.keys() | new.keys() if old.get(k) != new.get(k)}
        stray = sorted(changed - set(RESTORE_FIELDS))
        if stray:
            problems.append(f"{panel_id}: fields outside the image metadata changed: {', '.join(stray)}")
    return problems


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout


def cmd_lookup(seq):
    panel = find_seq(load_panels((REPO_ROOT / GALLERY).read_text("utf-8")), seq)
    if panel is None:
        sys.exit(f"no panel #{seq}")
    print(f"id={one_line(panel['id'])}")
    print(f"label={one_line(label(panel))}")
    print(f"image={one_line(panel['image'])}")


def cmd_prepare(seq, work):
    found = find_seq(load_panels((REPO_ROOT / GALLERY).read_text("utf-8")), seq)
    if found is None:
        sys.exit(f"no panel #{seq}")
    sys.path[:0] = [str(SKILLS / "restore-panel"), str(SKILLS / "restore-color-panel")]
    import panel as panel_tool
    import restore_color

    # The photo as first posted, even for a panel restored before: a -vN image
    # is never restored again. The same recovery as `panel.py original`.
    data, origin = panel_tool.original_bytes(found["image"])
    if data is None:
        sys.exit(f"can't find the original of {found['image']} in the working tree or git history")
    source = Path(work) / "source.jpg"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(data)
    print(f"{panel_tool.original_image(found['image'])} from {origin}", file=sys.stderr)

    rms, patches, verdict = restore_color.classify(source)
    print(f"source={source}")
    print(f"check={verdict} (unexplained chroma {rms:.2f}, patches {patches:.2f}%)")
    print(f"start={one_line(start_directions(verdict, source))}")


def cmd_collect(seq, before_image, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    restored = find_seq(load_panels((REPO_ROOT / GALLERY).read_text("utf-8")), seq)
    if restored is None:
        sys.exit(f"no panel #{seq}")
    if restored["image"] == before_image:
        print("installed=false")
        return
    problem = image_path_problem(before_image, restored["image"])
    if problem:
        sys.exit(problem)
    source = REPO_ROOT / "public" / restored["image"]
    if not source.is_file():
        sys.exit(f"gallery.json points at {restored['image']}, which doesn't exist")
    shutil.copyfile(source, out / "restored.jpg")
    print("installed=true")


def cmd_verify(seq, before_image):
    before = load_panels(git("show", f"HEAD:{GALLERY}"))
    after = load_panels((REPO_ROOT / GALLERY).read_text("utf-8"))
    panel = find_seq(before, seq)
    if panel is None:
        sys.exit(f"no panel #{seq} at HEAD")

    problems = gallery_problems(before, after, panel["id"])
    if problems:
        sys.exit("refusing to commit this run:\n  " + "\n  ".join(problems))

    restored = find_seq(after, seq)
    if restored["image"] == before_image:
        if restored != panel:
            sys.exit("the panel's metadata changed but its image didn't")
        print("installed=false")
        return

    problem = image_path_problem(before_image, restored["image"])
    if problem:
        sys.exit(f"refusing to commit this run: {problem}")
    tracked = subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:public/{restored['image']}"],
        cwd=REPO_ROOT,
        stderr=subprocess.DEVNULL,
    )
    if tracked.returncode == 0:
        sys.exit(f"refusing to commit this run: {restored['image']} is already in the repo")
    new_file = REPO_ROOT / "public" / restored["image"]
    if not new_file.is_file():
        sys.exit(f"gallery.json points at {restored['image']}, which doesn't exist")
    if (REPO_ROOT / "public" / before_image).exists():
        sys.exit(f"{before_image} is still on disk; install removes it")

    paths = [GALLERY, f"public/{restored['image']}", f"public/{before_image}"]
    paths += [f"public/data/{name}" for name in EMBEDDINGS]
    print("installed=true")
    print(f"new_image={restored['image']}")
    print(f"paths={' '.join(paths)}")


def cmd_compare(before_path, after_path, out_path):
    import cv2
    import numpy as np

    before, after = cv2.imread(before_path), cv2.imread(after_path)
    if before is None or after is None:
        sys.exit("couldn't read both images")
    # Restorations keep the framing, so these normally match already; scale the
    # before to the after's height in case a crop was asked for.
    if before.shape[0] != after.shape[0]:
        scale = after.shape[0] / before.shape[0]
        before = cv2.resize(before, (round(before.shape[1] * scale), after.shape[0]), interpolation=cv2.INTER_AREA)
    gutter = np.full((after.shape[0], 16, 3), 255, np.uint8)
    out = np.hstack([before, gutter, after])
    # Telegram recompresses anything past 2560 on a side; shrink it ourselves first.
    long_side = max(out.shape[:2])
    if long_side > 2560:
        f = 2560 / long_side
        out = cv2.resize(out, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    cv2.imwrite(out_path, out, [cv2.IMWRITE_JPEG_QUALITY, 90])


def main(argv):
    if len(argv) >= 2 and argv[0] == "lookup":
        cmd_lookup(int(argv[1]))
    elif len(argv) >= 3 and argv[0] == "prepare":
        cmd_prepare(int(argv[1]), argv[2])
    elif len(argv) >= 4 and argv[0] == "collect":
        cmd_collect(int(argv[1]), argv[2], argv[3])
    elif len(argv) >= 3 and argv[0] == "verify":
        cmd_verify(int(argv[1]), argv[2])
    elif len(argv) >= 4 and argv[0] == "compare":
        cmd_compare(argv[1], argv[2], argv[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
