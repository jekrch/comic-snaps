#!/usr/bin/env python3
"""
Compute image embeddings for gallery panels.

Supports multiple embedding models, each writing to its own output file
with a version tag so that model swaps trigger a full recompute
automatically.

Models
------
siglip  – google/siglip-so400m-patch14-384 (semantic / conceptual similarity)
dino    – facebook/dinov2-small (structural / perceptual similarity)
gram    – VGG-16 Gram matrices (line style / texture similarity)

The gram model extracts Gram matrices from three VGG-16 convolutional
layers spanning shallow-to-mid depth, capturing texture at multiple
scales: fine hatching and stippling from early layers, broader stylistic
patterns from deeper ones. The raw Gram features are high-dimensional,
so PCA reduces them to a compact embedding. Because PCA is fit on the
full corpus each run, gram embeddings are always fully recomputed (not
incremental). Bumping the version string will also trigger a recompute.

Usage
-----
    python compute_embeddings.py              # compute all
    python compute_embeddings.py siglip       # compute only siglip
    python compute_embeddings.py dino         # compute only dino
    python compute_embeddings.py gram         # compute only gram
    python compute_embeddings.py siglip dino  # explicit subset
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.decomposition import PCA
from torchvision import models, transforms
from transformers import AutoImageProcessor, AutoModel, AutoProcessor


# Paths
GALLERY_PATH = Path("public/data/gallery.json")
IMAGE_ROOT = Path("public")


# Model registry

@dataclass(frozen=True)
class ModelSpec:
    """Everything needed to load a model and store its embeddings."""

    key: str  # short name used on the CLI and in the output
    hf_name: str  # Hugging Face model identifier (or torchvision for gram)
    dim: int  # expected embedding dimensionality
    output_path: Path  # where to write the embeddings JSON
    version: str  # bumped when the model or post-processing changes
    incremental: bool = True  # whether incremental updates are supported


MODELS: dict[str, ModelSpec] = {
    "siglip": ModelSpec(
        key="siglip",
        hf_name="google/siglip-so400m-patch14-384",
        dim=768,
        output_path=Path("public/data/embeddings.json"),
        version="siglip-so400m-patch14-384-v1",
    ),
    "dino": ModelSpec(
        key="dino",
        hf_name="facebook/dinov2-small",
        dim=384,
        output_path=Path("public/data/embeddings-dino.json"),
        version="dinov2-small-v1",
    ),
    "gram": ModelSpec(
        key="gram",
        hf_name="vgg16",
        dim=256,
        output_path=Path("public/data/embeddings-gram.json"),
        version="vgg16-gram-3layer-pca256-v1",
        incremental=False,  # PCA must be fit on the full corpus
    ),
}


# I/O helpers

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



# Embedding computation – SigLIP

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



# Embedding computation – DINOv2

def compute_embedding_dino(
    img: Image.Image, model, processor
) -> np.ndarray:
    """DINOv2: use the CLS token from last_hidden_state → unit-normalize."""
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
        vec = outputs.last_hidden_state[:, 0].squeeze().numpy()
    return vec / np.linalg.norm(vec)



# Embedding computation – Gram matrices (VGG-16)

# Layers to extract Gram matrices from. These span shallow → mid depth:
#   relu1_2 (64 channels)  – fine texture: hatching, stippling, line weight
#   relu2_2 (128 channels) – medium patterns: crosshatching, dot screens
#   relu3_3 (256 channels) – broader style: inking approach, tonal treatment
GRAM_LAYER_INDICES = {
    "relu1_2": 3,   # features[3]  = ReLU after conv1_2
    "relu2_2": 8,   # features[8]  = ReLU after conv2_2
    "relu3_3": 15,  # features[15] = ReLU after conv3_3
}

# Standard ImageNet normalization for VGG
GRAM_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# Number of images to push through VGG in a single forward pass.
# Tune based on available memory — 32 is conservative for CPU with
# 224×224 inputs and only 15 conv layers.
GRAM_BATCH_SIZE = 32


class GramExtractor(nn.Module):
    """Extract Gram matrices from specified VGG-16 feature layers.

    A Gram matrix G for a feature map F with shape (C, H*W) is:
        G = F @ F^T / (H * W)
    It captures which feature channels co-activate, encoding texture
    and style independent of spatial layout.

    Supports batched input: given a tensor of shape (B, 3, H, W),
    returns a list of tensors each of shape (B, C*(C+1)/2) — one
    per layer, with upper-triangle Gram values for every image in
    the batch.
    """

    def __init__(self, layer_indices: dict[str, int]):
        super().__init__()
        vgg = models.vgg16(weights=models.VGG16_Weights.IMAGENET1K_V1)
        self.slices = nn.ModuleList()
        self.layer_names = list(layer_indices.keys())

        indices = sorted(layer_indices.values())
        prev = 0
        for idx in indices:
            self.slices.append(
                nn.Sequential(*list(vgg.features.children())[prev : idx + 1])
            )
            prev = idx + 1

        # Pre-compute upper-triangle index pairs for each layer's
        # channel count so they aren't rebuilt on every forward call.
        channel_counts = [64, 128, 256]  # relu1_2, relu2_2, relu3_3
        self._triu_indices = [
            torch.triu_indices(c, c) for c in channel_counts
        ]

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        """Return upper-triangle Gram vectors for a batch of images.

        Parameters
        ----------
        x : Tensor of shape (B, 3, 224, 224)

        Returns
        -------
        list[Tensor]
            One tensor per layer, each of shape (B, C*(C+1)/2).
        """
        grams = []
        h = x
        for i, s in enumerate(self.slices):
            h = s(h)
            # h shape: (B, C, H, W)
            b, c, height, width = h.shape
            features = h.view(b, c, height * width)           # (B, C, H*W)
            gram = torch.bmm(features, features.transpose(1, 2))  # (B, C, C)
            gram = gram / (height * width)

            # Extract upper triangle for each image in the batch
            triu = self._triu_indices[i]
            gram_upper = gram[:, triu[0], triu[1]]             # (B, tri)
            grams.append(gram_upper)
        return grams


def compute_gram_features_batch(
    images: list[Image.Image], extractor: GramExtractor
) -> np.ndarray:
    """Compute raw (pre-PCA) Gram feature vectors for a batch of images.

    Parameters
    ----------
    images : list[PIL.Image]
        Already-converted to RGB.
    extractor : GramExtractor

    Returns
    -------
    np.ndarray of shape (len(images), 43232)
        Concatenated upper-triangle Gram values from all layers.
    """
    batch = torch.stack([GRAM_TRANSFORM(img) for img in images])
    with torch.no_grad():
        grams = extractor(batch)                # list of (B, tri_i)
    return torch.cat(grams, dim=1).numpy()       # (B, 43232)


def compute_gram_features(
    img: Image.Image, extractor: GramExtractor
) -> np.ndarray:
    """Compute raw (pre-PCA) Gram feature vector for a single image.

    Convenience wrapper around compute_gram_features_batch for the
    single-image case.
    """
    return compute_gram_features_batch([img], extractor)[0]



# Dispatch table for standard (incremental) models

COMPUTE_FN = {
    "siglip": compute_embedding_siglip,
    "dino": compute_embedding_dino,
}


def load_model(spec: ModelSpec):
    """Load the model and processor/image-processor from HF."""
    print(f"[{spec.key}] Loading model: {spec.hf_name}")

    model = AutoModel.from_pretrained(spec.hf_name)
    model.eval()

    if spec.key == "dino":
        processor = AutoImageProcessor.from_pretrained(spec.hf_name)
    else:
        processor = AutoProcessor.from_pretrained(spec.hf_name)

    return model, processor


def embed_image(
    image_path: Path, spec: ModelSpec, model, processor
) -> list[float]:
    """Open an image, compute its embedding, and return as rounded list."""
    img = Image.open(image_path).convert("RGB")
    vec = COMPUTE_FN[spec.key](img, model, processor)
    return [round(float(v), 5) for v in vec]



# Processing pipelines

def process_incremental(spec: ModelSpec, panels: list[dict]) -> None:
    """Run the incremental-compute pipeline for SigLIP / DINO."""
    existing = load_existing(spec)

    to_compute = [p for p in panels if p["id"] not in existing]

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
            print(f"  SKIP (file not found): {panel['image']}", file=sys.stderr)
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


def process_gram(spec: ModelSpec, panels: list[dict]) -> None:
    """Compute Gram-matrix style embeddings for all panels.

    Unlike incremental models, this always recomputes everything because
    PCA is fit on the full corpus — adding a single image shifts the
    entire embedding space. If nothing has changed (same panels, same
    version), the existing file is kept as-is.

    Images are processed in batches through VGG-16 to amortize the cost
    of convolutional forward passes. The per-image Gram matrix
    computation (F @ F^T) happens inside the batched forward call via
    torch.bmm.
    """
    existing = load_existing(spec)
    current_ids = {p["id"] for p in panels}

    # Quick exit: if the version matches and panel set is unchanged,
    # there's nothing to do.
    if existing and set(existing.keys()) == current_ids:
        print(f"[{spec.key}] All panels already have embeddings.")
        return

    print(f"[{spec.key}] Computing Gram features for {len(panels)} panel(s)...")
    print(f"[{spec.key}] Loading model: VGG-16 (torchvision)")
    extractor = GramExtractor(GRAM_LAYER_INDICES)
    extractor.eval()

    # Phase 1: extract raw Gram features in batches
    raw_features: dict[str, np.ndarray] = {}
    error_count = 0

    # Build a list of (panel_id, image) pairs, skipping load failures
    batch_ids: list[str] = []
    batch_imgs: list[Image.Image] = []

    for i, panel in enumerate(panels):
        image_path = IMAGE_ROOT / panel["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {panel['image']}", file=sys.stderr)
            error_count += 1
            continue

        try:
            img = Image.open(image_path).convert("RGB")
            batch_ids.append(panel["id"])
            batch_imgs.append(img)
        except Exception as e:
            print(f"  ERROR loading: {panel['image']} → {e}", file=sys.stderr)
            error_count += 1

    # Process in chunks of GRAM_BATCH_SIZE
    total = len(batch_imgs)
    for start in range(0, total, GRAM_BATCH_SIZE):
        end = min(start + GRAM_BATCH_SIZE, total)
        chunk_ids = batch_ids[start:end]
        chunk_imgs = batch_imgs[start:end]

        try:
            features = compute_gram_features_batch(chunk_imgs, extractor)
            for j, pid in enumerate(chunk_ids):
                raw_features[pid] = features[j]
            print(
                f"  [{end}/{total}] Batch OK "
                f"({len(chunk_ids)} image(s))"
            )
        except Exception as e:
            # Fall back to one-at-a-time so a single bad image
            # doesn't take out the whole batch
            print(
                f"  Batch {start}–{end} failed ({e}), "
                f"falling back to single-image mode",
                file=sys.stderr,
            )
            for j, (pid, img) in enumerate(zip(chunk_ids, chunk_imgs)):
                try:
                    feat = compute_gram_features(img, extractor)
                    raw_features[pid] = feat
                    print(f"  [{start + j + 1}/{total}] OK (fallback)")
                except Exception as e2:
                    print(
                        f"  ERROR: panel {pid} → {e2}",
                        file=sys.stderr,
                    )
                    error_count += 1

    if len(raw_features) < 2:
        print(
            f"[{spec.key}] Need at least 2 panels for PCA. Skipping.",
            file=sys.stderr,
        )
        return

    # Phase 2: PCA to reduce dimensionality, then unit-normalize
    ids = list(raw_features.keys())
    matrix = np.stack([raw_features[pid] for pid in ids])

    n_components = min(spec.dim, len(ids), matrix.shape[1])
    print(
        f"[{spec.key}] Fitting PCA: {matrix.shape[1]} → {n_components} dimensions "
        f"({len(ids)} samples)"
    )
    pca = PCA(n_components=n_components, random_state=42)
    reduced = pca.fit_transform(matrix)

    # Unit-normalize each embedding
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    norms[norms == 0] = 1  # guard against zero vectors
    reduced = reduced / norms

    explained = sum(pca.explained_variance_ratio_) * 100
    print(f"[{spec.key}] PCA explains {explained:.1f}% of variance.")

    embeddings = {
        pid: [round(float(v), 5) for v in vec]
        for pid, vec in zip(ids, reduced)
    }

    # When the corpus is smaller than spec.dim, n_components will be
    # smaller than the nominal dim. Store the actual dim used so the
    # frontend knows the vector length.
    save_spec = ModelSpec(
        key=spec.key,
        hf_name=spec.hf_name,
        dim=n_components,
        output_path=spec.output_path,
        version=spec.version,
        incremental=spec.incremental,
    )
    save_embeddings(save_spec, embeddings)
    print(
        f"[{spec.key}] Done. {len(embeddings)} embedding(s), "
        f"{error_count} error(s)."
    )



# Main



def process_model(spec: ModelSpec, panels: list[dict]) -> None:
    """Route to the appropriate pipeline based on model type."""
    print(f"\n{'=' * 60}")
    print(f"  {spec.key}  ({spec.hf_name})")
    print(f"{'=' * 60}")

    if spec.incremental:
        process_incremental(spec, panels)
    else:
        process_gram(spec, panels)


def main():
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(GALLERY_PATH.read_text())
    panels = gallery.get("panels", [])

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