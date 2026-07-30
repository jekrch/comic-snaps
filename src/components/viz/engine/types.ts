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
// One deliberate asymmetry with `DrawShard`. A formation is a standing
// arrangement that panels flow *through*, so where each quad sits, how large it
// is and what it crops are the same answer on every frame of a run — rebuilding
// that list sixty times a second would put the whole formation through the
// allocator to say nothing new. Instead the static half lives in a
// `StageLayout` stamped with a revision, uploaded once and again only when the
// arrangement genuinely changes; the per-frame half is the camera, a few
// scalars, and one entry per resident panel.
//
// The counts here are deliberately small — a handful of panels wearing a handful
// of large quads each, not a cloud of confetti. A formation of hundreds of small
// crops is legible as texture rather than as pages: the eye reads a busy grain
// and no individual image, which is the opposite of the point. So a scene
// declares the few quads it wants (`SpatialScene.panels` × `perPanel`) and makes
// each one big enough to be read as a piece of a comic.

/** Which formation a spatial scene arranges its quads into. */
export type StageKind = "swarm" | "vault" | "sheet" | "ribbons" | "motes";

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
  /**
   * 3 per instance: which way is "along" for this quad, in each formation.
   *
   * The normal alone fixes the plane a quad lies in but not its roll within it,
   * and the vertex shader's fallback — cross a world up against the normal —
   * gives a roll that has nothing to do with the formation. That is invisible
   * for a scatter and fatal for a ribbon, where consecutive quads have to share
   * an axis or the strip shears into confetti. Read only when `StageFrame.align`
   * is above zero; every formation still supplies it, defaulted off the normal.
   */
  tanA: Float32Array;
  tanB: Float32Array;
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

/**
 * A tube of wallpaper around the camera — a formation that is one continuous
 * *surface* rather than a set of quads.
 *
 * The reason it exists at all is that a corridor built from quads is a corridor
 * built from postcards. However large each one is, a quad has a rim, and a rim
 * moving past the eye is an object passing the viewer; a dozen of them is a dozen
 * objects flying at the camera, which is exactly the busy, cluttered reading that
 * separate crops on a tube wall cannot escape. A tube has no rim. One page wrapped
 * twice around it is a wall of comic art with no edges in it anywhere, and at that
 * point the frame is *made of* one image rather than tiled with many.
 *
 * The other thing it buys is that nothing moves. The geometry stands still around
 * the camera and the wallpaper's own coordinates scroll, so the flight is entirely
 * in the texture: there is no depth at which something arrives, and therefore
 * nothing that can pass through the viewer. Foreshortening does the rest — a
 * pattern scrolling down a tube in perspective accelerates as it approaches, which
 * is the whole of what reads as flight.
 *
 * Textured per slot, from the same `StageFrame.slots` the quads use, so a panel
 * handover is a crossfade of the entire wall. See the note in the vault preset
 * about why its two slots have to sum to one.
 */
