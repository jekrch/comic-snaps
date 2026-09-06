import { describe, expect, it } from "vitest";
import {
  COLOR_FORMATS,
  formatColor,
  labToRgb255,
  prefersDarkInk,
  toHex,
  type Lab,
  type Rgb255,
} from "./colorFormats";

describe("labToRgb255", () => {
  it("maps the CIELAB extremes onto the sRGB extremes", () => {
    expect(labToRgb255([100, 0, 0])).toEqual([255, 255, 255]);
    expect(labToRgb255([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("keeps a neutral L* neutral", () => {
    const [r, g, b] = labToRgb255([50, 0, 0]);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("resolves sRGB red", () => {
    expect(labToRgb255([53.24, 80.09, 67.2])).toEqual([255, 0, 0]);
  });

  it("clamps a centroid outside the sRGB gamut into it", () => {
    const rgb = labToRgb255([50, 200, -200]);
    for (const c of rgb) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it("clamps rather than wrapping for an L* above 100", () => {
    expect(labToRgb255([200, 0, 0])).toEqual([255, 255, 255]);
  });

  it("returns whole bytes for arbitrary input", () => {
    const rgb = labToRgb255([37.4, -21.9, 14.3]);
    expect(rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
  });
});

describe("toHex", () => {
  it("pads each channel to two digits", () => {
    expect(toHex([0, 0, 0])).toBe("#000000");
    expect(toHex([255, 255, 255])).toBe("#ffffff");
    expect(toHex([1, 2, 3])).toBe("#010203");
  });
});

describe("formatColor", () => {
  const red: Rgb255 = [255, 0, 0];
  const white: Rgb255 = [255, 255, 255];
  const grey: Rgb255 = [119, 119, 119];

  it("emits every declared format", () => {
    for (const format of COLOR_FORMATS) {
      expect(typeof formatColor(red, format)).toBe("string");
      expect(formatColor(red, format).length).toBeGreaterThan(0);
    }
  });

  it("formats hex and rgb straight off the bytes", () => {
    expect(formatColor(red, "hex")).toBe("#ff0000");
    expect(formatColor(red, "rgb")).toBe("rgb(255, 0, 0)");
  });

  it("formats hsl", () => {
    expect(formatColor(red, "hsl")).toBe("hsl(0, 100%, 50%)");
    expect(formatColor(white, "hsl")).toBe("hsl(0, 0%, 100%)");
    expect(formatColor([0, 0, 255], "hsl")).toBe("hsl(240, 100%, 50%)");
  });

  it("gives a grey zero saturation rather than a spurious hue", () => {
    expect(formatColor(grey, "hsl")).toBe("hsl(0, 0%, 47%)");
  });

  it("adapts CSS lab() to the D50 white it is defined against", () => {
    // White must land on L*=100 with no a/b cast — the Bradford round trip is
    // the whole reason this branch exists.
    expect(formatColor(white, "lab")).toBe("lab(100 0 0)");
    expect(formatColor(red, "lab")).toBe("lab(54.29 80.8 69.89)");
  });

  it("formats oklch", () => {
    expect(formatColor(white, "oklch")).toBe("oklch(1 0 0)");
    expect(formatColor(red, "oklch")).toBe("oklch(0.628 0.258 29.2)");
  });

  it("prints hue 0 for an achromatic oklch rather than floating-point dust", () => {
    expect(formatColor(grey, "oklch")).toBe("oklch(0.569 0 0)");
    expect(formatColor([0, 0, 0], "oklch")).toBe("oklch(0 0 0)");
  });

  it("keeps the oklch hue in [0, 360)", () => {
    for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [180, 20, 200]] as Rgb255[]) {
      const hue = Number(formatColor(rgb, "oklch").match(/([\d.]+)\)$/)![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("sheds trailing zeros so nothing reads as false precision", () => {
    expect(formatColor(white, "lab")).not.toMatch(/\.00/);
    expect(formatColor(white, "oklch")).not.toMatch(/\.000/);
  });

  it("names the same colour the swatch is painted from", () => {
    // Everything funnels through one byte triple, so hex and rgb can never
    // disagree about which square was copied.
    const lab: Lab = [64.2, 18.7, -33.1];
    const rgb = labToRgb255(lab);
    expect(formatColor(rgb, "hex")).toBe(toHex(rgb));
    expect(formatColor(rgb, "rgb")).toBe(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  });
});

describe("prefersDarkInk", () => {
  it("wants dark ink on a light ground", () => {
    expect(prefersDarkInk([255, 255, 255])).toBe(true);
    expect(prefersDarkInk([240, 240, 200])).toBe(true);
  });

  it("wants light ink on a dark ground", () => {
    expect(prefersDarkInk([0, 0, 0])).toBe(false);
    expect(prefersDarkInk([20, 20, 40])).toBe(false);
  });

  it("weights the channels by luminance, not by L*", () => {
    // Pure blue is far darker than pure green at the same byte value, so the
    // two must land on opposite sides of the threshold.
    expect(prefersDarkInk([0, 255, 0])).toBe(true);
    expect(prefersDarkInk([0, 0, 255])).toBe(false);
  });
});
