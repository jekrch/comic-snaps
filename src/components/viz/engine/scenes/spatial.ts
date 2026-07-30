import type { VizConfig } from "../../vizConfig";
import type { Rng } from "../rng";
import type { ShellDraw, SlotLayout, SolidShape, StageKind, StageLayout, Vec3 } from "../types";

/**
 * The spatial scenes and the formation maths they share.
 *
 * A spatial scene is a *formation* rather than a spawner. Where `Scene.spawn`
 * hands back one shard at a time and the director keeps a handful alive, a
 * formation is built once — a few dozen quads, arranged — and then panels flow
 * through it while the arrangement itself only breathes.
 *
 * "A few dozen" is the governing constraint on everything below, and it is a
 * compositional one rather than a budget. These formations are *shapes made of
 * comic pages*: a ring, a corridor, three planes crossing, a band swept along a
 * curve. A shape reads as a shape only if its faces are large enough to be seen
 * as faces, so a scene asks for a handful of panels wearing a handful of quads
 * each and makes every quad a substantial piece of its page — near enough
 * full-bleed on the surface formations. Fill hundreds of small crops into the
 * same arrangement instead and the shape survives while the *imagery* does not:
 * the frame becomes a fine busy grain in which no single panel can be read.
 *
 * Every formation is authored as a *pair* of arrangements that the vertex
 * shader morphs between. It costs six floats an instance and it is the single
 * cheapest source of slow structural change in the engine: a spiral opening
 * into a sphere over a minute is one uniform moving, with no rebuild, no
 * respawn, and nothing discontinuous anywhere in it.
 */

/** The angle successive florets sit at on a sunflower head, and the reason a
 *  phyllotaxis spiral never lines up into spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * The two-dimensional R2 sequence, off the plastic number.
 *
 * Where the golden angle spreads points around a circle, this spreads them over
 * a square — and it is what the surface formations fill their sheets with. A grid
 * would show as a grid through the quads however large they were, and independent
 * random offsets clump and leave holes at these counts; a low-discrepancy
 * sequence does neither, and being a pure function of the index it keeps the two
 * arrangements of a pair in correspondence for free.
 */
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * The `index`-th point of the R2 sequence, offset half a step.
 *
 * The offset matters here in a way it would not at a hundred points: the raw
 * sequence starts at (0, 0), which is the corner of the cell, and with only two
 * or three quads on a plane that corner is not a rounding detail but one of the
 * few positions anything occupies. Half a step in puts the first quad on the
 * surface rather than hanging off its edge.
 */
function r2(index: number): [number, number] {
  return [fract((index + 0.5) * R2_X), fract((index + 0.5) * R2_Y)];
}

