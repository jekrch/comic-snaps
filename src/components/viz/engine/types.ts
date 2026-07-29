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

/**
 * A tone level applied to a layer's source before tint and blend: `c * gain +
 * lift`, clamped. Collapsed to a single mul-add on purpose — the per-panel
 * decision is made once on the CPU from metadata that is already loaded, so
 * every backend pays two instructions for it and nothing has to read the frame
 * back. Built by `levelsFor`.
 */
export interface Levels {
  gain: number;
  lift: number;
}

/** The panel composited exactly as it was drawn. */
export const IDENTITY_LEVELS: Levels = { gain: 1, lift: 0 };

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
  /** Levelled toward a common key before tint and blend. Fixed at birth. */
  levels: Levels;
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

/** Three components, in the same tuple style as `tint`. */
export type Vec3 = [number, number, number];

/** A shard collapsed to its state at one instant — what a backend draws. */
export interface DrawShard {
  panelId: string;
  srcRect: Rect;
  dstRect: Rect;
  rotation: number;
  blendMode: BlendMode;
  levels: Levels;
  tint: [number, number, number];
  tintAmount: number;
  opacity: number;
  feather: number;
}

// --- The spatial stage ------------------------------------------------------
//
// Everything above is a flat quad: `DrawShard` is an axis-aligned rectangle in
// stage space, and no amount of uv warping in the post chain can give it depth.
// The types below are the parallel contract for the scenes that are actually
// three-dimensional — quads placed in a formation, seen through a real camera,
// with solids that occlude them.
//
// The split runs along the same seam as the rest of the engine: the director
// emits a value, a backend consumes it. The CSS fallback simply has no answer
// for perspective, so it ignores `VizFrame.stage` entirely and the director
// never selects a spatial scene while that backend is live.
//
// One deliberate asymmetry with `DrawShard`. A spatial scene places hundreds of
// quads, so rebuilding a list of hundreds of objects every frame — the way the
// flat path rebuilds its handful — would put the whole formation through the
// allocator sixty times a second to say the same thing each time. Instead the
// *static* half (where each quad sits, how big it is, what it crops) lives in a
// `StageLayout` stamped with a revision, uploaded once and again only when the
// arrangement genuinely changes; the per-frame half is the camera, a few
// scalars, and one entry per resident panel.

/** Which formation a spatial scene arranges its quads into. */
export type StageKind = "swarm" | "vault";

/**
 * Static per-instance geometry for the quads bound to one panel slot.
 *
 * Two positions and two normals per instance rather than one: the formations
 * are authored as a pair and morphed between in the vertex shader, so the
 * arrangement can breathe from a spiral into a sphere — or a tube into a
 * cavern — without any of this being recomputed. Parallel arrays of primitives
 * because they go to the GPU as instanced attributes verbatim.
 */
export interface SlotLayout {
  count: number;
  /** 3 per instance: position in the first formation. */
  posA: Float32Array;
  /** 3 per instance: the direction the quad faces in the first formation. */
  nrmA: Float32Array;
  posB: Float32Array;
  nrmB: Float32Array;
  /** 4 per instance: half-size, in-plane tilt, breath rate, breath phase. */
  quad: Float32Array;
  /** 4 per instance: crop x, y, w, h in source uv — the out-of-context fragment. */
  crop: Float32Array;
}

export interface StageLayout {
  /** Bumped when the arrangement changes. Backends re-upload on a change and
   *  do nothing at all otherwise, which is the point of the whole split. */
  revision: number;
  slots: SlotLayout[];
}

/**
 * The panel currently bound to one slot. Parallel to `StageLayout.slots` by
 * index: a slot is a fixed set of quads that panels flow through, so a panel
 * change re-textures the quads where they stand rather than moving them.
 */
export interface StageSlotDraw {
  panelId: string;
  /** Crossfade of the whole slot as one panel gives way to the next. */
  opacity: number;
  levels: Levels;
  tint: Vec3;
  tintAmount: number;
  /** Source image aspect, so a portrait page is not squared off by its quad. */
  aspect: number;
}

