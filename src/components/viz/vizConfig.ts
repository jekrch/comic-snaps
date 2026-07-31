import type { PostParams, StageKind } from "./engine/types";

/**
 * Which rendering path the piece runs on. "flat" is the drift stack and the
 * whole engine as it was: shards composited on one quad, everything else done
 * to the frame afterwards. The others are the spatial scenes, where the
 * composition is quads in a real projection instead.
 *
 * A kind rather than a number because there is nothing in between the two. It
 * is the one field a mode switch cannot cross-fade, and it is handled
 * explicitly everywhere the numeric fields are handled generically.
 */
export type StageMode = "flat" | StageKind;

/**
 * Order matters beyond the listing: a mode's index here is its code in an
 * encoded `vizcfg` token, so this is append-only — see `vizUrl.ts`.
 *
 * Four of these were reworked rather than added, and each one took the slot of
 * the scene it replaced: `prism` where `swarm` was, `drape` where `sheet` was,
 * `band` where `ribbons` was, `shatter` where `motes` was, and `vault`
 * untouched at its own index. So a link shared before the rework still decodes
 * to the scene that now occupies that slot — which is exactly what a reader
 * following an old `vizcfg` link should get, and the closest thing to
 * append-only available when the entries themselves were replaced in place.
 */
export const STAGE_MODES: StageMode[] = ["flat", "prism", "vault", "drape", "band", "shatter"];

