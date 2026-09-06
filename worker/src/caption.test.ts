import { describe, expect, it } from "vitest";
import { parseCaption, parseIssue, parseTags, slugify } from "./caption";

describe("parseIssue", () => {
  it("reads a bare integer as a number", () => {
    expect(parseIssue("5")).toBe(5);
    expect(parseIssue(" 42 ")).toBe(42);
    expect(parseIssue("0")).toBe(0);
  });

  it("keeps anything else as text", () => {
    expect(parseIssue("VOL 1")).toBe("VOL 1");
    expect(parseIssue("Annual 2")).toBe("Annual 2");
    expect(parseIssue("½")).toBe("½");
    // Not a whole number, so not a number.
    expect(parseIssue("1.5")).toBe("1.5");
    expect(parseIssue("-1")).toBe("-1");
  });

  it("rejects an empty issue", () => {
    expect(() => parseIssue("")).toThrow(/required/);
    expect(() => parseIssue("   ")).toThrow(/required/);
  });
});

describe("parseCaption", () => {
  describe("the // format", () => {
    it("reads the three required segments", () => {
      expect(parseCaption("Saga // 1 // 2012")).toEqual({
        title: "Saga",
        issue: 1,
        year: 2012,
        artist: null,
        notes: null,
        tags: [],
        seriesTags: [],
        artistTags: [],
      });
    });

    it("trims whitespace around every segment", () => {
      const out = parseCaption("  Saga  //  1  //  2012  //  Fiona Staples  ");
      expect(out.title).toBe("Saga");
      expect(out.artist).toBe("Fiona Staples");
    });

    it("reads a free-form issue", () => {
      expect(parseCaption("Hellboy // VOL 1 // 1994").issue).toBe("VOL 1");
    });

    it("reads the optional artist and notes", () => {
      const out = parseCaption("Saga // 1 // 2012 // Fiona Staples // great spread");
      expect(out.artist).toBe("Fiona Staples");
      expect(out.notes).toBe("great spread");
    });

    it("leaves the artist null when the segment is empty, so the caller can fill it in", () => {
      const out = parseCaption("Saga // 1 // 2012 // // great spread");
      expect(out.artist).toBeNull();
      expect(out.notes).toBe("great spread");
    });

    it("reaches tags past an empty notes segment", () => {
      const out = parseCaption("Saga // 1 // 2012 // Fiona Staples // // sci-fi, space opera");
      expect(out.notes).toBeNull();
      expect(out.tags).toEqual(["sci-fi", "space opera"]);
    });

    it("buckets tags by prefix", () => {
      const out = parseCaption("Saga // 1 // 2012 // F S // n // panel, +series, ++artist");
      expect(out.tags).toEqual(["panel"]);
      expect(out.seriesTags).toEqual(["series"]);
      expect(out.artistTags).toEqual(["artist"]);
    });

    it("rejects an unparseable year", () => {
      expect(() => parseCaption("Saga // 1 // nineteen")).toThrow(/Invalid year/);
    });

    it("rejects an empty issue segment", () => {
      expect(() => parseCaption("Saga //  // 2012")).toThrow(/required/);
    });

    it("falls through to the freeform format when there are too few segments", () => {
      // Two segments is not the // format, so the fallback regex gets a turn.
      expect(parseCaption("Saga // 1 #4 2012").issue).toBe(4);
    });
  });

  describe("the freeform format", () => {
    it("reads title, issue and year", () => {
      expect(parseCaption("Saga #4 2012")).toEqual({
        title: "Saga",
        issue: 4,
        year: 2012,
        artist: null,
        notes: null,
        tags: [],
        seriesTags: [],
        artistTags: [],
      });
    });

    it("reads an optional trailing artist", () => {
      const out = parseCaption("Saga #4 2012 Fiona Staples");
      expect(out.artist).toBe("Fiona Staples");
    });

    it("handles a title containing a number", () => {
      const out = parseCaption("Saga 3 #4 2012");
      expect(out.title).toBe("Saga 3");
      expect(out.issue).toBe(4);
    });

    it("requires a four-digit year", () => {
      expect(() => parseCaption("Saga #4 12")).toThrow(/Could not parse/);
    });

    it("only accepts a numeric issue", () => {
      expect(() => parseCaption("Saga #VOL 2012")).toThrow(/Could not parse/);
    });
  });

  it("explains the expected format when nothing matches", () => {
    expect(() => parseCaption("just some words")).toThrow(/Expected format/);
  });
});

describe("parseTags", () => {
  it("splits on commas and trims", () => {
    expect(parseTags("a , b,c").tags).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries", () => {
    expect(parseTags("a,,  ,b").tags).toEqual(["a", "b"]);
  });

  it("routes a single + to the series bucket", () => {
    expect(parseTags("+horror").seriesTags).toEqual(["horror"]);
  });

  it("routes a double + to the artist bucket", () => {
    expect(parseTags("++ec-comics").artistTags).toEqual(["ec-comics"]);
  });

  it("checks ++ before +, so an artist tag is never read as a series tag", () => {
    const out = parseTags("++a, +b, c");
    expect(out).toEqual({ tags: ["c"], seriesTags: ["b"], artistTags: ["a"] });
  });

  it("tolerates space after the marker", () => {
    expect(parseTags("+ horror").seriesTags).toEqual(["horror"]);
    expect(parseTags("++ ec").artistTags).toEqual(["ec"]);
  });

  it("drops a bare marker with nothing after it", () => {
    expect(parseTags("+, ++, x")).toEqual({ tags: ["x"], seriesTags: [], artistTags: [] });
  });

  it("returns three empty buckets for an empty string", () => {
    expect(parseTags("")).toEqual({ tags: [], seriesTags: [], artistTags: [] });
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Love & Rockets")).toBe("love-rockets");
    expect(slugify("Saga")).toBe("saga");
  });

  it("collapses a run of separators into one hyphen", () => {
    expect(slugify("A   B---C")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  !Saga!  ")).toBe("saga");
  });

  it("keeps digits", () => {
    expect(slugify("2000 AD")).toBe("2000-ad");
  });

  it("drops non-ASCII entirely", () => {
    expect(slugify("Épatant")).toBe("patant");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
  });
});
