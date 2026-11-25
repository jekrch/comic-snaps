import type { Panel } from "../../types";

/** Colour maths shared by the colour lesson's figures. CIELAB is D65. */

export type Lab = readonly [number, number, number];
export type Rgb8 = readonly [number, number, number];

/** CIELAB → linear sRGB, unclamped, so out-of-gamut shows as <0 or >1. */
export function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const d = 6 / 29;
  const inv = (t: number) => (t > d ? t * t * t : 3 * d * d * (t - 4 / 29));
  const X = 0.9505 * inv(fx);
  const Y = inv(fy);
  const Z = 1.089 * inv(fz);
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

const EPS = 0.002;
export function inGamut(rgb: readonly number[]): boolean {
  return rgb.every((c) => c >= -EPS && c <= 1 + EPS);
}

/** Linear channel → gamma-encoded 0–255. */
export function to8(c: number): number {
  const g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(g * 255)));
}

export function labToRgb8(L: number, a: number, b: number): Rgb8 {
  const [r, g, bl] = labToLinear(L, a, b);
  return [to8(r), to8(g), to8(bl)];
}

export function labCss(L: number, a: number, b: number): string {
  return rgbCss(labToRgb8(L, a, b));
}

export function rgbCss([r, g, b]: Rgb8): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Gamma-encoded 0–255 sRGB → CIELAB. */
export function rgbToLab([r8, g8, b8]: Rgb8): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(r8), lin(g8), lin(b8)];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
  const d = 6 / 29;
  const f = (t: number) => (t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Straight-line distance between two triples (RGB or CIELAB). */
export function dist3(p: readonly number[], q: readonly number[]): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function hueDeg(a: number, b: number): number {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

export function panelName(p: Panel): string {
  return p.issue != null && p.issue !== "" ? `${p.title} #${p.issue}` : p.title;
}

/** Signed number with a true minus sign. */
export function num(n: number, d = 0): string {
  const s = Math.abs(n).toFixed(d);
  return n < 0 && Number(s) !== 0 ? `−${s}` : s;
}

/** Shortest way round the wheel between two hue angles, 0–180. */
export function hueGap(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The everyday name for a hue angle. CIELAB's angles aren't the familiar
 * colour wheel's: sRGB red sits near 40°, yellow near 100°, green near 135°,
 * cyan near 195° and pure blue as far round as 305°. Only saturated blues
 * reach that far, though; a dusty colour at 300° already reads as purple.
 */
export function hueName(L: number, a: number, b: number): string {
  const C = Math.hypot(a, b);
  const h = hueDeg(a, b);
  if (h >= 350 || h < 22) return L > 65 ? "pink" : "red";
  if (h < 50) return C < 25 && L < 50 ? "brown" : L < 38 ? "maroon" : "red";
  if (h < 75) return L < 50 ? "brown" : C < 25 && L > 60 ? "beige" : "orange";
  if (h < 110) return L < 55 ? (C > 20 && h > 85 ? "olive" : "brown") : C < 25 && L > 60 ? "beige" : "yellow";
  if (h < 165) return "green";
  if (h < 225) return "teal";
  if (h < (C > 60 ? 315 : 292)) return "blue";
  return C > 45 ? "magenta" : "purple";
}

/** A plain-language name for a CIELAB colour: "a muted orange", "a near-black". */
export function colorName(L: number, a: number, b: number): string {
  const C = Math.hypot(a, b);
  let name: string;
  if (C < 8) {
    name = L < 22 ? "near-black" : L > 88 ? "off-white" : L < 45 ? "dark grey" : L > 70 ? "light grey" : "grey";
  } else {
    const hue = hueName(L, a, b);
    // One adjective at most, and none that the hue's own name already says.
    const adj =
      C < 15 && hue !== "beige"
        ? "greyish"
        : L < 35 && !["maroon", "brown", "olive"].includes(hue)
          ? "dark"
          : L > 78 && hue !== "beige"
            ? "pale"
            : C < 30 && hue !== "beige"
              ? "muted"
              : C > 55
                ? "vivid"
                : "";
    name = adj ? `${adj} ${hue}` : hue;
  }
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
}