export function isStageMode(value: unknown): value is StageMode {
  return typeof value === "string" && (STAGE_MODES as string[]).includes(value);
}

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
  /**
   * How strongly each layer is levelled toward a common key before it blends,
   * 0..1. At 0 panels composite at the brightness they were drawn at, which is
   * what lets a wall of white comic pages screen the frame to blank; at 1 a
   * bright page is brought all the way down to the target key.
   */
  keyBalance: number;
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
  /**
   * How far the composition's own parameters wander from the ones authored
   * here, 0..1. Distinct from `psychedelia`, which adds effects on top of a
   * piece holding still: this moves the piece itself — fold depth and count,
   * which way the symmetry turns, how far layers zoom, pan and rotate — so a
   * mode using it never settles at one appearance. Inert at 0.
   */
  wander: number;
  /** Rate of that drift, 1 = as authored. */
  wanderRate: number;

  // --- The spatial stage ----------------------------------------------------
  // Read only when `stageKind` is not "flat". Kept at the top level rather than
  // nested so the tuning panel and the JSON clamp reach them the same way they
  // reach everything else.
  stageKind: StageMode;
  /**
   * Multiplier on how many quads a formation is built from, against the counts
   * the scene asked for.
   *
   * 1 is the scene as authored — a few panels wearing a few large crops each,
   * which is the whole design of these formations. This exists to be turned
   * *down* as readily as up: the failure mode it guards against is the frame
   * filling with small panels until the shape is texture and no single page can
   * be read. Moving it rebuilds the arrangement, so it is a tuning knob rather
   * than something to animate.
   *
   * Deliberately does not touch how many *panels* are resident. That number is
   * how many images are on screen at once, every scene has chosen it carefully,
   * and a slider that multiplied it would undo all of them at the first drag.
   * A scene with no quads at all is unaffected by this entirely, which is now
   * most of them: only `shatter` arranges instances, and only for the shards
   * that have broken off its body. Everything else on the spatial path is one
   * continuous surface, which has no instance count to be a multiple of.
   */
  stageDensity: number;
  /** Global multiplier on size: a quad's, for the one scene that has them, and
   *  the whole object's for the scenes that are a surface — a wider corridor, a
   *  larger body, a broader band. */
  stageScale: number;
  /** Added to the edge softness each scene asks for, in a quad's own uv. Up is a
   *  formation of dissolving shapes; 0 leaves every scene at its own choice. */
  stageFeather: number;
  /** Peak opacity of one slot. The washout governor for this path: the quads
   *  composite additively, so this multiplies straight into frame luminance. */
  stageOpacity: number;
  /** Where the formation sits between its two arrangements, 0..1. The swing
   *  around it is whatever headroom is left on the nearer side, so 0 and 1 are
   *  each a formation held still and 0.5 is the full fold. */
  stageMorph: number;
  /** Rate of that swing, cycles per clock second. */
  stageMorphRate: number;
  /** How strongly quads turn to face the camera. 0 leaves them lying on the
   *  formation's own surface — wallpaper — and 1 is a swarm of billboards. */
  stageBillboard: number;
  /** Rate of the per-instance opacity breath, radians per clock second. */
  stageBreathe: number;
  /** Vertical field of view, degrees. Wide is a fisheye flight; narrow
   *  flattens the formation toward the arrangement the flat path could do. */
  stageFov: number;
  /** Turn of the whole formation, radians per clock second. Signed; integrated
   *  into `VizPhases.orbit` for the same reason as every other spin here. */
  stageSpin: number;
  /** Flight through a repeating formation, units per clock second. Signed;
   *  integrated into `VizPhases.travel`. Does nothing to one that does not
   *  repeat. */
  stageFlight: number;
  /** Solids drifting in the middle distance. Capped by the texture budget as
   *  well as by this — see `Stage.setScene`. */
  stageSolids: number;
  /** How strongly a quad's roll follows the formation's own along-direction
   *  rather than a world up. Only means anything to a formation with a
   *  direction — a ribbon — and is left at 0 by everything else. */
  stageAlign: number;
  /** Vertex displacement along each quad's normal, world units. The knob that
   *  lets a surface leave its own arrangement and pass through another. */
  stageDisplace: number;
  /** Travel of that wave, world units per clock second. Signed; integrated
   *  into `VizPhases.swell`. */
  stageDisplaceRate: number;
  /** Curl-noise scatter, world units. Divergence-free, so it reads as a current
   *  through the formation rather than as per-quad jitter. */
  stageSwirl: number;

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
  feedbackDroste: 0,
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
  droste: 0,
  drosteInner: 0.06,
  drostePeriod: 1.9,
  drosteTwist: 0,
  // Slow enough that a repeat takes the better part of a minute to arrive.
  drosteSpin: 0.04,
  tunnel: 0,
  tunnelDepth: 0.35,
  tunnelSpin: 0.05,
  kaleido: 0,
  kaleidoSegments: 6,
  // The slow intrinsic turn that makes a fold legible as a fold rather than as
  // wallpaper. Only read when `kaleido` is up.
  kaleidoSpin: 0.06,
  tile: 0,
  fold: 0,
  foldScale: 1.22,
  foldOffsetX: 0.62,
  foldOffsetY: 0.34,
  foldSpin: 0.03,
  lattice: 0,
  latticeScale: 3,
  warp: 0,
  warpScale: 2.4,
  warpSpeed: 0.35,
  ripple: 0,
  rippleFreq: 16,
  twist: 0,
  bulge: 0,
  quasi: 0,
  quasiFreq: 14,
  turbulence: 0,
  turbulenceScale: 2.2,
  turbulenceSpeed: 0.12,
  flow: 0,
  flowScale: 2.6,
  // High retention. The field is what carries the effect's slowness, and at low
  // decay it restates itself every second and reads as a boil instead.
  flowDecay: 0.97,
  react: 0,
  // Mitosis: the window where Gray-Scott makes dividing blobs rather than
  // either dying out or flooding. The interesting values are all within a few
  // thousandths of these.
  reactFeed: 0.037,
  reactKill: 0.062,
  reactScale: 1.6,
  slit: 0,
  slitAxis: 0,
  slitLuma: 0,
  slitDepth: 0.6,
  disperse: 0,
  blur: 0,
  blurSpin: 0,
  bloom: 0,
  bloomThreshold: 0.68,
  bloomRadius: 0.02,
  misreg: 0,
  misregSpread: 0.006,
  moire: 0,
  moireSpread: 0.09,
  benday: 0,
  krackle: 0,
  krackleScale: 26,
  krackleThreshold: 0.62,
  bleed: 0,
  bleedRadius: 1.6,
  paper: 0,
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
  keyBalance: 0.75,
  beat: 2,
  speed: 1,
  psychedelia: 0,
  cycleInterval: 14,
  wander: 0,
  wanderRate: 1,
  stageKind: "flat",
  stageDensity: 1,
  stageScale: 1,
  stageFeather: 0,
  stageOpacity: 0.55,
  stageMorph: 0.5,
  // A little under five minutes for the round trip. The formation is the largest
  // thing on screen, so it is held to the slowest rate in the engine — this is
  // the piece becoming something else, not an animation. Halved along with the
  // spins when the formations became a few large pages: at these sizes there is
  // something to read in every frame, and the rates that suited a crowd of small
  // crops hurried all of it past.
  stageMorphRate: 0.0035,
  stageBillboard: 0.75,
  stageBreathe: 0.08,
  stageFov: 55,
  stageSpin: 0.022,
  stageFlight: 0.8,
  stageSolids: 2,
  stageAlign: 0,
  stageDisplace: 0,
  stageDisplaceRate: 0.12,
  stageSwirl: 0,
  post: { ...DEFAULT_POST },
  // Heavily toward the wildcard. Every preset inherits this, so what a run shows
  // next is mostly unrelated to what it is showing now — the gallery read wide
  // rather than as a chain of near-neighbours.
  //
  // The other three are held low but deliberately *not* zero. They are the axes
  // a viewer tunes along, and a weight of 0 is a slider that has to be moved off
  // its end before it does anything; at 0.1 each the affinities are still
  // present in the mix and raising one is a change of degree.
  weights: { rhyme: 0.1, clash: 0.1, color: 0.1, random: 0.7 },
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

