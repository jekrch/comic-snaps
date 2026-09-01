/**
 * The panel palettes in `gallery.json` are CIELAB triples under a D65 white —
 * that is what scikit-image's `rgb2lab` hands back, and what every other
 * consumer of `dominantColors` in the app assumes.
 *
 * Everything here funnels through one 8-bit sRGB triple on the way out. That
 * is deliberate: the swatch on screen is painted from the same bytes the
 * strings are built from, so a copied `oklch()` can never name a colour
 * slightly beside the square it was copied from. Centroids that land outside
 * the sRGB gamut are clamped once, at that step, rather than each format
 * clipping differently on its own.
 */

export type Lab = readonly [number, number, number];

export const COLOR_FORMATS = ["hex", "rgb", "hsl", "lab", "oklch"] as const;
export type ColorFormat = (typeof COLOR_FORMATS)[number];

/** sRGB byte triple, 0–255. */
export type Rgb255 = [number, number, number];

function labInverseF(t: number): number {
  const d = 6 / 29;
  return t > d ? t * t * t : 3 * d * d * (t - 4 / 29);
}

function encodeGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function decodeGamma(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** CIELAB (D65) to an 8-bit sRGB triple, clamped into gamut. */
export function labToRgb255([L, a, b]: Lab): Rgb255 {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = 0.95047 * labInverseF(fx);
  const y = 1.0 * labInverseF(fy);
  const z = 1.08883 * labInverseF(fz);

  const linear = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ];

  return linear.map((c) =>
    Math.max(0, Math.min(255, Math.round(encodeGamma(Math.max(0, Math.min(1, c))) * 255)))
  ) as Rgb255;
}

export function toHex([r, g, b]: Rgb255): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function toHsl([r, g, b]: Rgb255): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function linearSrgb([r, g, b]: Rgb255): [number, number, number] {
  return [decodeGamma(r / 255), decodeGamma(g / 255), decodeGamma(b / 255)];
}

/**
 * CSS `lab()` is defined against a D50 white, so the stored D65 numbers can't
 * be printed as-is without naming a slightly different colour than the swatch.
 * Round-tripping through XYZ with the Bradford adaptation from CSS Color 4 is
 * the only way the pasted string matches the hex beside it.
 */
function toCssLab(rgb: Rgb255): string {
  const [lr, lg, lb] = linearSrgb(rgb);

  const x65 = lr * 0.41239079926595934 + lg * 0.357584339383878 + lb * 0.1804807884018343;
  const y65 = lr * 0.21263900587151027 + lg * 0.7151686787677559 + lb * 0.07219231536073371;
  const z65 = lr * 0.01933081871559182 + lg * 0.11919477979462598 + lb * 0.9505321522496607;

  const x = x65 * 1.0479298208405488 + y65 * 0.022946793341019088 + z65 * -0.05019222954313557;
  const y = x65 * 0.029627815688159344 + y65 * 0.990434484573249 + z65 * -0.01707382502938514;
  const z = x65 * -0.009243058152591178 + y65 * 0.015055144896577895 + z65 * 0.7518742899580008;

  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  const f = (t: number) => (t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116);

  const fx = f(x / 0.9642956764295677);
  const fy = f(y);
  const fz = f(z / 0.8251046025104602);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return `lab(${round(L, 2)} ${round(a, 2)} ${round(b, 2)})`;
}

function toOklch(rgb: Rgb255): string {
  const [r, g, b] = linearSrgb(rgb);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(A * A + B * B);
  // Hue is meaningless once chroma vanishes, and atan2 on floating-point dust
  // would print a confident angle for a grey. Powers of the achromatic axis
  // get 0 instead, which is how browsers serialise them too.
  const h = C < 1e-4 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;

  return `oklch(${round(L, 3)} ${round(C, 3)} ${round(h < 0 ? h + 360 : h, 1)})`;
}

/** Trailing zeros read as false precision in a value meant to be pasted. */
function round(n: number, places: number): number {
  return Number(n.toFixed(places));
}

export function formatColor(rgb: Rgb255, format: ColorFormat): string {
  switch (format) {
    case "hex":
      return toHex(rgb);
    case "rgb":
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    case "hsl":
      return toHsl(rgb);
    case "lab":
      return toCssLab(rgb);
    case "oklch":
      return toOklch(rgb);
  }
}

/**
 * Whether a label printed on this colour should be dark. Relative luminance,
 * not L*, because the text sits directly on the sRGB swatch — and the
 * threshold is the crossover where white-on-colour and black-on-colour reach
 * the same WCAG contrast, so the label is always the better-contrasting one.
 */
export function prefersDarkInk([r, g, b]: Rgb255): boolean {
  const [lr, lg, lb] = linearSrgb([r, g, b]);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb > 0.1791;
}
