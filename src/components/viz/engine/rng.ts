/**
 * Seeded PRNG (mulberry32). Every random choice in the visualizer routes
 * through one of these so a whole session replays identically from its seed —
 * which is what makes "that run looked great, what was it doing?" answerable,
 * and lets a good run be shared as a URL.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Picks an index by relative weight. Weights need not sum to 1. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /** A fresh independent stream, deterministic given this one's position. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 0xffffffff));
  }
}

/** A seed suitable for putting in a URL. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function parseSeed(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 36);
  return Number.isFinite(n) ? n >>> 0 : null;
}

export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(36);
}
