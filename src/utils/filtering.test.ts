import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  computeFacets,
  getDecade,
  hasActiveFilters,
  searchTokens,
  type FilterSetKey,
  type Filters,
} from "./filtering";
import { makePanel } from "./testPanel";

/** Facets are named as plain arrays here; the real shape is a set of each. */
type FilterSpec = Partial<Record<FilterSetKey, string[]>> & { searchQuery?: string };

function filters(over: FilterSpec = {}): Filters {
  return {
    ...EMPTY_FILTERS,
    decades: new Set(over.decades ?? []),
    tags: new Set(over.tags ?? []),
    artists: new Set(over.artists ?? []),
    colorists: new Set(over.colorists ?? []),
    letterers: new Set(over.letterers ?? []),
    credits: new Set(over.credits ?? []),
    postedBy: new Set(over.postedBy ?? []),
    series: new Set(over.series ?? []),
    searchQuery: over.searchQuery ?? "",
  };
}

describe("getDecade", () => {
  it("floors a year to its decade", () => {
    expect(getDecade(2012)).toBe("2010s");
    expect(getDecade(1999)).toBe("1990s");
    expect(getDecade(1970)).toBe("1970s");
  });
});

describe("activeFilterCount / hasActiveFilters", () => {
  it("is zero for the empty filter set", () => {
    expect(activeFilterCount(filters())).toBe(0);
    expect(hasActiveFilters(filters())).toBe(false);
  });

  it("sums every facet dimension", () => {
    const f = filters({ decades: ["1970s"], tags: ["a", "b"], artists: ["Moebius"] });
    expect(activeFilterCount(f)).toBe(4);
  });

  it("counts a non-blank query as one filter", () => {
    expect(activeFilterCount(filters({ searchQuery: "moebius" }))).toBe(1);
  });

  it("does not count a whitespace-only query", () => {
    expect(activeFilterCount(filters({ searchQuery: "   " }))).toBe(0);
    expect(hasActiveFilters(filters({ searchQuery: "   " }))).toBe(false);
  });
});

describe("searchTokens", () => {
  it("splits on whitespace and lowercases", () => {
    expect(searchTokens("  Fiona   STAPLES ")).toEqual(["fiona", "staples"]);
  });

  it("is empty for a blank query", () => {
    expect(searchTokens("   ")).toEqual([]);
  });
});

describe("applyFilters", () => {
  const saga = makePanel({ id: "a", title: "Saga", artist: "Fiona Staples", year: 2012 });
  const arzach = makePanel({
    id: "b",
    title: "Arzach",
    slug: "arzach",
    artist: "Moebius",
    year: 1975,
    tags: ["sci-fi"],
    postedBy: "sam",
  });
  const panels = [saga, arzach];

  it("returns the input array untouched when nothing is active", () => {
    expect(applyFilters(panels, filters())).toBe(panels);
  });

  it("filters by decade", () => {
    expect(applyFilters(panels, filters({ decades: ["1970s"] }))).toEqual([arzach]);
  });

  it("filters by artist", () => {
    expect(applyFilters(panels, filters({ artists: ["Moebius"] }))).toEqual([arzach]);
  });

  it("filters by series title", () => {
    expect(applyFilters(panels, filters({ series: ["Saga"] }))).toEqual([saga]);
  });

  it("filters by poster", () => {
    expect(applyFilters(panels, filters({ postedBy: ["sam"] }))).toEqual([arzach]);
  });

  it("keeps a panel carrying any one of the selected tags", () => {
    expect(applyFilters(panels, filters({ tags: ["sci-fi", "horror"] }))).toEqual([arzach]);
  });

  it("treats a missing multi-value field as no match", () => {
    expect(applyFilters(panels, filters({ colorists: ["Anybody"] }))).toEqual([]);
  });

  it("matches a colorist on the panel", () => {
    const colored = makePanel({ id: "c", colorists: ["Dave Stewart"] });
    expect(applyFilters([...panels, colored], filters({ colorists: ["Dave Stewart"] }))).toEqual([
      colored,
    ]);
  });

  it("ANDs across dimensions", () => {
    // 1970s alone matches arzach, but the artist filter rules it out.
    expect(applyFilters(panels, filters({ decades: ["1970s"], artists: ["Fiona Staples"] }))).toEqual(
      [],
    );
  });

  it("requires every search token to land somewhere on the panel", () => {
    expect(applyFilters(panels, filters({ searchQuery: "moebius arzach" }))).toEqual([arzach]);
    expect(applyFilters(panels, filters({ searchQuery: "moebius saga" }))).toEqual([]);
  });

  it("reaches the derived decade from free text", () => {
    expect(applyFilters(panels, filters({ searchQuery: "1970s" }))).toEqual([arzach]);
  });

  it("reaches notes and tags from free text", () => {
    const noted = makePanel({ id: "d", notes: "a beautiful splash page" });
    expect(applyFilters([noted, arzach], filters({ searchQuery: "splash" }))).toEqual([noted]);
  });

  it("matches free text case-insensitively", () => {
    expect(applyFilters(panels, filters({ searchQuery: "MOEBIUS" }))).toEqual([arzach]);
  });
});

