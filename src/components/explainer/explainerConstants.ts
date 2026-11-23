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
      "SigLIP was trained to match images with their captions, so it converts each image into a list of numbers that captures what a caption would: what's depicted, the mood, the composition. Two images with similar meaning end up with similar lists.",
  },
  "embedding-dino": {
    name: "DINOv2",
    family: "Self-supervised vision embedding",
    oneLiner:
      "DINOv2 learned from images alone, with no captions or labels, so it converts each image into a list of numbers that captures how it looks: shapes, spatial layout, and texture. It can tell that two things look alike without having words for them.",
  },
  "embedding-gram": {
    name: "VGG-16 Gram Matrix",
    family: "Style / texture embedding",
    oneLiner:
      "A Gram matrix records which of VGG-16's texture detectors fire together across a panel, while ignoring where they fire. That turns each image into a list of numbers about style (line quality, hatching, ink texture, tonal rendering) rather than about what's drawn.",
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

// Embedding dimensions by metric — a fallback only: the explainer reads the
// real length off the loaded vectors when it has them.

export const EMBEDDING_DIM: Record<string, number> = {
  "embedding-siglip": 768,
  "embedding-dino": 384,
  "embedding-gram": 30,
};

// Helpers

export function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

export function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}