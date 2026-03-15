/* Similarity Graph: shared constants & types */

export const NEIGHBOR_COUNTS = [6, 10, 16] as const;
export const DEFAULT_COUNT = 6;

export const NODE_SIZE = 100;
export const ANCHOR_SIZE = 130;

/* Tap / click detection thresholds (shared with PanelCard) */

export const DOUBLE_CLICK_DELAY = 400;
export const MOUSE_TOLERANCE = 20;
export const TOUCH_TOLERANCE = 30;
export const LONG_PRESS_DELAY = 300;

/* Metric definitions */

export type MetricKey =
  | "embedding-siglip"
  | "embedding-dino"
  | "embedding-gram"
  | "color"
  | "phash";

export interface MetricOption {
  key: MetricKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const METRICS: MetricOption[] = [
  {
    key: "embedding-siglip",
    label: "SigLIP",
    shortLabel: "SigLIP",
    description: "Semantic / conceptual",
  },
  {
    key: "embedding-dino",
    label: "DINOv2",
    shortLabel: "DINO",
    description: "Structural / perceptual",
  },
  {
    key: "embedding-gram",
    label: "VGG-16 Gram",
    shortLabel: "Gram",
    description: "Line style / texture",
  },
  {
    key: "color",
    label: "Color Palette",
    shortLabel: "Color",
    description: "CIELAB dominant color",
  },
  {
    key: "phash",
    label: "pHash",
    shortLabel: "pHash",
    description: "Perceptual hash (near-dupes)",
  },
];