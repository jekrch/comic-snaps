import { describe, expect, it } from "vitest";
import { colorName, dist3, hueGap, labToRgb8, rgbToLab } from "./cielab";
import { paletteDistance } from "../../utils/sorting";
import { placeChips } from "./CielabPlane";

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

const name = (rgb: [number, number, number]) => colorName(...rgbToLab(rgb));

describe("colorName", () => {
  it("names the sRGB primaries by their everyday names, not CIELAB's angles", () => {
    expect(name([255, 0, 0])).toBe("a vivid red");
    expect(name([255, 255, 0])).toBe("a pale yellow");
    expect(name([0, 255, 0])).toBe("a pale green");
    expect(name([0, 0, 255])).toBe("a dark blue");
    expect(name([187, 57, 152])).toBe("a vivid magenta");
  });

  it("calls low-chroma colours by their lightness", () => {
    expect(name([14, 12, 12])).toBe("a near-black");
    expect(name([245, 245, 240])).toBe("an off-white");
    expect(name([140, 140, 133])).toBe("a grey");
  });

  it("keeps dusty purples out of blue", () => {
    expect(name([118, 108, 140])).toBe("a muted purple");
  });
});

describe("hueGap", () => {
  it("goes the short way round", () => {
    expect(hueGap(350, 10)).toBe(20);
    expect(hueGap(10, 190)).toBe(180);
  });
});

describe("paletteDistance", () => {
  it("is a weighted mean of the matched pairs' distances", () => {
    const a: [number, number, number][] = [[50, 40, 0], [95, 0, 0]];
    const b: [number, number, number][] = [[50, 0, 0], [95, 0, 0]];
    // The white pair is 0 apart, so the mean sits below the coloured pair's 40.
    const d = paletteDistance(a, b);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(40);
  });
});

describe("placeChips", () => {
  const gaps = (c: { x: number; y: number }[]) => [
    Math.hypot(c[0].x - c[1].x, c[0].y - c[1].y),
    Math.hypot(c[0].x - c[2].x, c[0].y - c[2].y),
    Math.hypot(c[1].x - c[2].x, c[1].y - c[2].y),
  ];

  it("leaves well-separated colours on their true spots", () => {
    const c = placeChips([[100, 100], [200, 200], [250, 60]]);
    expect(c.every((k) => !k.moved)).toBe(true);
  });

  it("fans out colours that land on the same spot, even at the edge", () => {
    for (const spot of [[150, 150], [299, 1]] as const) {
      const c = placeChips([[...spot], [...spot], [...spot]] as [number, number][]);
      for (const g of gaps(c)) expect(g).toBeGreaterThan(25);
    }
  });
});
