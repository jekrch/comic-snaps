import { describe, expect, it } from "vitest";
import { dist3, labToRgb8, rgbToLab } from "./cielab";

describe("cielab", () => {
  it("round-trips sRGB through CIELAB", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [93, 55, 75], [0, 255, 0], [12, 200, 240]] as const) {
      expect(labToRgb8(...rgbToLab(rgb))).toEqual(rgb);
    }
  });

  it("white is L* 100, neutral", () => {
    const [L, a, b] = rgbToLab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 0);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });

  // The pure-colour pairs in RgbVsLab: equal RGB gaps, very unequal CIELAB ones.
  it("keeps the RGB-vs-CIELAB example honest", () => {
    const alike = [[0, 255, 0], [40, 255, 4]] as const;
    const apart = [[93, 55, 75], [74, 82, 52]] as const;
    expect(dist3(...alike)).toBeCloseTo(dist3(...apart), 1);
    expect(dist3(rgbToLab(alike[0]), rgbToLab(alike[1]))).toBeLessThan(3);
    expect(dist3(rgbToLab(apart[0]), rgbToLab(apart[1]))).toBeGreaterThan(30);
  });
});
