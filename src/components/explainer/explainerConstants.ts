import type { Panel } from "../../types";
import { MetricKey } from "../graph/similarityConfig";

// Shared types

export interface NeighborInfo {
  panel: Panel;
  distance: number;
}

// Panels the explainers never show on their own: not as the random sample
// anchor, nor as a closest/furthest neighbour (the next one in line is used
// instead). They stay in the gallery and everywhere else.
export const EXPLAINER_EXCLUDED_PANELS: ReadonlySet<string> = new Set([
  "hyde-street-10-1772390798",
]);

/** Neighbours an explainer may show, nearest first. */
export function explainerNeighbors(neighbors: NeighborInfo[]): NeighborInfo[] {
  return neighbors
    .filter((n) => !EXPLAINER_EXCLUDED_PANELS.has(n.panel.id))
    .sort((a, b) => a.distance - b.distance);
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
      "SigLIP was trained to match images with their captions, so the list of numbers it makes for an image holds the kind of thing a caption would say: what's depicted, the mood, the composition. Images that would be described alike get similar lists.",
  },
  "embedding-dino": {
    name: "DINOv2",
    family: "Self-supervised vision embedding",
    oneLiner:
      "DINOv2 learned from images alone, with no captions or labels, so its list of numbers for an image is about how it looks: shapes, spatial layout and texture. It can tell that two things look alike without having words for either.",
  },
  "embedding-gram": {
    name: "VGG-16 Gram Matrix",
    family: "Style / texture embedding",
    oneLiner:
      "A Gram matrix records which of VGG-16's texture detectors fire together across a panel, while ignoring where they fire. The list of numbers that comes out is about how a panel is drawn (line quality, hatching, ink texture, tonal rendering) and says little about what's in it.",
  },
  color: {
    name: "Color Palette",
    family: "CIELAB dominant color",
    oneLiner:
      "Color does two jobs with two different measurements. The sort lines panels up around the color wheel by the one color each reads as; the neighbours compare whole palettes. Both work in CIELAB, a color space built to match how people see color differences.",
  },
  phash: {
    name: "Perceptual Hash",
    family: "Duplicate finder",
    oneLiner:
      "pHash boils each image down to a 64-bit fingerprint of where it's light and dark, then counts how many bits differ between two fingerprints. Unlike the other methods it isn't for ranking panels: a low count flags the same picture twice.",
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