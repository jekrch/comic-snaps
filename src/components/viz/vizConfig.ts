import type { PostParams } from "./engine/types";

/**
 * Every tunable the visualizer has. The debug panel (`?vizdebug=1`) binds
 * sliders straight to this shape, so a value that isn't here can't be tuned
 * without a recompile — which is the thing most likely to eat the schedule.
 */
export interface VizConfig {
  /** Simultaneous full-bleed layers in the drift stack. */
  layerCount: number;
  /** Seconds a drift-stack layer lives, before jitter. */
  layerLifetime: number;
  layerLifetimeJitter: number;
  /** Crossfade length as a fraction of lifetime. */
  crossfade: number;
  /** Ken Burns: how far a layer zooms over its life (1 = none). */
  zoomAmount: number;
  /** Ken Burns: pan distance as a fraction of the frame. */
  panAmount: number;
  /** Max absolute rotation drift, radians. */
  rotateAmount: number;
  /** Peak opacity of a non-base layer. */
  layerOpacity: number;
  /** How strongly a layer is pushed toward its complement tint, 0..1. */
  tintAmount: number;
  /** Beat grid for discrete events, seconds. */
  beat: number;
  /**
   * Global rate of the composition clock, 1 = as authored. Everything else in
   * this config is expressed in clock seconds, so this is the one knob that
   * moves the whole piece — lifetimes, Ken Burns, the beat grid and the post
   * LFOs all follow it together, which is what keeps a speed change from
   * pulling the composition apart.
   */
  speed: number;
  /**
   * How strongly the effect cycler runs, 0..1. At 0 it is inert and never even
   * draws from its rng, so a preset that doesn't want it is exactly the piece
   * it was before the cycler existed. Above 0 it scales both how many effects
   * can overlap and how far each one is pushed.
   */
  psychedelia: number;
  /** Mean seconds between one cycled effect starting and the next. */
  cycleInterval: number;
  post: PostParams;
  /** Director selection weights — see §4 of the plan. */
  weights: {
    rhyme: number;
    clash: number;
    color: number;
    random: number;
  };
}

/** Uniform-gated post defaults. Phase 1 keeps these mild: enough feedback to
 *  smear the crossfades, no halftone or posterize yet. */
export const DEFAULT_POST: PostParams = {
  feedbackAmount: 0.42,
  feedbackScale: 1.006,
  feedbackRotate: 0.0012,
  halftone: 0,
  halftoneScale: 1.4,
  chroma: 0.15,
  posterize: 0,
  grain: 0.05,
  vignette: 0.35,
  exposure: 1,
  hueShift: 0,
  // Every distortion is off by default; the scale/frequency values beside them
  // are the shape each one takes when something turns it on.
  kaleido: 0,
  kaleidoSegments: 6,
  tile: 0,
  warp: 0,
  warpScale: 2.4,
  warpSpeed: 0.35,
  ripple: 0,
  rippleFreq: 16,
  twist: 0,
  bulge: 0,
  solarize: 0,
};

export const DEFAULT_CONFIG: VizConfig = {
  layerCount: 4,
  layerLifetime: 26,
  layerLifetimeJitter: 0.35,
  crossfade: 0.42,
  zoomAmount: 1.28,
  panAmount: 0.14,
  rotateAmount: 0.05,
  layerOpacity: 0.85,
  tintAmount: 0.22,
  beat: 2,
  speed: 1,
  psychedelia: 0,
  cycleInterval: 14,
  post: { ...DEFAULT_POST },
  weights: { rhyme: 0.5, clash: 0.2, color: 0.2, random: 0.1 },
};

/**
 * The ladder the speed control steps through. Discrete rather than a slider on
 * purpose: it is offered on the launch modal and on auto-hiding chrome that a
 * finger has to hit, where a tap target beats a drag.
 */
export const VIZ_SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;
export const VIZ_MIN_SPEED = VIZ_SPEEDS[0];
export const VIZ_MAX_SPEED = VIZ_SPEEDS[VIZ_SPEEDS.length - 1];

