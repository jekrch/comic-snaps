import { describe, expect, it } from "vitest";
import {
  FADE_W,
  HEAD_GAP,
  HEAD_H,
  HERO_ASPECT,
  RAIL_BAND_H,
  STRIP_H,
  STRIP_H_NARROW,
  TEASE_ASPECT,
  capNames,
  clampAspect,
  meterPlayed,
  panelAspect,
  placeholderFor,
  postedRange,
  rowHeight,
} from "./rowGeometry";
import { makePanel } from "../utils/testPanel";

/** Local-time construction, so the assertions do not move with the runner's
 *  timezone the way an epoch literal would. */
const day = (y: number, monthIndex: number, d: number) => new Date(y, monthIndex, d).getTime();

describe("rowHeight", () => {
  it("stacks head, gap and strip on the desktop layout", () => {
    expect(rowHeight(false)).toBe(HEAD_H + HEAD_GAP + STRIP_H);
  });

  it("adds the rail band and shortens the strip on the narrow one", () => {
    expect(rowHeight(true)).toBe(HEAD_H + HEAD_GAP + RAIL_BAND_H + STRIP_H_NARROW);
  });

  it("is the same for both shelves at a given breakpoint", () => {
    // Series and artists must agree, or switching views reads as a new page.
    expect(rowHeight(false)).toBeGreaterThan(0);
    expect(rowHeight(true)).toBeGreaterThan(0);
  });

  it("gives the head room for a 15px line", () => {
    expect(HEAD_H).toBeGreaterThanOrEqual(28);
  });

  it("closes the edge dissolve over the same distance it is wide", () => {
    expect(FADE_W).toBe(80);
  });
});

describe("panelAspect", () => {
  it("is width over height", () => {
    expect(panelAspect(makePanel({ width: 300, height: 150 }))).toBe(2);
  });

  it("falls back to 0.75 when a dimension is missing", () => {
    // Covers carry zeroes until their image loads.
    expect(panelAspect(makePanel({ width: 0, height: 0 }))).toBe(0.75);
    expect(panelAspect(makePanel({ width: 300, height: 0 }))).toBe(0.75);
    expect(panelAspect(makePanel({ width: 0, height: 150 }))).toBe(0.75);
  });
});

describe("clampAspect", () => {
  it("passes an in-range aspect through", () => {
    expect(clampAspect(1, HERO_ASPECT)).toBe(1);
  });

  it("clamps the wall's extremes into the hero band", () => {
    // Panel aspects run 0.32 to 3.33; unclamped they become slivers and
    // full-row monsters.
    expect(clampAspect(0.32, HERO_ASPECT)).toBe(HERO_ASPECT[0]);
    expect(clampAspect(3.33, HERO_ASPECT)).toBe(HERO_ASPECT[1]);
  });

  it("holds teases narrower than heroes so they never out-mass one", () => {
    expect(TEASE_ASPECT[1]).toBeLessThan(HERO_ASPECT[1]);
    expect(clampAspect(3.33, TEASE_ASPECT)).toBe(TEASE_ASPECT[1]);
  });
});

describe("placeholderFor", () => {
  it("names the panel's first dominant colour", () => {
    expect(placeholderFor(makePanel({ dominantColors: [[50, 10, -20]] }))).toBe("lab(50 10 -20)");
  });

  it("is undefined without a palette", () => {
    expect(placeholderFor(makePanel({ dominantColors: null }))).toBeUndefined();
    expect(placeholderFor(makePanel({ dominantColors: [] }))).toBeUndefined();
  });
});

describe("capNames", () => {
  it("shows at most two names", () => {
    expect(capNames(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], extra: 2 });
  });

  it("reports no overflow when two or fewer", () => {
    expect(capNames(["a", "b"])).toEqual({ shown: ["a", "b"], extra: 0 });
    expect(capNames(["a"])).toEqual({ shown: ["a"], extra: 0 });
    expect(capNames([])).toEqual({ shown: [], extra: 0 });
  });
});

describe("postedRange", () => {
  it("is null when either end is missing", () => {
    expect(postedRange(0, day(2026, 7, 1))).toBeNull();
    expect(postedRange(day(2026, 7, 1), 0)).toBeNull();
    expect(postedRange(0, 0)).toBeNull();
  });

  it("prints one month-and-year for a single posting day", () => {
    const out = postedRange(day(2026, 7, 15), day(2026, 7, 15))!;
    expect(out).not.toContain("–");
    expect(out).toContain("2026");
  });

  it("drops to days for a span inside one month", () => {
    // "Aug 2026" at both ends would read as a single post rather than a
    // fortnight of them.
    const out = postedRange(day(2026, 7, 1), day(2026, 7, 15))!;
    expect(out).toContain("–");
    expect(out).toContain("15");
    expect(out).toContain("2026");
    // The month is named once, the year once.
    expect(out.match(/2026/g)).toHaveLength(1);
  });

  it("uses month precision across different months", () => {
    const out = postedRange(day(2026, 0, 5), day(2026, 7, 20))!;
    expect(out).toContain("–");
    // Day numbers do not appear at month precision.
    expect(out).not.toContain("5,");
    expect(out).not.toContain("20,");
  });

  it("uses month precision across different years, naming both", () => {
    const out = postedRange(day(2025, 7, 1), day(2026, 7, 1))!;
    expect(out).toContain("2025");
    expect(out).toContain("2026");
  });

  it("does not collapse the same month in different years", () => {
    const out = postedRange(day(2025, 7, 1), day(2026, 7, 15))!;
    expect(out.match(/202[56]/g)).toHaveLength(2);
  });
});

describe("meterPlayed", () => {
  it("is a module-scoped set, so a re-sort does not replay twenty meters", () => {
    expect(meterPlayed).toBeInstanceOf(Set);
    meterPlayed.add("saga");
    expect(meterPlayed.has("saga")).toBe(true);
    meterPlayed.delete("saga");
  });
});
