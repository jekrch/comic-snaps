import { describe, expect, it } from "vitest";
import {
  ARTIST_SORT_OPTIONS,
  DEFAULT_ARTIST_SORT,
  isArtistSortMode,
  sortArtistRows,
} from "./artistSorting";
import type { ArtistRow } from "./artistRollup";
import { makePanel } from "./testPanel";

function row(over: Partial<ArtistRow> & { name: string }): ArtistRow {
  return {
    artist: null,
    panels: [makePanel()],
    series: [],
    years: null,
    life: null,
    country: null,
    alsoColorist: 0,
    alsoLetterer: 0,
    alsoCredited: 0,
    firstPostedAt: 0,
    lastPostedAt: 0,
    ...over,
  };
}

const withSeries = (name: string, count: number, over: Partial<ArtistRow> = {}) =>
  row({
    name,
    series: Array.from({ length: count }, (_, i) => ({
      slug: `s${i}`,
      titles: [`S${i}`],
      title: `S${i}`,
    })),
    ...over,
  });

describe("isArtistSortMode", () => {
  it("accepts every declared option", () => {
    for (const { value } of ARTIST_SORT_OPTIONS) expect(isArtistSortMode(value)).toBe(true);
  });

  it("rejects anything else, including the series-only modes", () => {
    expect(isArtistSortMode("rating")).toBe(false);
    expect(isArtistSortMode("born")).toBe(false);
    expect(isArtistSortMode(null)).toBe(false);
  });

  it("defaults to last posted, matching the series shelf beside it", () => {
    expect(DEFAULT_ARTIST_SORT).toBe("newest");
  });

  it("offers no RATING mode — nothing in ratings.json targets a creator", () => {
    expect(ARTIST_SORT_OPTIONS.map((o) => o.value)).not.toContain("rating");
  });
});

describe("sortArtistRows", () => {
  it("does not mutate the caller's array", () => {
    const rows = [row({ name: "B" }), row({ name: "A" })];
    const copy = [...rows];
    sortArtistRows(rows, "name");
    expect(rows).toEqual(copy);
  });

  it("orders by surname, not by the display string", () => {
    const rows = [row({ name: "Jeff Lemire" }), row({ name: "Andy Belanger" })];
    expect(sortArtistRows(rows, "name").map((r) => r.name)).toEqual([
      "Andy Belanger",
      "Jeff Lemire",
    ]);
  });

  it("orders by last posting, most recent first", () => {
    const rows = [row({ name: "Old", lastPostedAt: 1 }), row({ name: "New", lastPostedAt: 9 })];
    expect(sortArtistRows(rows, "newest").map((r) => r.name)).toEqual(["New", "Old"]);
  });

  it("orders by strip length", () => {
    const rows = [
      row({ name: "One", panels: [makePanel()] }),
      row({ name: "Two", panels: [makePanel(), makePanel()] }),
    ];
    expect(sortArtistRows(rows, "panels").map((r) => r.name)).toEqual(["Two", "One"]);
  });

  it("orders by number of books, then by panel count", () => {
    const rows = [
      withSeries("Fewer books", 1, { panels: [makePanel(), makePanel(), makePanel()] }),
      withSeries("More books", 3, { panels: [makePanel()] }),
    ];
    expect(sortArtistRows(rows, "series").map((r) => r.name)).toEqual([
      "More books",
      "Fewer books",
    ]);
  });

  it("breaks an equal book count on panel count", () => {
    const rows = [
      withSeries("Zed Few", 2, { panels: [makePanel()] }),
      withSeries("Alpha Many", 2, { panels: [makePanel(), makePanel()] }),
    ];
    expect(sortArtistRows(rows, "series").map((r) => r.name)).toEqual(["Alpha Many", "Zed Few"]);
  });

  describe("year", () => {
    it("puts the oldest work first — the one ordering the wall cannot show", () => {
      const rows = [
        row({ name: "Modern", years: { from: 2012, to: 2020 } }),
        row({ name: "Golden Age", years: { from: 1952, to: 1961 } }),
      ];
      expect(sortArtistRows(rows, "year").map((r) => r.name)).toEqual(["Golden Age", "Modern"]);
    });

    it("puts a row with no dates last", () => {
      const rows = [
        row({ name: "Unknown", years: null }),
        row({ name: "Dated", years: { from: 1975, to: 1980 } }),
      ];
      expect(sortArtistRows(rows, "year").map((r) => r.name)).toEqual(["Dated", "Unknown"]);
    });

    it("orders date-less rows by surname", () => {
      const rows = [row({ name: "Jeff Zed", years: null }), row({ name: "Andy Alpha", years: null })];
      expect(sortArtistRows(rows, "year").map((r) => r.name)).toEqual(["Andy Alpha", "Jeff Zed"]);
    });

    it("breaks an equal start year by surname", () => {
      const rows = [
        row({ name: "Jeff Zed", years: { from: 1975, to: 1990 } }),
        row({ name: "Andy Alpha", years: { from: 1975, to: 1980 } }),
      ];
      expect(sortArtistRows(rows, "year").map((r) => r.name)).toEqual(["Andy Alpha", "Jeff Zed"]);
    });
  });

  it("handles an empty set in every mode", () => {
    for (const { value } of ARTIST_SORT_OPTIONS) expect(sortArtistRows([], value)).toEqual([]);
  });
});
