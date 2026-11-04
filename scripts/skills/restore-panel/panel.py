#!/usr/bin/env python3
"""Find a gallery panel, recover its original photo, and measure regions of it.

Subcommands (see SKILL.md for the workflow):
  find      search the gallery, say whether each match was restored, and check its color
  original  write the photo as first posted, from git, even after restorations
  probe     median Lab, chroma, hue, and texture of regions, optionally against a second image

Enhancing and installing live in the restore-bw-panel and restore-color-panel skills.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GALLERY = REPO_ROOT / "public" / "data" / "gallery.json"


def load_panels(path=GALLERY):
    return json.loads(Path(path).read_text(encoding="utf-8"))["panels"]


def issue_words(issue):
    return {w for w in re.split(r"[^a-z0-9]+", str(issue).lower()) if w}


def matches(panel, query):
    """Every word must hit. Numbers (or #numbers) match the issue or a whole word of
    the id, such as its upload timestamp. The rest match title, slug, artist, or id,
    so "bleeding hearts 8 morian" narrows to one artist."""
    text = " ".join(str(panel.get(k) or "") for k in ("title", "slug", "artist", "id")).lower()
    for word in query:
        word = word.lower().lstrip("#")
        if not word:
            continue
        if word.isdigit():
            if word not in issue_words(panel.get("issue")) | issue_words(panel.get("id")):
                return False
        elif word not in text:
            return False
    return True


def restored_version(image):
    """2 for ...-v2.jpg, None for an image never restored."""
    match = re.fullmatch(r".*-v(\d+)", Path(image).stem)
    return int(match.group(1)) if match else None


def original_image(image):
    """images/x/issue-6-123-v3.jpg -> images/x/issue-6-123.jpg."""
    path = Path(image)
    return str(path.with_name(re.sub(r"-v\d+$", "", path.stem) + path.suffix))


def git(*args, binary=False):
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=not binary)
    return result.stdout if result.returncode == 0 else None


def original_bytes(image):
    """The first-posted photo for a gallery image path, and where it came from."""
    rel = "public/" + original_image(image)
    on_disk = REPO_ROOT / rel
    if on_disk.exists():
        return on_disk.read_bytes(), "working tree"
    data = git("show", f"HEAD:{rel}", binary=True)
    if data:
        return data, "HEAD (restoration not committed yet)"
    # --no-renames: a restoration can be recorded as a rename of the original.
    commit = (git("log", "--no-renames", "--diff-filter=D", "--format=%H", "-1", "--", rel) or "").strip()
    if commit:
        data = git("show", f"{commit}^:{rel}", binary=True)
        if data:
            return data, f"git {commit[:8]}^"
    return traced_original(image)


def traced_original(image, depth=6):
    """Follow a restored file back through the commits that replaced its predecessor.

    Needed when the name changed along the way: The Vault of Horror's issue was
    corrected from 10 to 21 in the same commit that restored it. The upload
    timestamp at the end of the name is what survives.
    """
    rel = "public/" + image
    stamp = re.sub(r"-v\d+$", "", Path(image).stem).rsplit("-", 1)[-1]
    for _ in range(depth):
        commit = (git("log", "--no-renames", "--diff-filter=A", "--format=%H", "-1", "--", rel) or "").strip()
        if not commit:
            return None, None
        changes = git("show", "--no-renames", "--name-status", "--format=", commit) or ""
        deleted = [
            line.split("\t", 1)[1]
            for line in changes.splitlines()
            if line.startswith("D\t")
            and str(Path(line.split("\t", 1)[1]).parent) == str(Path(rel).parent)
            and re.sub(r"-v\d+$", "", Path(line.split("\t", 1)[1]).stem).endswith("-" + stamp)
        ]
        if len(deleted) != 1:
            return None, None
        rel = deleted[0]
        if restored_version(rel) is None:
            data = git("show", f"{commit}^:{rel}", binary=True)
            return (data, f"git {commit[:8]}^ as {rel.removeprefix('public/')}") if data else (None, None)
    return None, None


def cmd_find(args):
    panels = [p for p in load_panels() if matches(p, args.query)]
    if not panels:
        sys.exit("no panel matches; try fewer words, or part of the title")
    if len(panels) > args.limit:
        print(f"{len(panels)} matches, showing {args.limit}; add the issue or artist to narrow it\n")
    check = None
    if not args.no_check and len(panels) <= args.limit:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "restore-color-panel"))
        import restore_color

        check = restore_color.classify
    for p in panels[: args.limit]:
        version = restored_version(p["image"])
        print(f"{p['id']}")
        print(f"  {p['title']} #{p['issue']}, {p.get('artist') or 'artist unknown'}")
        print(f"  public/{p['image']}  {p.get('width')}x{p.get('height')}")
        if version:
            print(f"  restored before (v{version}): restore from `original`, not this file")
        if check:
            # A restored image is checked as it is now; B&W restorations measure neutral.
            target = REPO_ROOT / "public" / p["image"]
            if version:
                data, _ = original_bytes(p["image"])
                if data:
                    target = Path(args.scratch) / f"{p['id']}-original{Path(p['image']).suffix}"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
            rms, patches, verdict = check(target)
            route = {"bw": "restore-bw-panel", "color": "restore-color-panel", "unsure": "view it, then choose"}[verdict]
            print(f"  check: {verdict} (unexplained chroma {rms:.2f}, patches {patches:.2f}%) -> {route}")
        print()


def cmd_original(args):
    panel = next((p for p in load_panels() if p["id"] == args.panel_id), None)
    if panel is None:
        sys.exit(f"no panel {args.panel_id}")
    data, source = original_bytes(panel["image"])
    if data is None:
        sys.exit(f"can't find {original_image(panel['image'])} in the working tree or git history")
    Path(args.output).write_bytes(data)
    print(f"{original_image(panel['image'])} from {source} -> {args.output}")
    if not restored_version(panel["image"]):
        print("this panel was never restored, so that's the current image")


def parse_box(text):
    x, y, w, h = (int(v) for v in text.split(","))
    return x, y, w, h


def region_stats(lab, box):
    import numpy as np

    x, y, w, h = box
    region = lab[max(y, 0):y + h, max(x, 0):x + w].reshape(-1, 3)
    if not len(region):
        sys.exit(f"box {box} is outside the image")
    L, a, b = (float(v) for v in np.median(region, axis=0))
    return {
        "L": L,
        "a": a,
        "b": b,
        "chroma": float(np.hypot(a, b)),
        "hue": float(np.degrees(np.arctan2(b, a)) % 360),
        "L_std": float(region[:, 0].std()),
    }


def describe(s):
    return f"L {s['L']:5.1f} a {s['a']:6.1f} b {s['b']:6.1f}  chroma {s['chroma']:5.1f} hue {s['hue']:5.1f}  L std {s['L_std']:4.1f}"


def cmd_probe(args):
    import cv2
    import numpy as np

    def load(path):
        bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if bgr is None:
            sys.exit(f"cannot read {path}")
        return cv2.cvtColor(bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)

    first = load(args.image)
    second = load(args.against) if args.against else None
    if second is not None and second.shape != first.shape:
        sys.exit(f"{args.against} is {second.shape[1]}x{second.shape[0]}, not {first.shape[1]}x{first.shape[0]}: probe it on its own")
    for text in args.box:
        box = parse_box(text)
        a = region_stats(first, box)
        print(f"{text:>20}  {describe(a)}")
        if second is not None:
            b = region_stats(second, box)
            hue_shift = (b["hue"] - a["hue"] + 180) % 360 - 180
            delta_e = float(np.sqrt((b["L"] - a["L"]) ** 2 + (b["a"] - a["a"]) ** 2 + (b["b"] - a["b"]) ** 2))
            note = "" if min(a["chroma"], b["chroma"]) >= 6 else "  (near neutral: hue means little)"
            print(f"{'against':>20}  {describe(b)}")
            print(f"{'':>20}  dE {delta_e:5.1f}, hue {hue_shift:+6.1f}, chroma {b['chroma'] - a['chroma']:+5.1f}, L std {b['L_std'] - a['L_std']:+4.1f}{note}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    f = sub.add_parser("find", help="search by title, issue, artist, or id")
    f.add_argument("query", nargs="+", help='words that must all match, e.g. "bleeding hearts 8 morian"')
    f.add_argument("--limit", type=int, default=8, help="most matches shown; the color check only runs when all fit")
    f.add_argument("--no-check", action="store_true", help="skip the color check")
    f.add_argument("--scratch", default=tempfile.gettempdir(), help="where a restored panel's original is written for the check")
    f.set_defaults(func=cmd_find)

    o = sub.add_parser("original", help="write the photo as first posted")
    o.add_argument("panel_id")
    o.add_argument("output")
    o.set_defaults(func=cmd_original)

    p = sub.add_parser("probe", help="measure regions: known whites, a face, a dark painted area")
    p.add_argument("image")
    p.add_argument("--box", action="append", required=True, help="X,Y,W,H; repeatable")
    p.add_argument("--against", help="a pixel-aligned image to compare, such as the enhanced output")
    p.set_defaults(func=cmd_probe)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
