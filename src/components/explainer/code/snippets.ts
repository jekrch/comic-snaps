import type { SnippetSpec } from "./extract";

export const REPO_URL = "https://github.com/jekrch/comic-snaps";
export const REPO_BRANCH = "main";

/** The code behind one explainer section. */
export interface CodeRef {
  /** Heading for the code view, usually the section's title. */
  title: string;
  snippets: SnippetSpec[];
  /** Outside references, like a model's page. */
  links?: { label: string; href: string }[];
}

const EMB = "scripts/compute-embeddings.py";
const MAPS = "scripts/compute-patch-maps.py";
const META = "scripts/metadata/image_metadata.py";
const SORTING = "src/utils/sorting.ts";
const NEIGHBORS = "src/utils/similarityUtils.ts";
const PATCH_TS = "src/components/explainer/patchMaps.ts";

const SIGLIP_MODEL = { label: "SigLIP on Hugging Face", href: "https://huggingface.co/google/siglip-base-patch16-224" };
const DINO_MODEL = { label: "DINOv2 on Hugging Face", href: "https://huggingface.co/facebook/dinov2-with-registers-small" };
const VGG_DOCS = { label: "VGG-16 in torchvision", href: "https://pytorch.org/vision/stable/models/generated/torchvision.models.vgg16.html" };

type Embedding = "embedding-siglip" | "embedding-dino" | "embedding-gram";

/** Shared by every embedding: ranking the gallery by distance to the anchor. */
const RANK: SnippetSpec = {
  file: NEIGHBORS,
  symbol: "computeNeighbors",
  note: "In the browser: every other panel's distance to the anchor, sorted nearest first.",
};

const COSINE: SnippetSpec = {
  file: SORTING,
  symbol: "cosineDistance",
  note: "In the browser: the dot product of two unit-length arrows, subtracted from 1.",
};

export const EMBEDDING_CODE: Record<Embedding, Record<"prepare" | "patches" | "direction" | "angle" | "distance", CodeRef | null>> = {
  "embedding-siglip": {
    prepare: {
      title: "Prepare the image",
      snippets: [
        {
          file: EMB,
          symbol: "compute_embeddings_siglip_batch",
          note: "SigLIP's own processor does the squash to 224 × 224 and the patching; this hands it the panels and keeps the result.",
        },
      ],
      links: [SIGLIP_MODEL],
    },
    patches: {
      title: "Let the patches compare notes",
      snippets: [
        {
          file: MAPS,
          symbol: "siglip_maps",
          note: "Runs SigLIP on one example panel and keeps every patch's numbers after layers 1, 6 and 12.",
        },
        {
          file: MAPS,
          symbol: "scratch_patches",
          note: "Finds the patches SigLIP has turned into scratch space: their numbers grow many times larger than the rest.",
        },
        {
          file: MAPS,
          symbol: "pack_tokens",
          note: "Shrinks each patch to 16 numbers so the examples stay small, keeping what tells patches apart.",
        },
        {
          file: PATCH_TS,
          symbol: "similarityMap",
          note: "In the browser: how alike the chosen patch is to every other patch, which is what the tint shows.",
        },
      ],
      links: [SIGLIP_MODEL],
    },
    direction: {
      title: "Turn each image into a direction",
      snippets: [
        {
          file: EMB,
          symbol: "compute_embeddings_siglip_batch",
          note: "get_image_features runs the whole model, attention pooling included; the last lines scale each arrow to length 1.",
        },
      ],
      links: [SIGLIP_MODEL],
    },
    angle: { title: "Measure the angle between arrows", snippets: [COSINE] },
    distance: { title: "From similarity to distance", snippets: [COSINE, RANK] },
  },
  "embedding-dino": {
    prepare: {
      title: "Prepare the image",
      snippets: [
        {
          file: EMB,
          symbol: "DINO_SHORT_SIDE",
          through: "dino_pixels",
          note: "Scales the panel so its short side is 256 pixels, snaps both sides to whole 14-pixel patches, and normalizes the colours.",
        },
      ],
      links: [DINO_MODEL],
    },
    patches: {
      title: "Let the patches compare notes",
      snippets: [
        {
          file: MAPS,
          symbol: "dino_maps",
          note: "Runs DINOv2 on one example panel and keeps every patch's numbers after layers 1, 6 and 12, plus how much CLS drew from each patch.",
        },
        {
          file: MAPS,
          symbol: "pack_tokens",
          note: "Shrinks each patch to 16 numbers so the examples stay small, keeping what tells patches apart.",
        },
        {
          file: PATCH_TS,
          symbol: "similarityMap",
          note: "In the browser: how alike the chosen patch is to every other patch, which is what the tint shows.",
        },
      ],
      links: [DINO_MODEL],
    },
    direction: {
      title: "Turn each image into a direction",
      snippets: [
        {
          file: EMB,
          symbol: "compute_embeddings_dino_batch",
          note: "Averages the CLS token with the mean of the patch tokens (skipping the registers), then scales each arrow to length 1.",
        },
      ],
      links: [DINO_MODEL],
    },
    angle: { title: "Measure the angle between arrows", snippets: [COSINE] },
    distance: { title: "From similarity to distance", snippets: [COSINE, RANK] },
  },
  "embedding-gram": {
    prepare: {
      title: "Prepare the image",
      snippets: [
        {
          file: EMB,
          symbol: "GRAM_SHORT_SIDE",
          through: "gram_input",
          note: "Scales the panel so its short side is 448 pixels, keeping its shape.",
        },
      ],
      links: [VGG_DOCS],
    },
    patches: null,
    direction: {
      title: "Turn each image into a direction",
      snippets: [
        {
          file: EMB,
          symbol: "GRAM_LAYER_INDICES",
          note: "The four VGG-16 layers the style is read from, fine marks to broad strokes.",
        },
        {
          file: EMB,
          symbol: "GramExtractor",
          note: "Runs VGG-16 and, at each of those layers, records which filters fire together (the Gram matrix), throwing away where.",
        },
        {
          file: EMB,
          symbol: "process_gram",
          from: "# Phase 2",
          to: "reduced = reduced / norms",
          note: "Compresses the 174,560 raw numbers to the few directions where the gallery's panels differ most (PCA), then scales each arrow to length 1.",
        },
      ],
      links: [VGG_DOCS],
    },
    angle: { title: "Measure the angle between arrows", snippets: [COSINE] },
    distance: { title: "From similarity to distance", snippets: [COSINE, RANK] },
  },
};

