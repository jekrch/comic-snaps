import type { PageId } from "./lessons";

/**
 * The ideas the Guide teaches, each with a one-line definition and the step
 * that introduces it. A lesson marks a word as one of these with `<Term>`;
 * the Glossary page lists them all.
 *
 * Separate from `explainer/code/glossary.ts`, which explains names in the
 * code. Where the two overlap, `code` names the code side.
 */
export interface Concept {
  id: string;
  label: string;
  short: string;
  /** The page that introduces it: a lesson, or the Overview for ideas every lesson uses. */
  lesson: PageId;
  step: string;
  /** Names in the code view that implement this idea. */
  code?: string[];
}

export const CONCEPTS: Concept[] = [
  {
    id: "anchor",
    label: "Anchor panel",
    short: "The panel everything else is compared with. Each lesson ranks the gallery by its distance to the anchor; shuffle or pick another from the worked example.",
    lesson: "overview",
    step: "alike",
  },
  {
    id: "neural-network",
    label: "Neural network (model)",
    short: "A program made of many layers of simple arithmetic whose settings were learned from millions of example images rather than written by hand. Three of the five methods use one.",
    lesson: "overview",
    step: "alike",
  },
  {
    id: "vector",
    label: "Vector (arrow)",
    short: "A list of numbers read as an arrow from the origin. Its direction is what a model's numbers mean.",
    lesson: "vectors",
    step: "arrows",
  },
  {
    id: "embedding",
    label: "Embedding",
    short: "The vector a model produces for one image, computed ahead of time for every panel in the gallery.",
    lesson: "vectors",
    step: "arrows",
  },
  {
    id: "dimension",
    label: "Dimension",
    short: "How many numbers a vector has. SigLIP's arrows live in 768 dimensions, DINOv2's in 384 and the Gram model's in 30.",
    lesson: "vectors",
    step: "arrows",
  },
  {
    id: "normalization",
    label: "Normalization",
    short: "Scaling every arrow to the same length, so only its direction is compared.",
    lesson: "vectors",
    step: "normalize",
    code: ["np.linalg.norm"],
  },
  {
    id: "dot-product",
    label: "Dot product",
    short: "Multiply two vectors' matching numbers and add them all up.",
    lesson: "vectors",
    step: "dot",
    code: ["cosineDistance"],
  },
  {
    id: "cosine",
    label: "Cosine similarity",
    short: "The cosine of the angle between two arrows: 1 when they point the same way, 0 at right angles, −1 when opposite.",
    lesson: "vectors",
    step: "dot",
  },
  {
    id: "distance",
    label: "Cosine distance",
    short: "1 minus the cosine similarity, so that smaller means more alike. What the gallery sorts by.",
    lesson: "vectors",
    step: "distance",
    code: ["cosineDistance"],
  },
  {
    id: "vision-language",
    label: "Vision-language model",
    short: "A model trained on images paired with their captions, so it learns to place a picture near the words that describe it. SigLIP is one.",
    lesson: "siglip",
    step: "prepare",
  },
  {
    id: "self-supervised",
    label: "Self-supervised",
    short: "Trained on pictures alone, with no captions or labels: the model learns by matching different crops and views of the same image. DINOv2 is trained this way.",
    lesson: "dino",
    step: "prepare",
  },
  {
    id: "patch",
    label: "Patch",
    short: "One small square of the image. A transformer reads an image as a grid of patches, like words in a sentence.",
    lesson: "siglip",
    step: "prepare",
  },
  {
    id: "transformer",
    label: "Transformer",
    short: "A kind of neural network that reads its input as a set of pieces (words, or an image's patches) and, layer after layer, lets every piece look at every other. SigLIP and DINOv2 are transformers; VGG-16 isn't.",
    lesson: "siglip",
    step: "attention",
  },
  {
    id: "token",
    label: "Token",
    short: "One piece of a transformer's input with its own list of numbers. For an image, each patch is a token; DINOv2 adds a few that have no patch, like CLS.",
    lesson: "siglip",
    step: "attention",
  },
  {
    id: "layer",
    label: "Layer",
    short: "One round of processing. In a transformer, every patch updates its numbers once per layer.",
    lesson: "siglip",
    step: "attention",
  },
  {
    id: "attention",
    label: "Attention",
    short: "The step where each patch weighs every other patch and folds some of what they hold into its own numbers.",
    lesson: "siglip",
    step: "attention",
  },
  {
    id: "pooling",
    label: "Pooling",
    short: "Turning a transformer's many per-patch lists into the one list for the whole panel. SigLIP uses one last attention step; DINOv2 averages CLS with the mean of the patches.",
    lesson: "siglip",
    step: "arrows",
  },
  {
    id: "cls",
    label: "CLS token",
    short: "An extra token in DINOv2 with no pixels of its own, whose numbers build up a summary of the whole panel. The final arrow is the average of CLS and the patches' average.",
    lesson: "dino",
    step: "attention",
  },
  {
    id: "scratch",
    label: "Scratch patches (registers)",
    short: "Patches a model stops using to describe the art and keeps whole-image bookkeeping in instead. DINOv2's 'with registers' version gets spare slots for this.",
    lesson: "dino",
    step: "attention",
  },
  {
    id: "vgg16",
    label: "VGG-16",
    short: "A 2014 neural network built to name what's in a photo (trained on ImageNet's 1,000 categories). The Gram model ignores its answer and reads its filters instead.",
    lesson: "gram",
    step: "prepare",
  },
  {
    id: "filter",
    label: "Convolutional filter",
    short: "A small pattern detector slid across the whole image. VGG-16 stacks layers of them, from fine marks up to broader strokes.",
    lesson: "gram",
    step: "prepare",
  },
  {
    id: "gram",
    label: "Gram matrix",
    short: "A record of which filters fire together across an image, with where they fired thrown away. It keeps style and loses layout.",
    lesson: "gram",
    step: "prepare",
  },
  {
    id: "pca",
    label: "PCA",
    short: "Principal component analysis: compresses many numbers to the few directions where the gallery's panels differ most.",
    lesson: "gram",
    step: "arrows",
  },
  {
    id: "cielab",
    label: "CIELAB",
    short: "A color space built so that equal distances look roughly like equal differences to the eye. Roughly: it's known to be uneven, especially among blues and vivid colors.",
    lesson: "color",
    step: "rgb",
  },
  {
    id: "palette",
    label: "Dominant colors (palette)",
    short: "A panel's three main colors, found by grouping its pixels into three clusters of similar color (k-means) and taking each cluster's average. Paper and ink often take one or two of them.",
    lesson: "color",
    step: "channels",
    code: ["extract_dominant_colors"],
  },
  {
    id: "chroma",
    label: "Chroma",
    short: "How far a color sits from gray: its distance from the center of the a*–b* plane. Vivid colors have high chroma; whites, grays and blacks have almost none.",
    lesson: "color",
    step: "split",
  },
  {
    id: "chroma-share",
    label: "Chroma share",
    short: "The fraction of a panel's pixels that are clearly colored once the paper's own tint is taken out. At 4% or more the panel sorts as color; below, as black-and-white.",
    lesson: "color",
    step: "split",
    code: ["compute_color_features", "isChromatic"],
  },
  {
    id: "similarity-graph",
    label: "Similarity graph",
    short: "The gallery's graph view: a panel in the middle with its nearest neighbours around it, by whichever method is chosen.",
    lesson: "color",
    step: "split",
    code: ["computeNeighbors"],
  },
  {
    id: "hue-angle",
    label: "Hue angle",
    short: "Where a color sits around the a*–b* plane, as an angle. In CIELAB, red is near 40°, yellow near 100°, green near 135° and blue near 305°.",
    lesson: "color",
    step: "hue",
  },
  {
    id: "key-color",
    label: "Key color",
    short: "The color a panel reads as: the most common hue among its colored pixels, averaged around that peak. The color sort places panels by it.",
    lesson: "color",
    step: "hue",
    code: ["compute_color_features", "sortColor"],
  },
  {
    id: "delta-e",
    label: "ΔE (color distance)",
    short: "The straight-line distance between two colors in CIELAB. About 2 is the smallest difference most people can see; under about 10, two colors still get the same name.",
    lesson: "color",
    step: "distance",
    code: ["labDistance"],
  },
  {
    id: "perceptual-weight",
    label: "Perceptual weight",
    short: "How much a palette color counts in the color distance: more for vivid mid-tones that cover much of the panel, very little for paper white and ink black.",
    lesson: "color",
    step: "distance",
    code: ["colorPerceptualWeight", "matchPalettes"],
  },
  {
    id: "phash",
    label: "Perceptual hash",
    short: "A short fingerprint of an image's broad brightness pattern, built to survive resizing and small edits.",
    lesson: "phash",
    step: "pair",
  },
  {
    id: "luminance",
    label: "Luma (brightness)",
    short: "One brightness number per pixel, a weighted sum of the stored red, green and blue values with green counting most. Often called luminance, which strictly is the same sum on linear light. pHash sees nothing else.",
    lesson: "phash",
    step: "luma",
  },
  {
    id: "dct",
    label: "DCT (frequency transform)",
    short: "Rewrites an image as a sum of smooth to busy patterns. pHash keeps only the smooth ones: the big-picture brightness.",
    lesson: "phash",
    step: "patterns",
  },
  {
    id: "median",
    label: "Median",
    short: "The middle value once a list is sorted: half the values are above it, half below. Unlike the average, a few huge values barely move it.",
    lesson: "phash",
    step: "bits",
  },
  {
    id: "hex",
    label: "Hex digit",
    short: "One digit in base 16, 0–9 then a–f. Each stands for exactly four bits, so a 64-bit hash is 16 hex digits.",
    lesson: "phash",
    step: "bits",
  },
  {
    id: "hamming",
    label: "Hamming distance",
    short: "How many bits differ between two hashes.",
    lesson: "phash",
    step: "count",
    code: ["hammingDistanceHex"],
  },
];

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function concept(id: string): Concept | undefined {
  return BY_ID.get(id);
}
