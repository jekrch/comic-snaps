/**
 * Worked examples for the pHash lesson: one panel's original phone photo and
 * its restoration, with every step imagehash.phash computes along the way.
 * Written by scripts/compute-phash-examples.py to
 * public/data/phash-examples.json.
 */

interface RawSide {
  width: number;
  height: number;
  /** 32 × 32 luminance, base64 uint8, row-major. */
  grid: string;
  /** The top-left 8 × 8 of the DCT, row-major. */
  dct: number[];
  median: number;
  hash: string;
  /** The color image (gallery path, or a file beside the JSON). */
  image: string;
  /** Its luminance, as PIL's convert("L") makes it. */
  luma: string;
}

interface RawExample {
  id: string;
  title: string;
  issue: number | string | null;
  artist: string | null;
  before: RawSide;
  after: RawSide;
  quad: [number, number][] | null;
}

/** min / median / max of a set of Hamming distances. */
export interface Spread {
  n: number;
  min: number;
  median: number;
  max: number;
}

export interface PhashStats {
  panels: number;
  pairs: Spread & { p5: number; p95: number };
  nearest: Spread;
  restoredKeptFrame: Spread;
  restoredReframed: Spread;
}

export interface HashSide {
  width: number;
  height: number;
  grid: Uint8Array;
  dct: number[];
  median: number;
  hash: string;
  /** 64 bits, row-major over the 8 × 8 DCT block. */
  bits: boolean[];
  image: string;
  luma: string;
}

export interface PhashExample {
  id: string;
  title: string;
  issue: number | string | null;
  artist: string | null;
  before: HashSide;
  after: HashSide;
  /**
   * The restored frame's corners inside the original photo (TL, TR, BR, BL),
   * as fractions of its width and height. Null if the match failed.
   */
  quad: [number, number][] | null;
}

export interface PhashExamples {
  examples: PhashExample[];
  stats: PhashStats;
}

/** A 16-digit hex hash as 64 bits, most significant first, as imagehash writes it. */
export function hexBits(hex: string): boolean[] {
  const out: boolean[] = [];
  for (const c of hex) {
    const v = parseInt(c, 16);
    for (let s = 3; s >= 0; s--) out.push(((v >> s) & 1) === 1);
  }
  return out;
}

/** How many positions differ. */
export function bitDistance(a: boolean[], b: boolean[]): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function side(raw: RawSide): HashSide {
  return { ...raw, grid: bytes(raw.grid), bits: hexBits(raw.hash) };
}

export function decodePhashExamples(raw: { examples: RawExample[]; stats: PhashStats }): PhashExamples {
  return {
    examples: raw.examples.map((e) => ({ ...e, before: side(e.before), after: side(e.after) })),
    stats: raw.stats,
  };
}

let loaded: Promise<PhashExamples | null> | null = null;

/** The examples, fetched once. Null if they couldn't be loaded. */
export function loadPhashExamples(): Promise<PhashExamples | null> {
  if (!loaded) {
    loaded = fetch(`${import.meta.env.BASE_URL}data/phash-examples.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load pHash examples: ${res.status}`);
        return res.json();
      })
      .then(decodePhashExamples)
      .catch((err) => {
        console.error(err);
        loaded = null; // let a later visit retry
        return null;
      });
  }
  return loaded;
}

export function exampleLabel(e: Pick<PhashExample, "title" | "issue">): string {
  return e.issue != null && e.issue !== "N/A" ? `${e.title} #${e.issue}` : e.title;
}

/** PIL's convert("L"): ITU-R 601 luma, with its fixed-point rounding. */
export function luma(r: number, g: number, b: number): number {
  return (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;
}

/**
 * One of the 64 smooth patterns the 8 × 8 DCT block measures, sampled on
 * the 32 × 32 grid: row `u` varies top to bottom, column `v` left to right.
 * Values in [-1, 1].
 */
export function dctBasis(u: number, v: number, size = 32): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const cy = Math.cos(((2 * y + 1) * u * Math.PI) / (2 * size));
    for (let x = 0; x < size; x++) {
      out[y * size + x] = cy * Math.cos(((2 * x + 1) * v * Math.PI) / (2 * size));
    }
  }
  return out;
}
