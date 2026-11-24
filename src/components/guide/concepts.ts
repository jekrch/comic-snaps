import type { LessonId } from "./lessons";

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
  lesson: LessonId;
  step: string;
  /** Names in the code view that implement this idea. */
  code?: string[];
}

export const CONCEPTS: Concept[] = [
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
    short: "How many numbers a vector has. SigLIP's arrows live in 768 dimensions, DINOv2's in 384.",
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
    id: "patch",
    label: "Patch",
    short: "One small square of the image. A transformer reads an image as a grid of patches, like words in a sentence.",
    lesson: "siglip",
    step: "prepare",
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
    id: "cls",
    label: "CLS token",
    short: "An extra slot in DINOv2 with no patch of its own. It only gathers from the patches, and half of the final arrow is its numbers.",
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
    short: "A color space built so that equal distances look like equal differences to the eye.",
    lesson: "color",
    step: "rgb",
  },
  {
    id: "colorfulness",
    label: "Colorfulness (chroma)",
    short: "How far a panel's colors spread from gray on CIELAB's a* and b* axes. It splits color panels from black-and-white ones.",
    lesson: "color",
    step: "split",
  },
  {
    id: "hue-angle",
    label: "Hue angle",
    short: "Where a color sits around the color wheel, worked out from a* and b*. Reds near 0°, yellows near 90°.",
    lesson: "color",
    step: "hue",
  },
  {
    id: "delta-e",
    label: "ΔE (color distance)",
    short: "The straight-line distance between two colors in CIELAB. Under about 10 most people call them the same color.",
    lesson: "color",
    step: "distance",
    code: ["paletteDistance"],
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
    label: "Luminance",
    short: "One brightness number per pixel, a weighted sum of red, green and blue with green counting most. pHash sees nothing else.",
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