describe("computeFacets", () => {
  const a = makePanel({ id: "a", artist: "Moebius", year: 1975, tags: ["sci-fi"] });
  const b = makePanel({ id: "b", artist: "Moebius", year: 1985, tags: ["sci-fi", "ink"] });
  const c = makePanel({ id: "c", artist: "Fiona Staples", year: 2012, tags: ["ink"] });

  it("counts every value when nothing is selected", () => {
    const f = computeFacets([a, b, c], filters());
    expect(f.artistCounts.get("Moebius")).toBe(2);
    expect(f.artistCounts.get("Fiona Staples")).toBe(1);
    expect(f.decadeCounts.get("1970s")).toBe(1);
    expect(f.tagCounts.get("sci-fi")).toBe(2);
    expect(f.tagCounts.get("ink")).toBe(2);
  });

  it("counts a facet against every filter except its own", () => {
    // With the 1970s selected, the *decade* counts still show what picking
    // each other decade would add — that is the point of the exemption.
    const f = computeFacets([a, b, c], filters({ decades: ["1970s"] }));
    expect(f.decadeCounts.get("1980s")).toBe(1);
    expect(f.decadeCounts.get("2010s")).toBe(1);
    // Artist counts, meanwhile, are narrowed by the decade filter.
    expect(f.artistCounts.get("Moebius")).toBe(1);
    expect(f.artistCounts.get("Fiona Staples")).toBeUndefined();
  });

  it("lets the search query narrow every count, its own included", () => {
    const f = computeFacets([a, b, c], filters({ searchQuery: "moebius" }));
    expect(f.artistCounts.get("Moebius")).toBe(2);
    expect(f.artistCounts.get("Fiona Staples")).toBeUndefined();
    expect(f.decadeCounts.get("2010s")).toBeUndefined();
  });

  it("counts multi-value fields once per value", () => {
    const f = computeFacets([b], filters());
    expect(f.tagCounts.get("sci-fi")).toBe(1);
    expect(f.tagCounts.get("ink")).toBe(1);
  });

  describe("the credit dimensions", () => {
    const crew = [
      makePanel({
        id: "a",
        colorists: ["Dave Stewart"],
        letterers: ["Todd Klein"],
        credits: ["Dave Stewart", "Todd Klein"],
      }),
      makePanel({
        id: "b",
        colorists: ["Matt Hollingsworth"],
        letterers: ["Todd Klein"],
        credits: ["Matt Hollingsworth"],
      }),
    ];

    it("counts colorists, letterers and credits", () => {
      const f = computeFacets(crew, filters());
      expect(f.coloristCounts.get("Dave Stewart")).toBe(1);
      expect(f.lettererCounts.get("Todd Klein")).toBe(2);
      expect(f.creditCounts.get("Matt Hollingsworth")).toBe(1);
    });

    it("exempts each credit dimension from its own filter", () => {
      const f = computeFacets(crew, filters({ colorists: ["Dave Stewart"] }));
      // The colorist counts still show what picking the other one would add.
      expect(f.coloristCounts.get("Matt Hollingsworth")).toBe(1);
      // Everything else is narrowed by it.
      expect(f.lettererCounts.get("Todd Klein")).toBe(1);
    });

    it("narrows the colorist counts by a letterer filter", () => {
      const f = computeFacets(crew, filters({ letterers: ["Todd Klein"] }));
      expect(f.coloristCounts.get("Dave Stewart")).toBe(1);
      expect(f.coloristCounts.get("Matt Hollingsworth")).toBe(1);
    });

    it("narrows the letterer counts by a credit filter", () => {
      const f = computeFacets(crew, filters({ credits: ["Dave Stewart"] }));
      expect(f.lettererCounts.get("Todd Klein")).toBe(1);
    });

    it("counts nothing for a panel missing the field entirely", () => {
      const f = computeFacets([makePanel({ id: "bare" })], filters());
      expect(f.coloristCounts.size).toBe(0);
      expect(f.lettererCounts.size).toBe(0);
      expect(f.creditCounts.size).toBe(0);
    });

    it("excludes a panel that fails a filter on another dimension", () => {
      const f = computeFacets(crew, filters({ postedBy: ["nobody"] }));
      expect(f.coloristCounts.size).toBe(0);
      expect(f.lettererCounts.size).toBe(0);
    });

    it("counts postedBy and series against everything but themselves", () => {
      const mixed = [
        makePanel({ id: "a", postedBy: "jek", title: "Saga" }),
        makePanel({ id: "b", postedBy: "sam", title: "Arzach" }),
      ];
      const byPoster = computeFacets(mixed, filters({ postedBy: ["jek"] }));
      expect(byPoster.postedByCounts.get("sam")).toBe(1);
      expect(byPoster.seriesCounts.get("Arzach")).toBeUndefined();

      const bySeries = computeFacets(mixed, filters({ series: ["Saga"] }));
      expect(bySeries.seriesCounts.get("Arzach")).toBe(1);
      expect(bySeries.postedByCounts.get("sam")).toBeUndefined();
    });
  });
});