export interface ShellDraw {
  /** Radius of the tube at its widest, world units. */
  radius: number;
  /** How far down -z it reaches before the fog has taken it entirely. */
  length: number;
  /** How far behind the camera the mouth sits. Non-zero so the open end is
   *  always outside the frustum, however far the camera sways off the axis. */
  back: number;
  /** 0 is a straight corridor; 1 pinches both ends and opens the middle into a
   *  cavern. The morph knob, for a formation that has no second arrangement. */
  profile: number;
  /** Copies of the image around the circumference. One or two: this is the knob
   *  that decides whether the wall is a page or a pattern. */
  tiles: number;
  /** Turn of the wallpaper over the tube's length, radians. A helical wrap, so
   *  the flight has a twist in it without the camera rolling. */
  twist: number;
  /** Distance scrolled along the tube, world units. Integrated `travel`. */
  scroll: number;
  /** Radial ripple amplitude, world units — the corridor breathing. */
  ripple: number;
  /** Spatial frequency of that ripple, cycles per world unit. */
  rippleScale: number;
  /** Travel of the ripple. Integrated, like every other rate. */
  ripplePhase: number;
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
  /**
   * The wallpaper tube, when the scene is one. Exclusive with the quads in
   * practice — a scene that has a shell asks for no quads at all — but not by
   * type: the two draw from the same slot list, so a formation that wanted both
   * would already work.
   */
  shell: ShellDraw | null;
  solids: SolidDraw[];
  /** Clock seconds — the per-instance breath is a function of it. */
  time: number;
  /** 0..1 between the layout's two formations. */
  morph: number;
  /** How strongly quads turn to face the camera rather than sit on the
   *  formation's own surface. 0 is wallpaper, 1 is a swarm of billboards. */
  billboard: number;
  /**
   * How strongly a quad's roll follows the formation's own "along" direction
   * rather than a world up vector. 0 is every previous formation, unchanged; 1
   * is a ribbon, where the strip only reads as a strip because consecutive
   * quads agree about which way is along it.
   */
  align: number;
  /** Global multiplier on every quad's size. */
  scale: number;
  /**
   * Edge softness of a quad, in its own uv, 0..0.5.
   *
   * Per frame rather than a constant of the pass because at these sizes the edge
   * is a compositional element rather than an anti-aliasing detail. A quad that
   * fills half the frame has a border long enough to read as a *cut*, and the
   * scenes disagree about whether they want one: a corridor wall is a page and
   * wants its edge, where a drifting shard wants to dissolve into the ones
   * around it.
   */
  feather: number;
  /**
   * Vertex displacement along each quad's own normal, in world units.
   *
   * The one thing on this list that a uv warp structurally cannot express: the
   * surface genuinely leaves its arrangement, so a sheet swelling toward the
   * camera passes *through* the sheet in front of it rather than being composited
   * over it. Applied to the morphed position, so it rides whatever the formation
   * is already doing instead of replacing it.
   */
  displace: number;
  /** Spatial frequency of that displacement, cycles per world unit. */
  displaceScale: number;
  /** Travel of the displacement wave. Integrated, like every other rate. */
  displacePhase: number;
  /**
   * Curl-noise scatter, in world units. Divergence-free by construction, which
   * is what makes it read as a current carrying the quads rather than as each
   * one being pushed somewhere on its own.
   */
  swirl: number;
  /** Spatial frequency of that noise. Large is a fine boil, small is a drift. */
  swirlScale: number;
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
  /**
   * Samples the trail in log-polar instead of by rotate-and-scale, wrapping the
   * log radius so the trail folds back into itself. Same cost as the zoom it
   * replaces, and the difference is a corridor rather than a spiral smear: a
   * scaled trail recedes and is gone, where a wrapped one arrives again from
   * the outside forever.
   *
   * Takes its stride from `drostePeriod` and `drosteInner` rather than carrying
   * its own, so a frame running both the regress and the corridor has them agree
   * about how far apart the copies sit.
   */
  feedbackDroste: number;
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

  // --- Fields ---------------------------------------------------------------
  // The two displacements that are not a formula but a *simulation*, read out of
  // a buffer the backend advanced before the frame. Both are therefore slow by
  // construction rather than by tuning — a field carries its own history, so
  // there is no rate here to set too high — which is what §6 asks for and what
  // no closed-form warp above can offer.
  /**
   * Displacement along an advected flow field, driven from the composition's own
   * drift heading. The frame smears like ink in water *along the current the
   * layers are already moving on*, so the fluid motion and the layer motion are
   * one schedule rather than two.
   */
  flow: number;
  /** Spatial scale of the structure injected into that field. */
  flowScale: number;
  /** How much of the field survives each frame, 0..1. High is a long, coherent
   *  smear; low is a field that restates itself and reads as a boil. */
  flowDecay: number;
  /**
   * Displacement along the gradient of a Gray–Scott reaction–diffusion field
   * seeded from the frame's own luminance edges. Its natural timescale is tens
   * of seconds, which makes it the best pacing match in the engine: the slowness
   * is intrinsic to the chemistry rather than dialled in.
   */
  react: number;
  /** Gray–Scott feed rate. With `reactKill`, this is the entire shape knob —
   *  the difference between spots, stripes and a spreading front. */
  reactFeed: number;
  /** Gray–Scott kill rate. Narrow window: outside it the reaction either dies
   *  out or floods, and both are a still frame. */
  reactKill: number;
  /** Cell size of the simulation, in field texels per pattern feature. Larger
   *  is a coarser, slower pattern. */
  reactScale: number;