export type ConfigGroup =
  | "stack"
  | "motion"
  | "post"
  | "shape"
  | "field"
  | "optics"
  | "print"
  | "cycle"
  | "stage"
  | "director";

export interface ConfigField {
  group: ConfigGroup;
  /** Dotted path, matching the shape emitted by the tuning panel's JSON. */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** One line of plain English for the tuning panel's tooltip. May be empty. */
  hint: string;
  get: (config: VizConfig) => number;
  set: (config: VizConfig, value: number) => void;
}

/**
 * What each slider does, in the terms someone watching the frame would use
 * rather than the terms the shader does. Keyed by path and looked up by
 * `field()` so the table below stays one line per tunable — a hint missing
 * here is simply a slider with no tooltip, not a broken one.
 */
const HINTS: Record<string, string> = {
  layerCount: "How many full-bleed panels are composited at once.",
  layerLifetime: "Seconds a panel stays on screen before it is retired.",
  layerLifetimeJitter: "Spread in those lifetimes, so layers don't all turn over together.",
  crossfade: "How much of a panel's life is spent fading in and out.",
  layerOpacity: "Peak strength of the panels stacked over the base one.",
  beat: "The grid discrete events snap to, in seconds.",
  keyBalance: "How hard bright pages are levelled toward a common tone. The guard against a white-out.",

  speed: "Rate of the whole composition clock — moves every other timing with it.",
  zoomAmount: "How far a panel zooms over its life.",
  panAmount: "How far a panel drifts across the frame.",
  rotateAmount: "How far a panel is allowed to tilt as it drifts.",
  tintAmount: "How strongly each layer is pushed toward its complementary colour.",

  "post.feedbackAmount": "How much of the last frame is kept, smearing motion into trails.",
  "post.feedbackScale": "Zoom on the kept frame each pass — over 1 pushes the trails outward.",
  "post.feedbackRotate": "Turn on the kept frame each pass, so the trails spiral.",
  "post.feedbackDroste": "Bends the feedback into a corridor receding into itself.",
  "post.halftone": "Dot screen over the frame, the way printed ink lays down.",
  "post.halftoneScale": "Size of those dots.",
  "post.chroma": "Colour fringing toward the edges, as if the lens split the light.",
  "post.posterize": "Crushes the tones into flat bands of colour.",
  "post.grain": "Film grain over the frame.",
  "post.vignette": "Darkens the corners.",
  "post.exposure": "Overall brightness.",
  "post.hueShift": "Rotates every colour around the wheel.",
  "post.solarize": "Inverts the brightest tones — a burnt, photographic reversal.",

  "post.kaleido": "Mirrors the frame into a kaleidoscope.",
  "post.kaleidoSegments": "How many mirrored wedges.",
  "post.kaleidoSpin": "How fast the kaleidoscope turns.",
  "post.tile": "Repeats the frame as a mirrored grid.",
  "post.tunnel": "Bends the frame into a tube receding away from you.",
  "post.tunnelDepth": "How far back the tube goes.",
  "post.tunnelSpin": "How fast the tube rotates.",
  "post.fold": "Folds the frame back over itself, again and again.",
  "post.foldScale": "Zoom applied at each fold.",
  "post.foldOffsetX": "Where the fold is centred, left to right.",
  "post.foldOffsetY": "Where the fold is centred, top to bottom.",
  "post.foldSpin": "How fast the fold turns.",
  "post.lattice": "Wraps the frame into a repeating grid of cells.",
  "post.latticeScale": "How many cells across.",
  "post.droste": "Recursion: the frame inside itself, without end.",
  "post.drosteInner": "Size of the hole the recursion falls into.",
  "post.drostePeriod": "How much zoom fits between one repeat and the next.",
  "post.drosteTwist": "Winds the recursion into a spiral.",
  "post.drosteSpin": "How fast the recursion drifts inward.",
  "post.warp": "Pushes the frame around with smooth noise.",
  "post.warpScale": "Size of the warp — low is broad swells, high is fine churn.",
  "post.warpSpeed": "How fast the warp moves.",
  "post.ripple": "Rings rippling out from the centre.",
  "post.rippleFreq": "How tightly packed those rings are.",
  "post.twist": "Rotates the frame more the further out you go.",
  "post.bulge": "Pushes the centre toward you, or away, like a lens.",
  "post.quasi": "Lays a quasicrystal interference pattern over the frame.",
  "post.quasiFreq": "How fine that pattern is.",
  "post.turbulence": "Churns the frame with layered noise.",
  "post.turbulenceScale": "Size of the churn.",
  "post.turbulenceSpeed": "How fast it churns.",

  "post.flow": "Drags the frame along a current that remembers where it has been.",
  "post.flowScale": "Size of the eddies in that current.",
  "post.flowDecay": "How long the current holds its history. High is slow and smooth.",
  "post.react": "A dividing, cell-like growth displaces the frame.",
  "post.reactFeed": "How fast that growth spreads.",
  "post.reactKill": "How fast it dies back. Works against feed to set the pattern.",
  "post.reactScale": "Size of the cells.",
  "post.slit": "Each slice of the frame is taken from a different moment.",
  "post.slitAxis": "Whether the scan runs down the frame or across it.",
  "post.slitLuma": "Take the delay from brightness rather than from position.",
  "post.slitDepth": "How far back in time the oldest slice comes from.",

  "post.disperse": "Splits the frame into its colours, like a prism.",
  "post.blur": "Blur streaking out from the centre.",
  "post.blurSpin": "Bends that streak into a spin around the centre.",
  "post.bloom": "Glow bleeding out of the brightest areas.",
  "post.bloomThreshold": "How bright an area has to be before it glows.",
  "post.bloomRadius": "How far the glow spreads.",

  "post.misreg": "Colour plates printed off-register.",
  "post.misregSpread": "How far the plates drift apart.",
  "post.moire": "Interference between overlaid print screens.",
  "post.moireSpread": "How far those screens are turned from each other.",
  "post.benday": "Ben-Day dots that shift and breathe rather than sit still.",
  "post.krackle": "Kirby crackle — blots of black energy over the frame.",
  "post.krackleScale": "Size of the crackle cells.",
  "post.krackleThreshold": "How much of the frame the crackle covers.",
  "post.bleed": "Ink spreading into the paper, softening the darks.",
  "post.bleedRadius": "How far the ink spreads.",
  "post.paper": "Newsprint texture and warmth over everything.",

  psychedelia: "How eagerly the piece turns effects on and off by itself.",
  cycleInterval: "Average seconds between one of those effects and the next.",
  wander: "How far the composition drifts from the settings on this panel.",
  wanderRate: "How fast that drift moves.",

  stageDensity: "How many pages a formation is built from. Down for fewer, larger crops.",
  stageScale: "Size of the formation, or of its pages where it has them.",
  stageFeather: "Softness of each page's edge.",
  stageOpacity: "Strength of each page. The main guard against a washed-out frame.",
  stageMorph: "Where the formation sits between its two shapes.",
  stageMorphRate: "How fast it swings between them.",
  stageBillboard: "How strongly pages turn to face you instead of lying on the surface.",
  stageBreathe: "Rate of the slow fade in and out of each page.",
  stageFov: "Camera field of view. Wide is a fisheye, narrow flattens the formation.",
  stageSpin: "How fast the whole formation turns.",
  stageFlight: "How fast the camera flies through it.",
  stageSolids: "Loose panels drifting in the middle distance.",
  stageAlign: "How strongly pages follow the direction of a curving formation.",
  stageDisplace: "Pushes the surface out along its own normal, in waves.",
  stageDisplaceRate: "How fast that wave travels.",
  stageSwirl: "A current running through the formation, scattering it.",

  "weights.rhyme": "Favour a next panel that echoes the one on screen.",
  "weights.clash": "Favour one that cuts against it.",
  "weights.color": "Favour one close to it in colour.",
  "weights.random": "Favour a wildcard, unrelated to what is showing.",
};

