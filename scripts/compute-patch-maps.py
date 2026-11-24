#!/usr/bin/env python3
"""
Compute per-panel "patch maps" for the explainer's transformer section.

SigLIP and DINOv2 are vision transformers: they cut a panel into patches,
and in each of 12 layers every patch's numbers are updated by looking at
every other patch. The explainer lets a reader tap a patch and see which
other patches it most resembles at an early, middle, and final layer.
This script records what that figure needs.

By default it computes a handful of hand-picked EXAMPLES into one file,
which the explainer cycles through:

  public/data/patch-examples.json

With --all it computes every gallery panel instead, one file each, so a
panel could show its own maps:

  local-data/patch-maps/<panel id>.json

That folder is gitignored and outside public/, so it isn't committed or
deployed. Move it under public/data/ if a panel ever shows its own maps.

The examples were picked from an --all run (2026-11-23); see EXAMPLES for
how. The best ones start on part of something and end up matching a
second, separate thing of the same kind (a face and a mask, two horns,
two balloons), which raw pixel likeness can't explain.

For each model and each of LAYERS, every patch's token is centred on the
panel's mean token and projected onto that panel's top DIMS principal
components (PCA per panel, per layer), then stored as int8. Cosine
similarity on those 16 numbers tracks cosine on the full tokens closely
(per-patch map correlation ~0.93-0.99 on a sample of panels; the early
layers are the loosest), which is all the figure computes. Quantization
uses one scale per layer, which cosine ignores, so no scale is stored.

DINOv2 also gets a "summary" map: how much its CLS token attends to each
patch in the last layer, averaged over heads. That's half of what goes
into the DINOv2 embedding (compute-embeddings.py averages CLS with the
patch mean). SigLIP gets no summary map: its pooling head puts 13-27% of
its weight on one fixed scratch patch (see below; row 9, column 13 of 14
in most panels) and much of the rest next to it, so a heatmap of it would
point at the corner of the panel rather than at anything in the art.

`scratch` lists patches the model has repurposed as scratch space: their
token's norm at layer SCRATCH_LAYER is over SCRATCH_RATIO times the
panel's median (15-20x for SigLIP's, against ~1.4x for the next-largest
ordinary patch). They stop describing the art, so the figure marks them
instead of colouring them. DINOv2's registers exist to take this job, so
its list is normally empty. (Detected before the final norm, which hides
them.)

`focus` is the patch the figure starts on: DINOv2's most-attended patch
that isn't a scratch patch. SigLIP starts on the same spot of the panel
(both models see all of it, so a position maps across exactly), moved to
the nearest non-scratch patch if it lands on one.

Inputs match compute-embeddings.py exactly: SigLIP's processor squashes to
224 x 224 (14 x 14 patches); DINOv2 uses that script's own dino_pixels.

With --all it's incremental: a panel is skipped when its file has the
current VERSION and the image's hash matches, so restored images are
recomputed, and files for panels no longer in the gallery are removed.

Usage
-----
    python scripts/compute-patch-maps.py        # the examples
    python scripts/compute-patch-maps.py --all  # every panel
"""

import base64
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ONEDNN_PRIMITIVE_CACHE_CAPACITY", "4")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel, AutoProcessor, SiglipVisionModel
from transformers.utils import logging as hf_logging

hf_logging.set_verbosity_error()
hf_logging.disable_progress_bar()

_env_threads = os.environ.get("TORCH_NUM_THREADS") or os.environ.get("OMP_NUM_THREADS")
if _env_threads:
    try:
        torch.set_num_threads(int(_env_threads))
    except ValueError:
        pass

GALLERY_PATH = Path(os.environ.get("EMBED_GALLERY_PATH") or "public/data/gallery.json")
IMAGE_ROOT = Path("public")
OUT_DIR = Path("local-data/patch-maps")
EXAMPLES_PATH = Path("public/data/patch-examples.json")

# In the order the explainer shows them: (panel id, where to start). The
# start is a point in the panel as fractions of its width and height, or
# None for DINOv2's most-attended patch. What each start shows is described
# in src/components/explainer/TransformerFigures.tsx.
#
# Picked 2026-11-23 from an --all run: for each panel's 20 most-attended
# patches, scored on how different its layer-1 and layer-12 matches are,
# whether layer 12 lands on a second, separate region the size of an
# object, and whether SigLIP lands there too; then checked by eye.
EXAMPLES: list[tuple[str, tuple[float, float] | None]] = [
    ("universal-monsters-phantom-of-the-opera-3-1777232387", None),  # her face → the Phantom's mask
    ("bizarre-sex-1-1779570977", (0.639, 0.205)),  # one horn → the other horn
    ("100-2-1773890854", (0.848, 0.194)),  # one balloon → the other balloon
    ("buzzard-4-1783309323", (0.761, 0.639)),  # a face → the face in the next panel
    ("red-roots-1-1777758703", None),  # the cat's nose → its whole face
]