/** Nearest rung to an arbitrary value, for a config that came from JSON. */
export function nearestSpeed(value: number): number {
  return VIZ_SPEEDS.reduce((best, rung) =>
    Math.abs(rung - value) < Math.abs(best - value) ? rung : best
  );
}

export function formatSpeed(value: number): string {
  return `${Number(value.toFixed(2))}×`;
}

export function cloneConfig(config: VizConfig): VizConfig {
  return { ...config, post: { ...config.post }, weights: { ...config.weights } };
}

// --- Tunable fields ---------------------------------------------------------

export type ConfigGroup = "stack" | "motion" | "post" | "shape" | "cycle" | "director";

export interface ConfigField {
  group: ConfigGroup;
  /** Dotted path, matching the shape emitted by the tuning panel's JSON. */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get: (config: VizConfig) => number;
  set: (config: VizConfig, value: number) => void;
}

const field = (
  group: ConfigGroup,
  path: string,
  label: string,
  min: number,
  max: number,
  step: number,
  get: ConfigField["get"],
  set: ConfigField["set"]
): ConfigField => ({ group, path, label, min, max, step, get, set });

/**
 * One source of truth for every tunable and its legal range. The tuning panel
 * renders sliders from this, and pasted JSON is clamped against it — so a
 * hand-written config cannot reach a value the sliders could not, which is what
 * keeps the §7 limits meaningful for custom configs too.
 */
