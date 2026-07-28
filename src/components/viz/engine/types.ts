import type { Panel } from "../../../types";

/** Axis-aligned rectangle. Interpretation depends on the field:
 *  `srcRect` is in texture uv (0..1); `dstRect` is in aspect-corrected
 *  screen space where y spans 0..1 and x spans 0..aspect. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blend modes are resolved in the fragment shader, not via gl.blendFunc, so
 *  the non-separable ones (overlay, hard-light) are available too. The numeric
 *  values are the shader's switch codes — keep in sync with `blendCode()`. */
export type BlendMode =
  | "normal"
  | "screen"
  | "lighten"
  | "difference"
  | "exclusion"
  | "overlay"
  | "hard-light"
  | "multiply";

const BLEND_CODES: Record<BlendMode, number> = {
  normal: 0,
  screen: 1,
  lighten: 2,
  difference: 3,
  exclusion: 4,
  overlay: 5,
  "hard-light": 6,
  multiply: 7,
};

export function blendCode(mode: BlendMode): number {
  return BLEND_CODES[mode];
}

/** CSS `mix-blend-mode` equivalents, for the fallback backend. */
export const CSS_BLEND: Record<BlendMode, string> = {
  normal: "normal",
  screen: "screen",
  lighten: "lighten",
  difference: "difference",
  exclusion: "exclusion",
  overlay: "overlay",
  "hard-light": "hard-light",
  multiply: "multiply",
};

export type MaskKind = "hard" | "feather";

/** Fade in -> hold -> fade out, in seconds, scaled to fit `lifetime`. */
export interface Curve {
  fadeIn: number;
  fadeOut: number;
  /** Peak opacity reached during the hold. */
  peak: number;
}

/**
 * One on-screen instance of a crop of one panel.
 *
 * Motion is expressed as a from/to pair per animated property, evaluated by
 * `resolveShard` at the current time. That keeps the shard a pure value —
 * the director never has to mutate it after birth, and a scene preset is just
 * a function that produces these.
 */
export interface Shard {
  id: number;
  panelId: string;
  /** uv sub-rectangle of the source image — this is the "out of context" crop. */
  srcFrom: Rect;
  srcTo: Rect;
  /** Where it lands on screen, in aspect-corrected units. */
  dstFrom: Rect;
  dstTo: Rect;
  rotFrom: number;
  rotTo: number;
  blendMode: BlendMode;
  tint: [number, number, number];
  tintAmount: number;
  opacityCurve: Curve;
  /** Engine clock seconds. */
  bornAt: number;
  lifetime: number;
  mask: MaskKind;
  /** Edge softness in local uv, 0..0.5. Ignored when `mask` is "hard". */
  feather: number;
  /** Eases the from->to interpolation. Identity when omitted. */
  ease?: (t: number) => number;
}

/** A shard collapsed to its state at one instant — what a backend draws. */
export interface DrawShard {
  panelId: string;
  srcRect: Rect;
  dstRect: Rect;
  rotation: number;
  blendMode: BlendMode;
  tint: [number, number, number];
  tintAmount: number;
  opacity: number;
  feather: number;
}

/** Post-processing parameters. Every effect is gated by its own amount so a
 *  zeroed field costs one uniform compare in the shader. */
export interface PostParams {
  /** How much of the previous frame bleeds through. 0 disables the pass. */
  feedbackAmount: number;
  feedbackScale: number;
  feedbackRotate: number;
  halftone: number;
  halftoneScale: number;
  chroma: number;
  posterize: number;
  grain: number;
  vignette: number;
  /** Global multiplier, slew-limited by the safety governor. */
  exposure: number;
  hueShift: number;

  // --- Geometric ------------------------------------------------------------
  /** Radial mirror symmetry, blended in. 0 disables the fold. */
  kaleido: number;
  /** Wedges the frame folds into. Only read when `kaleido` > 0. */
  kaleidoSegments: number;
  /** Mirror-tiled repetition. Doubles as its own blend: 0 is one copy. */
  tile: number;

  // --- Undulating -----------------------------------------------------------
  /** Sinusoidal domain warp — the liquid one. */
  warp: number;
  /** Spatial frequency of the warp; low is a swell, high is a boil. */
  warpScale: number;
  warpSpeed: number;
  /** Concentric standing waves out from the centre. */
  ripple: number;
  rippleFreq: number;
  /** Radius-dependent rotation, i.e. a spiral shear. Signed. */
  twist: number;
  /** Lens: positive magnifies the centre, negative pinches it. */
  bulge: number;

  // --- Surreal --------------------------------------------------------------
  /** Tone fold: highlights invert, mid-tones peak. */
  solarize: number;
}

/** Everything a backend needs for one frame. */
export interface VizFrame {
  time: number;
  shards: DrawShard[];
  post: PostParams;
  /** 0..1 background wash under all shards. */
  background: [number, number, number];
}

export interface VizBackend {
  resize(width: number, height: number, dpr: number): void;
  render(frame: VizFrame): void;
  /** True once the panel's texture is resident and drawable. */
  isReady(panelId: string): boolean;
  requestPanels(panels: Panel[]): void;
  dispose(): void;
}

const IDENTITY = (t: number) => t;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

/** Opacity envelope at age `age` seconds into a shard's life. */
export function envelope(curve: Curve, age: number, lifetime: number): number {
  if (age <= 0 || age >= lifetime) return 0;
  // A shard whose fades exceed its lifetime becomes a triangle rather than
  // clipping abruptly at either end.
  const total = curve.fadeIn + curve.fadeOut;
  const scale = total > lifetime ? lifetime / total : 1;
  const fadeIn = curve.fadeIn * scale;
  const fadeOut = curve.fadeOut * scale;

  let a = 1;
  if (fadeIn > 0 && age < fadeIn) a = age / fadeIn;
  const remaining = lifetime - age;
  if (fadeOut > 0 && remaining < fadeOut) a = Math.min(a, remaining / fadeOut);
  // Smoothstep the ends so crossfades don't have a visible kink.
  return curve.peak * a * a * (3 - 2 * a);
}

export function resolveShard(shard: Shard, time: number): DrawShard {
  const age = time - shard.bornAt;
  const raw = Math.min(1, Math.max(0, age / shard.lifetime));
  const t = (shard.ease ?? IDENTITY)(raw);

  return {
    panelId: shard.panelId,
    srcRect: lerpRect(shard.srcFrom, shard.srcTo, t),
    dstRect: lerpRect(shard.dstFrom, shard.dstTo, t),
    rotation: lerp(shard.rotFrom, shard.rotTo, t),
    blendMode: shard.blendMode,
    tint: shard.tint,
    tintAmount: shard.tintAmount,
    opacity: envelope(shard.opacityCurve, age, shard.lifetime),
    feather: shard.mask === "hard" ? 0 : shard.feather,
  };
}

export function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}
