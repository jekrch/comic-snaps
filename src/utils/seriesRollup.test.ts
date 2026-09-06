import { describe, expect, it } from "vitest";
import { COVER_ISSUE, buildCoverPanels, buildSeriesRows, type SeriesMeta } from "./seriesRollup";
import type { IssueCredits, RatingsIndex, Series } from "../types";
import { makePanel } from "./testPanel";

const at = (iso: string) => new Date(iso).toISOString();

function series(over: Partial<Series> & { id: string; name: string }): Series {
  return { parentSeries: null, description: "", references: [], ...over };
}

const EMPTY_META: SeriesMeta = { series: [], issues: [] };

function issue(seriesSlug: string, num: number, credits: [string, string[]][]): IssueCredits {
  return {
    id: `${seriesSlug}-${num}`,
    series: seriesSlug,
    issue: num,
    credits: credits.map(([name, roles]) => ({ artistId: null, name, roles })),
  };
}

describe("buildSeriesRows", () => {
  it("groups by slug, not by title", () => {
    // One slug already carries two title spellings on the wall.
    const panels = [
      makePanel({ id: "a", slug: "omaha", title: "Omaha" }),
      makePanel({ id: "b", slug: "omaha", title: "Omaha the Cat Dancer" }),
    ];
    const rows = buildSeriesRows(panels, EMPTY_META, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("omaha");
    expect(rows[0].titles).toEqual(["Omaha", "Omaha the Cat Dancer"]);
  });

  it("labels the row with the newest panel's spelling", () => {
    const rows = buildSeriesRows(
      [
        makePanel({ id: "a", slug: "omaha", title: "Old Spelling", addedAt: at("2026-01-01") }),
        makePanel({ id: "b", slug: "omaha", title: "New Spelling", addedAt: at("2026-05-01") }),
      ],
      EMPTY_META,
      null,
    );
    expect(rows[0].title).toBe("New Spelling");
  });

  it("keeps the panels in the order they were handed over", () => {
    // The strip inherits the wall's active sort rather than re-sorting.
    const panels = [
      makePanel({ id: "third", addedAt: at("2026-03-01") }),
      makePanel({ id: "first", addedAt: at("2026-01-01") }),
    ];
    expect(buildSeriesRows(panels, EMPTY_META, null)[0].panels.map((p) => p.id)).toEqual([
      "third",
      "first",
    ]);
  });

  it("is a view of the filtered set — one matching panel makes a one-panel row", () => {
    const rows = buildSeriesRows([makePanel({ id: "only" })], EMPTY_META, null);
    expect(rows[0].panels).toHaveLength(1);
  });

  it("records first and last posting", () => {
    const rows = buildSeriesRows(
      [
        makePanel({ id: "a", addedAt: at("2026-03-01") }),
        makePanel({ id: "b", addedAt: at("2026-01-01") }),
      ],
      EMPTY_META,
      null,
    );
    expect(rows[0].firstPostedAt).toBe(Date.parse(at("2026-01-01")));
    expect(rows[0].lastPostedAt).toBe(Date.parse(at("2026-03-01")));
  });

  it("falls back to zero when no panel carries a parseable date", () => {
    const rows = buildSeriesRows([makePanel({ addedAt: "" })], EMPTY_META, null);
    expect(rows[0].firstPostedAt).toBe(0);
    expect(rows[0].lastPostedAt).toBe(0);
  });

  it("attaches the metadata record and its parent", () => {
    const meta: SeriesMeta = {
      series: [
        series({ id: "omaha-vol-2", name: "Omaha Vol 2", parentSeries: "omaha" }),
        series({ id: "omaha", name: "Omaha" }),
      ],
      issues: [],
    };
    const rows = buildSeriesRows([makePanel({ slug: "omaha-vol-2" })], meta, null);
    expect(rows[0].series?.name).toBe("Omaha Vol 2");
    expect(rows[0].parent?.id).toBe("omaha");
  });

  it("leaves series and parent null for a slug with no record", () => {
    const rows = buildSeriesRows([makePanel({ slug: "unknown" })], EMPTY_META, null);
    expect(rows[0].series).toBeNull();
    expect(rows[0].parent).toBeNull();
  });

  it("prefers the record's start year over the earliest panel's", () => {
    const meta: SeriesMeta = { series: [series({ id: "saga", name: "Saga", startYear: 2012 })], issues: [] };
    const rows = buildSeriesRows([makePanel({ slug: "saga", year: 2015 })], meta, null);
    expect(rows[0].year).toBe(2012);
  });

  it("falls back to the earliest panel year when the record has none", () => {
    const rows = buildSeriesRows(
      [makePanel({ id: "a", year: 2015 }), makePanel({ id: "b", year: 2012 })],
      EMPTY_META,
      null,
    );
    expect(rows[0].year).toBe(2012);
  });

  describe("artists", () => {
    it("ranks by credit count, most first", () => {
      const rows = buildSeriesRows(
        [
          makePanel({ id: "a", artist: "Solo" }),
          makePanel({ id: "b", artist: "Frequent" }),
          makePanel({ id: "c", artist: "Frequent" }),
        ],
        EMPTY_META,
        null,
      );
      expect(rows[0].artists).toEqual(["Frequent", "Solo"]);
    });

    it("breaks a tie by surname", () => {
      const rows = buildSeriesRows(
        [makePanel({ id: "a", artist: "Jeff Zed" }), makePanel({ id: "b", artist: "Andy Alpha" })],
        EMPTY_META,
        null,
      );
      expect(rows[0].artists).toEqual(["Andy Alpha", "Jeff Zed"]);
    });
  });

  describe("writers", () => {
    const meta: SeriesMeta = {
      series: [series({ id: "saga", name: "Saga" })],
      issues: [
        issue("saga", 1, [["On The Wall", ["Writer"]], ["An Artist", ["Penciller"]]]),
        issue("saga", 99, [["Not On The Wall", ["Writer"]]]),
      ],
    };

    it("only reports writers of issues actually on the wall", () => {
      const rows = buildSeriesRows([makePanel({ slug: "saga", issue: 1 })], meta, null);
      expect(rows[0].writers).toEqual(["On The Wall"]);
    });

    it("ignores non-writing roles", () => {
      const rows = buildSeriesRows([makePanel({ slug: "saga", issue: 1 })], meta, null);
      expect(rows[0].writers).not.toContain("An Artist");
    });

    it("matches a free-form issue by its string form", () => {
      const anthology: SeriesMeta = {
        series: [series({ id: "hb", name: "Hellboy" })],
        issues: [{ ...issue("hb", 1, [["W", ["Writer"]]]), issue: "VOL 1" as unknown as number }],
      };
      const rows = buildSeriesRows([makePanel({ slug: "hb", issue: "VOL 1" })], anthology, null);
      expect(rows[0].writers).toEqual(["W"]);
    });

    it("suppresses credits entirely for an anthology", () => {
      const anthologyMeta: SeriesMeta = {
        series: [series({ id: "saga", name: "Saga", anthology: true })],
        issues: meta.issues,
      };
      const rows = buildSeriesRows([makePanel({ slug: "saga", issue: 1 })], anthologyMeta, null);
      expect(rows[0].writers).toEqual([]);
    });
  });

  describe("ratings", () => {
    const ratings: RatingsIndex = {
      generatedAt: "",
      targets: {
        "series:saga": { label: "Saga", avg: 8, count: 2, ratings: [] },
        "issue:saga-1": { label: "Saga #1", avg: 9, count: 1, ratings: [] },
        "issue:saga-2": { label: "Saga #2", avg: 6, count: 1, ratings: [] },
      },
    };

    it("attaches the series rating", () => {
      const rows = buildSeriesRows([makePanel({ slug: "saga" })], EMPTY_META, ratings);
      expect(rows[0].rating?.avg).toBe(8);
    });

    it("rolls the issue scores up separately, never into the series average", () => {
      const rows = buildSeriesRows([makePanel({ slug: "saga" })], EMPTY_META, ratings);
      expect(rows[0].issueRating).toEqual({ avg: 7.5, count: 2 });
      expect(rows[0].rating?.avg).toBe(8);
    });

    it("rounds the issue roll-up to one decimal", () => {
      const uneven: RatingsIndex = {
        generatedAt: "",
        targets: {
          "issue:saga-1": { label: "", avg: 8, count: 1, ratings: [] },
          "issue:saga-2": { label: "", avg: 9, count: 1, ratings: [] },
          "issue:saga-3": { label: "", avg: 9, count: 1, ratings: [] },
        },
      };
      const rows = buildSeriesRows([makePanel({ slug: "saga" })], EMPTY_META, uneven);
      expect(rows[0].issueRating?.avg).toBe(8.7);
    });

    it("hands an issue key to the longest slug that prefixes it", () => {
      // `issue:stray-bullets-sunshine-roses-1` belongs to the long slug, not
      // to `stray-bullets` — the separator can appear inside a slug.
      const meta: SeriesMeta = {
        series: [
          series({ id: "stray-bullets", name: "Stray Bullets" }),
          series({ id: "stray-bullets-sunshine-roses", name: "Sunshine & Roses" }),
        ],
        issues: [],
      };
      const idx: RatingsIndex = {
        generatedAt: "",
        targets: {
          "issue:stray-bullets-sunshine-roses-1": { label: "", avg: 9, count: 1, ratings: [] },
        },
      };
      const rows = buildSeriesRows(
        [
          makePanel({ id: "a", slug: "stray-bullets" }),
          makePanel({ id: "b", slug: "stray-bullets-sunshine-roses" }),
        ],
        meta,
        idx,
      );
      const byslug = Object.fromEntries(rows.map((r) => [r.slug, r.issueRating]));
      expect(byslug["stray-bullets-sunshine-roses"]).toEqual({ avg: 9, count: 1 });
      expect(byslug["stray-bullets"]).toBeNull();
    });

    it("ignores an issue target with no score", () => {
      const idx: RatingsIndex = {
        generatedAt: "",
        targets: { "issue:saga-1": { label: "", avg: null, count: 0, ratings: [] } },
      };
      expect(buildSeriesRows([makePanel({ slug: "saga" })], EMPTY_META, idx)[0].issueRating).toBeNull();
    });

    it("leaves both ratings null when there is no index", () => {
      const rows = buildSeriesRows([makePanel({ slug: "saga" })], EMPTY_META, null);
      expect(rows[0].rating).toBeNull();
      expect(rows[0].issueRating).toBeNull();
    });
  });

  it("returns no rows for no panels", () => {
    expect(buildSeriesRows([], EMPTY_META, null)).toEqual([]);
  });
});

describe("buildCoverPanels", () => {
  const row = buildSeriesRows(
    [makePanel({ slug: "amulet", title: "Amulet", year: 2008 })],
    EMPTY_META,
    null,
  )[0];

  it("stands a cover in as a pageable panel", () => {
    const covers = buildCoverPanels(row, ["data/covers/amulet/a.jpg", "data/covers/amulet/b.jpg"]);
    expect(covers).toHaveLength(2);
    expect(covers[0].image).toBe("data/covers/amulet/a.jpg");
    expect(covers[0].cover).toBe(true);
  });

  it("gives each cover a distinct id keyed on the series", () => {
    const covers = buildCoverPanels(row, ["a.jpg", "b.jpg"]);
    expect(covers.map((c) => c.id)).toEqual(["cover:amulet:0", "cover:amulet:1"]);
  });

  it("keeps the slug, which is what the drawer resolves the series card from", () => {
    expect(buildCoverPanels(row, ["a.jpg"])[0].slug).toBe("amulet");
  });

  it("leaves every field that would name a poster empty rather than inventing one", () => {
    const [cover] = buildCoverPanels(row, ["a.jpg"]);
    expect(cover.artist).toBe("");
    expect(cover.postedBy).toBe("");
    expect(cover.addedAt).toBe("");
    expect(cover.tags).toEqual([]);
    expect(cover.notes).toBeNull();
  });

  it("labels the issue so it reads as 'Amulet Cover'", () => {
    expect(buildCoverPanels(row, ["a.jpg"])[0].issue).toBe(COVER_ISSUE);
  });

  it("leaves dimensions at zero — nothing that lays a cover out reads them", () => {
    const [cover] = buildCoverPanels(row, ["a.jpg"]);
    expect(cover.width).toBe(0);
    expect(cover.height).toBe(0);
  });

  it("returns nothing for a series with no covers", () => {
    expect(buildCoverPanels(row, [])).toEqual([]);
  });
});
