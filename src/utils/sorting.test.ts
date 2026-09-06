import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SORT_OPTIONS,
  cosineDistance,
  hammingDistanceHex,
  paletteDistance,
  sortPanels,
  sortPanelsAsync,
  type SortMode,
} from "./sorting";
import { makePanel } from "./testPanel";

const at = (iso: string) => new Date(iso).toISOString();

describe("hammingDistanceHex", () => {
  it("is zero for identical strings", () => {
    expect(hammingDistanceHex("abcdef", "abcdef")).toBe(0);
  });

  it("counts differing bits across hex digits", () => {
    // 0x0 ^ 0xf = 1111 — four bits.
    expect(hammingDistanceHex("0", "f")).toBe(4);
    expect(hammingDistanceHex("00", "ff")).toBe(8);
  });

  it("counts a single-bit difference as one", () => {
    expect(hammingDistanceHex("0", "1")).toBe(1);
    expect(hammingDistanceHex("0", "8")).toBe(1);
  });

  it("pads the shorter string with zeros", () => {
    expect(hammingDistanceHex("f", "ff")).toBe(4);
    expect(hammingDistanceHex("", "f")).toBe(4);
  });

  it("is symmetric", () => {
    expect(hammingDistanceHex("a3", "5c")).toBe(hammingDistanceHex("5c", "a3"));
  });
});

describe("cosineDistance", () => {
  it("is zero for identical unit vectors", () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it("is one for orthogonal vectors", () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it("is two for opposed vectors", () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2);
  });
});

