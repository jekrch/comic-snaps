#!/usr/bin/env python3
"""
Compute CLIP image embeddings for gallery panels.

Reads gallery.json to get the panel list, checks embeddings.json for
already-computed embeddings, computes missing ones, and writes the
updated embeddings.json back.

Embeddings are stored separately from gallery.json to keep the main
data file lean. The frontend only loads embeddings.json when the user
selects embedding-based sort.

Each embedding is a unit-normalized 512-float vector from CLIP
ViT-Base-Patch32, stored at 5 decimal places (~3.5KB per panel).
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

GALLERY_PATH = Path("public/data/gallery.json")
EMBEDDINGS_PATH = Path("public/data/embeddings.json")
IMAGE_ROOT = Path("public")

MODEL_NAME = "openai/clip-vit-base-patch32"


def load_existing_embeddings() -> dict[str, list[float]]:
    """Load existing embeddings keyed by panel id."""
    if not EMBEDDINGS_PATH.exists():
        return {}
    data = json.loads(EMBEDDINGS_PATH.read_text())
    return data.get("embeddings", {})


def compute_embedding(
    image_path: Path,
    model: CLIPModel,
    processor: CLIPProcessor,
) -> list[float]:
    """Compute a unit-normalized CLIP embedding for a single image."""
    img = Image.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
        # newer transformers may return a dataclass; unwrap if needed
        if hasattr(outputs, "image_embeds"):
            vec = outputs.image_embeds.squeeze().numpy()
        elif hasattr(outputs, "pooler_output"):
            vec = outputs.pooler_output.squeeze().numpy()
        else:
            vec = outputs.squeeze().numpy()
    vec = vec / np.linalg.norm(vec)
    return [round(float(v), 5) for v in vec]


def main():
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

    existing = load_existing_embeddings()

    # find panels that need embeddings
    to_compute = []
    for panel in panels:
        pid = panel["id"]
        if pid not in existing:
            to_compute.append(panel)

    # also prune embeddings for panels that no longer exist
    current_ids = {p["id"] for p in panels}
    pruned = {k: v for k, v in existing.items() if k in current_ids}
    pruned_count = len(existing) - len(pruned)
    if pruned_count > 0:
        print(f"Pruned {pruned_count} stale embedding(s).")

    if not to_compute:
        if pruned_count > 0:
            # still need to write the pruned version
            output = {"embeddings": pruned}
            EMBEDDINGS_PATH.write_text(json.dumps(output) + "\n")
            print(f"No new embeddings needed. Wrote pruned file.")
        else:
            print("All panels already have embeddings.")
        sys.exit(0)

    print(f"Computing embeddings for {len(to_compute)} panel(s)...")
    print(f"Loading model: {MODEL_NAME}")
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
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