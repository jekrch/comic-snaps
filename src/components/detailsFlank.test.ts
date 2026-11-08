import { describe, expect, it } from "vitest";
import { makePanel } from "../utils/testPanel";
import { artistNeighbors, compareByArtist, compareInSeries, flankLayout, seriesNeighbors } from "./DetailsFlank";

describe("compareInSeries", () => {
  it("orders issues numerically, then by posting time", () => {
    const panels = [
      makePanel({ id: "a", issue: 10 }),
      makePanel({ id: "b", issue: 2, addedAt: "2026-03-01T00:00:00.000Z" }),
      makePanel({ id: "c", issue: 2, addedAt: "2026-01-01T00:00:00.000Z" }),
      makePanel({ id: "d", issue: "VOL 1" }),
    ];
    expect(panels.sort(compareInSeries).map((p) => p.id)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("seriesNeighbors", () => {
  const series = [5, 1, 4, 2, 3, 6].map((n) => makePanel({ id: `s${n}`, issue: n }));
  const other = makePanel({ id: "x", slug: "other", issue: 3 });
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

  it("splits the series around the panel, nearest first", () => {
    const n = seriesNeighbors(series[4], [...series, other], 2)!;
    expect(ids(n.group)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(ids(n.before)).toEqual(["s2", "s1"]);
    expect(ids(n.after)).toEqual(["s4", "s5"]);
  });

  it("wraps round the ends so both sides are filled evenly", () => {
    // s1 of six: five others, the odd one going after.
    const n = seriesNeighbors(series[1], series)!;
    expect(ids(n.after)).toEqual(["s2", "s3", "s4"]);
    expect(ids(n.before)).toEqual(["s6", "s5"]);
    const last = seriesNeighbors(series[5], series)!;
    expect(ids(last.before)).toEqual(["s5", "s4"]);
    expect(ids(last.after)).toEqual(["s1", "s2", "s3"]);
  });

  it("never shows a panel twice in a small series", () => {
    const pair = seriesNeighbors(series[0], series.slice(0, 2))!;
    expect(pair.before).toEqual([]);
    expect(ids(pair.after)).toEqual(["s1"]);
    const three = seriesNeighbors(series[0], series.slice(0, 3))!;
    expect(ids(three.before).concat(ids(three.after)).sort()).toEqual(["s1", "s4"]);
  });

  it("caps each side", () => {
    const many = Array.from({ length: 20 }, (_, i) => makePanel({ id: `m${i}`, issue: i + 1 }));
    const n = seriesNeighbors(many[0], many, 6)!;
    expect(n.before).toHaveLength(6);
    expect(n.after).toHaveLength(6);
  });

  it("is null for a panel alone in its series or off the wall", () => {
    expect(seriesNeighbors(other, [...series, other])).toBeNull();
    expect(seriesNeighbors(makePanel({ id: "cover", cover: true }), series)).toBeNull();
  });
});

describe("artistNeighbors", () => {
  const by = (id: string, over: Partial<Parameters<typeof makePanel>[0]>) =>
    makePanel({ id, artist: "Jaime Hernandez", ...over });
  const work = [
    by("a", { title: "Love and Rockets", slug: "lr", issue: 1, year: 1982 }),
    by("b", { title: "Love and Rockets", slug: "lr", issue: 2, year: 1983 }),
    by("c", { title: "Penny Century", slug: "pc", issue: 1, year: 1997 }),
    by("d", { title: "Whoa, Nellie!", slug: "wn", issue: 1, year: 1996 }),
    by("e", { title: "Love and Rockets", slug: "lr", issue: 3, year: 1983 }),
  ];
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

  it("orders an artist's panels by year, then book, then issue", () => {
    expect(ids([...work].sort(compareByArtist))).toEqual(["a", "b", "e", "d", "c"]);
  });

  it("leaves out what the series stacks already show, but keeps the whole group to page through", () => {
    const n = artistNeighbors(work[1], work, new Set(["a", "e"]))!;
    expect(ids(n.group)).toEqual(["a", "b", "e", "d", "c"]);
    expect(ids(n.before).concat(ids(n.after)).sort()).toEqual(["c", "d"]);
  });

  it("is null when the series has shown everything the artist has", () => {
    expect(artistNeighbors(work[0], work.slice(0, 2), new Set(["b"]))).toBeNull();
    expect(artistNeighbors(makePanel({ id: "solo", artist: "Nobody Else" }), work)).toBeNull();
  });
});

describe("flankLayout", () => {
  // A 1920px screen with the drawer's 576px column centred in it, and a page
  // long enough to scroll.
  const wide = { viewW: 1920, colLeft: 672, colW: 576, colH: 2400, artistTop: null };

  it("stacks nothing in a truly narrow margin", () => {
    expect(flankLayout({ ...wide, viewW: 736, colLeft: 80 }, { before: [0.75], after: [0.75] })).toBeNull();
  });

  it("shrinks the sidecars to fit a narrower screen", () => {
    // 800px wide, the 512px column leaving 144px either side.
    const l = flankLayout({ ...wide, viewW: 800, colLeft: 144, colW: 512 }, { before: [0.75], after: [0.75] })!;
    const [a] = l.before;
    expect(a.w).toBeGreaterThanOrEqual(56);
    expect(a.w).toBeLessThan(flankLayout(wide, { before: [0.75], after: [] })!.before[0].w);
    expect(a.x + a.w).toBeLessThan(l.left);
  });

  it("keeps a stack within the range it's given", () => {
    const l = flankLayout(wide, { before: [0.75, 0.75, 0.75], after: [0.75, 0.75, 0.75] }, { top: 600, end: 900 })!;
    expect(l.before[0].y).toBe(600);
    for (const it of [...l.before, ...l.after]) expect(it.y + it.h + 24).toBeLessThanOrEqual(900);
    expect(flankLayout(wide, { before: [0.75], after: [] }, { top: 32, end: 60 })!.before).toEqual([]);
  });

  it("trims the longer stack to pair with a shorter one", () => {
    const l = flankLayout({ ...wide, colH: 900 }, { before: [0.5, 0.5, 0.5, 0.5], after: [3, 3, 3, 3, 3, 3] })!;
    expect(l.after.length).toBeLessThanOrEqual(l.before.length + 1);
  });

  it("stacks each side down the page from the column's top, at one width and inset", () => {
    const l = flankLayout(wide, { before: [0.75, 1.5, 0.75], after: [0.75, 0.75, 0.75] })!;
    expect(l.left).toBe(672);
    expect(l.right).toBe(672);
    const [a, b, c] = l.before;
    expect(a.y).toBe(32);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(c.y).toBeGreaterThan(b.y + b.h);
    expect(new Set(l.before.map((it) => it.w)).size).toBe(1);
    expect(new Set(l.before.map((it) => it.x)).size).toBe(1);
    expect(b.h).toBeCloseTo(b.w / 1.5);
    expect(l.after[0]).toEqual(a);
  });

  it("keeps the sidecars small and inside their margin", () => {
    const l = flankLayout(wide, { before: [0.75], after: [] })!;
    const [a] = l.before;
    expect(a.w).toBeLessThanOrEqual(136);
    expect(a.x + a.w).toBeLessThan(l.left);
  });

  it("crops a very tall panel rather than letting it run down the page", () => {
    const [a] = flankLayout(wide, { before: [0.2], after: [] })!.before;
    expect(a.h).toBeCloseTo(a.w * 1.5);
  });

  it("measures each margin on its own, so a scrollbar doesn't shift the stacks", () => {
    const l = flankLayout({ ...wide, viewW: 1904, colLeft: 664 }, { before: [0.75], after: [0.75] })!;
    expect(l.left).toBe(664);
    expect(l.right).toBe(664);
  });

  it("stops a stack where the page ends", () => {
    const l = flankLayout({ ...wide, colH: 420 }, { before: [0.75, 0.75, 0.75, 0.75], after: [] })!;
    const last = l.before[l.before.length - 1];
    expect(l.before.length).toBeLessThan(4);
    expect(last.y + last.h + 24).toBeLessThanOrEqual(420 - 32);
  });
});