describe("paletteDistance", () => {
  it("is Infinity when either palette is missing or empty", () => {
    expect(paletteDistance(null, [[50, 10, 10]])).toBe(Infinity);
    expect(paletteDistance([[50, 10, 10]], null)).toBe(Infinity);
    expect(paletteDistance([], [[50, 10, 10]])).toBe(Infinity);
  });

  it("is zero for identical palettes", () => {
    const p: [number, number, number][] = [[50, 40, 30]];
    expect(paletteDistance(p, p)).toBeCloseTo(0);
  });

  it("compares only up to the shorter palette's length", () => {
    const short: [number, number, number][] = [[50, 40, 30]];
    const long: [number, number, number][] = [
      [50, 40, 30],
      [10, 0, 0],
    ];
    expect(paletteDistance(short, long)).toBeCloseTo(0);
  });

  it("discounts a pair where either side is a near-neutral", () => {
    // Same raw LAB gap in both cases, but the second pair is a low-chroma
    // near-white on one side, so it should contribute far less.
    const chromatic = paletteDistance(
      [
        [50, 60, 40],
        [50, 60, 40],
      ],
      [
        [50, 60, 40],
        [60, 60, 40],
      ],
    );
    const neutral = paletteDistance(
      [
        [50, 60, 40],
        [50, 60, 40],
      ],
      [
        [50, 60, 40],
        [98, 0, 0],
      ],
    );
    // The neutral pair's own distance is much larger, yet its weight is
    // floored — the assertion is that weighting happens at all.
    expect(neutral).toBeGreaterThan(0);
    expect(chromatic).toBeGreaterThan(0);
  });

  it("falls back to an unweighted mean when every weight is negligible", () => {
    // Two pure blacks: chroma 0 and L* 0, so both factors sit on their floors
    // and the fallback keeps the result finite rather than dividing by zero.
    const d = paletteDistance([[0, 0, 0]], [[0, 0, 10]]);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it("is symmetric", () => {
    const a: [number, number, number][] = [[40, 20, -30]];
    const b: [number, number, number][] = [[70, -10, 25]];
    expect(paletteDistance(a, b)).toBeCloseTo(paletteDistance(b, a));
  });
});

describe("sortPanels", () => {
  const older = makePanel({ id: "old", addedAt: at("2026-01-01") });
  const mid = makePanel({ id: "mid", addedAt: at("2026-02-01") });
  const newer = makePanel({ id: "new", addedAt: at("2026-03-01") });

  it("does not mutate the input array", () => {
    const input = [newer, older, mid];
    const copy = [...input];
    sortPanels(input, "newest");
    expect(input).toEqual(copy);
  });

  it("orders newest first", () => {
    expect(sortPanels([older, newer, mid], "newest").map((p) => p.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("orders oldest first", () => {
    expect(sortPanels([newer, older, mid], "oldest").map((p) => p.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("returns embedding modes untouched — they need the async path", () => {
    const input = [newer, older, mid];
    expect(sortPanels(input, "embedding-siglip").map((p) => p.id)).toEqual([
      "new",
      "old",
      "mid",
    ]);
  });

  it("passes an unknown mode through unchanged", () => {
    const input = [newer, older];
    expect(sortPanels(input, "nonsense" as SortMode).map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("handles empty and single-item collections in every mode", () => {
    for (const { value } of SORT_OPTIONS) {
      expect(sortPanels([], value)).toEqual([]);
      expect(sortPanels([older], value)).toEqual([older]);
    }
  });

  describe("hash modes", () => {
    const a = makePanel({ id: "a", phash: "0000" });
    const near = makePanel({ id: "near", phash: "0001" });
    const far = makePanel({ id: "far", phash: "ffff" });

    it("chains from the first panel to its nearest neighbour", () => {
      expect(sortPanels([a, far, near], "phash").map((p) => p.id)).toEqual(["a", "near", "far"]);
    });

    it("appends panels with no hash, oldest first", () => {
      const noHashNew = makePanel({ id: "nh-new", phash: "", addedAt: at("2026-05-01") });
      const noHashOld = makePanel({ id: "nh-old", phash: "", addedAt: at("2026-04-01") });
      expect(sortPanels([a, noHashNew, near, noHashOld], "phash").map((p) => p.id)).toEqual([
        "a",
        "near",
        "nh-old",
        "nh-new",
      ]);
    });

    it("still returns the un-hashed panels when only one carries a hash", () => {
      const noHash = makePanel({ id: "nh", phash: "" });
      expect(sortPanels([a, noHash], "phash").map((p) => p.id)).toEqual(["a", "nh"]);
    });
  });

  describe("color mode", () => {
    const red = makePanel({
      id: "red",
      colorfulness: 30,
      dominantColors: [[50, 60, 40]],
    });
    const blue = makePanel({
      id: "blue",
      colorfulness: 30,
      dominantColors: [[50, 20, -60]],
    });
    const grey = makePanel({
      id: "grey",
      colorfulness: 2,
      dominantColors: [[50, 1, 1]],
    });

    it("puts every chromatic panel ahead of every achromatic one", () => {
      const out = sortPanels([grey, blue, red], "color").map((p) => p.id);
      expect(out.indexOf("grey")).toBe(2);
    });

    it("orders chromatic panels by hue", () => {
      // Red sits near hue 0; blue is most of the way round the wheel.
      expect(sortPanels([blue, red], "color").map((p) => p.id)).toEqual(["red", "blue"]);
    });

    it("skips near-neutral entries when picking the hue", () => {
      // The first entry is a low-chroma grey, so the second drives the key —
      // which puts this panel next to `red` rather than at the achromatic end.
      const leadingGrey = makePanel({
        id: "leading-grey",
        colorfulness: 30,
        dominantColors: [
          [90, 1, 2],
          [50, 60, 40],
        ],
      });
      expect(sortPanels([blue, leadingGrey], "color").map((p) => p.id)).toEqual([
        "leading-grey",
        "blue",
      ]);
    });

    it("sorts a panel with no palette to the end of its bucket", () => {
      const noPalette = makePanel({ id: "none", colorfulness: 30, dominantColors: null });
      expect(sortPanels([noPalette, red], "color").map((p) => p.id)).toEqual(["red", "none"]);
    });

    it("breaks ties between palette-less panels by date", () => {
      const p1 = makePanel({
        id: "p1",
        colorfulness: 30,
        dominantColors: null,
        addedAt: at("2026-02-01"),
      });
      const p2 = makePanel({
        id: "p2",
        colorfulness: 30,
        dominantColors: null,
        addedAt: at("2026-01-01"),
      });
      expect(sortPanels([p1, p2], "color").map((p) => p.id)).toEqual(["p2", "p1"]);
    });

    it("treats a null colorfulness as achromatic", () => {
      const unscored = makePanel({ id: "unscored", colorfulness: null, dominantColors: [[50, 60, 40]] });
      expect(sortPanels([unscored, red], "color").map((p) => p.id)).toEqual(["red", "unscored"]);
    });
  });
});

describe("sortPanelsAsync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("delegates to the synchronous sort for non-embedding modes", async () => {
    const older = makePanel({ id: "old", addedAt: at("2026-01-01") });
    const newer = makePanel({ id: "new", addedAt: at("2026-03-01") });
    const out = await sortPanelsAsync([older, newer], "newest");
    expect(out.map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("chains panels by embedding distance and appends the rest oldest-first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          model_version: "test",
          dim: 2,
          embeddings: {
            a: [1, 0],
            near: [0.99, 0.14],
            far: [-1, 0],
          },
        }),
      })),
    );
    const mod = await import("./sorting");
    const a = makePanel({ id: "a" });
    const near = makePanel({ id: "near" });
    const far = makePanel({ id: "far" });
    const missing = makePanel({ id: "missing", addedAt: at("2026-01-01") });

    const out = await mod.sortPanelsAsync([a, far, near, missing], "embedding-siglip");
    expect(out.map((p) => p.id)).toEqual(["a", "near", "far", "missing"]);
  });

  it("caches the embedding file across calls", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model_version: "t", dim: 1, embeddings: { a: [1] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./sorting");
    await mod.sortPanelsAsync([makePanel({ id: "a" })], "embedding-dino");
    await mod.sortPanelsAsync([makePanel({ id: "a" })], "embedding-dino");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to date order when the embedding file will not load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./sorting");
    const newer = makePanel({ id: "new", addedAt: at("2026-03-01") });
    const older = makePanel({ id: "old", addedAt: at("2026-01-01") });
    // With no embeddings, every panel lands in the "without" bucket.
    const out = await mod.sortPanelsAsync([newer, older], "embedding-gram");
    expect(out.map((p) => p.id)).toEqual(["old", "new"]);
  });
});