export const CONFIG_FIELDS: ConfigField[] = [
  field("stack", "layerCount", "layers", 1, 8, 1, (c) => c.layerCount, (c, v) => (c.layerCount = v)),
  field("stack", "layerLifetime", "lifetime", 4, 90, 1, (c) => c.layerLifetime, (c, v) => (c.layerLifetime = v)),
  field("stack", "layerLifetimeJitter", "jitter", 0, 0.8, 0.01, (c) => c.layerLifetimeJitter, (c, v) => (c.layerLifetimeJitter = v)),
  field("stack", "crossfade", "crossfade", 0.05, 1, 0.01, (c) => c.crossfade, (c, v) => (c.crossfade = v)),
  field("stack", "layerOpacity", "opacity", 0.1, 1, 0.01, (c) => c.layerOpacity, (c, v) => (c.layerOpacity = v)),
  field("stack", "beat", "beat", 0.25, 8, 0.25, (c) => c.beat, (c, v) => (c.beat = v)),

  field("motion", "speed", "speed", VIZ_MIN_SPEED, VIZ_MAX_SPEED, 0.05, (c) => c.speed, (c, v) => (c.speed = v)),
  field("motion", "zoomAmount", "zoom", 1, 2.5, 0.01, (c) => c.zoomAmount, (c, v) => (c.zoomAmount = v)),
  field("motion", "panAmount", "pan", 0, 0.45, 0.005, (c) => c.panAmount, (c, v) => (c.panAmount = v)),
  field("motion", "rotateAmount", "rotate", 0, 0.35, 0.005, (c) => c.rotateAmount, (c, v) => (c.rotateAmount = v)),
  field("motion", "tintAmount", "tint", 0, 1, 0.01, (c) => c.tintAmount, (c, v) => (c.tintAmount = v)),

  field("post", "post.feedbackAmount", "feedback", 0, 0.98, 0.01, (c) => c.post.feedbackAmount, (c, v) => (c.post.feedbackAmount = v)),
  field("post", "post.feedbackScale", "fb scale", 0.97, 1.05, 0.001, (c) => c.post.feedbackScale, (c, v) => (c.post.feedbackScale = v)),
  field("post", "post.feedbackRotate", "fb spin", -0.02, 0.02, 0.0005, (c) => c.post.feedbackRotate, (c, v) => (c.post.feedbackRotate = v)),
  field("post", "post.halftone", "halftone", 0, 1, 0.01, (c) => c.post.halftone, (c, v) => (c.post.halftone = v)),
  field("post", "post.halftoneScale", "ht scale", 0.3, 4, 0.05, (c) => c.post.halftoneScale, (c, v) => (c.post.halftoneScale = v)),
  field("post", "post.chroma", "chroma", 0, 1.5, 0.01, (c) => c.post.chroma, (c, v) => (c.post.chroma = v)),
  field("post", "post.posterize", "posterize", 0, 1, 0.01, (c) => c.post.posterize, (c, v) => (c.post.posterize = v)),
  field("post", "post.grain", "grain", 0, 0.3, 0.005, (c) => c.post.grain, (c, v) => (c.post.grain = v)),
  field("post", "post.vignette", "vignette", 0, 1, 0.01, (c) => c.post.vignette, (c, v) => (c.post.vignette = v)),
  field("post", "post.exposure", "exposure", 0.2, 1.8, 0.01, (c) => c.post.exposure, (c, v) => (c.post.exposure = v)),
  field("post", "post.hueShift", "hue", -1, 1, 0.01, (c) => c.post.hueShift, (c, v) => (c.post.hueShift = v)),
  field("post", "post.solarize", "solarize", 0, 1, 0.01, (c) => c.post.solarize, (c, v) => (c.post.solarize = v)),

  field("shape", "post.kaleido", "kaleido", 0, 1, 0.01, (c) => c.post.kaleido, (c, v) => (c.post.kaleido = v)),
  field("shape", "post.kaleidoSegments", "segments", 2, 16, 1, (c) => c.post.kaleidoSegments, (c, v) => (c.post.kaleidoSegments = v)),
  field("shape", "post.tile", "tile", 0, 1, 0.01, (c) => c.post.tile, (c, v) => (c.post.tile = v)),
  field("shape", "post.warp", "warp", 0, 1, 0.01, (c) => c.post.warp, (c, v) => (c.post.warp = v)),
  field("shape", "post.warpScale", "warp scale", 0.5, 8, 0.1, (c) => c.post.warpScale, (c, v) => (c.post.warpScale = v)),
  field("shape", "post.warpSpeed", "warp rate", 0, 2, 0.01, (c) => c.post.warpSpeed, (c, v) => (c.post.warpSpeed = v)),
  field("shape", "post.ripple", "ripple", 0, 1, 0.01, (c) => c.post.ripple, (c, v) => (c.post.ripple = v)),
  field("shape", "post.rippleFreq", "ripple freq", 2, 60, 1, (c) => c.post.rippleFreq, (c, v) => (c.post.rippleFreq = v)),
  field("shape", "post.twist", "twist", -1, 1, 0.01, (c) => c.post.twist, (c, v) => (c.post.twist = v)),
  field("shape", "post.bulge", "bulge", -1, 1, 0.01, (c) => c.post.bulge, (c, v) => (c.post.bulge = v)),

  field("cycle", "psychedelia", "psychedelia", 0, 1, 0.01, (c) => c.psychedelia, (c, v) => (c.psychedelia = v)),
  field("cycle", "cycleInterval", "interval", 3, 60, 1, (c) => c.cycleInterval, (c, v) => (c.cycleInterval = v)),

  field("director", "weights.rhyme", "rhyme", 0, 1, 0.01, (c) => c.weights.rhyme, (c, v) => (c.weights.rhyme = v)),
  field("director", "weights.clash", "clash", 0, 1, 0.01, (c) => c.weights.clash, (c, v) => (c.weights.clash = v)),
  field("director", "weights.color", "colour", 0, 1, 0.01, (c) => c.weights.color, (c, v) => (c.weights.color = v)),
  field("director", "weights.random", "random", 0, 1, 0.01, (c) => c.weights.random, (c, v) => (c.weights.random = v)),
];

function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const part of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export interface ParsedConfig {
  config: VizConfig;
  /** Fields present in the input that were clamped or ignored. */
  adjusted: string[];
  unknown: string[];
}

/**
 * Merge a candidate object onto `base`, taking only recognised numeric fields
 * and clamping each to its declared range. Anything else is reported rather
 * than applied — silently accepting an unrecognised key would make a typo look
 * like it worked.
 */