export const COLOR_CODE: Record<"lab" | "palette" | "split" | "hue" | "distance", CodeRef> = {
  lab: {
    title: "Why not just use RGB?",
    snippets: [
      {
        file: META,
        symbol: "compute_metadata",
        to: '"colorfulness": compute_colorfulness',
        note: "Shrinks the panel to a 64-pixel thumbnail and converts every pixel from RGB to CIELAB.",
      },
    ],
  },
  palette: {
    title: "The three CIELAB channels",
    snippets: [
      {
        file: META,
        symbol: "extract_dominant_colors",
        note: "Groups the CIELAB pixels into three clusters (k-means) and keeps each cluster's centre, biggest first.",
      },
    ],
  },
  split: {
    title: "Color vs. black-and-white",
    snippets: [
      {
        file: META,
        symbol: "compute_colorfulness",
        note: "The colorfulness score: how far the pixels' a* and b* values spread.",
      },
      {
        file: NEIGHBORS,
        symbol: "computeNeighbors",
        from: 'metric === "color"',
        to: "if (anchorIsChromatic !== candidateIsChromatic) continue;",
        note: "In the browser: a color panel is only ever compared with color panels, and black-and-white with black-and-white.",
      },
    ],
  },
  hue: {
    title: "Hue-angle sorting within each group",
    snippets: [
      {
        file: SORTING,
        symbol: "colorSortKey",
        note: "Each panel's place in the colour sort: the hue angle of its first properly coloured dominant colour.",
      },
    ],
  },
  distance: {
    title: "Measuring distance between neighbors",
    snippets: [
      {
        file: SORTING,
        symbol: "colorPerceptualWeight",
        through: "paletteDistance",
        note: "Weights each dominant colour by how much it matters (near-white and near-black count for little), then averages the CIELAB distances.",
      },
    ],
  },
};

export const PHASH_CODE: Record<"hash" | "distance", CodeRef> = {
  hash: {
    title: "Shrink and simplify",
    snippets: [
      {
        file: META,
        symbol: "HASH_FUNCTIONS",
        note: "The hashes come from the imagehash library; phash is the one the explainer describes.",
      },
      {
        file: META,
        symbol: "compute_metadata",
        from: "# Each hash function",
        note: "Each panel is hashed once, in greyscale, when it's added to the gallery.",
      },
    ],
    links: [{ label: "imagehash's phash", href: "https://github.com/JohannesBuchner/imagehash" }],
  },
  distance: {
    title: "Count the differences",
    snippets: [
      {
        file: SORTING,
        symbol: "hammingDistanceHex",
        note: "In the browser: compares two hashes hex digit by hex digit and counts the bits that differ.",
      },
    ],
  },
};

export function githubUrl(file: string, startLine?: number, endLine?: number): string {
  const lines = startLine ? `#L${startLine}${endLine && endLine !== startLine ? `-L${endLine}` : ""}` : "";
  return `${REPO_URL}/blob/${REPO_BRANCH}/${file}${lines}`;
}
