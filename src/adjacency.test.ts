import { describe, expect, it } from "vitest";
import { resolveNeighbors } from "./adjacency";
import { makePanel } from "./utils/testPanel";

/** Panels are square here, so the height function is trivial and the
 *  geometry in each case reads straight off the rects. */
const squareHeight = (_: unknown, w: number) => w;

function panelAt(id: string, x: number, y: number, w: number) {
  return { kind: "panel" as const, panel: makePanel({ id }), x, y, w, h: w };
}

function fillerAt(key: string, x: number, y: number, w: number, h: number) {
  return { kind: "filler" as const, key, x, y, w, h };
}

describe("resolveNeighbors", () => {
  it("returns an entry for every filler, even a lonely one", () => {
    const out = resolveNeighbors([fillerAt("f", 0, 0, 10, 10)], squareHeight);
    expect(out.size).toBe(1);
    expect(out.get("f")).toEqual({});
  });

  it("finds a panel whose bottom edge meets the filler's top", () => {
    const out = resolveNeighbors(
      [panelAt("above", 0, 0, 100), fillerAt("f", 0, 100, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.top?.id).toBe("above");
  });

  it("finds a panel whose top edge meets the filler's bottom", () => {
    const out = resolveNeighbors(
      [panelAt("below", 0, 120, 100), fillerAt("f", 0, 100, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.bottom?.id).toBe("below");
  });

  it("finds panels on the left and right", () => {
    const out = resolveNeighbors(
      [
        panelAt("left", 0, 0, 100),
        panelAt("right", 120, 0, 100),
        fillerAt("f", 100, 0, 20, 100),
      ],
      squareHeight,
    );
    expect(out.get("f")?.left?.id).toBe("left");
    expect(out.get("f")?.right?.id).toBe("right");
  });

  it("resolves all four sides at once", () => {
    const out = resolveNeighbors(
      [
        panelAt("top", 100, 0, 100),
        panelAt("bottom", 100, 120, 100),
        panelAt("left", 0, 100, 100),
        panelAt("right", 200, 100, 100),
        fillerAt("f", 100, 100, 100, 20),
      ],
      squareHeight,
    );
    const n = out.get("f")!;
    expect([n.top?.id, n.bottom?.id, n.left?.id, n.right?.id]).toEqual([
      "top",
      "bottom",
      "left",
      "right",
    ]);
  });

  it("tolerates a sub-pixel gap between edges", () => {
    // EDGE_TOLERANCE is 6px, so a 5px gutter still counts as adjacent.
    const out = resolveNeighbors(
      [panelAt("above", 0, 0, 100), fillerAt("f", 0, 105, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.top?.id).toBe("above");
  });

  it("does not join across a gap wider than the tolerance", () => {
    const out = resolveNeighbors(
      [panelAt("above", 0, 0, 100), fillerAt("f", 0, 140, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.top).toBeUndefined();
  });

  it("requires a real overlap, not just a touching corner", () => {
    // The panel's bottom edge is level with the filler's top, but they only
    // share 2px horizontally — under the 4px minimum.
    const out = resolveNeighbors(
      [panelAt("corner", 98, 0, 100), fillerAt("f", 0, 100, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.top).toBeUndefined();
  });

  it("prefers the panel earliest in layout order when several are adjacent", () => {
    const out = resolveNeighbors(
      [
        panelAt("first", 0, 0, 100),
        panelAt("second", 50, 0, 100),
        fillerAt("f", 0, 100, 150, 20),
      ],
      squareHeight,
    );
    expect(out.get("f")?.top?.id).toBe("first");
  });

  it("derives panel height from the callback, not from a stored h", () => {
    // A half-height panel ends at y=50, so only the filler placed there is
    // adjacent to it.
    const halfHeight = (_: unknown, w: number) => w / 2;
    const items = [
      panelAt("p", 0, 0, 100),
      fillerAt("meets", 0, 50, 100, 20),
      fillerAt("misses", 0, 100, 100, 20),
    ];
    const out = resolveNeighbors(items, halfHeight);
    expect(out.get("meets")?.top?.id).toBe("p");
    expect(out.get("misses")?.top).toBeUndefined();
  });

  it("finds a neighbour far down the page, across band boundaries", () => {
    // BAND_HEIGHT is 512px; this pair sits well past several of them, so the
    // band index has to place both in the same bucket to match.
    const y = 5000;
    const out = resolveNeighbors(
      [panelAt("above", 0, y, 100), fillerAt("f", 0, y + 100, 100, 20)],
      squareHeight,
    );
    expect(out.get("f")?.top?.id).toBe("above");
  });

  it("matches a panel that spans several bands", () => {
    // A 1200px-tall panel covers three bands; the filler at its foot must
    // still find it exactly once.
    const tall = { kind: "panel" as const, panel: makePanel({ id: "tall" }), x: 0, y: 0, w: 1200, h: 1200 };
    const out = resolveNeighbors([tall, fillerAt("f", 0, 1200, 100, 20)], squareHeight);
    expect(out.get("f")?.top?.id).toBe("tall");
  });

  it("resolves each filler independently", () => {
    const out = resolveNeighbors(
      [
        panelAt("a", 0, 0, 100),
        fillerAt("f1", 0, 100, 100, 20),
        panelAt("b", 0, 200, 100),
        fillerAt("f2", 0, 300, 100, 20),
      ],
      squareHeight,
    );
    expect(out.get("f1")?.top?.id).toBe("a");
    expect(out.get("f2")?.top?.id).toBe("b");
  });

  it("returns an empty map when there are no fillers", () => {
    expect(resolveNeighbors([panelAt("a", 0, 0, 100)], squareHeight).size).toBe(0);
  });

  it("handles no items at all", () => {
    expect(resolveNeighbors([], squareHeight).size).toBe(0);
  });
});