export function mergeConfig(candidate: unknown, base: VizConfig): ParsedConfig {
  const config = cloneConfig(base);
  const adjusted: string[] = [];
  const unknown: string[] = [];

  if (typeof candidate !== "object" || candidate === null) {
    return { config, adjusted, unknown };
  }
  const source = candidate as Record<string, unknown>;
  const known = new Set(CONFIG_FIELDS.map((entry) => entry.path));

  for (const entry of CONFIG_FIELDS) {
    const raw = readPath(source, entry.path);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      adjusted.push(entry.path);
      continue;
    }
    const clamped = Math.min(entry.max, Math.max(entry.min, value));
    if (clamped !== value) adjusted.push(entry.path);
    entry.set(config, clamped);
  }

  // Surface stray top-level keys, and stray keys inside the two nested objects.
  for (const [key, value] of Object.entries(source)) {
    if (key === "post" || key === "weights") {
      if (typeof value !== "object" || value === null) {
        unknown.push(key);
        continue;
      }
      for (const nested of Object.keys(value as Record<string, unknown>)) {
        if (!known.has(`${key}.${nested}`)) unknown.push(`${key}.${nested}`);
      }
    } else if (!known.has(key)) {
      unknown.push(key);
    }
  }

  return { config, adjusted, unknown };
}

export type ConfigJsonResult =
  | { ok: true; parsed: ParsedConfig }
  | { ok: false; error: string };

export function parseConfigJson(raw: string, base: VizConfig): ConfigJsonResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  return { ok: true, parsed: mergeConfig(candidate, base) };
}

// --- Device caps (§7) -------------------------------------------------------

export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 620;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface DeviceCaps {
  /** Texture pool size. All 211 panels at full res would be hundreds of MB. */
  texturePoolSize: number;
  /** Longest edge of a decoded texture, px. */
  textureMaxEdge: number;
  renderScale: number;
  /** Feedback FBO scale relative to the render target — the blur hides it. */
  feedbackScale: number;
  /** Shards composited in a single pass; more than this ping-pongs in batches. */
  maxShardsPerPass: number;
}

export function deviceCaps(): DeviceCaps {
  const mobile = isMobile();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return {
    texturePoolSize: mobile ? 8 : 16,
    textureMaxEdge: mobile ? 768 : 1024,
    renderScale: mobile ? 1 : Math.min(dpr, 1.5),
    feedbackScale: 0.75,
    maxShardsPerPass: 12,
  };
}

// --- Safety (§7) ------------------------------------------------------------

/** No full-screen luminance flash above this rate, ever. Enforced in the
 *  engine rather than per-scene so a future preset cannot opt out. */
export const MAX_FLASH_HZ = 3;
export const MIN_FLASH_INTERVAL = 1 / MAX_FLASH_HZ;
/** Ceiling on how fast global exposure may move, per second. */
export const MAX_EXPOSURE_SLEW = 1.2;
/** A full-bleed layer may never fade faster than this, in *real* seconds. */
export const MIN_FULLBLEED_FADE = 0.6;
/**
 * The same floor expressed in clock seconds, which is what a scene authors a
 * fade in. Scaled by the speed ceiling rather than the current speed, because
 * the speed control can be raised at any moment — including mid-fade — and a
 * floor that only held at the speed the shard was born at would not be a floor.
 */
export const MIN_FULLBLEED_FADE_CLOCK = MIN_FULLBLEED_FADE * VIZ_MAX_SPEED;
/**
 * A cycled effect may never ramp in or out faster than this, in *real*
 * seconds. Several of them (solarize, feedback surges, posterize) move whole
 * frame luminance, so an effect that snapped on would be a flash by another
 * name — the rate limit is what keeps them a swell instead. Expressed in clock
 * seconds against the speed ceiling for the same reason as the fade floor.
 */
export const MIN_EFFECT_RAMP = 1.5;
export const MIN_EFFECT_RAMP_CLOCK = MIN_EFFECT_RAMP * VIZ_MAX_SPEED;
