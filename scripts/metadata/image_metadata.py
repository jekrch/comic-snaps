from pathlib import Path

import imagehash
import numpy as np
from PIL import Image
from skimage import color as skcolor
from sklearn.cluster import KMeans

HASH_FUNCTIONS = {
    "phash": imagehash.phash, # DCT-based, good structural similarity
    "ahash": imagehash.average_hash, # brightness-based
    "dhash": imagehash.dhash,  # gradient/edge-based
}

NUM_DOMINANT_COLORS = 3

# keyColor is legitimately null on a black-and-white panel, so it counts as
# present once the key exists; every other field must also be non-null.
NULLABLE_FIELDS = {"keyColor"}

METADATA_FIELDS = (
    {"width", "height", "dominantColors", "dominantWeights", "colorfulness",
     "chromaShare", "keyColor"}
    | set(HASH_FUNCTIONS.keys())
)

# --- colour features (OKLab) -------------------------------------------------
#
# The colour sort reads these rather than the k-means centres. A k-means
# centre averages every pixel in its cluster, and with three clusters a comic
# panel usually spends two on paper and ink, leaving one to average all of the
# actual colour: a red-and-green panel comes out as a muddy brown whose hue
# belongs to neither. These are measured from the pixels themselves.
#
# Thresholds were set against hand-checked gallery panels (phone photos of
# printed pages, many with muted or painted colour), so they sit lower than
# they would for clean digital art.

# OKLab chroma a pixel needs to count as coloured. Paper tint left after the
# cast is removed stays under this; muted painted colour sits just above it.
CHROMA_MIN = 0.03
# Pixels darker than this are ignored: black ink picks up the lamp's cast (a
# red or navy black) without being colour anyone would sort by.
LIGHTNESS_MIN = 0.3
# A paper tint this weak and this warm is paper or lamp light, and is
# subtracted before measuring. Cool tints are left alone: aged paper and indoor
# light go yellow-orange, nothing in the capture makes a page teal, and a
# teal-washed page is a colour panel.
PAPER_CAST_MAX = 0.05
PAPER_CAST_HUES = (15.0, 115.0)
# A darker band's tint counts as the same cast when it's within this many
# degrees of the paper's hue and at most this many times as strong.
PAPER_HUE_TOLERANCE = 35.0
PAPER_STRENGTH_TOLERANCE = 1.5
CAST_BANDS = 8
# The key hue is the peak of a chroma-weighted hue histogram, refined by the
# circular mean of the pixels within this many degrees of the peak.
HUE_BINS = 36
HUE_WINDOW = 30.0


def needs_update(panel: dict) -> bool:
    """Return True if any metadata field is missing (or null, where null isn't
    a valid value)."""
    return any(
        field not in panel if field in NULLABLE_FIELDS else panel.get(field) is None
        for field in METADATA_FIELDS
    )


def extract_dominant_colors(pixels_lab: np.ndarray, k: int = NUM_DOMINANT_COLORS) -> tuple[list, list]:
    """
    Extract k dominant colors from CIELAB pixel data using k-means.

    Returns the [L, a, b] centres sorted by cluster size (most dominant first),
    rounded to one decimal place, and each cluster's share of the pixels in the
    same order, rounded to three.
    """
    # n_init=1 is fine because random_state is fixed — the run is deterministic
    # and multiple inits don't add information.
    kmeans = KMeans(n_clusters=k, n_init=1, random_state=42)
    kmeans.fit(pixels_lab)

    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    order = np.argsort(-counts)
    centers = kmeans.cluster_centers_[labels[order]]
    shares = counts[order] / counts.sum()

    return (
        [[round(float(v), 1) for v in c] for c in centers],
        [round(float(w), 3) for w in shares],
    )


# Björn Ottosson's OKLab matrices: linear sRGB → LMS, and cube-rooted LMS → Lab.
_OKLAB_LMS = np.array([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
])
_OKLAB_LAB = np.array([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
])


def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """sRGB in 0–1, shape (n, 3), to OKLab."""
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return np.cbrt(linear @ _OKLAB_LMS.T) @ _OKLAB_LAB.T


def oklab_to_cielab(oklab: np.ndarray) -> np.ndarray:
    """OKLab, shape (n, 3), to CIELAB (D65) by way of sRGB, clipped to gamut."""
    lms = (oklab @ np.linalg.inv(_OKLAB_LAB).T) ** 3
    linear = np.clip(lms @ np.linalg.inv(_OKLAB_LMS).T, 0, 1)
    rgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    return skcolor.rgb2lab(rgb.reshape(1, -1, 3)).reshape(-1, 3)


