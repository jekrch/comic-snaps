import { describe, expect, it } from "vitest";
import { highlight, similarityMap, type ModelMaps } from "./patchMaps";

/** 2×2 grid, 2 dims, unit vectors: patches 0 and 1 alike, 3 opposite to 0. */
function maps(): ModelMaps {
  const s = Math.SQRT1_2;
  return {
    cols: 2,
    rows: 2,
    layers: [1],
    dims: 2,
    vectors: [Float32Array.from([1, 0, s, s, 0, 1, -1, 0])],
    summary: null,
    scratch: new Set(),
    focus: 0,
  };
}

describe("similarityMap", () => {
  it("is the cosine of the focus patch with every patch", () => {
    const sim = similarityMap(maps(), 0, 0);
    expect(sim[0]).toBeCloseTo(1);
    expect(sim[1]).toBeCloseTo(Math.SQRT1_2);
    expect(sim[2]).toBeCloseTo(0);
    expect(sim[3]).toBeCloseTo(-1);
  });
});

describe("highlight", () => {
  it("puts the best other match at 1, leaves the focus and scratch patches dark", () => {
    const sim = Float32Array.from([1, 0.9, 0.2, -0.5]);
    const h = highlight(sim, 0, new Set([2]));
    expect(h[0]).toBe(0);
    expect(h[1]).toBeCloseTo(1);
    expect(h[2]).toBe(0);
    expect(h[3]).toBe(0);
  });

  it("is all zero when every other patch is scratch", () => {
    const h = highlight(Float32Array.from([1, 0.5]), 0, new Set([1]));
    expect([...h]).toEqual([0, 0]);
  });
});