export type SolidShape = "torus" | "box";

/** A solid drifting in the middle distance. Opaque, and the only thing in the
 *  frame that writes depth — which is what lets it eclipse the quads behind it. */
export interface SolidDraw {
  shape: SolidShape;
  panelId: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
  levels: Levels;
  tint: Vec3;
  tintAmount: number;
}

/** Everything a backend needs to draw one frame of a spatial scene. */
export interface StageFrame {
  kind: StageKind;
  layout: StageLayout;
  /** One per `layout.slots`, same order. */
  slots: StageSlotDraw[];
  solids: SolidDraw[];
  /** Clock seconds — the per-instance breath is a function of it. */
  time: number;
  /** 0..1 between the layout's two formations. */
  morph: number;
  /** How strongly quads turn to face the camera rather than sit on the
   *  formation's own surface. 0 is wallpaper, 1 is a swarm of billboards. */
  billboard: number;
  /** Global multiplier on every quad's size. */
  scale: number;
  /** Rate of the per-instance opacity breath, cycles per clock second. */
  breathe: number;
  /** Euler rotation of the whole formation. Carries the roll as well as the
   *  turn: rolling the camera would fight `lookAt`, and for a formation this
   *  symmetric the two are the same picture. */
  spin: Vec3;
  eye: Vec3;
  look: Vec3;
  /** Vertical field of view, degrees. The knob that says how much this reads
   *  as perspective rather than as a flat arrangement seen from far away. */
  fov: number;
  /**
   * Length the formation repeats over along its own z, or 0 for no repeat.
   * A finite ring of instances wrapped by this is an endless tube: the flight
   * is `travel` moving through it rather than the camera going anywhere, so it
   * never runs out of tunnel and never accumulates a coordinate.
   */
  wrap: number;
  /** Distance travelled through that repeat. Integrated, like every other rate. */
  travel: number;
  /** Quads nearer than this fade back out, so nothing pops at the camera. */
  fogNear: number;
  /** Distance at which a quad has faded entirely into the background. */
  fogFar: number;
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

  // --- Reparameterisation ---------------------------------------------------
  // The maps that change what the frame's coordinates *mean* before anything
  // else reads them. They run ahead of the symmetry folds so that the folds —
  // and therefore the seams — are still drawn in screen space, where they
  // close cleanly.
  /** Log-polar regress: the frame repeats into itself, forever. */
  droste: number;
  /** Innermost radius of the repeating annulus, in stage units. */
  drosteInner: number;
  /** Log-radii per repeat. Larger is a longer stride between copies. */
  drostePeriod: number;
  /**
   * Shear of the log strip, in repeats per turn. 0 is concentric rings; whole
   * numbers are a spiral whose seam closes on itself, and anything between
   * leaves a visible step where the ring wraps.
   */
  drosteTwist: number;
  /** How fast the regress crawls inward, log-radii per clock second. Signed,
   *  and integrated into `VizFrame.phases` for the same reason as the fold. */
  drosteSpin: number;
  /** Perspective flight: screen radius becomes depth down an infinite tube. */
  tunnel: number;
  /** Distance scale of that tube. Larger pushes the vanishing point away. */
  tunnelDepth: number;
  /** Travel down the tube, depth units per clock second. Signed; integrated. */
  tunnelSpin: number;