def remove_paper_cast(oklab: np.ndarray) -> np.ndarray:
    """
    Subtract the page's own tint, measured per lightness band.

    A black-and-white page under a warm lamp is tinted all the way from ink to
    paper, by an amount that changes with lightness, so one paper colour isn't
    enough. Each band's median a*/b* is the tint at that lightness.

    The paper (the lightest band) decides whether there is a cast at all: it
    must be weak and warm. A darker band's tint is then removed only if it
    looks like the paper's, close in hue and not much stronger, since lamp
    light tints shadows the way it tints paper. Olive or tan paint on white
    paper doesn't match the paper, so it stays.
    """
    L = oklab[:, 0]
    edges = np.quantile(L, np.linspace(0, 1, CAST_BANDS + 1))
    band = np.clip(np.searchsorted(edges, L, side="right") - 1, 0, CAST_BANDS - 1)
    centres, casts = [], []
    for i in range(CAST_BANDS):
        members = band == i
        if not members.any():
            continue
        centres.append(float(np.median(L[members])))
        casts.append(np.median(oklab[members, 1:], axis=0))
    order = np.argsort(centres)
    centres = np.asarray(centres)[order]
    casts = np.asarray(casts)[order]

    def strength_and_hue(cast):
        return float(np.hypot(*cast)), float(np.degrees(np.arctan2(cast[1], cast[0])) % 360)

    paper_strength, paper_hue = strength_and_hue(casts[-1])
    if paper_strength > PAPER_CAST_MAX or not PAPER_CAST_HUES[0] <= paper_hue <= PAPER_CAST_HUES[1]:
        return oklab
    removed = np.zeros_like(casts)
    for i, cast in enumerate(casts):
        strength, hue = strength_and_hue(cast)
        if (strength <= max(paper_strength * PAPER_STRENGTH_TOLERANCE, 0.01)
                and abs((hue - paper_hue + 180) % 360 - 180) <= PAPER_HUE_TOLERANCE):
            removed[i] = cast
    out = oklab.copy()
    out[:, 1] -= np.interp(L, centres, removed[:, 0])
    out[:, 2] -= np.interp(L, centres, removed[:, 1])
    return out


def compute_color_features(pixels_rgb: np.ndarray) -> dict:
    """
    How much of the panel is coloured, and the colour it reads as.

    chromaShare: the fraction of pixels that are coloured (OKLab chroma at
      least CHROMA_MIN, lightness at least LIGHTNESS_MIN) once the paper cast
      is removed. The colour sort splits colour from black-and-white on this.
    keyColor: the colour the panel reads as, in CIELAB [L, a, b] like
      dominantColors: the mean (in OKLab, weighted by chroma) of the coloured
      pixels within HUE_WINDOW of the hue they peak at. Null when too few
      pixels are coloured to have a hue.
    """
    oklab = remove_paper_cast(srgb_to_oklab(pixels_rgb))
    L, a, b = oklab[:, 0], oklab[:, 1], oklab[:, 2]
    chroma = np.hypot(a, b)
    coloured = (chroma >= CHROMA_MIN) & (L >= LIGHTNESS_MIN)
    share = round(float(coloured.mean()), 3)
    if coloured.sum() < 8:
        return {"chromaShare": share, "keyColor": None}

    pixels, C = oklab[coloured], chroma[coloured]
    hue = np.degrees(np.arctan2(pixels[:, 2], pixels[:, 1])) % 360
    hist, _ = np.histogram(hue, bins=HUE_BINS, range=(0, 360), weights=C)
    hist = hist + 0.5 * (np.roll(hist, 1) + np.roll(hist, -1))
    peak = (np.argmax(hist) + 0.5) * 360 / HUE_BINS
    near = np.abs((hue - peak + 180) % 360 - 180) <= HUE_WINDOW
    key = np.average(pixels[near], axis=0, weights=C[near])
    return {
        "chromaShare": share,
        "keyColor": [round(float(v), 1) for v in oklab_to_cielab(key[None, :])[0]],
    }


def compute_colorfulness(pixels_lab: np.ndarray) -> float:
    """
    Compute a colorfulness score from CIELAB pixel data.

    Uses the RMS of the standard deviations of the a* and b* channels.
    This captures how much chromatic variation exists in the image:
      - B&W art with warm paper tint: low variance in a,b → low score
      - Richly colored panels: high variance in a,b → high score

    Returns a float rounded to one decimal place.
    """
    std_a = np.std(pixels_lab[:, 1])
    std_b = np.std(pixels_lab[:, 2])
    score = np.sqrt(std_a ** 2 + std_b ** 2)
    return round(float(score), 1)


def compute_metadata(image_path: Path) -> dict:
    """Open an image and return dimensions, perceptual hashes, dominant colors
    with their pixel shares, colorfulness, and the colour-sort features."""
    img = Image.open(image_path)

    # Shared thumbnail for color analysis
    thumb = img.copy()
    thumb.thumbnail((64, 64))
    thumb = thumb.convert("RGB")

    pixels_rgb = np.array(thumb).reshape(-1, 3) / 255.0
    pixels_lab = skcolor.rgb2lab(pixels_rgb.reshape(1, -1, 3)).reshape(-1, 3)

    dominant_colors, dominant_weights = extract_dominant_colors(pixels_lab)
    result = {
        "width": img.width,
        "height": img.height,
        "dominantColors": dominant_colors,
        "dominantWeights": dominant_weights,
        "colorfulness": compute_colorfulness(pixels_lab),
        **compute_color_features(pixels_rgb),
    }
    # Each hash function does its own .convert("L") internally; passing a
    # pre-greyscaled image skips the redundant conversions (the second and
    # third .convert("L") become no-ops).
    img_l = img.convert("L")
    for name, fn in HASH_FUNCTIONS.items():
        result[name] = str(fn(img_l))
    return result