/** Section blurbs for the tuning panel, on the same principle as `HINTS`. */
export const GROUP_HINTS: Record<ConfigGroup, string> = {
  stack: "The stack of full-bleed panels the flat path composites.",
  motion: "How panels drift, zoom and turn — and how fast the clock runs.",
  post: "Treatments over the finished frame: trails, tone and colour.",
  shape: "Distortions that re-map where the frame is drawn — folds, tunnels, mirrors.",
  field: "Displacements driven by a simulation that carries its own history.",
  optics: "Lens behaviour: dispersion, radial blur and bloom.",
  print: "Comic-press artefacts — plates, screens, ink and paper.",
  cycle: "How much the piece changes itself while it runs.",
  stage: "The 3D formations. Ignored while the mode is a flat one.",
  director: "What the engine looks for when it picks the next panel.",
};

const field = (
  group: ConfigGroup,
  path: string,
  label: string,
  min: number,
  max: number,
  step: number,
  get: ConfigField["get"],
  set: ConfigField["set"]
): ConfigField => ({ group, path, label, min, max, step, hint: HINTS[path] ?? "", get, set });

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
  field("stack", "keyBalance", "key balance", 0, 1, 0.01, (c) => c.keyBalance, (c, v) => (c.keyBalance = v)),

  field("motion", "speed", "speed", VIZ_MIN_SPEED, VIZ_MAX_SPEED, 0.05, (c) => c.speed, (c, v) => (c.speed = v)),
  field("motion", "zoomAmount", "zoom", 1, 2.5, 0.01, (c) => c.zoomAmount, (c, v) => (c.zoomAmount = v)),
  field("motion", "panAmount", "pan", 0, 0.45, 0.005, (c) => c.panAmount, (c, v) => (c.panAmount = v)),
  field("motion", "rotateAmount", "rotate", 0, 0.35, 0.005, (c) => c.rotateAmount, (c, v) => (c.rotateAmount = v)),
  field("motion", "tintAmount", "tint", 0, 1, 0.01, (c) => c.tintAmount, (c, v) => (c.tintAmount = v)),

  field("post", "post.feedbackAmount", "feedback", 0, 0.98, 0.01, (c) => c.post.feedbackAmount, (c, v) => (c.post.feedbackAmount = v)),
  field("post", "post.feedbackScale", "fb scale", 0.97, 1.05, 0.001, (c) => c.post.feedbackScale, (c, v) => (c.post.feedbackScale = v)),
  field("post", "post.feedbackRotate", "fb spin", -0.02, 0.02, 0.0005, (c) => c.post.feedbackRotate, (c, v) => (c.post.feedbackRotate = v)),
  field("post", "post.feedbackDroste", "fb corridor", 0, 1, 0.01, (c) => c.post.feedbackDroste, (c, v) => (c.post.feedbackDroste = v)),
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
  field("shape", "post.kaleidoSpin", "kaleido spin", -0.4, 0.4, 0.005, (c) => c.post.kaleidoSpin, (c, v) => (c.post.kaleidoSpin = v)),
  field("shape", "post.tile", "tile", 0, 1, 0.01, (c) => c.post.tile, (c, v) => (c.post.tile = v)),
  field("shape", "post.fold", "fold", 0, 1, 0.01, (c) => c.post.fold, (c, v) => (c.post.fold = v)),
  field("shape", "post.foldScale", "fold zoom", 1, 1.6, 0.01, (c) => c.post.foldScale, (c, v) => (c.post.foldScale = v)),
  field("shape", "post.foldOffsetX", "fold x", -1.5, 1.5, 0.01, (c) => c.post.foldOffsetX, (c, v) => (c.post.foldOffsetX = v)),
  field("shape", "post.foldOffsetY", "fold y", -1.5, 1.5, 0.01, (c) => c.post.foldOffsetY, (c, v) => (c.post.foldOffsetY = v)),
  field("shape", "post.foldSpin", "fold spin", -0.2, 0.2, 0.005, (c) => c.post.foldSpin, (c, v) => (c.post.foldSpin = v)),
  field("shape", "post.lattice", "lattice", 0, 1, 0.01, (c) => c.post.lattice, (c, v) => (c.post.lattice = v)),
  field("shape", "post.latticeScale", "lattice cells", 1, 8, 0.1, (c) => c.post.latticeScale, (c, v) => (c.post.latticeScale = v)),
  field("shape", "post.droste", "droste", 0, 1, 0.01, (c) => c.post.droste, (c, v) => (c.post.droste = v)),
  field("shape", "post.drosteInner", "droste inner", 0.02, 0.25, 0.005, (c) => c.post.drosteInner, (c, v) => (c.post.drosteInner = v)),
  field("shape", "post.drostePeriod", "droste period", 0.4, 3, 0.05, (c) => c.post.drostePeriod, (c, v) => (c.post.drostePeriod = v)),
  field("shape", "post.drosteTwist", "droste twist", -3, 3, 1, (c) => c.post.drosteTwist, (c, v) => (c.post.drosteTwist = v)),
  field("shape", "post.drosteSpin", "droste rate", -0.25, 0.25, 0.005, (c) => c.post.drosteSpin, (c, v) => (c.post.drosteSpin = v)),
  field("shape", "post.tunnel", "tunnel", 0, 1, 0.01, (c) => c.post.tunnel, (c, v) => (c.post.tunnel = v)),
  // Capped well below where the arithmetic breaks: depth over the radius floor
  // is how many rings deep the tube goes, and past about eight they alias into
  // a shimmer no ramp can make calm.
  field("shape", "post.tunnelDepth", "tunnel depth", 0.05, 0.5, 0.01, (c) => c.post.tunnelDepth, (c, v) => (c.post.tunnelDepth = v)),
  field("shape", "post.tunnelSpin", "tunnel rate", -0.3, 0.3, 0.005, (c) => c.post.tunnelSpin, (c, v) => (c.post.tunnelSpin = v)),
  field("shape", "post.warp", "warp", 0, 1, 0.01, (c) => c.post.warp, (c, v) => (c.post.warp = v)),
  field("shape", "post.warpScale", "warp scale", 0.5, 8, 0.1, (c) => c.post.warpScale, (c, v) => (c.post.warpScale = v)),
  field("shape", "post.warpSpeed", "warp rate", 0, 2, 0.01, (c) => c.post.warpSpeed, (c, v) => (c.post.warpSpeed = v)),
  field("shape", "post.ripple", "ripple", 0, 1, 0.01, (c) => c.post.ripple, (c, v) => (c.post.ripple = v)),
  field("shape", "post.rippleFreq", "ripple freq", 2, 60, 1, (c) => c.post.rippleFreq, (c, v) => (c.post.rippleFreq = v)),
  field("shape", "post.twist", "twist", -1, 1, 0.01, (c) => c.post.twist, (c, v) => (c.post.twist = v)),
  field("shape", "post.bulge", "bulge", -1, 1, 0.01, (c) => c.post.bulge, (c, v) => (c.post.bulge = v)),
  field("shape", "post.quasi", "quasicrystal", 0, 1, 0.01, (c) => c.post.quasi, (c, v) => (c.post.quasi = v)),
  field("shape", "post.quasiFreq", "quasi freq", 3, 40, 0.5, (c) => c.post.quasiFreq, (c, v) => (c.post.quasiFreq = v)),
  field("shape", "post.turbulence", "turbulence", 0, 1, 0.01, (c) => c.post.turbulence, (c, v) => (c.post.turbulence = v)),
  field("shape", "post.turbulenceScale", "turb scale", 0.5, 6, 0.1, (c) => c.post.turbulenceScale, (c, v) => (c.post.turbulenceScale = v)),
  field("shape", "post.turbulenceSpeed", "turb rate", 0, 0.6, 0.005, (c) => c.post.turbulenceSpeed, (c, v) => (c.post.turbulenceSpeed = v)),

  // The buffer-backed displacements. Both are simulations rather than formulas,
  // so what is tunable here is the field's own character; how fast it moves is
  // not on offer, because a field carries its own history and there is no rate
  // in it to raise.
  field("field", "post.flow", "flow", 0, 1, 0.01, (c) => c.post.flow, (c, v) => (c.post.flow = v)),
  field("field", "post.flowScale", "flow scale", 0.5, 8, 0.1, (c) => c.post.flowScale, (c, v) => (c.post.flowScale = v)),
  field("field", "post.flowDecay", "flow hold", 0.8, 0.995, 0.005, (c) => c.post.flowDecay, (c, v) => (c.post.flowDecay = v)),
  field("field", "post.react", "reaction", 0, 1, 0.01, (c) => c.post.react, (c, v) => (c.post.react = v)),
  // Narrow on purpose. Outside roughly these bounds Gray-Scott either dies back
  // to a flat field or floods it, and both are a displacement map that does not
  // move — so the sliders only reach the range where there is a pattern at all.
  field("field", "post.reactFeed", "feed", 0.02, 0.06, 0.001, (c) => c.post.reactFeed, (c, v) => (c.post.reactFeed = v)),
  field("field", "post.reactKill", "kill", 0.05, 0.07, 0.0005, (c) => c.post.reactKill, (c, v) => (c.post.reactKill = v)),
  // Floored at 1: the stencil is in texels and cannot be narrower than one, so
  // the shader clamps it there anyway and a slider reaching below would be a
  // stretch of travel that did nothing.
  field("field", "post.reactScale", "cell size", 1, 3, 0.05, (c) => c.post.reactScale, (c, v) => (c.post.reactScale = v)),
  field("field", "post.slit", "slit-scan", 0, 1, 0.01, (c) => c.post.slit, (c, v) => (c.post.slit = v)),
  field("field", "post.slitAxis", "slit axis", 0, 1, 0.01, (c) => c.post.slitAxis, (c, v) => (c.post.slitAxis = v)),
  field("field", "post.slitLuma", "slit by tone", 0, 1, 0.01, (c) => c.post.slitLuma, (c, v) => (c.post.slitLuma = v)),
  field("field", "post.slitDepth", "slit depth", 0.05, 1, 0.01, (c) => c.post.slitDepth, (c, v) => (c.post.slitDepth = v)),

  field("optics", "post.disperse", "dispersion", 0, 0.6, 0.005, (c) => c.post.disperse, (c, v) => (c.post.disperse = v)),
  field("optics", "post.blur", "radial blur", 0, 1, 0.01, (c) => c.post.blur, (c, v) => (c.post.blur = v)),
  field("optics", "post.blurSpin", "blur spin", 0, 1, 0.01, (c) => c.post.blurSpin, (c, v) => (c.post.blurSpin = v)),
  // Capped well under 1. The spread is energy-normalised so it cannot bleach
  // the frame, but at full strength a highlight is debited its whole self and
  // the picture reads as a negative of its own glow.
  field("optics", "post.bloom", "bloom", 0, 0.7, 0.01, (c) => c.post.bloom, (c, v) => (c.post.bloom = v)),
  field("optics", "post.bloomThreshold", "bloom knee", 0.4, 0.95, 0.01, (c) => c.post.bloomThreshold, (c, v) => (c.post.bloomThreshold = v)),
  field("optics", "post.bloomRadius", "bloom radius", 0.004, 0.06, 0.002, (c) => c.post.bloomRadius, (c, v) => (c.post.bloomRadius = v)),

  field("print", "post.misreg", "misregister", 0, 1, 0.01, (c) => c.post.misreg, (c, v) => (c.post.misreg = v)),
  field("print", "post.misregSpread", "plate drift", 0, 0.02, 0.0005, (c) => c.post.misregSpread, (c, v) => (c.post.misregSpread = v)),
  field("print", "post.moire", "moire", 0, 1, 0.01, (c) => c.post.moire, (c, v) => (c.post.moire = v)),
  field("print", "post.moireSpread", "screen delta", 0, 0.35, 0.005, (c) => c.post.moireSpread, (c, v) => (c.post.moireSpread = v)),
  field("print", "post.benday", "living ben-day", 0, 1, 0.01, (c) => c.post.benday, (c, v) => (c.post.benday = v)),
  field("print", "post.krackle", "krackle", 0, 1, 0.01, (c) => c.post.krackle, (c, v) => (c.post.krackle = v)),
  field("print", "post.krackleScale", "krackle cells", 6, 70, 1, (c) => c.post.krackleScale, (c, v) => (c.post.krackleScale = v)),
  field("print", "post.krackleThreshold", "krackle knee", 0.25, 0.95, 0.01, (c) => c.post.krackleThreshold, (c, v) => (c.post.krackleThreshold = v)),
  field("print", "post.bleed", "ink bleed", 0, 1, 0.01, (c) => c.post.bleed, (c, v) => (c.post.bleed = v)),
  field("print", "post.bleedRadius", "bleed radius", 0.5, 4, 0.1, (c) => c.post.bleedRadius, (c, v) => (c.post.bleedRadius = v)),
  field("print", "post.paper", "newsprint", 0, 1, 0.01, (c) => c.post.paper, (c, v) => (c.post.paper = v)),

  field("cycle", "psychedelia", "psychedelia", 0, 1, 0.01, (c) => c.psychedelia, (c, v) => (c.psychedelia = v)),
  field("cycle", "cycleInterval", "interval", 3, 60, 1, (c) => c.cycleInterval, (c, v) => (c.cycleInterval = v)),
  field("cycle", "wander", "wander", 0, 1, 0.01, (c) => c.wander, (c, v) => (c.wander = v)),
  field("cycle", "wanderRate", "wander rate", 0.2, 3, 0.05, (c) => c.wanderRate, (c, v) => (c.wanderRate = v)),

  // Inert unless `stageKind` is a spatial one, which is not a slider — see the
  // note on StageMode. The rest of the stage is tunable exactly like the flat
  // path, so `?vizdebug=1` reviews a formation the same way it reviews a fold.
  field("stage", "stageDensity", "quad count", 0.25, 4, 0.25, (c) => c.stageDensity, (c, v) => (c.stageDensity = v)),
  field("stage", "stageScale", "quad size", 0.3, 2.5, 0.01, (c) => c.stageScale, (c, v) => (c.stageScale = v)),
  field("stage", "stageFeather", "quad edge", 0, 0.4, 0.01, (c) => c.stageFeather, (c, v) => (c.stageFeather = v)),
  field("stage", "stageOpacity", "quad opacity", 0.05, 1, 0.01, (c) => c.stageOpacity, (c, v) => (c.stageOpacity = v)),
  field("stage", "stageMorph", "morph", 0, 1, 0.01, (c) => c.stageMorph, (c, v) => (c.stageMorph = v)),
  field("stage", "stageMorphRate", "morph rate", 0, 0.06, 0.001, (c) => c.stageMorphRate, (c, v) => (c.stageMorphRate = v)),
  field("stage", "stageBillboard", "billboard", 0, 1, 0.01, (c) => c.stageBillboard, (c, v) => (c.stageBillboard = v)),
  field("stage", "stageBreathe", "breath", 0, 0.6, 0.005, (c) => c.stageBreathe, (c, v) => (c.stageBreathe = v)),
  field("stage", "stageFov", "field of view", 25, 95, 1, (c) => c.stageFov, (c, v) => (c.stageFov = v)),
  field("stage", "stageSpin", "formation spin", -0.4, 0.4, 0.005, (c) => c.stageSpin, (c, v) => (c.stageSpin = v)),
  field("stage", "stageFlight", "flight", -4, 4, 0.05, (c) => c.stageFlight, (c, v) => (c.stageFlight = v)),
  field("stage", "stageSolids", "solids", 0, 4, 1, (c) => c.stageSolids, (c, v) => (c.stageSolids = v)),
  field("stage", "stageAlign", "align to curve", 0, 1, 0.01, (c) => c.stageAlign, (c, v) => (c.stageAlign = v)),
  field("stage", "stageDisplace", "displace", 0, 1.2, 0.01, (c) => c.stageDisplace, (c, v) => (c.stageDisplace = v)),
  field("stage", "stageDisplaceRate", "displace rate", -0.6, 0.6, 0.01, (c) => c.stageDisplaceRate, (c, v) => (c.stageDisplaceRate = v)),
  field("stage", "stageSwirl", "swirl", 0, 1.5, 0.01, (c) => c.stageSwirl, (c, v) => (c.stageSwirl = v)),

  field("director", "weights.rhyme", "rhyme", 0, 1, 0.01, (c) => c.weights.rhyme, (c, v) => (c.weights.rhyme = v)),
  field("director", "weights.clash", "clash", 0, 1, 0.01, (c) => c.weights.clash, (c, v) => (c.weights.clash = v)),
  field("director", "weights.color", "colour", 0, 1, 0.01, (c) => c.weights.color, (c, v) => (c.weights.color = v)),
  field("director", "weights.random", "random", 0, 1, 0.01, (c) => c.weights.random, (c, v) => (c.weights.random = v)),
];