function norm(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Where one instance sits, which way it faces, and — for the formations that
 *  have a direction — which way is along it. */
export interface Placement {
  pos: Vec3;
  nrm: Vec3;
  /** Omitted by everything that is a scatter rather than a curve or a surface;
   *  `buildLayout` then derives one off the normal so the attribute is always
   *  present and the shader needs no second code path. */
  tan?: Vec3;
}

/** A roll for a placement that did not care about one. Any vector in the quad's
 *  plane will do — this is only ever read when the frame asks for alignment, and
 *  a formation with no direction has nothing to align to. */
function fallbackTangent(nrm: Vec3): Vec3 {
  const up: Vec3 = Math.abs(nrm[1]) > 0.94 ? [0, 0, 1] : [0, 1, 0];
  return norm(cross(up, norm(nrm)));
}

/**
 * A curve's placement, from the curve itself.
 *
 * The tangent is a finite difference rather than an analytic derivative: for a
 * Lissajous or a coil the derivative is no cheaper to write and much easier to
 * get wrong, and this is built once per instance at layout time.
 */
export function alongCurve(at: (s: number) => Vec3, s: number, step = 0.004): Placement {
  const pos = at(s);
  const ahead = at(s + step);
  const tan = norm([ahead[0] - pos[0], ahead[1] - pos[1], ahead[2] - pos[2]]);
  // The strip needs a face as well as a direction. Any consistent choice will
  // do, and the world up is the one that keeps a ribbon lying flat enough to be
  // read as a surface rather than seen edge-on.
  const up: Vec3 = Math.abs(tan[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  return { pos, nrm: norm(cross(tan, up)), tan };
}

/**
 * One arrangement. `t` runs 0..1 across the whole formation in index order,
 * which is what lets the two arrangements in a pair stay in correspondence:
 * instance `i` is the same instance in both, so the morph moves it rather than
 * dissolving one set of quads into another.
 */
export type Formation = (t: number, index: number) => Placement;

export interface SpatialContext {
  /** Panels the formation holds resident at once — the stage's answer to the
   *  scene's `panels` request, after the device budget and the density knob. */
  slots: number;
  /** Quads bound to each of those panels. */
  perSlot: number;
  rng: Rng;
}

/** A solid before the director has decided which panel it wears. */
export interface SolidPlacement {
  shape: SolidShape;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
}

/** Everything a formation decides per frame, given the clock and the config. */
export interface SpatialFrameParams {
  morph: number;
  billboard: number;
  /** How strongly a quad's roll follows the formation's own tangent. Left at 0
   *  by any formation that is a scatter rather than a curve. */
  align: number;
  scale: number;
  /** Edge softness of a quad in its own uv, 0..0.5. Clamped by the stage. */
  feather: number;
  breathe: number;
  /** Vertex displacement along each quad's normal, world units. */
  displace: number;
  displaceScale: number;
  /** The integral of the displacement rate — `VizPhases.swell`, passed through
   *  so a formation can scale it but never has to accumulate it. */
  displacePhase: number;
  /** Curl-noise scatter, world units. */
  swirl: number;
  swirlScale: number;
  spin: Vec3;
  eye: Vec3;
  look: Vec3;
  fov: number;
  wrap: number;
  fogNear: number;
  fogFar: number;
  /** The wallpaper tube, for the scene that is a surface rather than a set of
   *  quads. Null everywhere else, which is most of them. */
  shell: ShellDraw | null;
  solids: SolidPlacement[];
}

/**
 * The clock, in the two integrated forms a formation moves on.
 *
 * `travel` and `orbit` are accumulated by the director from the config's rates
 * rather than evaluated as `rate * time`, for the same reason every other spin
 * in the engine is: a rate the drift or a mode change is moving has to bend the
 * motion, not teleport it.
 */
export interface SpatialFrameContext {
  time: number;
  /** Distance through the formation, in its own units. */
  travel: number;
  /** Accumulated turn of the formation, radians. */
  orbit: number;
  /** Accumulated travel of the displacement wave, world units. */
  swell: number;
  /** Solids the stage actually has panels bound for. The config asks for a
   *  count; this is what the texture budget could afford, and the scene must
   *  not place more than it. */
  solidBudget: number;
  config: VizConfig;
}

export interface SpatialFormation {
  layout: StageLayout;
  frame(ctx: SpatialFrameContext): SpatialFrameParams;
}

export interface SpatialScene {
  readonly name: string;
  readonly kind: StageKind;
  /**
   * Panels on screen at once — the scene's own answer to "how many", not the
   * device's.
   *
   * It was the device's, and that was the wrong owner: a cap says how many
   * panels can be *afforded*, and the interesting number is how many the shape
   * can carry before it stops being one. Three large pages arranged in depth is
   * a composition; the same arrangement filled to the budget is a mosaic that
   * happens to be three-dimensional. The stage still clamps this to what the
   * texture pool can hold, so a phone gets the shape rather than a share of it.
   */
  readonly panels: number;
  /**
   * Quads bound to each of those panels. Low everywhere, and lowest on the
   * formations whose quads are meant to meet into a surface: a plane built of
   * one big crop is a page leaning in space, where one built of forty is a
   * texture of comic.
   *
   * Zero is legal and means the scene has no quads at all — its surface is a
   * shell, and a shell has no rim to be one of many.
   */
  readonly perPanel: number;
  /**
   * Whether the slots take turns instead of overlapping.
   *
   * Concurrent — the default — is right whenever the slots occupy *different*
   * parts of the frame: a page fading up somewhere in a formation while another
   * fades down is a page turning over, and the two being visible at once is the
   * composition rather than a compromise.
   *
   * It is exactly wrong when every slot paints the same surface. Two slots
   * crossfading on one tube wall are not two pages in a formation; they are two
   * pages *on top of each other*, and a wallpaper made of one image is the entire
   * point of that scene. Sequential residency gives each panel the surface to
   * itself for the whole of its dwell, with the outgoing and incoming fades
   * abutting so the handover is a dissolve and the total light never moves.
   */
  readonly sequential?: boolean;
  /**
   * Panels the scene's solids would like, declared ahead of `build` because
   * they come out of the same residency budget as the slots — the stage has to
   * subtract them before it knows how many slots it can afford to lay out.
   */
  readonly solidPanels: number;
  build(ctx: SpatialContext): SpatialFormation;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let revisionCounter = 0;

/** Stamp for a freshly built arrangement. Monotonic and process-wide, so a
 *  backend can compare it against what it holds without knowing who built it. */
export function nextRevision(): number {
  return ++revisionCounter;
}

/**
 * A crop of the source image for one quad — the "segment taken out of context"
 * of the flat path, except placed in depth.
 *
 * Ranges are set per scene and they are all wide now: a quad is a large piece of
 * its page, often nearly all of it. A crop tight enough to be a *detail* only
 * works when there are enough of them to read as a field, and there are
 * deliberately not.
 */
function randomCrop(rng: Rng, min: number, max: number): [number, number, number, number] {
  const w = rng.range(min, max);
  // Not square: a crop that keeps the page's own proportions reads as a page,
  // and one that does not reads as a detail. Both are wanted, so the shape is
  // drawn rather than derived.
  const h = clamp(w * rng.range(0.7, 1.45), min, 1);
  return [rng.range(0, 1 - w), rng.range(0, 1 - h), w, h];
}

export interface LayoutOptions {
  /**
   * Half-extent range of a quad, in world units, before the frame's global
   * scale.
   *
   * Read against the camera: the visible half-height at distance `d` and vertical
   * fov `f` is `d * tan(f / 2)`, so at the distances these scenes sit — six to
   * eight units, fifty-five to seventy degrees — one unit is roughly a third of
   * the frame. The sizes below are therefore around 1: a quad is meant to be a
   * substantial share of the picture, not a speck in a swarm of them.
   */
  size: [number, number];
  /** Max absolute in-plane tilt, radians. */
  tilt: number;
  /** Tightest and loosest crop, as a fraction of the source. */
  crop: [number, number];
}

/**
 * Interleave the two arrangements into per-slot instanced attributes.
 *
 * Instances are dealt across the slots round-robin, so slot `s` holds indices
 * `s, s + slots, s + 2 * slots, …` — spread through the whole formation rather
 * than owning a contiguous wedge of it. That matters: a slot is one panel, and
 * a panel that owned a wedge would read as a pie chart of the gallery, where
 * one dealt through the formation reads as the same image recurring across it.
 */
export function buildLayout(
  ctx: SpatialContext,
  revision: number,
  formationA: Formation,
  formationB: Formation,
  options: LayoutOptions
): StageLayout {
  const { slots, perSlot, rng } = ctx;
  const total = Math.max(1, slots * perSlot);
  const slotLayouts: SlotLayout[] = [];

  for (let slot = 0; slot < slots; slot++) {
    const layout: SlotLayout = {
      count: perSlot,
      posA: new Float32Array(perSlot * 3),
      nrmA: new Float32Array(perSlot * 3),
      posB: new Float32Array(perSlot * 3),
      nrmB: new Float32Array(perSlot * 3),
      tanA: new Float32Array(perSlot * 3),
      tanB: new Float32Array(perSlot * 3),
      quad: new Float32Array(perSlot * 4),
      crop: new Float32Array(perSlot * 4),
    };

    for (let k = 0; k < perSlot; k++) {
      const index = k * slots + slot;
      const t = (index + 0.5) / total;
      const a = formationA(t, index);
      const b = formationB(t, index);

      layout.posA.set(a.pos, k * 3);
      layout.nrmA.set(a.nrm, k * 3);
      layout.posB.set(b.pos, k * 3);
      layout.nrmB.set(b.nrm, k * 3);
      // Always written, even for the formations that have no direction: one
      // attribute that is sometimes ignored is cheaper than a second vertex
      // shader, and 24 bytes an instance is nothing against the textures.
      layout.tanA.set(a.tan ?? fallbackTangent(a.nrm), k * 3);
      layout.tanB.set(b.tan ?? fallbackTangent(b.nrm), k * 3);

      layout.quad.set(
        [
          rng.range(options.size[0], options.size[1]),
          rng.range(-options.tilt, options.tilt),
          // Per-instance rate as well as phase. With a shared rate the whole
          // formation breathes in unison, which is one large slow pulse of the
          // frame's luminance — the exact shape §6 rules out — where spread
          // rates never sum to a beat at all.
          rng.range(0.55, 1.5),
          rng.range(0, Math.PI * 2),
        ],
        k * 4
      );
      layout.crop.set(randomCrop(rng, options.crop[0], options.crop[1]), k * 4);
    }

    slotLayouts.push(layout);
  }

  return { revision, slots: slotLayouts };
}

// --- Arrangements -----------------------------------------------------------

/**
 * Phyllotaxis funnel, receding as it opens out. `sqrt(t)` for the radius is what
 * makes the density uniform rather than crowded at the rim, and the golden
 * angle is what stops successive instances — which are successive *slots*, and
 * therefore successive panels — from forming visible spokes of one image.
 *
 * `bowl` turns each quad outward in proportion to how far out it sits, which is
 * the difference between a spiral and a vortex. With hundreds of small quads it
 * would have been a refinement; with six large ones it is most of the shape —
 * flat normals put six pages on a wall facing the lens, and there is no
 * arrangement of a wall that reads as three-dimensional.
 */
export function phyllotaxis(radius: number, depth: number, bowl: number): Formation {
  return (t, index) => {
    const r = Math.sqrt(t) * radius;
    const a = index * GOLDEN_ANGLE;
    const lean = bowl * (r / Math.max(radius, 1e-4));
    return {
      pos: [Math.cos(a) * r, Math.sin(a) * r, -t * depth],
      nrm: norm([Math.cos(a) * lean, Math.sin(a) * lean, 1]),
      // Around the spiral rather than out along it: a quad rolled to follow the
      // turn lies in the funnel's own surface, which is what makes the funnel a
      // surface at all. Only read when a frame asks for alignment.
      tan: [-Math.sin(a), Math.cos(a), 0],
    };
  };
}

/** Fibonacci sphere: the same golden-angle spiral wrapped onto a ball, so the
 *  morph out of the disc is a fold rather than a scramble. */
export function fibonacciSphere(radius: number): Formation {
  return (t, index) => {
    const y = 1 - 2 * t;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = index * GOLDEN_ANGLE;
    const pos: Vec3 = [Math.cos(a) * ring * radius, y * radius, Math.sin(a) * ring * radius];
    const len = Math.hypot(pos[0], pos[1], pos[2]) || 1;
    return { pos, nrm: [pos[0] / len, pos[1] / len, pos[2] / len] };
  };
}

// The tube formation that used to live here — quads scattered over a cylinder
// wall — is gone rather than merely unused. It was the vault, twice: once with
// five hundred small crops and once with a dozen large ones, and the second was
// no better than the first, because a quad on a wall has a rim and a rim sliding
// past the eye is an object being thrown at the viewer. The corridor is a real
// surface now (see `ShellDraw`), which has no rim anywhere in it.

/**
 * A stack of leaning planes, each filled by the R2 sequence.
 *
 * `count` strands taken off the instance index modulo, so every sheet is dealt
 * quads from every panel slot rather than one sheet per panel — the same reason
 * the slots themselves are dealt round-robin. No two sheets are parallel, which
 * is what guarantees that displacing them along their normals drives them
 * *through* one another rather than merely past: the intersection is the whole
 * point of this arrangement, and it is the one thing a stack of composited
 * layers can never show.
 */
export function sheets(
  count: number,
  spread: number,
  size: number,
  /** Lean added per plane through the stack, radians-ish. A parameter rather
   *  than a constant because it has to grow as the stack thins: with three
   *  planes carrying two quads each, a lean tuned for five is barely a crossing
   *  at all, and the crossing is the entire subject of the arrangement. */
  tilt: number
): Formation {
  return (_t, index) => {
    const sheet = index % count;
    const step = Math.floor(index / count);
    const [rx, ry] = r2(step);
    const x = (rx - 0.5) * size;
    const y = (ry - 0.5) * size;
    const lean = (sheet - (count - 1) / 2) * tilt;
    const depth = (sheet / Math.max(1, count - 1) - 0.5) * spread;
    return {
      pos: [x, y, depth + x * lean - y * lean * 0.6],
      nrm: norm([-lean, lean * 0.6, 1]),
      tan: norm([1, 0, lean]),
    };
  };
}

/**
 * The same sheets rolled into concentric cylinder shells — the morph partner.
 *
 * Correspondence is by construction: instance `i` takes the same `sheet` and the
 * same R2 pair in both, so the morph unrolls a plane into a shell rather than
 * dissolving one set of quads into another.
 */
export function shells(count: number, radius: number, length: number): Formation {
  return (_t, index) => {
    const shell = index % count;
    const step = Math.floor(index / count);
    const [rx, ry] = r2(step);
    const a = rx * Math.PI * 2;
    const r = radius * (0.42 + 0.58 * (shell / Math.max(1, count - 1)));
    return {
      pos: [Math.cos(a) * r, (ry - 0.5) * length, Math.sin(a) * r],
      nrm: [-Math.cos(a), 0, -Math.sin(a)],
      tan: [-Math.sin(a), 0, Math.cos(a)],
    };
  };
}

/**
 * `count` strands swept along a Lissajous curve, offset from one another in
 * phase so they braid rather than overlap.
 *
 * The frequencies must be mutually irrational-ish for the figure to fill space
 * instead of closing into a loop after one pass — small integers close, and a
 * closed Lissajous is a wire rather than a weave.
 */
export function lissajous(count: number, scale: number, freq: Vec3): Formation {
  return (t, index) => {
    const strand = index % count;
    const offset = (strand / count) * Math.PI * 2;
    const at = (s: number): Vec3 => [
      Math.sin(s * freq[0] + offset) * scale,
      Math.sin(s * freq[1] + offset * 1.31 + 0.7) * scale * 0.68,
      Math.sin(s * freq[2] + offset * 0.73 + 1.9) * scale * 0.82,
    ];
    return alongCurve(at, t * Math.PI * 2);
  };
}

/** The same strands wound onto a torus, `turns` times around the tube for each
 *  circuit of the ring. A knot rather than a braid, and the morph between the
 *  two is the cheapest structural change a ribbon scene has. */
export function coil(count: number, major: number, minor: number, turns: number): Formation {
  return (t, index) => {
    const strand = index % count;
    const offset = (strand / count) * Math.PI * 2;
    const at = (s: number): Vec3 => {
      const small = s * turns + offset;
      const r = major + minor * Math.cos(small);
      return [Math.cos(s) * r, minor * Math.sin(small), Math.sin(s) * r];
    };
    return alongCurve(at, t * Math.PI * 2);
  };
}

/** A block of overlapping crops — the page assembled, before it comes apart. */
export function slab(width: number, height: number, depth: number): Formation {
  return (t, index) => {
    const [rx, ry] = r2(index);
    return {
      pos: [(rx - 0.5) * width, (ry - 0.5) * height, (t - 0.5) * depth],
      nrm: [0, 0, 1],
    };
  };
}

/** A ball of points, uniform through the volume rather than crowded at the rim —
 *  which is what the cube root is for. The art dispersed. */
export function cloud(radius: number): Formation {
  return (t, index) => {
    const r = Math.cbrt(t) * radius;
    const y = 1 - 2 * r2(index)[0];
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = index * GOLDEN_ANGLE;
    const pos: Vec3 = [Math.cos(a) * ring * r, y * r, Math.sin(a) * ring * r];
    return { pos, nrm: norm(pos) };
  };
}
