#!/usr/bin/env python3
"""
Compute text-based embeddings for gallery panels.

Pipeline
--------
1. PaddleOCR (v3.x / PP-OCRv5) detects and recognises visible text in
   each panel image — dialogue, captions, sound effects, narrative boxes.
2. The extracted text is cleaned via post-processing (common OCR
   corrections for comic-book lettering, deduplication, short-token
   filtering).
3. The cleaned text is saved to a ``text`` field on each panel object
   in gallery.json.
4. Panels with detected text are embedded using BAAI/bge-small-en-v1.5
   (384-dim) and written to embeddings-text.json.
5. Panels with no detected text are omitted from the embeddings file.

Incremental by default: panels that already have a ``text`` field in
gallery.json AND an entry in embeddings-text.json are skipped.
Pass ``--force`` to recompute everything.

Usage
-----
    python compute-text-embeddings.py            # incremental
    python compute-text-embeddings.py --force     # full recompute
"""

import json
import os
import re
import sys
from pathlib import Path

import numpy as np

# Skip the slow model-source connectivity check on init.
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

# Disable oneDNN (MKL-DNN) backend — the default oneDNN path crashes on
# GitHub Actions runners with "ConvertPirAttribute2RuntimeAttribute not
# support [pir::ArrayAttribute<pir::DoubleAttribute>]".  Plain CPU is
# slightly slower but works everywhere.
os.environ["FLAGS_use_mkldnn"] = "0"


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

GALLERY_PATH = Path("public/data/gallery.json")
EMBEDDINGS_PATH = Path("public/data/embeddings-text.json")
IMAGE_ROOT = Path("public")

# ---------------------------------------------------------------------------
# Versioning — bump when OCR model, sentence model, or post-processing
# changes to trigger a full recompute automatically.
# ---------------------------------------------------------------------------

VERSION = "paddleocr-bge-small-en-v1.5-v2"
EMBEDDING_DIM = 384

# ---------------------------------------------------------------------------
# OCR confidence threshold — text detections below this score are
# discarded.  PaddleOCR returns per-line confidence; 0.40 is lenient
# enough to keep stylised SFX while filtering random noise.
# ---------------------------------------------------------------------------

OCR_CONFIDENCE_THRESHOLD = 0.40

# ---------------------------------------------------------------------------
# Post-processing: common OCR misreads in comic-book lettering
# ---------------------------------------------------------------------------

# Character-level substitutions applied to each recognised line.
# Comic lettering is almost always ALL-CAPS, so the dominant errors
# involve confusing visually similar glyphs.
CHAR_FIXES: dict[str, str] = {
    "\u2018": "'",   # curly single quotes → straight
    "\u2019": "'",
    "\u201c": '"',   # curly double quotes → straight
    "\u201d": '"',
    "\u2014": "--",  # em-dash
    "\u2013": "-",   # en-dash
    "|": "I",        # pipe misread as letter I
    "}{": "H",       # braces misread as H (rare but consistent)
}

# Whole-word corrections (case-insensitive match, replaced with the
# value as-is).  Add entries here as recurring mis-recognitions are
# spotted in the gallery.
WORD_FIXES: dict[str, str] = {
    "l'M":   "I'M",
    "l'LL":  "I'LL",
    "l'VE":  "I'VE",
    "l'D":   "I'D",
    "lT":    "IT",
    "lS":    "IS",
    "lN":    "IN",
    "lF":    "IF",
    "TH1S":  "THIS",
    "TH1NK": "THINK",
    "W1TH":  "WITH",
    "0F":    "OF",
    "0N":    "ON",
    "0UT":   "OUT",
    "0NE":   "ONE",
    "0NLY":  "ONLY",
    "Y0U":   "YOU",
    "G0":    "GO",
    "N0":    "NO",
    "N0T":   "NOT",
    "D0":    "DO",
    "S0":    "SO",
    "T0":    "TO",
    "WH0":   "WHO",
}

