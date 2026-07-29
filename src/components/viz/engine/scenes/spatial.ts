import type { VizConfig } from "../../vizConfig";
import type { Rng } from "../rng";
import type { SlotLayout, SolidShape, StageKind, StageLayout, Vec3 } from "../types";

/**
 * The spatial scenes and the formation maths they share.
 *
 * A spatial scene is a *formation* rather than a spawner. Where `Scene.spawn`
 * hands back one shard at a time and the director keeps a handful alive, a
 * formation is built once — several hundred quads, arranged — and then panels
 * flow through it while the arrangement itself only breathes. That inversion is
 * what makes five hundred crops affordable: the expensive half is static, so
 * per frame there is a camera and a dozen slot uniforms and nothing else.
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

/** Where one instance sits, and which way it faces. */
export interface Placement {
  pos: Vec3;
  nrm: Vec3;
}

/**
 * One arrangement. `t` runs 0..1 across the whole formation in index order,
 * which is what lets the two arrangements in a pair stay in correspondence:
 * instance `i` is the same instance in both, so the morph moves it rather than
 * dissolving one set of quads into another.
 */
export type Formation = (t: number, index: number) => Placement;

export interface SpatialContext {
  /** Panels the formation holds resident at once. */
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
  scale: number;
  breathe: number;
  spin: Vec3;
  eye: Vec3;
  look: Vec3;
  fov: number;
  wrap: number;
  fogNear: number;
  fogFar: number;
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
 * of the flat path, except that here several hundred of them are on screen at
 * once and each one is a different reading of a different page.
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
  /** Half-extent range of a quad, before the frame's global scale. */
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
 * Phyllotaxis disc, receding as it opens out. `sqrt(t)` for the radius is what
 * makes the density uniform rather than crowded at the rim, and the golden
 * angle is what stops successive instances — which are successive *slots*, and
 * therefore successive panels — from forming visible spokes of one image.
 */
export function phyllotaxis(radius: number, depth: number): Formation {
  return (t, index) => {
    const r = Math.sqrt(t) * radius;
    const a = index * GOLDEN_ANGLE;
    return {
      pos: [Math.cos(a) * r, Math.sin(a) * r, -t * depth],
      nrm: [0, 0, 1],
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

/**
 * Pages papering the inside of a tube, laid along -z. `profile` scales the
 * radius by depth: a constant 1 is a straight corridor, and a bulge is a
 * cavern. Both faces point at the axis, which is where the camera is.
 */
export function tube(radius: number, length: number, profile: (t: number) => number): Formation {
  return (t, index) => {
    const a = index * GOLDEN_ANGLE;
    const r = radius * profile(t);
    return {
      pos: [Math.cos(a) * r, Math.sin(a) * r, -t * length],
      nrm: [-Math.cos(a), -Math.sin(a), 0],
    };
  };
}
