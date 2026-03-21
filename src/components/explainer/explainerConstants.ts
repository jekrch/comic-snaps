import type { Panel } from "../../types";
import { MetricKey } from "../graph/similarityConfig";

// Shared types

export interface NeighborInfo {
  panel: Panel;
  distance: number;
}

export interface MetricExplainerProps {
  metric: MetricKey;
  anchorPanel: Panel;
  neighbors: NeighborInfo[];
  onClose: () => void;
}

// Metric display metadata */

export const METRIC_INFO: Record<
  MetricKey,
  { name: string; family: string; oneLiner: string }
> = {
  "embedding-siglip": {
    name: "SigLIP",
    family: "Vision-language embedding",
    oneLiner:
      "SigLIP converts each image into a list of numbers that captures its meaning: what's depicted, the mood, the composition. Two images with similar meaning end up with similar lists.",
  },
  "embedding-dino": {
    name: "DINOv2",
    family: "Self-supervised vision embedding",
    oneLiner:
      "DINOv2 converts each image into a list of numbers that captures its visual structure: shapes, spatial layout, and texture, without understanding what things \"are.\"",
  },
  "embedding-gram": {
    name: "VGG-16 Gram Matrix",
    family: "Style / texture embedding",
    oneLiner:
      "VGG-16 Gram matrices convert each image into a list of numbers that captures artistic style: line quality, hatching patterns, ink texture, and tonal rendering.",
  },
  color: {
    name: "Color Palette",
    family: "CIELAB dominant color",
    oneLiner:
      "Color distance compares the dominant colors of two images using CIELAB, a color space designed to match how humans perceive color differences.",
  },
  phash: {
    name: "Perceptual Hash",
    family: "Luminance fingerprint",
    oneLiner:
      "pHash reduces each image to a compact fingerprint based on its brightness patterns, then counts how many bits differ between two fingerprints.",
  },
};

// Embedding dimensions by metric */

export const EMBEDDING_DIM: Record<string, number> = {
  "embedding-siglip": 768,
  "embedding-dino": 768,
  "embedding-gram": 512,
};

// Helpers

export function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

export function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}