# Build a compiled regex for whole-word replacement (case-insensitive).
_WORD_FIX_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in WORD_FIXES) + r")\b",
    re.IGNORECASE,
)

# Minimum length for a kept token (after stripping punctuation).
# Single stray characters are almost always OCR noise.
MIN_TOKEN_LENGTH = 2


def postprocess_line(line: str) -> str:
    """Clean a single OCR-recognised line of comic text."""
    # 1. Character-level fixes.
    for old, new in CHAR_FIXES.items():
        line = line.replace(old, new)

    # 2. Whole-word fixes.
    line = _WORD_FIX_PATTERN.sub(lambda m: WORD_FIXES.get(m.group(0).upper(), m.group(0)), line)

    # 3. Collapse runs of whitespace.
    line = re.sub(r"\s+", " ", line).strip()

    return line


def postprocess_text(raw_text: str) -> str:
    """Clean the full concatenated OCR output for a panel.

    Steps
    -----
    1. Apply per-line corrections.
    2. Remove duplicate lines (same text detected twice in overlapping
       regions is common with PaddleOCR).
    3. Drop tokens shorter than MIN_TOKEN_LENGTH to filter stray noise
       characters.
    """
    lines = raw_text.split(" ")
    cleaned: list[str] = []
    seen: set[str] = set()

    for line in lines:
        line = postprocess_line(line)
        if not line:
            continue
        key = line.upper()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(line)

    text = " ".join(cleaned)

    # Drop isolated short tokens (likely noise) while preserving
    # punctuation-attached words like "I" in "I'M".
    tokens = text.split()
    tokens = [
        t for t in tokens
        if len(re.sub(r"[^A-Za-z0-9]", "", t)) >= MIN_TOKEN_LENGTH
        or re.sub(r"[^A-Za-z0-9]", "", t).upper() == "I"
    ]
    return " ".join(tokens)


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def load_gallery() -> dict:
    """Load gallery.json, exit on failure."""
    if not GALLERY_PATH.exists():
        print(f"gallery.json not found at {GALLERY_PATH}", file=sys.stderr)
        sys.exit(1)
    return json.loads(GALLERY_PATH.read_text())


def save_gallery(gallery: dict) -> None:
    """Write gallery.json with trailing newline."""
    GALLERY_PATH.write_text(json.dumps(gallery, indent=2) + "\n")


def load_existing_embeddings() -> tuple[dict[str, list[float]], bool]:
    """Load cached text embeddings, returning ({}, False) if stale.

    Returns
    -------
    embeddings : dict mapping panel ID → float list
    valid : bool — True if version matches and data is usable
    """
    if not EMBEDDINGS_PATH.exists():
        return {}, False

    data = json.loads(EMBEDDINGS_PATH.read_text())
    stored_version = data.get("model_version")

    if stored_version != VERSION:
        print(
            f"[text] Version mismatch: stored={stored_version!r}, "
            f"expected={VERSION!r}. Recomputing all embeddings."
        )
        return {}, False

    embeddings = data.get("embeddings", {})

    if embeddings:
        sample = next(iter(embeddings.values()))
        if len(sample) != EMBEDDING_DIM:
            print(
                f"[text] Dimension mismatch: stored={len(sample)}, "
                f"expected={EMBEDDING_DIM}. Recomputing all embeddings."
            )
            return {}, False

    return embeddings, True


def save_embeddings(embeddings: dict[str, list[float]]) -> None:
    """Write embeddings JSON with version metadata."""
    output = {
        "model_version": VERSION,
        "dim": EMBEDDING_DIM,
        "embeddings": embeddings,
    }
    EMBEDDINGS_PATH.write_text(json.dumps(output) + "\n")


# ---------------------------------------------------------------------------
# OCR  (PaddleOCR v3.x / PaddleX)
# ---------------------------------------------------------------------------

