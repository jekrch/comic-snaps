import { describe, expect, it } from "vitest";
import {
  clipInsets,
  coverRect,
  cropsAnything,
  dissolveMask,
  featherFor,
  parseObjectPosition,
} from "./sharedElement";

describe("parseObjectPosition", () => {
  it("reads the percentages browsers compute the property to", () => {
    expect(parseObjectPosition("50% 22%")).toEqual({ x: 0.5, y: 0.22 });
  });

  it("reads keywords", () => {
    expect(parseObjectPosition("left top")).toEqual({ x: 0, y: 0 });
    expect(parseObjectPosition("right bottom")).toEqual({ x: 1, y: 1 });
    expect(parseObjectPosition("center center")).toEqual({ x: 0.5, y: 0.5 });
  });

  it("centres on a missing axis or a unit it cannot read as a fraction", () => {
    expect(parseObjectPosition("center")).toEqual({ x: 0.5, y: 0.5 });
    expect(parseObjectPosition("10px 20px")).toEqual({ x: 0.5, y: 0.5 });
    expect(parseObjectPosition("")).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("coverRect", () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };

  it("fills the box and overflows on the cropped axis only", () => {
    // A 200x200 image in a 200x100 box: scaled to 200 wide, 200 tall.
    const r = coverRect(box, { width: 200, height: 200 }, { x: 0.5, y: 0.5 });
    expect(r.width).toBe(200);
    expect(r.height).toBe(200);
    expect(r.left).toBe(100);
    expect(r.top).toBe(0); // centred: 50px of overflow hangs off each edge
  });

  it("hangs the overflow where object-position puts it", () => {
    const top = coverRect(box, { width: 200, height: 200 }, { x: 0.5, y: 0 });
    expect(top.top).toBe(50); // image top pinned to the box top

    const low = coverRect(box, { width: 200, height: 200 }, { x: 0.5, y: 0.22 });
    expect(low.top).toBeCloseTo(50 - 100 * 0.22);
  });

  it("scales up to cover a box larger than the image", () => {
    const r = coverRect(box, { width: 50, height: 50 }, { x: 0.5, y: 0.5 });
    expect(r.width).toBe(200);
    expect(r.height).toBe(200);
  });
});

describe("clipInsets", () => {
  // The image rests at 400x400 and collapses onto a 200x200 origin, so the
  // flight halves it: every viewport pixel of crop is two of the image's own.
  const rest = { left: 0, top: 0, width: 400, height: 400 };
  const origin = { left: 100, top: 0, width: 200, height: 200 };

  it("measures the crop in the untransformed image's pixels", () => {
    const clip = { left: 100, top: 50, width: 200, height: 100 };
    expect(clipInsets(rest, origin, clip)).toEqual({ top: 100, right: 0, bottom: 100, left: 0 });
  });

  it("is all zeroes when the thumbnail shows the whole image", () => {
    const insets = clipInsets(rest, origin, origin);
    expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(cropsAnything(insets)).toBe(false);
  });

  it("never opens the aperture wider than the image", () => {
    // A tile hanging off the left edge of the viewport would ask for a
    // negative inset; the crop only ever closes.
    const clip = { left: 50, top: 0, width: 200, height: 200 };
    expect(clipInsets(rest, origin, clip).left).toBe(0);
  });
});

/** Pull the (alpha, position) stops back out of a gradient string. */
function stops(mask: string) {
  return [...mask.matchAll(/rgba\(0,0,0,([\d.]+)\) (-?[\d.]+)px/g)].map((m) => ({
    alpha: parseFloat(m[1]),
    at: parseFloat(m[2]),
  }));
}

describe("dissolveMask", () => {
  // A 400px-wide image whose tile shows only the middle 200px.
  const insets = { top: 0, right: 100, bottom: 0, left: 100 };
  const size = { width: 400, height: 300 };

  it("leaves the whole picture alone at the start", () => {
    for (const s of stops(dissolveMask(insets, size, 0, 40))) expect(s.alpha).toBe(1);
  });

  it("takes the crop to nothing and the kept slice to nothing less", () => {
    const s = stops(dissolveMask(insets, size, 1, 40));
    expect(s.map((x) => x.alpha)).toEqual([0, 0, 1, 1, 0, 0]);
    // A clean edge on the tile's box: no ramp left hanging outside it.
    expect(s.map((x) => x.at)).toEqual([0, 100, 100, 300, 300, 400]);
  });

  it("fades where it stands rather than closing inward", () => {
    // The kept slice is the same slice at every point of the fade — it is the
    // alpha outside it that moves, not the boundary.
    // Skipping progress 0, where nothing is faded yet and so everything is kept.
    for (const p of [0.25, 0.5, 0.75, 1]) {
      const s = stops(dissolveMask(insets, size, p, 40));
      const kept = s.filter((x) => x.alpha === 1).map((x) => x.at);
      expect(kept).toEqual([100, 300]);
    }
  });

  it("fades at an even rate", () => {
    const outer = [0, 0.25, 0.5, 0.75, 1].map((p) => stops(dissolveMask(insets, size, p, 40))[0].alpha);
    expect(outer).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it("softens the join, and closes the softening as the fade lands", () => {
    const mid = stops(dissolveMask(insets, size, 0.5, 40));
    expect(mid[1].at).toBe(80); // a 20px ramp into the boundary at 100
    expect(stops(dissolveMask(insets, size, 1, 40))[1].at).toBe(100); // none left
  });

  it("runs down the other axis when that is the one that crops", () => {
    const tall = { top: 50, right: 0, bottom: 50, left: 0 };
    const mask = dissolveMask(tall, size, 0.5, 20);
    expect(mask.startsWith("linear-gradient(to bottom,")).toBe(true);
    const last = stops(mask)[stops(mask).length - 1];
    expect(last.at).toBe(300); // the height, not the width
  });

  it("keeps the ramp inside the picture when the crop is all on one side", () => {
    const oneSided = { top: 0, right: 200, bottom: 0, left: 0 };
    for (const s of stops(dissolveMask(oneSided, size, 0.5, 80))) {
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThanOrEqual(400);
    }
  });
});

describe("featherFor", () => {
  it("scales the softening with the strip being faded", () => {
    expect(featherFor({ top: 0, right: 100, bottom: 0, left: 100 })).toBe(40);
    expect(featherFor({ top: 25, right: 0, bottom: 25, left: 0 })).toBe(10);
  });
});
