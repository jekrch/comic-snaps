import { describe, expect, it } from "vitest";
import type { Panel } from "../../types";
import { agreement, embeddingStats, poolStats } from "./galleryStats";

const unit = (x: number, y: number) => {
  const n = Math.hypot(x, y);
  return [x / n, y / n];
};

describe("embeddingStats", () => {
  it("measures every pair once and finds each one's nearest", () => {
    const map = { a: unit(1, 0), b: unit(1, 0.1), c: unit(0, 1), d: unit(-1, 0) };
    const s = embeddingStats(map)!;
    expect(s.spread.pairs).toBe(6);
    expect(s.nearest.get("a")).toBe("b");
    expect(s.nearest.get("c")).toBe("b");
    // a–d is opposite: distance 2, so some pairs are past 1.
    expect(s.spread.hi).toBeCloseTo(2, 1);
    expect(s.spread.overOne).toBeGreaterThan(0);
    expect(embeddingStats(map)).toBe(s);
  });
});

describe("poolStats", () => {
  const panel = (id: string, chromaShare: number, L: number, phash: string): Panel =>
    ({
      id,
      phash,
      chromaShare,
      keyColor: chromaShare > 0.04 ? [50, 40, 30] : null,
      dominantColors: [[L, chromaShare > 0.04 ? 40 : 0, 0], [95, 0, 0], [10, 0, 0]],
      dominantWeights: [0.4, 0.4, 0.2],
    }) as unknown as Panel;

  it("never pairs a color panel with a black-and-white one", () => {
    const pool = [
      panel("c1", 0.2, 50, "ffffffff00000000"),
      panel("c2", 0.2, 55, "ffffffff00000001"),
      panel("c3", 0.2, 70, "00000000ffffffff"),
      panel("b1", 0.01, 50, "fffffffe00000000"),
      panel("b2", 0.01, 52, "0f0f0f0f0f0f0f0f"),
      panel("b3", 0.01, 80, "f0f0f0f0f0f0f0f0"),
    ];
    const { color, phash } = poolStats(pool);
    expect(color!.spread.pairs).toBe(3);
    expect(color!.bw!.pairs).toBe(3);
    for (const [id, n] of color!.nearest) expect(id[0]).toBe(n[0]);
    expect(phash!.spread.pairs).toBe(15);
    expect(phash!.nearest.get("c1")).not.toBe("c3");
  });
});

describe("agreement", () => {
  it("is the share of shared panels with the same nearest", () => {
    const a = new Map([["x", "y"], ["y", "x"], ["z", "x"]]);
    const b = new Map([["x", "y"], ["y", "z"], ["w", "x"]]);
    expect(agreement(a, b)).toBe(0.5);
  });
});