def init_ocr():
    """Initialise PaddleOCR with parameters tuned for comic-book lettering.

    PaddleOCR v3.x (wrapping PaddleX) changed the API surface:
      - ``use_angle_cls`` → ``use_textline_orientation``
      - ``show_log`` removed entirely
      - ``.ocr()`` deprecated in favour of ``.predict()``
      - Results are ``OCRResult`` objects (dict-like) with keys:
            rec_texts   – list[str]    recognised text per line
            rec_scores  – list[float]  confidence per line
            dt_polys    – list[array]  detection polygons

    Tuning notes for comic panels
    -----------------------------
    det_db_thresh : float (default 0.3)
        Binarisation threshold for the DB text detector.  Lowered to 0.2
        to pick up faint or coloured lettering on busy art backgrounds.

    det_db_box_thresh : float (default 0.6)
        Minimum score for a detected text *box* to be kept.  Lowered to
        0.45 so that stylised SFX and small caption text survive
        filtering.

    det_db_unclip_ratio : float (default 1.5)
        How much to expand detected text polygons.  Raised to 2.0
        because comic lettering — especially hand-drawn — often has
        strokes that extend beyond the tight detection box, causing
        clipped characters at recognition time.
    """
    from paddleocr import PaddleOCR

    return PaddleOCR(
        lang="en",
        use_textline_orientation=False,
        det_db_thresh=0.2,
        det_db_box_thresh=0.45,
        det_db_unclip_ratio=2.0,
    )


def extract_text(ocr, image_path: Path) -> str:
    """Run PaddleOCR on a single image and return cleaned, concatenated text.

    Lines are sorted top-to-bottom by the y-coordinate of their
    detection polygon's top edge, approximating natural reading order.
    Lines below ``OCR_CONFIDENCE_THRESHOLD`` are dropped.  The result
    is then passed through ``postprocess_text`` for comic-specific
    corrections.
    """
    results = ocr.predict(str(image_path))

    if not results:
        return ""

    # predict() returns a list of OCRResult (one per page/image).
    # For a single image there is exactly one result.
    result = results[0]

    # OCRResult is dict-like with keys: rec_texts, rec_scores, dt_polys.
    rec_texts = result["rec_texts"]
    rec_scores = result["rec_scores"]
    dt_polys = result["dt_polys"]

    if not rec_texts:
        return ""

    # Pair up (y_coord, text) for sorting, filtering by confidence.
    lines: list[tuple[float, str]] = []
    for text, score, poly in zip(rec_texts, rec_scores, dt_polys):
        if float(score) < OCR_CONFIDENCE_THRESHOLD:
            continue
        text = text.strip() if isinstance(text, str) else str(text).strip()
        if not text:
            continue
        # poly is typically [[x1,y1],[x2,y2],[x3,y3],[x4,y4]].
        # Use the minimum y value (top edge) for vertical ordering.
        try:
            y = float(min(pt[1] for pt in poly))
        except (TypeError, IndexError):
            y = 0.0
        lines.append((y, text))

    lines.sort(key=lambda t: t[0])
    raw = " ".join(text for _, text in lines)

    return postprocess_text(raw)


# ---------------------------------------------------------------------------
# Sentence embedding
# ---------------------------------------------------------------------------

def init_embedder():
    """Load the BGE-small-en-v1.5 sentence-transformer."""
    from sentence_transformers import SentenceTransformer

    print("[text] Loading sentence model: BAAI/bge-small-en-v1.5")
    return SentenceTransformer("BAAI/bge-small-en-v1.5")


