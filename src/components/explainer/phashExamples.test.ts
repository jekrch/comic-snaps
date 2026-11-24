import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bitDistance, dctBasis, decodePhashExamples, hexBits, luma } from "./phashExamples";

const raw = JSON.parse(readFileSync(resolve(__dirname, "../../../public/data/phash-examples.json"), "utf-8"));
const { examples, stats } = decodePhashExamples(raw);

describe("hexBits", () => {
  it("reads each hex digit most significant bit first", () => {
    expect(hexBits("a0").map(Number)).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("counts differing bits", () => {
    expect(bitDistance(hexBits("0000"), hexBits("0001"))).toBe(1);
    expect(bitDistance(hexBits("ffff"), hexBits("0000"))).toBe(16);
  });
});

describe("luma", () => {
  it("matches PIL's convert('L')", () => {
    expect(luma(255, 255, 255)).toBe(255);
    expect(luma(0, 0, 0)).toBe(0);
    expect(luma(255, 0, 0)).toBe(76);
    expect(luma(0, 255, 0)).toBe(150);
    expect(luma(0, 0, 255)).toBe(29);
  });
});

describe("the shipped examples", () => {
  it("has examples and gallery stats", () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(stats.pairs.median).toBeGreaterThan(stats.nearest.median);
  });

  for (const e of examples) {
    for (const which of ["before", "after"] as const) {
      const s = e[which];

      it(`${e.id} ${which}: the hash is the DCT block thresholded at its median`, () => {
        expect(s.grid.length).toBe(32 * 32);
        expect(s.bits).toEqual(s.dct.map((v) => v > s.median));
      });

      it(`${e.id} ${which}: the 8 × 8 block is the 32 × 32 grid's DCT, pattern by pattern`, () => {
        for (const [u, v] of [[0, 0], [0, 1], [1, 0], [3, 5], [7, 7]]) {
          const basis = dctBasis(u, v);
          let sum = 0;
          for (let i = 0; i < basis.length; i++) sum += s.grid[i] * basis[i];
          // scipy's unnormalised DCT-II doubles once per axis.
          expect(4 * sum).toBeCloseTo(s.dct[u * 8 + v], -1);
        }
      });
    }
  }
});