  // --- Time ------------------------------------------------------------------
  /**
   * Slit-scan: the frame stops being an image and becomes a solid of time. Each
   * pixel is read from a different frame of a ring of recent history, so the
   * picture is a *cut through* the run rather than a moment of it.
   *
   * Identity at zero because the nearest slice is the previous frame, and the
   * slices blend rather than step, so ramping in is a shear of the picture into
   * depth instead of a stack of visible bands arriving.
   */
  slit: number;
  /** What chooses the slice: 0 is the vertical axis (the classic slit-scan),
   *  1 is radius from centre — a literal tunnel through time. */
  slitAxis: number;
  /** Blends the geometric choice above toward luminance, so the frame melts at
   *  different rates by brightness rather than by position. */
  slitLuma: number;
  /** How far back the far end of the ramp reaches, as a fraction of the whole
   *  ring. Low is a shear, high is seconds of the run in one frame. */
  slitDepth: number;

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
  /**
   * Highlight spread, read out of a thresholded and blurred copy of the scene.
   *
   * Energy-normalised, which for this engine is not a refinement but the
   * condition of it existing at all: the feedback path accumulates with `max()`,
   * so anything that adds light to a bright frame re-opens the washout `bd1d4c5`
   * closed. The highlight is therefore *debited* exactly what the spread around
   * it is credited — a blur preserves its input's mean, so the two cancel and
   * the frame's total light is unchanged. A blooming highlight here gets dimmer
   * as it grows, which is also what a real lens does.
   */
  bloom: number;
  /** Tone above which a pixel is treated as a highlight and starts to spread. */
  bloomThreshold: number;
  /** Radius of the spread, in fractions of the frame's short edge. */
  bloomRadius: number;

  // --- Print ----------------------------------------------------------------
  // On-theme, and mostly one step from `halftone()`, which already screens CMY
  // at the classic print angles. These are the frame going *wrong at the press*
  // rather than going wrong in a shader, and they are the calmest additions in
  // the chain: a plate that has drifted a hundredth of a frame off register is
  // as loud as misregistration ever gets, and it cannot flash at all.
  /**
   * Plate misregistration. Each of C, M, Y and K is sampled at its own slowly
   * drifting offset before the inks recombine — a misfed press.
   *
   * The C, M and Y offsets are the existing per-channel split, because cyan
   * coverage *is* one minus red. K is the extra: the grey component is lifted out
   * of the three colour plates and printed from its own sample, which is what
   * makes the effect visible on black line art rather than only in the colour.
   */
  misreg: number;
  /** Furthest a plate drifts off register, in fractions of the frame. */
  misregSpread: number;
  /**
   * Moiré. Two dot screens a few degrees apart per plate instead of one: the
   * interference is enormous slow rosettes that swim as the angle between them
   * drifts, which is emergent structure out of two static things at the cost of
   * three extra `screenDot` calls. Only read when `halftone` is up.
   */
  moire: number;
  /** Half-angle between the two screens, radians at full amount. Small: the
   *  rosettes are largest when the screens nearly agree, and past a few degrees
   *  the interference is finer than the dots and reads as noise. */
  moireSpread: number;
  /**
   * Living Ben-Day: the dot screen's cell coordinates follow the distorted
   * frame rather than sitting on a grid pinned to the glass, so the dots flow
   * with whatever is bending the picture instead of the picture sliding under a
   * static screen.
   */
  benday: number;
  /**
   * Kirby Krackle. Highlights are thresholded and filled with the cells of a
   * worley lattice, leaving black blobs with bright rims in the hot areas —
   * cosmic energy fields, straight out of the source material.
   */
  krackle: number;
  /** Cells across the frame. */
  krackleScale: number;
  /** Tone above which the blobs start to appear. */
  krackleThreshold: number;
  /**
   * Ink bleed: darks dilated slightly, the way ink spreads into absorbent stock.
   * Grounds the wilder effects — the frame reads as print going strange rather
   * than as a shader demo — which is why it is worth four extra taps.
   */
  bleed: number;
  /** Dilation radius, in pixels of the render target. */
  bleedRadius: number;
  /** Newsprint stock: stretched fibre in two directions, and the cream cast of
   *  paper that was never white. Static, so it can carry any amount. */
  paper: number;

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
  /** Travel of the vertex displacement wave through the formation. */
  swell: number;
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
  /**
   * Which way the composition is currently moving, radians — the heading the
   * flow field is fed along.
   *
   * Derived rather than authored, like `phases`, and for the same reason it is
   * here rather than in `post`: it is read off the parameter drift's own heading
   * channel, which is the whole point. A flow field pushed on a schedule of its
   * own would be the second motion §6 rules out; pushed along the current the
   * layers are already drifting on, the smear and the composition agree.
   */
  flowAngle: number;
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