VERSION = "patch-maps-v1"
LAYERS = [1, 6, 12]
DIMS = 16
SCRATCH_LAYER = 6
SCRATCH_RATIO = 4.0

SIGLIP = "google/siglip-base-patch16-224"
DINO = "facebook/dinov2-with-registers-small"

# Reuse compute-embeddings.py's DINOv2 input prep so the grid here is the
# grid the embedding was computed on (and the one the explainer draws).
_spec = importlib.util.spec_from_file_location(
    "compute_embeddings", Path(__file__).with_name("compute-embeddings.py")
)
_embeddings = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_embeddings)
dino_pixels = _embeddings.dino_pixels


def image_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def pack_tokens(tokens: np.ndarray) -> str:
    """(N, D) tokens → base64 of (N, DIMS) int8, PCA'd within this panel."""
    t = tokens.astype(np.float64)
    t = t - t.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(t, full_matrices=False)
    proj = t @ vt[:DIMS].T
    scale = np.abs(proj).max() / 127 or 1.0
    q = np.clip(np.round(proj / scale), -127, 127).astype(np.int8)
    return base64.b64encode(q.tobytes()).decode("ascii")


def pack_weights(w: np.ndarray) -> str:
    """Non-negative weights → base64 of uint8, scaled so the max is 255."""
    w = np.maximum(w, 0)
    q = np.round(w / (w.max() or 1.0) * 255).astype(np.uint8)
    return base64.b64encode(q.tobytes()).decode("ascii")


def scratch_patches(tokens: np.ndarray) -> np.ndarray:
    """Indices of tokens whose norm is far above the panel's typical one."""
    n = np.linalg.norm(tokens, axis=1)
    return np.flatnonzero(n > SCRATCH_RATIO * np.median(n))


def dino_maps(img: Image.Image, model, processor) -> dict:
    """DINOv2's patch maps for one panel: packed patch tokens per layer, CLS attention, scratch patches, and where to start."""
    n_reg = getattr(model.config, "num_register_tokens", 0) or 0
    pixels = dino_pixels(img, processor)
    _, h, w = pixels.shape
    patch = model.config.patch_size
    cols, rows = w // patch, h // patch
    with torch.inference_mode():
        out = model(pixel_values=pixels.unsqueeze(0), output_hidden_states=True, output_attentions=True)
    first = 1 + n_reg  # [CLS, registers..., patches...]
    layers = []
    for L in LAYERS:
        # The last layer is taken after the final norm: that's what the
        # embedding is built from.
        h_l = out.last_hidden_state if L == len(out.hidden_states) - 1 else out.hidden_states[L]
        layers.append(pack_tokens(h_l[0, first:].numpy()))
    cls_attn = out.attentions[-1][0, :, 0, first:].mean(dim=0).numpy()
    scratch = scratch_patches(out.hidden_states[SCRATCH_LAYER][0, first:].numpy())
    pick = cls_attn.copy()
    pick[scratch] = -1
    return {
        "cols": cols,
        "rows": rows,
        "tokens": layers,
        "summary": pack_weights(cls_attn),
        "scratch": scratch.tolist(),
        "focus": int(pick.argmax()),
    }


def nearest_patch(x: float, y: float, cols: int, rows: int, skip: set[int]) -> int:
    """The patch centred nearest (x, y), given as fractions of the panel, avoiding `skip`."""
    best, best_d = 0, float("inf")
    for i in range(cols * rows):
        if i in skip:
            continue
        r, c = divmod(i, cols)
        d = ((c + 0.5) / cols - x) ** 2 + ((r + 0.5) / rows - y) ** 2
        if d < best_d:
            best, best_d = i, d
    return best


