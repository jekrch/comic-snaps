#!/usr/bin/env python3
"""
Compute SigLIP image embeddings for gallery panels.

Reads gallery.json to get the panel list, checks embeddings.json for
already-computed embeddings, computes missing ones, and writes the
updated embeddings.json back.

Embeddings are stored separately from gallery.json to keep the main
data file lean. The frontend only loads embeddings.json when the user
selects embedding-based sort.

Each embedding is a unit-normalized 768-float vector from SigLIP
Base-Patch16-224, stored at 5 decimal places (~5.1KB per panel).

SigLIP was chosen over CLIP because it shares the same dual-encoder
architecture (image + text in a joint space) but trains with a sigmoid
loss that produces better retrieval quality. This also sets up future
in-browser text-to-image search using the same model's text encoder.
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

GALLERY_PATH = Path("public/data/gallery.json")
EMBEDDINGS_PATH = Path("public/data/embeddings.json")
IMAGE_ROOT = Path("public")

MODEL_NAME = "google/siglip-base-patch16-224"
EXPECTED_DIM = 768


def load_existing_embeddings() -> dict[str, list[float]]:
    """Load existing embeddings keyed by panel id.

    Returns an empty dict if the file doesn't exist or if the stored
    embeddings have a different dimensionality (i.e. from a previous
    model), triggering a full recompute.
    """
    if not EMBEDDINGS_PATH.exists():
        return {}
    data = json.loads(EMBEDDINGS_PATH.read_text())
    embeddings = data.get("embeddings", {})

    # Detect dimension mismatch from a model swap and invalidate
    if embeddings:
        sample = next(iter(embeddings.values()))
        if len(sample) != EXPECTED_DIM:
            print(
                f"Dimension mismatch: stored={len(sample)}, "
                f"expected={EXPECTED_DIM}. Recomputing all embeddings."
            )
            return {}

    return embeddings


def compute_embedding(
    image_path: Path,
    model: AutoModel,
    processor: AutoProcessor,
) -> list[float]:
    """Compute a unit-normalized SigLIP embedding for a single image."""
    img = Image.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
        # get_image_features may return a plain tensor or a dataclass
        # depending on the model class and transformers version
        if hasattr(outputs, "pooler_output"):
            vec = outputs.pooler_output.squeeze().numpy()
        elif isinstance(outputs, torch.Tensor):
            vec = outputs.squeeze().numpy()
        else:
            vec = outputs[0].squeeze().numpy()
    vec = vec / np.linalg.norm(vec)
    return [round(float(v), 5) for v in vec]


def main():
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

    existing = load_existing_embeddings()

    # Find panels that need embeddings
    to_compute = []
    for panel in panels:
        pid = panel["id"]
        if pid not in existing:
            to_compute.append(panel)

    # Prune embeddings for panels that no longer exist
    current_ids = {p["id"] for p in panels}
    pruned = {k: v for k, v in existing.items() if k in current_ids}
    pruned_count = len(existing) - len(pruned)
    if pruned_count > 0:
        print(f"Pruned {pruned_count} stale embedding(s).")

    if not to_compute:
        if pruned_count > 0:
            output = {"embeddings": pruned}
            EMBEDDINGS_PATH.write_text(json.dumps(output) + "\n")
            print("No new embeddings needed. Wrote pruned file.")
        else:
            print("All panels already have embeddings.")
        sys.exit(0)

    print(f"Computing embeddings for {len(to_compute)} panel(s)...")
    print(f"Loading model: {MODEL_NAME}")
    model = AutoModel.from_pretrained(MODEL_NAME)
    processor = AutoProcessor.from_pretrained(MODEL_NAME)
    model.eval()

    updated = dict(pruned)
    error_count = 0

    for i, panel in enumerate(to_compute):
        image_path = IMAGE_ROOT / panel["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {panel['image']}", file=sys.stderr)
            error_count += 1
            continue

        try:
            vec = compute_embedding(image_path, model, processor)
            updated[panel["id"]] = vec
            print(f"  [{i + 1}/{len(to_compute)}] OK: {panel['image']}")
        except Exception as e:
            print(f"  ERROR: {panel['image']} → {e}", file=sys.stderr)
            error_count += 1

    output = {"embeddings": updated}
    EMBEDDINGS_PATH.write_text(json.dumps(output) + "\n")
    print(
        f"\nDone. {len(to_compute) - error_count} new embedding(s). "
        f"Errors: {error_count}. Total: {len(updated)}."
    )


if __name__ == "__main__":
    main()