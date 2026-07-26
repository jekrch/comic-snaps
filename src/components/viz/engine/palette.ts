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
