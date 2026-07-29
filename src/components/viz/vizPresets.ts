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
    id: "tumbler",
    name: "Tumbler",
    blurb: "The same fold, never twice the same: wedge count, tiling, spin and drift all wander.",
    overrides: {
      layerCount: 3,
      layerLifetime: 26,
      crossfade: 0.5,
      zoomAmount: 1.42,
      panAmount: 0.13,
      rotateAmount: 0.1,
      // Three screen-blended layers folded on top of themselves pile up toward
      // white faster than an unfolded stack does — the fold is a copy.
      layerOpacity: 0.76,
      tintAmount: 0.32,
      // The drift is what carries this mode, so the cycler is turned down to
      // occasional punctuation rather than a second thing changing everything —
      // two schedules moving the frame at once is what reads as jerky.
      psychedelia: 0.22,
      cycleInterval: 26,
      wander: 0.85,
      wanderRate: 1,
      post: {
        kaleido: 0.9,
        kaleidoSegments: 6,
        feedbackAmount: 0.48,
        feedbackScale: 1.005,
        chroma: 0.3,
        posterize: 0.2,
        grain: 0.05,
        vignette: 0.42,
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
    blurb: "Everything cycles: fractal folds, tunnels, prismatic warp and solarised colour.",
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
      // Longer than it was. The pool this draws from has roughly doubled, and
      // the geometry added to it holds a slot two to three times as long — at
      // the old spacing most onsets would find every slot full and be dropped,
      // which spends the variety without showing any of it.
      cycleInterval: 13,
      post: {
        feedbackAmount: 0.42,
        chroma: 0.4,
        // Standing dispersion. It refracts what is already bending and does
        // nothing at all otherwise, so it costs nothing at rest and means every
        // warp the cycler brings in arrives through glass rather than needing a
        // pulse of its own to be worth looking at.
        disperse: 0.18,
        solarize: 0.12,
        grain: 0.06,
        vignette: 0.42,
      },
    },
  },
  {
    id: "swarm",
    name: "Swarm",
    blurb: "Hundreds of crops on a spiral that folds into a sphere and back.",
    overrides: {
      stageKind: "swarm",
      // The dwell a slot holds its panel for. Long: a formation this dense is
      // already showing a dozen panels at once, so turning them over quickly
      // would be change on top of change rather than instead of it.
      layerLifetime: 30,
      crossfade: 0.5,
      layerLifetimeJitter: 0.4,
      tintAmount: 0.2,
      keyBalance: 0.8,
      stageScale: 1,
      // Additive, and hundreds deep. The single most important number in the
      // preset: this is what stands between the formation and the washout that
      // bd1d4c5 went in to prevent.
      stageOpacity: 0.5,
      stageMorph: 0.5,
      stageBillboard: 0.8,
      stageSpin: 0.05,
      stageFlight: 0,
      stageSolids: 0,
      // The formation is already the slowest thing in the engine; a cycler
      // pulsing the post chain over the top of it would be the second schedule
      // §6 rules out.
      psychedelia: 0.15,
      cycleInterval: 24,
      post: {
        // Low. The trail is a copy of a frame that is mostly dark with a few
        // hundred bright quads in it, and at the usual retention those quads
        // smear into a haze that fills the dark back in.
        feedbackAmount: 0.28,
        feedbackScale: 1.004,
        chroma: 0.22,
        grain: 0.05,
        vignette: 0.45,
      },
    },
  },
  {
    id: "vault",
    name: "Vault",
    blurb: "Flight down a corridor papered in comic pages, past tumbling solids.",
    overrides: {
      stageKind: "vault",
      layerLifetime: 26,
      crossfade: 0.45,
      tintAmount: 0.22,
      keyBalance: 0.78,
      // Larger and denser than the swarm's: these have to meet each other to
      // read as a wall rather than as pages floating in a tube.
      stageScale: 1.25,
      stageOpacity: 0.62,
      // Held nearer the straight corridor. The barrel is where it opens out to,
      // not where it lives — a tube that spends half its time as a cavern stops
      // reading as a tube at all.
      stageMorph: 0.3,
      stageMorphRate: 0.005,
      // Nearly flat against the wall. The pages are wallpaper here, and the
      // give-away that a tunnel is real rather than a uv remap is that the ones
      // beside you are seen edge-on.
      stageBillboard: 0.18,
      stageFov: 68,
      stageSpin: 0.035,
      stageFlight: 1.1,
      stageSolids: 2,
      psychedelia: 0.2,
      cycleInterval: 22,
      post: {
        feedbackAmount: 0.34,
        feedbackScale: 1.006,
        chroma: 0.3,
        grain: 0.05,
        vignette: 0.5,
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