def siglip_maps(img: Image.Image, model, processor, focus_xy: tuple[float, float]) -> dict:
    """SigLIP's patch maps for one panel: packed patch tokens per layer, scratch patches, and where to start."""
    pixels = processor(images=[img], return_tensors="pt")["pixel_values"]
    side = pixels.shape[-1] // model.config.patch_size
    with torch.inference_mode():
        out = model(pixel_values=pixels, output_hidden_states=True)
    last = out.last_hidden_state
    layers = []
    for L in LAYERS:
        h_l = last if L == len(out.hidden_states) - 1 else out.hidden_states[L]
        layers.append(pack_tokens(h_l[0].numpy()))
    scratch = scratch_patches(out.hidden_states[SCRATCH_LAYER][0].numpy())
    return {
        "cols": side,
        "rows": side,
        "tokens": layers,
        "scratch": scratch.tolist(),
        "focus": nearest_patch(*focus_xy, side, side, set(scratch.tolist())),
    }


def load_models():
    dino_proc = AutoImageProcessor.from_pretrained(DINO)
    # Eager attention: the default SDPA kernel doesn't return weights.
    dino = AutoModel.from_pretrained(DINO, attn_implementation="eager").eval()
    sig_proc = AutoProcessor.from_pretrained(SIGLIP)
    siglip = SiglipVisionModel.from_pretrained(SIGLIP).eval()
    return dino, dino_proc, siglip, sig_proc


def panel_maps(img: Image.Image, models, start: tuple[float, float] | None = None) -> dict:
    """Both models' maps for one panel, SigLIP starting where DINOv2 does.

    `start` overrides DINOv2's starting patch with the one nearest that
    point (fractions of the panel's width and height).
    """
    dino, dino_proc, siglip, sig_proc = models
    d = dino_maps(img, dino, dino_proc)
    if start is not None:
        d["focus"] = nearest_patch(*start, d["cols"], d["rows"], set(d["scratch"]))
    fr, fc = divmod(d["focus"], d["cols"])
    focus_xy = ((fc + 0.5) / d["cols"], (fr + 0.5) / d["rows"])
    return {"dino": d, "siglip": siglip_maps(img, siglip, sig_proc, focus_xy)}


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def run_examples(panels: list[dict]) -> int:
    by_id = {p["id"]: p for p in panels}
    missing = [pid for pid, _ in EXAMPLES if pid not in by_id]
    if missing:
        print(f"example panels not in the gallery: {', '.join(missing)}")
        return 1
    models = load_models()
    examples = []
    for pid, start in EXAMPLES:
        p = by_id[pid]
        img = Image.open(IMAGE_ROOT / p["image"]).convert("RGB")
        examples.append(
            {"id": pid, "title": p["title"], "issue": p.get("issue"), "image": p["image"], **panel_maps(img, models, start)}
        )
        print(f"  {pid}")
    write_json(EXAMPLES_PATH, {"version": VERSION, "layers": LAYERS, "dims": DIMS, "examples": examples})
    print(f"wrote {EXAMPLES_PATH}")
    return 0


def run_all(panels: list[dict]) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    todo = []
    for p in panels:
        path = IMAGE_ROOT / p["image"]
        if not path.is_file():
            print(f"  skip {p['id']}: missing image {path}")
            continue
        sha = image_sha(path)
        out_path = OUT_DIR / f"{p['id']}.json"
        if out_path.is_file():
            try:
                old = json.loads(out_path.read_text(encoding="utf-8"))
                if old.get("version") == VERSION and old.get("image_sha") == sha:
                    continue
            except (json.JSONDecodeError, OSError):
                pass
        todo.append((p, path, sha, out_path))

    keep = {f"{p['id']}.json" for p in panels}
    removed = 0
    for f in OUT_DIR.glob("*.json"):
        if f.name not in keep:
            f.unlink()
            removed += 1

    print(f"patch maps: {len(todo)} to compute, {len(panels) - len(todo)} current, {removed} removed")
    if not todo:
        return 0

    models = load_models()
    for i, (p, path, sha, out_path) in enumerate(todo, 1):
        img = Image.open(path).convert("RGB")
        data = {"version": VERSION, "image_sha": sha, "layers": LAYERS, "dims": DIMS, **panel_maps(img, models)}
        write_json(out_path, data)
        if i % 25 == 0 or i == len(todo):
            print(f"  {i}/{len(todo)}", flush=True)
    return 0


def main() -> int:
    panels = json.loads(GALLERY_PATH.read_text(encoding="utf-8"))["panels"]
    return run_all(panels) if "--all" in sys.argv[1:] else run_examples(panels)


if __name__ == "__main__":
    sys.exit(main())
