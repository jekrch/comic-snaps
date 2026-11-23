#!/usr/bin/env python3
"""
The neighbour bench — does an embedding put panels near the ones they belong with?

    python3 scripts/embedding-neighbors.py
    python3 scripts/embedding-neighbors.py public/data/embeddings-dino.json /tmp/candidate-dino.json

## What it measures

Every similarity view in the app (sorting, the graph, the viewer's neighbours,
the visualizer's next-panel pick) is cosine nearest neighbours over one of the
embedding files. The gallery already carries two labels that say which panels
belong together, so a model can be scored on them instead of eyeballed:

- **series** — panels from the same series share characters, settings and
  usually an art team. The content/semantic test.
- **artist** — panels by the same artist share a hand. The style test.
- **artist, other series** — the artist test with every same-series panel
  removed from the candidates, so a model can't pass it by recognising the
  book. Only panels whose artist appears in two or more series are scored.
  This is the one the gram (texture/style) model exists for.

Per panel, against all other panels ranked by cosine similarity:

- **mAP** — average precision over that panel's same-label panels; 1.0 puts
  every one of them ahead of everything else.
- **hit@5** — same-label panels in the top 5, divided by min(5, how many
  exist), so a panel with one sibling isn't held to five.

A panel with no same-label panel can't score and is left out. The `chance`
row is the expected mAP of a random ranking, the floor to read the rest
against.

When more than one file is given, every file after the first is also
compared panel-by-panel against the first: the mean mAP difference with a
95% bootstrap interval over panels, and how many panels got better / worse.
An interval that straddles 0 means the bench can't tell them apart.

Labels are exact strings: "Gurihiru & Goodman Yamada" is its own artist.
Run it before swapping or retuning any model in compute-embeddings.py, on a
candidate file computed into a scratch copy of public/data.
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np

GALLERY = Path("public/data/gallery.json")
DEFAULT_FILES = [
    Path("public/data/embeddings.json"),
    Path("public/data/embeddings-dino.json"),
    Path("public/data/embeddings-gram.json"),
]
K = 5
BOOTSTRAP = 2000


def load_embeddings(path: Path) -> tuple[str, dict[str, np.ndarray]]:
    data = json.loads(path.read_text())
    emb = {k: np.asarray(v, dtype=np.float64) for k, v in data["embeddings"].items()}
    return data.get("model_version", "?"), emb


def average_precision(relevant: np.ndarray) -> float:
    """AP of a ranked boolean relevance vector."""
    hits = np.flatnonzero(relevant)
    if len(hits) == 0:
        return float("nan")
    return float(np.mean((np.arange(len(hits)) + 1) / (hits + 1)))


def score(ids: list[str], vecs: np.ndarray, labels: dict[str, list[str]],
          exclude: list[str] | None = None) -> dict[str, np.ndarray]:
    """Per-panel AP and hit@K for one label. NaN where a panel can't score.

    `exclude[i]` names a label value; candidates sharing it with panel i are
    dropped before ranking (used to hide same-series panels).
    """
    unit = vecs / np.clip(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-12, None)
    sims = unit @ unit.T
    n = len(ids)
    ap = np.full(n, np.nan)
    hit = np.full(n, np.nan)
    chance = np.full(n, np.nan)
    lab = np.array(labels["value"], dtype=object)
    excl = np.array(exclude, dtype=object) if exclude is not None else None

    for i in range(n):
        if lab[i] is None:
            continue
        keep = np.ones(n, dtype=bool)
        keep[i] = False
        if excl is not None:
            keep &= excl != excl[i]
        cand = np.flatnonzero(keep)
        relevant = lab[cand] == lab[i]
        n_rel = int(relevant.sum())
        if n_rel == 0:
            continue
        order = np.argsort(-sims[i, cand], kind="stable")
        ranked = relevant[order]
        ap[i] = average_precision(ranked)
        hit[i] = ranked[:K].sum() / min(K, n_rel)
        # Expected AP of a random ranking is ~ the base rate.
        chance[i] = n_rel / len(cand)
    return {"ap": ap, "hit": hit, "chance": chance}


def bootstrap_diff(a: np.ndarray, b: np.ndarray, rng: random.Random) -> tuple[float, float, float]:
    d = b - a
    d = d[~np.isnan(d)]
    if len(d) == 0:
        return float("nan"), float("nan"), float("nan")
    means = []
    for _ in range(BOOTSTRAP):
        sample = [d[rng.randrange(len(d))] for _ in range(len(d))]
        means.append(sum(sample) / len(sample))
    means.sort()
    return float(d.mean()), means[int(0.025 * BOOTSTRAP)], means[int(0.975 * BOOTSTRAP)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", type=Path,
                        help="embedding JSON files; the first is the baseline for comparisons")
    parser.add_argument("--gallery", type=Path, default=GALLERY)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    files = args.files or DEFAULT_FILES

    panels = json.loads(args.gallery.read_text())["panels"]
    loaded = [(f, *load_embeddings(f)) for f in files]

    # Score every file on the same panel set: those every file has.
    common = set.intersection(*(set(e) for _, _, e in loaded))
    panels = [p for p in panels if p["id"] in common]
    ids = [p["id"] for p in panels]
    series = [p.get("slug") for p in panels]
    artist = [p.get("artist") or None for p in panels]

    artist_series: dict[str, set] = {}
    for a, s in zip(artist, series):
        if a:
            artist_series.setdefault(a, set()).add(s)
    artist_multi = [a if a and len(artist_series[a]) > 1 else None for a in artist]

    tests = [
        ("series", {"value": series}, None),
        ("artist", {"value": artist}, None),
        ("artist, other series", {"value": artist_multi}, series),
    ]

    print(f"{len(ids)} panels scored (those present in every file), top-{K}.\n")
    results = {}
    for path, version, emb in loaded:
        vecs = np.stack([emb[i] for i in ids])
        results[path] = {name: score(ids, vecs, lab, excl) for name, lab, excl in tests}

    name_w = max(len(f"{p.name} ({v})") for p, v, _ in loaded)
    for name, _, _ in tests:
        first = results[loaded[0][0]][name]
        n_scored = int((~np.isnan(first["ap"])).sum())
        print(f"{name}  —  {n_scored} panels can score")
        print(f"  {'':{name_w}}    mAP   hit@{K}")
        print(f"  {'chance':{name_w}}  {np.nanmean(first['chance']):.3f}")
        for path, version, _ in loaded:
            r = results[path][name]
            print(f"  {f'{path.name} ({version})':{name_w}}  {np.nanmean(r['ap']):.3f}  {np.nanmean(r['hit']):.3f}")
        print()

    if len(loaded) > 1:
        rng = random.Random(args.seed)
        base_path, base_version, _ = loaded[0]
        print(f"Paired against {base_path.name} ({base_version}), mAP:")
        for path, version, _ in loaded[1:]:
            print(f"  {path.name} ({version})")
            for name, _, _ in tests:
                a = results[base_path][name]["ap"]
                b = results[path][name]["ap"]
                mean, lo, hi = bootstrap_diff(a, b, rng)
                both = ~np.isnan(a) & ~np.isnan(b)
                better = int((b[both] > a[both] + 1e-9).sum())
                worse = int((b[both] < a[both] - 1e-9).sum())
                print(f"    {name:22} {mean:+.3f}  [{lo:+.3f}, {hi:+.3f}]  "
                      f"better {better}, worse {worse}")


if __name__ == "__main__":
    main()
