import { describe, expect, it } from "vitest";
import { dinoInputSize, gramInputSize } from "./PreprocessFigure";

// Expected values are what scripts/compute-embeddings.py's gram_input()
// produces: short side 448, long side capped at 1024, Python round().
describe("gramInputSize", () => {
  it("matches the Python pipeline for a wide panel", () => {
    expect(gramInputSize(1280, 483)).toEqual([1024, 386]);
  });

  it("matches the Python pipeline for a moderately tall panel", () => {
    expect(gramInputSize(960, 1280)).toEqual([448, 597]);
  });

  it("keeps a square panel square", () => {
    expect(gramInputSize(1000, 1000)).toEqual([448, 448]);
  });
});

// Expected values are what scripts/compute-embeddings.py's dino_pixels()
// produces for the same stored sizes (short side 256, long side capped at
// 1036, both snapped to 14 px patches with Python's round-half-even).
describe("dinoInputSize", () => {
  it("matches the Python pipeline for a wide panel", () => {
    expect(dinoInputSize(1280, 483)).toEqual([672, 252]);
  });

  it("matches the Python pipeline for a tall panel", () => {
    expect(dinoInputSize(960, 1280)).toEqual([252, 336]);
  });

  it("keeps a square panel square", () => {
    expect(dinoInputSize(1000, 1000)).toEqual([252, 252]);
  });

  it("caps the long side of a very long strip", () => {
    const [w, h] = dinoInputSize(5000, 1000);
    expect(w).toBe(1036);
    expect(h).toBe(210);
  });

  it("always yields whole patches", () => {
    for (const [w, h] of [[1279, 481], [333, 1280], [1280, 1279]]) {
      const [dw, dh] = dinoInputSize(w, h);
      expect(dw % 14).toBe(0);
      expect(dh % 14).toBe(0);
    }
  });
});
