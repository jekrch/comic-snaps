import { describe, expect, it } from "vitest";
import {
  PORTRAIT_ISSUE,
  buildArtistRows,
  buildPortraitPanel,
  type ArtistMeta,
} from "./artistRollup";
import type { Artist, Series } from "../types";
import { makePanel } from "./testPanel";

const at = (iso: string) => new Date(iso).toISOString();

function artist(over: Partial<Artist> & { id: string; name: string }): Artist {
  return { description: "", references: [], ...over };
}

function series(over: Partial<Series> & { id: string; name: string }): Series {
  return { parentSeries: null, description: "", references: [], ...over };
}

const EMPTY_META: ArtistMeta = { artists: [], series: [] };

describe("buildArtistRows", () => {
  it("groups by the name the panel spells, not by an artists.json id", () => {
    const rows = buildArtistRows(
      [makePanel({ id: "a", artist: "Moebius" }), makePanel({ id: "b", artist: "Moebius" })],
      EMPTY_META,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Moebius");
    expect(rows[0].panels).toHaveLength(2);
  });

  it("keeps a person with no metadata record rather than dropping them", () => {
    const rows = buildArtistRows([makePanel({ artist: "Unrecorded" })], EMPTY_META);
    expect(rows[0].artist).toBeNull();
    expect(rows[0].name).toBe("Unrecorded");
  });

  it("skips panels with no artist at all", () => {
    expect(buildArtistRows([makePanel({ artist: "" })], EMPTY_META)).toEqual([]);
  });

  it("attaches the metadata record when the name matches", () => {
    const meta: ArtistMeta = { artists: [artist({ id: "moebius", name: "Moebius" })], series: [] };
    expect(buildArtistRows([makePanel({ artist: "Moebius" })], meta)[0].artist?.id).toBe("moebius");
  });

  it("keeps the panels in the order they were handed over", () => {
    const panels = [
      makePanel({ id: "second", addedAt: at("2026-03-01") }),
      makePanel({ id: "first", addedAt: at("2026-01-01") }),
    ];
    expect(buildArtistRows(panels, EMPTY_META)[0].panels.map((p) => p.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("records first and last posting", () => {
    const rows = buildArtistRows(
      [
        makePanel({ id: "a", addedAt: at("2026-03-01") }),
        makePanel({ id: "b", addedAt: at("2026-01-01") }),
      ],
      EMPTY_META,
    );
    expect(rows[0].firstPostedAt).toBe(Date.parse(at("2026-01-01")));
    expect(rows[0].lastPostedAt).toBe(Date.parse(at("2026-03-01")));
  });

  it("falls back to zero when no panel carries a parseable date", () => {
    const rows = buildArtistRows([makePanel({ addedAt: "" })], EMPTY_META);
    expect(rows[0].firstPostedAt).toBe(0);
    expect(rows[0].lastPostedAt).toBe(0);
  });

  describe("years", () => {
    it("spans the cover dates actually on the wall", () => {
      const rows = buildArtistRows(
        [
          makePanel({ id: "a", year: 1975 }),
          makePanel({ id: "b", year: 1990 }),
          makePanel({ id: "c", year: 1982 }),
        ],
        EMPTY_META,
      );
      expect(rows[0].years).toEqual({ from: 1975, to: 1990 });
    });

    it("is null when no panel carries a year", () => {
      expect(buildArtistRows([makePanel({ year: 0 })], EMPTY_META)[0].years).toBeNull();
    });
  });

  describe("life", () => {
    it("prints a closed span when both dates are known", () => {
      const meta: ArtistMeta = {
        artists: [artist({ id: "w", name: "W", birthYear: 1927, deathYear: 1981 })],
        series: [],
      };
      expect(buildArtistRows([makePanel({ artist: "W" })], meta)[0].life).toBe("1927–1981");
    });

    it("prints a birth year alone as 'b.'", () => {
      const meta: ArtistMeta = {
        artists: [artist({ id: "w", name: "W", birthYear: 1970 })],
        series: [],
      };
      expect(buildArtistRows([makePanel({ artist: "W" })], meta)[0].life).toBe("b. 1970");
    });

    it("prints a death year alone as 'd.'", () => {
      const meta: ArtistMeta = {
        artists: [artist({ id: "w", name: "W", deathYear: 1981 })],
        series: [],
      };
      expect(buildArtistRows([makePanel({ artist: "W" })], meta)[0].life).toBe("d. 1981");
    });

    it("is null with no record and with no dates", () => {
      expect(buildArtistRows([makePanel({ artist: "W" })], EMPTY_META)[0].life).toBeNull();
      const meta: ArtistMeta = { artists: [artist({ id: "w", name: "W" })], series: [] };
      expect(buildArtistRows([makePanel({ artist: "W" })], meta)[0].life).toBeNull();
    });
  });

  describe("series rail", () => {
    it("ranks the books by how present the person is in each", () => {
      const rows = buildArtistRows(
        [
          makePanel({ id: "a", slug: "one-off", title: "One Off" }),
          makePanel({ id: "b", slug: "regular", title: "Regular" }),
          makePanel({ id: "c", slug: "regular", title: "Regular" }),
        ],
        EMPTY_META,
      );
      expect(rows[0].series.map((s) => s.slug)).toEqual(["regular", "one-off"]);
    });

    it("breaks a tie on the slug so the order is stable", () => {
      const rows = buildArtistRows(
        [makePanel({ id: "a", slug: "zed" }), makePanel({ id: "b", slug: "alpha" })],
        EMPTY_META,
      );
      expect(rows[0].series.map((s) => s.slug)).toEqual(["alpha", "zed"]);
    });

    it("collects every spelling a slug carries, so a click filters to all of them", () => {
      const rows = buildArtistRows(
        [
          makePanel({ id: "a", slug: "omaha", title: "Omaha" }),
          makePanel({ id: "b", slug: "omaha", title: "Omaha the Cat Dancer" }),
        ],
        EMPTY_META,
      );
      expect(rows[0].series[0].titles).toEqual(["Omaha", "Omaha the Cat Dancer"]);
    });

    it("prefers the metadata's spelling as the label — it is the name on the book", () => {
      const meta: ArtistMeta = {
        artists: [],
        series: [series({ id: "omaha", name: "Omaha the Cat Dancer" })],
      };
      const rows = buildArtistRows([makePanel({ slug: "omaha", title: "Omaha" })], meta);
      expect(rows[0].series[0].title).toBe("Omaha the Cat Dancer");
    });

    it("falls back to the wall's spelling with no record", () => {
      const rows = buildArtistRows([makePanel({ slug: "omaha", title: "Omaha" })], EMPTY_META);
      expect(rows[0].series[0].title).toBe("Omaha");
    });
  });

  describe("also-credits", () => {
    it("counts the person's colouring and lettering across the filtered set", () => {
      const rows = buildArtistRows(
        [
          makePanel({ id: "a", artist: "Dave Stewart" }),
          makePanel({ id: "b", artist: "Someone Else", colorists: ["Dave Stewart"] }),
          makePanel({ id: "c", artist: "Someone Else", letterers: ["Dave Stewart"] }),
        ],
        EMPTY_META,
      );
      const dave = rows.find((r) => r.name === "Dave Stewart")!;
      expect(dave.alsoColorist).toBe(1);
      expect(dave.alsoLetterer).toBe(1);
    });

    it("does not count a credit on a panel the person already drew", () => {
      // That is the row's own strip restated, not a second role.
      const rows = buildArtistRows(
        [makePanel({ artist: "Moebius", credits: ["Moebius"] })],
        EMPTY_META,
      );
      expect(rows[0].alsoCredited).toBe(0);
    });

    it("counts a credit on someone else's panel", () => {
      const rows = buildArtistRows(
        [
          makePanel({ id: "a", artist: "Moebius" }),
          makePanel({ id: "b", artist: "Other", credits: ["Moebius"] }),
        ],
        EMPTY_META,
      );
      expect(rows.find((r) => r.name === "Moebius")!.alsoCredited).toBe(1);
    });

    it("never reports an artist count as an 'also' line", () => {
      const rows = buildArtistRows([makePanel({ artist: "Moebius" })], EMPTY_META);
      expect(rows[0].alsoColorist).toBe(0);
      expect(rows[0].alsoLetterer).toBe(0);
      expect(rows[0].alsoCredited).toBe(0);
    });
  });

  it("returns no rows for no panels", () => {
    expect(buildArtistRows([], EMPTY_META)).toEqual([]);
  });
});

describe("buildPortraitPanel", () => {
  function rowFor(a: Artist | null) {
    const meta: ArtistMeta = { artists: a ? [a] : [], series: [] };
    return buildArtistRows([makePanel({ artist: a?.name ?? "Nobody" })], meta)[0];
  }

  it("returns null when the record carries no portrait", () => {
    expect(buildPortraitPanel(rowFor(artist({ id: "w", name: "W" })))).toBeNull();
    expect(buildPortraitPanel(rowFor(null))).toBeNull();
  });

  it("stands the portrait in as a pageable panel", () => {
    const row = rowFor(artist({ id: "wally-wood", name: "Wally Wood", imageUrl: "a.jpg" }));
    const portrait = buildPortraitPanel(row)!;
    expect(portrait.image).toBe("a.jpg");
    expect(portrait.portrait).toBe(true);
    expect(portrait.id).toBe("portrait:wally-wood");
  });

  it("keeps the artist name — the one field a portrait can honestly fill", () => {
    const row = rowFor(artist({ id: "wally-wood", name: "Wally Wood", imageUrl: "a.jpg" }));
    const portrait = buildPortraitPanel(row)!;
    expect(portrait.artist).toBe("Wally Wood");
    expect(portrait.title).toBe("Wally Wood");
  });

  it("leaves everything that records a posting empty", () => {
    const portrait = buildPortraitPanel(
      rowFor(artist({ id: "w", name: "W", imageUrl: "a.jpg" })),
    )!;
    expect(portrait.postedBy).toBe("");
    expect(portrait.addedAt).toBe("");
    expect(portrait.slug).toBe("");
    expect(portrait.tags).toEqual([]);
  });

  it("labels the issue so it reads as 'Wally Wood Portrait'", () => {
    const portrait = buildPortraitPanel(
      rowFor(artist({ id: "w", name: "Wally Wood", imageUrl: "a.jpg" })),
    )!;
    expect(portrait.issue).toBe(PORTRAIT_ISSUE);
  });

  it("declares a square aspect, since the strip's tile is a square crop", () => {
    const portrait = buildPortraitPanel(
      rowFor(artist({ id: "w", name: "W", imageUrl: "a.jpg" })),
    )!;
    expect(portrait.width).toBe(1);
    expect(portrait.height).toBe(1);
  });
});