  // --- Geometric ------------------------------------------------------------
  /** Radial mirror symmetry, blended in. 0 disables the fold. */
  kaleido: number;
  /** Wedges the frame folds into. Only read when `kaleido` > 0. */
  kaleidoSegments: number;
  /**
   * How fast the fold turns, radians per clock second. Signed: negative turns
   * the tube back the other way. A *rate* rather than an angle because the
   * director integrates it into `VizFrame.kaleidoPhase` — which is what lets
   * the rate be changed, or reversed, without the frame jumping.
   */
  kaleidoSpin: number;
  /** Mirror-tiled repetition. Doubles as its own blend: 0 is one copy. */
  tile: number;
  /**
   * Iterated fold-rotate-scale (a KIFS). Where `kaleido` mirrors the frame once
   * about the centre and leaves a rosette, this repeats the mirror at four
   * scales and leaves a self-similar one — the same operation, compounded.
   */
  fold: number;
  /** Zoom per iteration. Above 1 pulls fine structure outward into view. */
  foldScale: number;
  /** Translation applied between iterations — the shape knob. Small changes
   *  here reorganise the whole figure, which is why the cycler redraws it per
   *  pulse rather than sweeping it. */
  foldOffsetX: number;
  foldOffsetY: number;
  /** Rotation between iterations, radians per clock second. Signed; integrated
   *  into `VizFrame.phases`, so the structure reorganises continuously rather
   *  than merely spinning. */
  foldSpin: number;
  /**
   * Hexagonal wallpaper fold (p6m). The first symmetry here that is not centred
   * on the viewer: it reads as a mirrored plane extending past the frame rather
   * than as a mandala pinned to the middle.
   */
  lattice: number;
  /** How many cells span the frame. */
  latticeScale: number;

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
  /**
   * Refraction through a five-fold quasiperiodic lattice. Aperiodic by
   * construction — it cannot settle into a loop the way the sine warp
   * eventually does, which is the whole reason it is here.
   */
  quasi: number;
  quasiFreq: number;
  /** Domain-warped fBm: the turbulent, marbling relative of `warp`. The most
   *  expensive effect in the chain — twelve noise evaluations a pixel — so it
   *  is gated hard and never runs at rest. */
  turbulence: number;
  turbulenceScale: number;
  turbulenceSpeed: number;

  // --- Optics ---------------------------------------------------------------
  /**
   * Prismatic dispersion: the three channels are sampled at different
   * *refraction* strengths, so colour fans out where the geometry bends and
   * stays clean where it is flat.
   *
   * Deliberately scales only the smooth displacements — bulge, twist, ripple,
   * quasi, warp, turbulence — and none of the folds. A fold split per channel
   * would fringe its seams rather than its content, which reads as a broken
   * mirror instead of as glass. So this does nothing on its own: it needs
   * something bending the frame to disperse.
   */
  disperse: number;
  /** Directional blur along the radius. Streaks the frame under motion. */
  blur: number;
  /** Which way it streaks: 0 is radial (zoom), 1 is tangential (spin). */
  blurSpin: number;

  // --- Surreal --------------------------------------------------------------
  /** Tone fold: highlights invert, mid-tones peak. */
  solarize: number;
}

/**
 * Accumulated angles and distances for every effect authored as a *rate*.
 *
 * Integrated per frame rather than evaluated as `rate * time` so that a rate
 * the drift or the cycler is moving — or reversing — bends the motion instead
 * of teleporting it. Derived, never authored: presets set the spins.
 */
export interface VizPhases {
  kaleido: number;
  droste: number;
  fold: number;
  tunnel: number;
  /** Flight through the spatial formation, in its own units — depth down a
   *  tube, and nothing at all for a formation that does not repeat. */
  travel: number;
  /** Accumulated turn of that formation, radians. */
  orbit: number;
}

/** Everything a backend needs for one frame. */
export interface VizFrame {
  time: number;
  shards: DrawShard[];
  /**
   * The spatial scene, when one is running. Null is the flat path, and the two
   * are exclusive: a frame with a stage carries no shards, because the whole
   * composition is in the formation instead.
   *
   * The post chain does not care which it was. It reads a texture, so every
   * effect in it — the folds, the Droste, the feedback trail, the halftone —
   * lands on the 3D render exactly as it lands on the flat one.
   */
  stage: StageFrame | null;
  post: PostParams;
  /** Integrals of the `*Spin` rates in `post`. Live reference, not a copy —
   *  a frame is consumed by its backend within the tick that produced it. */
  phases: VizPhases;
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
    levels: shard.levels,
    tint: shard.tint,
    tintAmount: shard.tintAmount,
    opacity: envelope(shard.opacityCurve, age, shard.lifetime),
    feather: shard.mask === "hard" ? 0 : shard.feather,
  };
}

export function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}
