import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERIES_SORT,
  SERIES_SORT_OPTIONS,
  isSeriesSortMode,
  sortSeriesRows,
  titleSortKey,
} from "./seriesSorting";
import type { SeriesRow } from "./seriesRollup";
import { makePanel } from "./testPanel";

function row(over: Partial<SeriesRow> & { title: string }): SeriesRow {
  return {
    slug: over.title.toLowerCase(),
    titles: [over.title],
    series: null,
    parent: null,
    panels: [makePanel()],
    covers: [],
    writers: [],
    artists: [],
    year: null,
    publisher: null,
    rating: null,
    issueRating: null,
    firstPostedAt: 0,
    lastPostedAt: 0,
    ...over,
  };
}

const rated = (title: string, avg: number | null, count = 1) =>
  row({ title, rating: avg === null ? null : { label: title, avg, count, ratings: [] } });

describe("titleSortKey", () => {
  it("drops a leading article", () => {
    expect(titleSortKey("The Nice House by the Sea")).toBe("nice house by the sea");
    expect(titleSortKey("A Contract with God")).toBe("contract with god");
    expect(titleSortKey("An Unkindness")).toBe("unkindness");
  });

  it("only drops the article when it leads", () => {
    expect(titleSortKey("Nice House the Sea")).toBe("nice house the sea");
  });

  it("speaks & aloud so it files with the spelt-out titles", () => {
    expect(titleSortKey("Love & Rockets")).toBe("love and rockets");
  });

  it("lowercases and trims", () => {
    expect(titleSortKey("  SAGA  ")).toBe("saga");
  });
});

describe("isSeriesSortMode", () => {
  it("accepts every declared option", () => {
    for (const { value } of SERIES_SORT_OPTIONS) expect(isSeriesSortMode(value)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isSeriesSortMode("phash")).toBe(false);
    expect(isSeriesSortMode("")).toBe(false);
    expect(isSeriesSortMode(null)).toBe(false);
  });

  it("keeps `newest` as the wire value behind the LAST POSTED label", () => {
    // Existing `?ssort=` links depend on the key, not the label.
    const newest = SERIES_SORT_OPTIONS.find((o) => o.value === "newest");
    expect(newest?.label).toBe("LAST POSTED");
    expect(DEFAULT_SERIES_SORT).toBe("newest");
  });
});

describe("sortSeriesRows", () => {
  it("does not mutate the caller's array", () => {
    const rows = [row({ title: "B" }), row({ title: "A" })];
    const copy = [...rows];
    sortSeriesRows(rows, "name");
    expect(rows).toEqual(copy);
  });

  it("shares the strips by reference", () => {
    const r = row({ title: "A" });
    expect(sortSeriesRows([r], "name")[0].panels).toBe(r.panels);
  });

  it("orders by name with articles dropped", () => {
    const rows = [row({ title: "Saga" }), row({ title: "The Arrival" }), row({ title: "Black Hole" })];
    expect(sortSeriesRows(rows, "name").map((r) => r.title)).toEqual([
      "The Arrival",
      "Black Hole",
      "Saga",
    ]);
  });

  describe("rating", () => {
    it("orders by average, highest first", () => {
      const rows = [rated("A", 6), rated("B", 9), rated("C", 7)];
      expect(sortSeriesRows(rows, "rating").map((r) => r.title)).toEqual(["B", "C", "A"]);
    });

    it("puts unrated rows last rather than treating them as zero", () => {
      const rows = [rated("Unrated", null), rated("Low", 2)];
      expect(sortSeriesRows(rows, "rating").map((r) => r.title)).toEqual(["Low", "Unrated"]);
    });

    it("orders the unrated among themselves by name", () => {
      const rows = [rated("Zed", null), rated("Alpha", null)];
      expect(sortSeriesRows(rows, "rating").map((r) => r.title)).toEqual(["Alpha", "Zed"]);
    });

    it("breaks an equal average on the number of raters", () => {
      const rows = [rated("Few", 8, 1), rated("Many", 8, 5)];
      expect(sortSeriesRows(rows, "rating").map((r) => r.title)).toEqual(["Many", "Few"]);
    });

    it("falls through to name when average and count both tie", () => {
      const rows = [rated("Zed", 8, 2), rated("Alpha", 8, 2)];
      expect(sortSeriesRows(rows, "rating").map((r) => r.title)).toEqual(["Alpha", "Zed"]);
    });
  });

  describe("newest", () => {
    it("orders by last posting, most recent first", () => {
      const rows = [
        row({ title: "Old", lastPostedAt: 100 }),
        row({ title: "New", lastPostedAt: 300 }),
      ];
      expect(sortSeriesRows(rows, "newest").map((r) => r.title)).toEqual(["New", "Old"]);
    });

    it("breaks a tie by name", () => {
      const rows = [
        row({ title: "Zed", lastPostedAt: 100 }),
        row({ title: "Alpha", lastPostedAt: 100 }),
      ];
      expect(sortSeriesRows(rows, "newest").map((r) => r.title)).toEqual(["Alpha", "Zed"]);
    });
  });

  describe("year", () => {
    it("orders newest year first", () => {
      const rows = [row({ title: "Old", year: 1975 }), row({ title: "New", year: 2012 })];
      expect(sortSeriesRows(rows, "year").map((r) => r.title)).toEqual(["New", "Old"]);
    });

    it("puts a year-less row last", () => {
      const rows = [row({ title: "Unknown", year: null }), row({ title: "Dated", year: 1975 })];
      expect(sortSeriesRows(rows, "year").map((r) => r.title)).toEqual(["Dated", "Unknown"]);
    });

    it("orders year-less rows by name", () => {
      const rows = [row({ title: "Zed", year: null }), row({ title: "Alpha", year: null })];
      expect(sortSeriesRows(rows, "year").map((r) => r.title)).toEqual(["Alpha", "Zed"]);
    });
  });

  describe("panels", () => {
    it("orders by strip length, longest first", () => {
      const rows = [
        row({ title: "One", panels: [makePanel()] }),
        row({ title: "Three", panels: [makePanel(), makePanel(), makePanel()] }),
      ];
      expect(sortSeriesRows(rows, "panels").map((r) => r.title)).toEqual(["Three", "One"]);
    });

    it("breaks a tie by name", () => {
      const rows = [row({ title: "Zed" }), row({ title: "Alpha" })];
      expect(sortSeriesRows(rows, "panels").map((r) => r.title)).toEqual(["Alpha", "Zed"]);
    });
  });

  it("handles an empty set in every mode", () => {
    for (const { value } of SERIES_SORT_OPTIONS) expect(sortSeriesRows([], value)).toEqual([]);
  });
});