def embed_text(model, text: str) -> list[float]:
    """Encode a string and return a unit-normalised float list."""
    vec = model.encode(text, normalize_embeddings=True)
    return [round(float(v), 5) for v in vec]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    force = "--force" in sys.argv

    gallery = load_gallery()
    panels = gallery.get("panels", [])

    if not panels:
        print("[text] No panels found in gallery.json.")
        return

    existing_embeddings, version_valid = load_existing_embeddings()

    if force or not version_valid:
        existing_embeddings = {}

    # Determine which panels need OCR.  A panel needs OCR if:
    #   - force mode is on, OR
    #   - it has no "text" field in gallery.json, OR
    #   - the embeddings version was stale (version_valid is False)
    current_ids = {p["id"] for p in panels}
    needs_ocr: list[dict] = []
    for p in panels:
        if force or not version_valid:
            needs_ocr.append(p)
        elif "text" not in p:
            needs_ocr.append(p)

    # Panels that already have OCR text but are missing an embedding
    # (e.g. embedding file was deleted but gallery.json still has text).
    needs_embedding_only: list[dict] = []
    if not force and version_valid:
        for p in panels:
            pid = p["id"]
            if pid not in existing_embeddings and p.get("text") and p not in needs_ocr:
                needs_embedding_only.append(p)

    # Prune stale entries from embeddings
    pruned = {k: v for k, v in existing_embeddings.items() if k in current_ids}
    pruned_count = len(existing_embeddings) - len(pruned)
    if pruned_count:
        print(f"[text] Pruned {pruned_count} stale embedding(s).")

    if not needs_ocr and not needs_embedding_only:
        if pruned_count:
            save_embeddings(pruned)
            print("[text] No new work needed. Wrote pruned file.")
        else:
            print("[text] All panels already processed.")
        return

    # -----------------------------------------------------------------------
    # Phase 1: OCR
    # -----------------------------------------------------------------------

    gallery_modified = False

    if needs_ocr:
        print(f"[text] Running OCR on {len(needs_ocr)} panel(s)...")
        ocr = init_ocr()
        ocr_error_count = 0

        for i, panel in enumerate(needs_ocr):
            image_path = IMAGE_ROOT / panel["image"]
            if not image_path.exists():
                print(
                    f"  SKIP (file not found): {panel['image']}",
                    file=sys.stderr,
                )
                ocr_error_count += 1
                continue

            try:
                text = extract_text(ocr, image_path)
                panel["text"] = text
                gallery_modified = True
                status = f'"{text[:60]}..."' if len(text) > 60 else f'"{text}"'
                if not text:
                    status = "(no text detected)"
                print(f"  [{i + 1}/{len(needs_ocr)}] {panel['image']}: {status}")
            except Exception as e:
                print(
                    f"  ERROR: {panel['image']} → {e}",
                    file=sys.stderr,
                )
                ocr_error_count += 1

        if ocr_error_count:
            print(f"[text] OCR finished with {ocr_error_count} error(s).")

    if gallery_modified:
        save_gallery(gallery)
        print("[text] Updated gallery.json with extracted text.")

    # -----------------------------------------------------------------------
    # Phase 2: Sentence embedding
    # -----------------------------------------------------------------------

    # Collect all panels that have text and need an embedding.
    ocr_ids = {p["id"] for p in needs_ocr}
    to_embed: list[dict] = []
    for p in panels:
        pid = p["id"]
        if pid in pruned and pid not in ocr_ids:
            continue  # already have a valid embedding
        if p.get("text"):
            to_embed.append(p)

    # Also include panels from needs_embedding_only
    for p in needs_embedding_only:
        if p not in to_embed:
            to_embed.append(p)

    if not to_embed:
        if pruned_count or gallery_modified:
            save_embeddings(pruned)
            print("[text] No panels with text to embed. Wrote file.")
        else:
            print("[text] No panels with text to embed.")
        return

    print(f"[text] Computing embeddings for {len(to_embed)} panel(s)...")
    embedder = init_embedder()

    updated = dict(pruned)
    embed_error_count = 0

    for i, panel in enumerate(to_embed):
        try:
            vec = embed_text(embedder, panel["text"])
            updated[panel["id"]] = vec
            print(f"  [{i + 1}/{len(to_embed)}] OK: {panel['image']}")
        except Exception as e:
            print(
                f"  ERROR embedding: {panel['image']} → {e}",
                file=sys.stderr,
            )
            embed_error_count += 1

    save_embeddings(updated)
    print(
        f"[text] Done. {len(to_embed) - embed_error_count} embedded, "
        f"{embed_error_count} error(s), {len(updated)} total in file."
    )


if __name__ == "__main__":
    main()