import { DEFAULT_CONFIG, cloneConfig, prefersReducedMotion } from "./vizConfig";
import type { VizConfig } from "./vizConfig";
import type { PostParams } from "./engine/types";

type PresetOverrides = Partial<Omit<VizConfig, "post" | "weights">> & {
  post?: Partial<PostParams>;
  weights?: Partial<VizConfig["weights"]>;
};

export interface VizPreset {
  id: string;
  name: string;
  /** One line, shown under the name in the launch modal. */
  blurb: string;
  overrides: PresetOverrides;
}

/**
 * Each preset is a region of the same parameter space, not a separate code
 * path — which is why they can be described as overrides and why a pasted
 * config can start from any of them.
 */
export const VIZ_PRESETS: VizPreset[] = [
  {
    id: "dissolve",
    name: "Dissolve",
    blurb: "Two slow layers, no feedback, no rotation, and reduced motion.",
    overrides: {
      layerCount: 2,
      layerLifetime: 44,
      crossfade: 0.5,
      zoomAmount: 1.06,
      panAmount: 0.04,
      rotateAmount: 0,
      layerOpacity: 0.75,
      beat: 4,
      post: {
        feedbackAmount: 0,
        chroma: 0,
        grain: 0.03,
      },
    },
  },
  {
    id: "drift",
    name: "Drift",
    blurb: "Four full-bleed layers on long crossfades. Minimal processing.",
    overrides: {},
  },
  {
    id: "newsprint",
    name: "Newsprint",
    blurb: "Rotated CMY dot screen over a flattened palette.",
    overrides: {
      layerCount: 3,
      layerLifetime: 22,
      tintAmount: 0.1,
      post: {
        feedbackAmount: 0.12,
        halftone: 0.85,
        halftoneScale: 1.1,
        posterize: 0.55,
        chroma: 0.05,
        grain: 0.1,
        vignette: 0.28,
      },
    },
  },
  {
    id: "long-exposure",
    name: "Long Exposure",
    blurb: "Frame feedback dominates: layers smear into trails rather than cut.",
    overrides: {
      layerCount: 3,
      layerLifetime: 34,
      crossfade: 0.55,
      zoomAmount: 1.5,
      panAmount: 0.2,
      post: {
        feedbackAmount: 0.82,
        feedbackScale: 1.012,
        feedbackRotate: 0.002,
        chroma: 0.25,
        vignette: 0.45,
      },
    },
  },
  {
    id: "interference",
    name: "Interference",
    blurb: "Weighted toward clashing pairs on subtractive blends, with hue drift.",
    overrides: {
      layerCount: 5,
      layerLifetime: 18,
      crossfade: 0.35,
      rotateAmount: 0.09,
      tintAmount: 0.35,
      weights: { rhyme: 0.2, clash: 0.5, color: 0.2, random: 0.1 },
      post: {
        feedbackAmount: 0.35,
        chroma: 0.55,
        posterize: 0.2,
        grain: 0.07,
      },
    },
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    blurb: "Panels folded into rotating radial symmetry, the fold count drifting.",
    overrides: {
      layerCount: 3,
      layerLifetime: 30,
      crossfade: 0.5,
      zoomAmount: 1.35,
      panAmount: 0.1,
      rotateAmount: 0.12,
      tintAmount: 0.3,
      psychedelia: 0.4,
      cycleInterval: 20,
      post: {
        kaleido: 0.88,
        kaleidoSegments: 6,
        feedbackAmount: 0.5,
        feedbackScale: 1.004,
        chroma: 0.3,
        posterize: 0.25,
        vignette: 0.4,
      },
    },
  },
  {
    id: "undertow",
    name: "Undertow",
    blurb: "A liquid domain warp with concentric ripples — the frame never sits still.",
    overrides: {
      layerCount: 3,
      layerLifetime: 34,
      crossfade: 0.55,
      zoomAmount: 1.2,
      panAmount: 0.1,
      rotateAmount: 0.03,
      psychedelia: 0.45,
      cycleInterval: 16,
      post: {
        warp: 0.65,
        warpScale: 2.4,
        warpSpeed: 0.3,
        ripple: 0.4,
        rippleFreq: 16,
        feedbackAmount: 0.5,
        feedbackScale: 1.008,
        chroma: 0.35,
        vignette: 0.4,
      },
    },
  },
  {
    id: "zoink",
    name: "Zoink",
    blurb: "Everything cycles: symmetry, warp, solarised colour, in and out at random.",
    overrides: {
      layerCount: 4,
      layerLifetime: 20,
      crossfade: 0.45,
      zoomAmount: 1.35,
      rotateAmount: 0.08,
      // Four screen-blended layers over a wall of light comic pages pile up
      // toward white, so each one carries less than the default.
      layerOpacity: 0.72,
      tintAmount: 0.3,
      weights: { rhyme: 0.35, clash: 0.35, color: 0.2, random: 0.1 },
      psychedelia: 0.9,
      cycleInterval: 9,
      post: {
        feedbackAmount: 0.42,
        chroma: 0.4,
        solarize: 0.12,
        grain: 0.06,
        vignette: 0.42,
      },
    },
  },
];

/** Dissolve leads the list and is what an unqualified launch runs. */
export const DEFAULT_PRESET_ID = "dissolve";

export function findPreset(id: string | null | undefined): VizPreset {
  return VIZ_PRESETS.find((preset) => preset.id === id) ?? VIZ_PRESETS[0];
}

export function presetConfig(id: string | null | undefined): VizConfig {
  const base = cloneConfig(DEFAULT_CONFIG);
  const { post, weights, ...rest } = findPreset(id).overrides;
  return {
    ...base,
    ...rest,
    post: { ...base.post, ...post },
    weights: { ...base.weights, ...weights },
  };
}

/**
 * Dissolve is now the default for everyone, and it is also the calm option, so
 * a reduced-motion preference is already satisfied. Pinned explicitly anyway:
 * if DEFAULT_PRESET_ID is ever pointed at something livelier, that must not
 * quietly become the reduced-motion default too (§7).
 */
export function initialPresetId(): string {
  return prefersReducedMotion() ? "dissolve" : DEFAULT_PRESET_ID;
}