/**
 * Fields a mode switch interpolates. Speed is deliberately left out: it is the
 * viewer's own control, and a preset carrying its authored rate back in would
 * take away a choice they had already made.
 */
const RAMP_FIELDS = CONFIG_FIELDS.filter((entry) => entry.path !== "speed");

/**
 * Write the `from`→`to` crossing at position `t` into `live`, in place. In
 * place because the engine holds the live config by reference and reads it
 * every frame, which is what lets a mode change arrive without restarting the
 * run — the layers already in flight carry on under the new parameters.
 */
export function lerpConfigInto(live: VizConfig, from: VizConfig, to: VizConfig, t: number): void {
  for (const entry of RAMP_FIELDS) {
    const start = entry.get(from);
    const value = start + (entry.get(to) - start) * t;
    // Whole-number fields (layer count, kaleido segments) have no meaningful
    // value in between, so they step rather than slide.
    entry.set(live, entry.step >= 1 ? Math.round(value) : value);
  }
  // The one field with nothing in between: there is no half-way between a flat
  // composite and a formation in perspective. Switched at the midpoint of the
  // ramp rather than at either end, so the cut lands where the crossfade has
  // both presets at half strength and is the least visible thing happening.
  live.stageKind = t < 0.5 ? from.stageKind : to.stageKind;
}

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

  // The one non-numeric tunable, so it is taken by hand. An unrecognised kind
  // is reported rather than applied, on the same principle as the rest: a typo
  // that silently ran the flat path would look like the config worked.
  if ("stageKind" in source) {
    if (isStageMode(source.stageKind)) config.stageKind = source.stageKind;
    else adjusted.push("stageKind");
  }

  // Surface stray top-level keys, and stray keys inside the two nested objects.
  for (const [key, value] of Object.entries(source)) {
    if (key === "stageKind") continue;
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
  /**
   * Ceiling on the panels a spatial formation may hold resident at once — its
   * slots and its solids together. Deliberately under `texturePoolSize`: the
   * panels queued to replace them have to decode somewhere, and a stage that
   * filled the pool would evict a slot that is on screen to make room for its
   * own successor.
   *
   * A ceiling rather than the count: what a formation actually asks for is
   * `SpatialScene.panels`, which is a compositional decision and comes out well
   * under this on every device. The cap only bites if the density knob is pushed.
   */
  stagePanels: number;
  /** Ceiling on the quads bound to each of those panels. Instances are a vertex
   *  cost rather than a fill one, so this is generous — but the scenes ask for a
   *  couple, because the cost that matters is legibility, not throughput. */
  stagePerSlot: number;
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
    stagePanels: mobile ? 5 : 13,
    // Room for the density knob to be pushed a long way past what the scenes ask
    // for, and no further. The real limit here is overdraw — every quad is
    // transparent, none of them occlude, and they are now large enough that a few
    // of them cover the frame — so the phone's ceiling is cut harder than its
    // pool size alone would suggest.
    stagePerSlot: mobile ? 10 : 20,
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
/**
 * How long a mode switch takes to cross from one preset to the next, in real
 * milliseconds. A mode change moves exactly the parameters MIN_EFFECT_RAMP
 * exists to govern — feedback, posterize, solarize, kaleido — so it is held to
 * the same floor instead of snapping the frame over to the new preset.
 */
export const MODE_SWITCH_MS = Math.max(1600, MIN_EFFECT_RAMP * 1000);
