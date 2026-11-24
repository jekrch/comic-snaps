import { describe, expect, it } from "vitest";
import { stripScale } from "./VectorStrips";

describe("stripScale", () => {
  it("ignores a lone outlier so ordinary cells keep their contrast", () => {
    const row = Array.from({ length: 96 }, (_, i) => (i % 2 ? 0.02 : -0.02));
    row[78] = 0.38;
    expect(stripScale([row, row, row])).toBeCloseTo(0.02);
  });

  it("falls back to the max when most values are zero", () => {
    const row = Array(96).fill(0);
    row[3] = 0.5;
    expect(stripScale([row])).toBe(0.5);
  });

  it("never returns zero", () => {
    expect(stripScale([[0, 0, 0]])).toBe(1);
    expect(stripScale([])).toBe(1);
  });
});
