import { describe, expect, it } from "vitest";
import {
  GLIDE_TAU,
  MAX_VELOCITY,
  RELEASE_STALE,
  VELOCITY_WINDOW,
  glideAt,
  glideDone,
  planGlide,
  releaseVelocity,
} from "./stripGlide";

describe("releaseVelocity", () => {
  it("is zero with fewer than two samples", () => {
    expect(releaseVelocity([], 0)).toBe(0);
    expect(releaseVelocity([{ t: 0, x: 0 }], 0)).toBe(0);
  });

  it("measures the slope over the recent window, not the whole drag", () => {
    // A slow start, then a fast flick at the end.
    const samples = [
      { t: 0, x: 0 },
      { t: 100, x: 10 },
      { t: 200, x: 20 },
      { t: 220, x: 60 },
      { t: 240, x: 100 },
    ];
    expect(releaseVelocity(samples, 240)).toBeCloseTo(2, 5);
  });

  it("ignores samples older than the window", () => {
    const samples = [
      { t: 0, x: 0 },
      { t: VELOCITY_WINDOW + 50, x: 1000 },
      { t: VELOCITY_WINDOW + 60, x: 1010 },
    ];
    expect(releaseVelocity(samples, VELOCITY_WINDOW + 60)).toBeCloseTo(1, 5);
  });

  it("cancels the throw when the hand paused before letting go", () => {
    const samples = [
      { t: 0, x: 0 },
      { t: 20, x: 80 },
    ];
    expect(releaseVelocity(samples, 20 + RELEASE_STALE + 1)).toBe(0);
  });

  it("is capped in both directions", () => {
    const right = [
      { t: 0, x: 0 },
      { t: 10, x: 1000 },
    ];
    const left = [
      { t: 0, x: 0 },
      { t: 10, x: -1000 },
    ];
    expect(releaseVelocity(right, 10)).toBe(MAX_VELOCITY);
    expect(releaseVelocity(left, 10)).toBe(-MAX_VELOCITY);
  });
});

describe("planGlide", () => {
  it("does not glide on a placement", () => {
    expect(planGlide(100, 0, 1000)).toBeNull();
    expect(planGlide(100, 0.01, 1000)).toBeNull();
  });

  it("travels velocity × τ", () => {
    expect(planGlide(100, 1, 5000)).toEqual({ from: 100, to: 100 + GLIDE_TAU });
    expect(planGlide(1000, -1, 5000)).toEqual({ from: 1000, to: 1000 - GLIDE_TAU });
  });

  it("lands on the end of the strip rather than past it", () => {
    expect(planGlide(900, 4, 1000)).toEqual({ from: 900, to: 1000 });
    expect(planGlide(50, -4, 1000)).toEqual({ from: 50, to: 0 });
  });

  it("does nothing when already against the end it is thrown toward", () => {
    expect(planGlide(1000, 3, 1000)).toBeNull();
    expect(planGlide(0, -3, 1000)).toBeNull();
  });
});

describe("glideAt", () => {
  const glide = { from: 0, to: 600 };

  it("starts where it was released and moves monotonically toward rest", () => {
    expect(glideAt(glide, 0)).toBe(0);
    let prev = 0;
    for (let t = 16; t < 3000; t += 16) {
      const x = glideAt(glide, t);
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeLessThanOrEqual(600);
      prev = x;
    }
  });

  it("leaves at the release velocity", () => {
    // d/dt at 0 is (to - from) / τ, which is the velocity planGlide was given.
    const v = (glideAt(glide, 1) - glideAt(glide, 0)) / 1;
    expect(v).toBeCloseTo(600 / GLIDE_TAU, 2);
  });

  it("settles within a couple of seconds", () => {
    expect(glideDone(glide, 100)).toBe(false);
    expect(glideDone(glide, GLIDE_TAU * 8)).toBe(true);
  });
});
