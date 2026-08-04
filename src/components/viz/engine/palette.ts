import type { Levels } from "./types";
import { IDENTITY_LEVELS } from "./types";

export type Lab = [number, number, number];
export type Rgb = [number, number, number];

function labInverseF(t: number): number {
  const d = 6 / 29;
  return t > d ? t * t * t : 3 * d * d * (t - 4 / 29);
}

function gamma(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** CIELAB (D65) to sRGB in 0..1. */
export function labToRgb([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = (95.047 * labInverseF(fx)) / 100;
  const y = (100.0 * labInverseF(fy)) / 100;
  const z = (108.883 * labInverseF(fz)) / 100;

  return [
    gamma(x * 3.2406 + y * -1.5372 + z * -0.4986),
    gamma(x * -0.9689 + y * 1.8758 + z * 0.0415),
    gamma(x * 0.0557 + y * -0.204 + z * 1.057),
  ];
}

/** Opposite hue at a mid lightness — the tint that keeps an overlap chromatic. */
export function complement([L, a, b]: Lab): Lab {
  return [Math.min(75, Math.max(45, L)), -a, -b];
}

/**
 * Scale a colour so its brightest channel is 1. The shader applies tints
 * multiplicatively, so an unnormalised tint would double as an exposure cut
 * and the stack would crawl toward black as layers accumulate.
 */
export function normalizeTint(rgb: Rgb): Rgb {
  const max = Math.max(rgb[0], rgb[1], rgb[2], 0.001);
  return [rgb[0] / max, rgb[1] / max, rgb[2] / max];
}

// --- Key and levels ---------------------------------------------------------

/**
 * The key a *single* layer is levelled toward. A little under mid on purpose:
 * the blends that stack layers are mostly additive, so the composite needs
 * somewhere to climb before it clips.
 *
 * It is the depth-one case of `stackKey` and nothing else, which is the whole
 * of what was wrong with it as a constant — see there.
 */
export const TARGET_KEY = 0.46;

/**
 * The brightest the *composite* may sit, however deep the stack gets.
 *
 * A deep stack is allowed to read a little brighter than a lone layer — the
 * light is the point of stacking — but it approaches this and stops, rather
 * than climbing with every layer added.
 */
const COMPOSITE_CEILING = 0.62;

/** How layers of a stack combine, which is what decides the arithmetic below. */
export type StackBlend = "screen" | "additive";

/** Where the finished composite should land for a stack this deep. */
function compositeKey(depth: number): number {
  return TARGET_KEY + (COMPOSITE_CEILING - TARGET_KEY) * (1 - 1 / depth);
}

/**
 * The key one layer of a stack should be levelled to, given how many layers
 * will pile onto it.
 *
 * `TARGET_KEY` alone was a depth-one answer applied at every depth, and the
 * blends the stack uses compound: N screened layers at key k land the composite
 * at `1 - (1 - k)^N`, so at 0.46 two layers read 0.71, three 0.84 and four
 * 0.92. Past about three the frame is white regardless of the artwork, which is
 * the washout this exists to stop. Additive is worse still — it just sums.
 *
 * So the target is inverted out of the composite instead of asserted: pick
 * where the finished frame should sit, then solve for the per-layer key that
 * gets it there. Opacity divides back out, because a layer that only
 * contributes at `a` needs to start `1/a` brighter to arrive at the same place.
 *
 * Never above `TARGET_KEY`: the depth-one case is the brightest a layer is ever
 * allowed to be levelled to, and a low opacity must not become a licence to
 * exceed it.
 */
export function stackKey(depth: number, blend: StackBlend, opacity = 1): number {
  const n = Math.max(1, Math.round(depth));
  const target = compositeKey(n);
  if (n === 1) return target;
  const a = Math.min(1, Math.max(0.1, opacity));
  const per = blend === "screen" ? 1 - Math.pow(1 - target, 1 / n) : target / n;
  return Math.min(TARGET_KEY, per / a);
}

/**
 * Weights for the dominant colours by rank. They arrive ordered by cluster
 * size, so a flat mean would let a small patch of ink cancel out a page that is
 * almost all paper — which is the exact case this exists to catch.
 */
const KEY_WEIGHTS = [0.55, 0.28, 0.17];

/**
 * How bright a panel reads overall, 0..1. Lab L* is already perceptual, so this
 * is the axis a washed-out frame is judged on rather than luminance.
 *
 * A panel with no palette gets the target key back, so a missing field means
 * "leave it alone" instead of a guess.
 */
export function panelKey(colors: Lab[] | null): number {
  if (!colors || colors.length === 0) return TARGET_KEY;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < colors.length; i++) {
    const w = KEY_WEIGHTS[Math.min(i, KEY_WEIGHTS.length - 1)];
    sum += (Math.min(100, Math.max(0, colors[i][0])) / 100) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : TARGET_KEY;
}

/**
 * Tone levels that bring a panel to `targetKey` before it blends. Pass the
 * answer from `stackKey` for anything that stacks; the default is the depth-one
 * case, for the one-layer callers.
 *
 * The map scales toward the target and then expands around it: `c * (target /
 * key) * expand + target * (1 - expand)`. The panel's own key lands on the
 * target, black stays black, and the expansion wins back the separation the
 * scaling costs.
 *
 * It scales rather than shifts because the corrections got much larger when
 * they became depth-aware. A shift — `(c - key) * gain + target`, which this
 * was — moves the whole tone curve down bodily, and at the depth of pull a
 * four-layer stack needs that puts everything below the mid-tones under zero:
 * washout traded for mud at the other end. Scaling costs contrast instead of
 * shadow, and the expansion is there to buy the contrast back.
 *
 * It only ever darkens. Lifting a dark panel toward the target would grey its
 * blacks, which is the same complaint from the other end.
 */
export function levelsFor(
  colors: Lab[] | null,
  strength: number,
  targetKey: number = TARGET_KEY
): Levels {
  const key = panelKey(colors);
  if (strength <= 0 || key <= targetKey) return IDENTITY_LEVELS;
  const target = key + (targetKey - key) * Math.min(1, strength);
  // Capped: past this the expansion clips more shadow than the extra crispness
  // in the mid-tones is worth.
  const expand = Math.min(1.35, 1 + (key - target) * 0.6);
  return { gain: (target / key) * expand, lift: target * (1 - expand) };
}

/** The panel's most chromatic dominant colour, or null if it has none. */
export function chromaticDominant(colors: Lab[] | null): Lab | null {
  if (!colors || colors.length === 0) return null;
  let best: Lab | null = null;
  let bestChroma = 4;
  for (const c of colors) {
    const chroma = Math.hypot(c[1], c[2]);
    if (chroma > bestChroma) {
      bestChroma = chroma;
      best = c;
    }
  }
  return best;
}
