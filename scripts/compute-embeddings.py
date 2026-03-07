#!/usr/bin/env python3
"""
Compute image embeddings for gallery panels.

Supports multiple embedding models, each writing to its own output file
with a version tag so that model swaps trigger a full recompute
automatically.

Models
------
siglip  – google/siglip-small-patch16-224 (semantic / conceptual similarity)
dino    – facebook/dinov2-small (structural / perceptual similarity)

Usage
-----
    python compute_embeddings.py              # compute both
    python compute_embeddings.py siglip       # compute only siglip
    python compute_embeddings.py dino         # compute only dino
    python compute_embeddings.py siglip dino  # explicit both
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel, AutoProcessor

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
GALLERY_PATH = Path("public/data/gallery.json")
IMAGE_ROOT = Path("public")

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelSpec:
    """Everything needed to load a model and store its embeddings."""

    key: str  # short name used on the CLI and in the output
    hf_name: str  # Hugging Face model identifier
    dim: int  # expected embedding dimensionality
    output_path: Path  # where to write the embeddings JSON
    version: str  # bumped when the model or post-processing changes


MODELS: dict[str, ModelSpec] = {
    "siglip": ModelSpec(
        key="siglip",
        hf_name="google/siglip-base-patch16-224",
        dim=768,
        output_path=Path("public/data/embeddings.json"),
        version="siglip-base-patch16-224-v1",
    ),
    "dino": ModelSpec(
        key="dino",
        hf_name="facebook/dinov2-small",
        dim=384,
        output_path=Path("public/data/embeddings-dino.json"),
        version="dinov2-small-v1",
    ),
}

# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def load_existing(spec: ModelSpec) -> dict[str, list[float]]:
    """Load cached embeddings, returning {} if stale or missing.

    Staleness is detected by comparing the stored ``model_version``
    against the spec's current version string. A mismatch (from a model
    swap or post-processing change) triggers a full recompute.
    """
    if not spec.output_path.exists():
        return {}

    data = json.loads(spec.output_path.read_text())

    stored_version = data.get("model_version")
    if stored_version != spec.version:
        print(
            f"[{spec.key}] Version mismatch: stored={stored_version!r}, "
            f"expected={spec.version!r}. Recomputing all embeddings."
        )
        return {}

    embeddings = data.get("embeddings", {})

    # Belt-and-suspenders: also check dimensionality
    if embeddings:
        sample = next(iter(embeddings.values()))
        if len(sample) != spec.dim:
            print(
                f"[{spec.key}] Dimension mismatch: stored={len(sample)}, "
                f"expected={spec.dim}. Recomputing all embeddings."
            )
            return {}

    return embeddings


def save_embeddings(spec: ModelSpec, embeddings: dict[str, list[float]]) -> None:
    """Write embeddings JSON with model version metadata."""
    output = {
        "model_version": spec.version,
        "dim": spec.dim,
        "embeddings": embeddings,
    }
    spec.output_path.write_text(json.dumps(output) + "\n")


# ---------------------------------------------------------------------------
# Embedding computation
# ---------------------------------------------------------------------------


def load_model(spec: ModelSpec):
    """Load the model and processor/image-processor from HF."""
    print(f"[{spec.key}] Loading model: {spec.hf_name}")

    model = AutoModel.from_pretrained(spec.hf_name)
    model.eval()

    # SigLIP uses AutoProcessor; DINOv2 uses AutoImageProcessor
    if spec.key == "dino":
        processor = AutoImageProcessor.from_pretrained(spec.hf_name)
    else:
        processor = AutoProcessor.from_pretrained(spec.hf_name)

    return model, processor


def compute_embedding_siglip(
    img: Image.Image, model, processor
) -> np.ndarray:
    """SigLIP: use get_image_features → unit-normalize."""
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
        if hasattr(outputs, "pooler_output"):
            vec = outputs.pooler_output.squeeze().numpy()
        elif isinstance(outputs, torch.Tensor):
            vec = outputs.squeeze().numpy()
        else:
            vec = outputs[0].squeeze().numpy()
    return vec / np.linalg.norm(vec)


def compute_embedding_dino(
    img: Image.Image, model, processor
) -> np.ndarray:
    """DINOv2: use the CLS token from last_hidden_state → unit-normalize."""
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
        # CLS token is the first token of the last hidden state
        vec = outputs.last_hidden_state[:, 0].squeeze().numpy()
    return vec / np.linalg.norm(vec)


COMPUTE_FN = {
    "siglip": compute_embedding_siglip,
    "dino": compute_embedding_dino,
}


def embed_image(
    image_path: Path, spec: ModelSpec, model, processor
) -> list[float]:
    """Open an image, compute its embedding, and return as rounded list."""
    img = Image.open(image_path).convert("RGB")
    vec = COMPUTE_FN[spec.key](img, model, processor)
    return [round(float(v), 5) for v in vec]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def process_model(spec: ModelSpec, panels: list[dict]) -> None:
    """Run the full incremental-compute pipeline for one model."""
    print(f"\n{'='*60}")
    print(f"  {spec.key}  ({spec.hf_name})")
    print(f"{'='*60}")

    existing = load_existing(spec)

    # Determine work
    to_compute = [p for p in panels if p["id"] not in existing]

    # Prune stale entries
    current_ids = {p["id"] for p in panels}
    pruned = {k: v for k, v in existing.items() if k in current_ids}
    pruned_count = len(existing) - len(pruned)
    if pruned_count:
        print(f"[{spec.key}] Pruned {pruned_count} stale embedding(s).")

    if not to_compute:
        if pruned_count:
            save_embeddings(spec, pruned)
            print(f"[{spec.key}] No new embeddings needed. Wrote pruned file.")
        else:
            print(f"[{spec.key}] All panels already have embeddings.")
        return

    print(f"[{spec.key}] Computing embeddings for {len(to_compute)} panel(s)...")
    model, processor = load_model(spec)

    updated = dict(pruned)
    error_count = 0

    for i, panel in enumerate(to_compute):
        image_path = IMAGE_ROOT / panel["image"]
        if not image_path.exists():
            print(
                f"  SKIP (file not found): {panel['image']}", file=sys.stderr
            )
            error_count += 1
            continue

        try:
            vec = embed_image(image_path, spec, model, processor)
            updated[panel["id"]] = vec
            print(f"  [{i + 1}/{len(to_compute)}] OK: {panel['image']}")
        except Exception as e:
            print(f"  ERROR: {panel['image']} → {e}", file=sys.stderr)
            error_count += 1

    save_embeddings(spec, updated)
    print(
        f"[{spec.key}] Done. {len(to_compute) - error_count} new, "
        f"{error_count} error(s), {len(updated)} total."
    )


def main():
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

    # Parse which models to run (default: all)
    requested = sys.argv[1:] if len(sys.argv) > 1 else list(MODELS.keys())
    for key in requested:
        if key not in MODELS:
            print(
                f"Unknown model key: {key!r}. "
                f"Available: {', '.join(MODELS.keys())}",
                file=sys.stderr,
            )
            sys.exit(1)

    for key in requested:
        process_model(MODELS[key], panels)


if __name__ == "__main__":
    main()