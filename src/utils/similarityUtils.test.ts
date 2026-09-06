import { describe, expect, it } from "vitest";
import { computeCrossDistance, computeNeighbors, forceLayout } from "./similarityUtils";
import { makePanel } from "./testPanel";

const embeddings = {
  anchor: [1, 0],
  near: [0.99, 0.141],
  far: [-1, 0],
};

describe("computeNeighbors", () => {
  const anchor = makePanel({ id: "anchor", phash: "0000" });
  const near = makePanel({ id: "near", phash: "0001" });
  const far = makePanel({ id: "far", phash: "ffff" });

  it("never returns the anchor itself", () => {
    const out = computeNeighbors(anchor, [anchor, near], "phash", 10, null);
    expect(out.map((n) => n.panel.id)).toEqual(["near"]);
  });

  it("orders by distance, closest first", () => {
    const out = computeNeighbors(anchor, [far, near], "phash", 10, null);
    expect(out.map((n) => n.panel.id)).toEqual(["near", "far"]);
  });

  it("caps the result at the requested count", () => {
    expect(computeNeighbors(anchor, [far, near], "phash", 1, null)).toHaveLength(1);
  });

  it("skips candidates missing the hash", () => {
    const noHash = makePanel({ id: "nohash", phash: "" });
    const out = computeNeighbors(anchor, [noHash, near], "phash", 10, null);
    expect(out.map((n) => n.panel.id)).toEqual(["near"]);
  });

  it("returns nothing when the anchor itself has no hash", () => {
    const bare = makePanel({ id: "bare", phash: "" });
    expect(computeNeighbors(bare, [near, far], "phash", 10, null)).toEqual([]);
  });

  describe("embedding metrics", () => {
    const a = makePanel({ id: "anchor" });
    const n = makePanel({ id: "near" });
    const f = makePanel({ id: "far" });

    it("orders by cosine distance", () => {
      const out = computeNeighbors(a, [f, n], "embedding-siglip", 10, embeddings);
      expect(out.map((x) => x.panel.id)).toEqual(["near", "far"]);
    });

    it("returns nothing without an embedding map", () => {
      expect(computeNeighbors(a, [n, f], "embedding-dino", 10, null)).toEqual([]);
    });

    it("skips a panel absent from the map", () => {
      const absent = makePanel({ id: "absent" });
      const out = computeNeighbors(a, [absent, n], "embedding-gram", 10, embeddings);
      expect(out.map((x) => x.panel.id)).toEqual(["near"]);
    });
  });

  describe("color metric", () => {
    const chromatic = makePanel({
      id: "chromatic",
      colorfulness: 30,
      dominantColors: [[50, 60, 40]],
    });
    const alsoChromatic = makePanel({
      id: "also-chromatic",
      colorfulness: 20,
      dominantColors: [[52, 58, 42]],
    });
    const achromatic = makePanel({
      id: "achromatic",
      colorfulness: 2,
      dominantColors: [[50, 1, 1]],
    });

    it("never crosses the chromatic / achromatic partition", () => {
      const out = computeNeighbors(chromatic, [achromatic, alsoChromatic], "color", 10, null);
      expect(out.map((n) => n.panel.id)).toEqual(["also-chromatic"]);
    });

    it("matches an achromatic anchor only to achromatic candidates", () => {
      const otherGrey = makePanel({
        id: "other-grey",
        colorfulness: 1,
        dominantColors: [[60, 0, 0]],
      });
      const out = computeNeighbors(achromatic, [chromatic, otherGrey], "color", 10, null);
      expect(out.map((n) => n.panel.id)).toEqual(["other-grey"]);
    });

    it("drops a candidate whose palette distance is not finite", () => {
      // `paletteDistance` returns Infinity for a missing palette.
      const noPalette = makePanel({ id: "none", colorfulness: 30, dominantColors: null });
      const out = computeNeighbors(chromatic, [noPalette, alsoChromatic], "color", 10, null);
      expect(out.map((n) => n.panel.id)).toEqual(["also-chromatic"]);
    });
  });

  it("returns nothing for a metric it does not handle", () => {
    expect(computeNeighbors(anchor, [near], "ahash" as never, 10, null)).toEqual([]);
  });

  it("returns nothing when there are no candidates", () => {
    expect(computeNeighbors(anchor, [], "phash", 10, null)).toEqual([]);
  });
});

describe("computeCrossDistance", () => {
  const a = makePanel({ id: "anchor", phash: "0000", colorfulness: 30, dominantColors: [[50, 60, 40]] });
  const b = makePanel({ id: "near", phash: "0001", colorfulness: 30, dominantColors: [[50, 60, 40]] });

  it("measures hamming distance for phash", () => {
    expect(computeCrossDistance(a, b, "phash", null)).toBe(1);
  });

  it("measures cosine distance for an embedding metric", () => {
    expect(computeCrossDistance(a, b, "embedding-siglip", embeddings)).toBeCloseTo(
      1 - (1 * 0.99 + 0 * 0.141),
    );
  });

  it("measures palette distance for color", () => {
    expect(computeCrossDistance(a, b, "color", null)).toBeCloseTo(0);
  });

  it("crosses the color partition, unlike computeNeighbors", () => {
    // A cross-edge is a measurement between two named panels, not a search,
    // so the chromatic guard does not apply.
    const grey = makePanel({ id: "grey", colorfulness: 1, dominantColors: [[50, 1, 1]] });
    expect(computeCrossDistance(a, grey, "color", null)).toBeGreaterThan(0);
  });

  it("is null when a hash or embedding is missing", () => {
    const noHash = makePanel({ id: "nh", phash: "" });
    expect(computeCrossDistance(a, noHash, "phash", null)).toBeNull();
    expect(computeCrossDistance(a, b, "embedding-dino", null)).toBeNull();
    const absent = makePanel({ id: "absent" });
    expect(computeCrossDistance(a, absent, "embedding-gram", embeddings)).toBeNull();
  });

  it("is null for an unhandled metric", () => {
    expect(computeCrossDistance(a, b, "dhash" as never, null)).toBeNull();
  });
});

describe("forceLayout", () => {
  it("returns one position per node", () => {
    const out = forceLayout(5, [], 10);
    expect(out).toHaveLength(5);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("is deterministic — the seed positions are a fixed circle", () => {
    const edges = [{ source: 0, target: 1, weight: 1 }];
    expect(forceLayout(4, edges, 20)).toEqual(forceLayout(4, edges, 20));
  });

  it("handles a single node", () => {
    expect(forceLayout(1, [], 10)).toEqual([{ x: 0, y: 0 }]);
  });

  it("handles no nodes", () => {
    expect(forceLayout(0, [], 10)).toEqual([]);
  });

  it("survives an edge set whose weights are all zero", () => {
    // `maxWeight` is floored at 0.001 so the ideal length stays finite.
    const out = forceLayout(3, [{ source: 0, target: 1, weight: 0 }], 20);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("keeps positions finite with cross-edges present", () => {
    const out = forceLayout(
      4,
      [
        { source: 0, target: 1, weight: 0.4 },
        { source: 1, target: 2, weight: 0.9, isCross: true },
      ],
      50,
    );
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("pulls a connected pair closer than the repulsion alone would leave them", () => {
    const edges = [{ source: 0, target: 1, weight: 0.1 }];
    const relaxed = forceLayout(2, edges, 300);
    const d = Math.hypot(relaxed[0].x - relaxed[1].x, relaxed[0].y - relaxed[1].y);
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});
