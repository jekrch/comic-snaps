import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, Gallery, PanelEntry } from "./types";
import type { RatingsIndex } from "./ratings";

/**
 * `resolveTarget` reads the gallery through `github.ts` and memoises it in the
 * edge cache, so both are stood in for here — the tests are about the
 * reference grammar, not about GitHub or `caches.default`.
 */
const gallery: Gallery = { panels: [] };
const seriesFile = { series: [] as Record<string, unknown>[] };
let ratingsFile: RatingsIndex | null = null;
let lastCommitMessage = "";

vi.mock("./github", async () => {
  const actual = await vi.importActual<typeof import("./github")>("./github");
  return {
    ...actual,
    readGalleryJson: vi.fn(async () => ({ gallery, sha: "sha" })),
    readJsonFile: vi.fn(async (_env: Env, path: string) => ({
      data: path.includes("series") ? seriesFile : ratingsFile,
      sha: "sha",
    })),
    mutateJsonFile: vi.fn(
      async (
        _env: Env,
        _path: string,
        empty: () => RatingsIndex,
        apply: (d: RatingsIndex) => { result: unknown; message: string },
      ) => {
        const doc = ratingsFile ?? empty();
        const { result, message } = apply(doc);
        ratingsFile = doc;
        lastCommitMessage = message;
        return result;
      },
    ),
  };
});

/** A no-op stand-in for the Workers edge cache. */
function stubCaches() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
      delete: async (req: Request) => store.delete(req.url),
    },
  });
}

const env = { GITHUB_REPO: "o/r", GITHUB_TOKEN: "t", RATINGS_SALT: "salt" } as Env;

function panel(over: Partial<PanelEntry> = {}): PanelEntry {
  return {
    seq: 1,
    id: "saga-1-abc",
    title: "Saga",
    slug: "saga",
    issue: 1,
    year: 2012,
    artist: "Fiona Staples",
    image: "images/saga/1.jpg",
    notes: null,
    tags: [],
    postedBy: "jek",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const {
  aggregateFrom,
  formatAggregate,
  invalidateSourceCache,
  issueLabel,
  issueTargetId,
  parseRateArgs,
  ratingsFrom,
  resolveTarget,
  targetForPanel,
  targetKey,
  upsertRating,
  userKey,
} = await import("./ratings");

beforeEach(() => {
  gallery.panels = [];
  seriesFile.series = [];
  ratingsFile = null;
  lastCommitMessage = "";
  stubCaches();
});

describe("target ids", () => {
  it("builds an issue id from the slug and a slugified issue", () => {
    expect(issueTargetId("saga", 4)).toBe("saga-4");
    expect(issueTargetId("hellboy", "VOL 1")).toBe("hellboy-vol-1");
  });

  it("collapses two panels of one issue onto the same target", () => {
    const a = targetForPanel(panel({ seq: 1, issue: 4 }), false);
    const b = targetForPanel(panel({ seq: 2, issue: 4 }), false);
    expect(a.id).toBe(b.id);
  });

  it("labels an issue with its display form", () => {
    expect(issueLabel("Saga", 4)).toBe("Saga #4");
    expect(issueLabel("Hellboy", "VOL 1")).toBe("Hellboy VOL 1");
  });

  it("rates the issue a panel came from, not the panel", () => {
    const t = targetForPanel(panel({ issue: 4 }), false);
    expect(t.type).toBe("issue");
    expect(t.id).toBe("saga-4");
    expect(t.series).toEqual({ id: "saga", label: "Saga" });
  });

  it("walks up to the series when the command forces it", () => {
    const t = targetForPanel(panel({ issue: 4 }), true);
    expect(t.type).toBe("series");
    expect(t.id).toBe("saga");
  });

  it("keys a target by type and id", () => {
    expect(targetKey("issue", "saga-4")).toBe("issue:saga-4");
    expect(targetKey("series", "saga")).toBe("series:saga");
  });
});

describe("userKey", () => {
  it("is stable for the same Telegram id", async () => {
    expect(await userKey(env, 42)).toBe(await userKey(env, 42));
  });

  it("differs between people", async () => {
    expect(await userKey(env, 42)).not.toBe(await userKey(env, 43));
  });

  it("is a short opaque digest, not the raw id", async () => {
    const key = await userKey(env, 42);
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(key).not.toContain("42");
  });

  it("changes with the salt, so the published digest cannot be brute-forced", async () => {
    const other = { ...env, RATINGS_SALT: "different" } as Env;
    expect(await userKey(env, 42)).not.toBe(await userKey(other, 42));
  });

  it("falls back through the webhook secret to a default", async () => {
    const noSalt = { GITHUB_REPO: "o/r", WEBHOOK_SECRET: "w" } as Env;
    const noneAtAll = { GITHUB_REPO: "o/r" } as Env;
    expect(await userKey(noSalt, 1)).toMatch(/^[0-9a-f]{12}$/);
    expect(await userKey(noneAtAll, 1)).toMatch(/^[0-9a-f]{12}$/);
    expect(await userKey(noSalt, 1)).not.toBe(await userKey(noneAtAll, 1));
  });
});

describe("parseRateArgs", () => {
  it("reads a trailing score as the score, not as an issue", () => {
    // This is what makes `/rate Saga 9` the series at 9.
    const out = parseRateArgs("Saga 9");
    expect(out).toMatchObject({ ok: true, ref: "Saga", score: 9 });
  });

  it("accepts the n/10 form", () => {
    expect(parseRateArgs("Saga 8/10")).toMatchObject({ ok: true, ref: "Saga", score: 8 });
  });

  it("reads a review after //", () => {
    const out = parseRateArgs("Saga 9 // best thing all year");
    expect(out).toMatchObject({ ok: true, ref: "Saga", score: 9, review: "best thing all year" });
  });

  it("accepts a review with no score", () => {
    expect(parseRateArgs("Saga // just lovely")).toMatchObject({
      ok: true,
      ref: "Saga",
      score: null,
      review: "just lovely",
    });
  });

  it("treats an empty review as none", () => {
    expect(parseRateArgs("Saga 9 //   ")).toMatchObject({ review: null });
  });

  it("rejects a review past the cap", () => {
    const out = parseRateArgs(`Saga 9 // ${"x".repeat(1001)}`);
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toMatch(/1000/);
  });

  it("accepts a review exactly at the cap", () => {
    expect(parseRateArgs(`Saga 9 // ${"x".repeat(1000)}`).ok).toBe(true);
  });

  it("leaves a reference with no score alone", () => {
    expect(parseRateArgs("Saga")).toMatchObject({ ok: true, ref: "Saga", score: null });
  });

  it("is an empty reference when nothing is given", () => {
    expect(parseRateArgs("")).toMatchObject({ ok: true, ref: "", score: null });
    expect(parseRateArgs("   ")).toMatchObject({ ok: true, ref: "", score: null });
  });

  it("rejects an out-of-range score alongside a reference", () => {
    expect(parseRateArgs("Saga 42")).toMatchObject({ ok: false });
    expect(parseRateArgs("Saga 0")).toMatchObject({ ok: false });
  });

  it("reads a lone out-of-range number as a reference, not a bad score", () => {
    // `/rate 247` is far more likely a panel number with the score left off.
    expect(parseRateArgs("247")).toMatchObject({ ok: true, ref: "247", score: null });
  });

  it("keeps a non-numeric trailing token in the reference", () => {
    expect(parseRateArgs("2000 AD")).toMatchObject({ ok: true, ref: "2000 AD", score: null });
  });

  describe("attribution flags", () => {
    it("signs a rating with --me", () => {
      expect(parseRateArgs("Saga 9 --me")).toMatchObject({ ref: "Saga", score: 9, attributed: true });
    });

    it("hands it back to the group with --us", () => {
      expect(parseRateArgs("Saga 9 --us")).toMatchObject({ attributed: false });
    });

    it("says nothing when no flag is given", () => {
      expect(parseRateArgs("Saga 9")).toMatchObject({ attributed: null });
    });

    it("accepts every spelling", () => {
      expect(parseRateArgs("Saga --mine 9")).toMatchObject({ attributed: true });
      expect(parseRateArgs("Saga --ours 9")).toMatchObject({ attributed: false });
      expect(parseRateArgs("Saga --anon 9")).toMatchObject({ attributed: false });
      expect(parseRateArgs("Saga -me 9")).toMatchObject({ attributed: true });
    });

    it("strips the flag wherever it appears, so it is never read as the score", () => {
      expect(parseRateArgs("--me Saga 9")).toMatchObject({ ref: "Saga", score: 9, attributed: true });
      expect(parseRateArgs("Saga --me 9")).toMatchObject({ ref: "Saga", score: 9 });
    });

    it("lets the last flag win", () => {
      expect(parseRateArgs("Saga --me --us 9")).toMatchObject({ attributed: false });
    });

    it("leaves an unknown double-dash token in the reference", () => {
      expect(parseRateArgs("Saga --wat 9")).toMatchObject({ ref: "Saga --wat", score: 9 });
    });
  });
});

describe("resolveTarget", () => {
  it("resolves a bare number to that panel's issue", async () => {
    gallery.panels = [panel({ seq: 247, slug: "saga", issue: 4, title: "Saga" })];
    const out = await resolveTarget(env, "247");
    expect(out).toMatchObject({ ok: true, target: { type: "issue", id: "saga-4" } });
  });

  it("falls through a number no panel carries, so a series named in digits still resolves", async () => {
    seriesFile.series = [{ id: "100-percent", name: "100%", aliases: ["100"] }];
    const out = await resolveTarget(env, "100");
    expect(out).toMatchObject({ ok: true, target: { type: "series", id: "100-percent" } });
  });

  it("matches a series by id, name and alias", async () => {
    seriesFile.series = [{ id: "love-rockets", name: "Love & Rockets", aliases: ["L&R"] }];
    for (const ref of ["love-rockets", "Love & Rockets", "l&r"]) {
      expect(await resolveTarget(env, ref)).toMatchObject({
        ok: true,
        target: { type: "series", id: "love-rockets" },
      });
    }
  });

  it("tries the whole string as a series before splitting a trailing number off", async () => {
    // `2000 AD` must not resolve as the series "2000" plus issue "AD".
    seriesFile.series = [{ id: "2000-ad", name: "2000 AD" }];
    expect(await resolveTarget(env, "2000 AD")).toMatchObject({
      ok: true,
      target: { type: "series", id: "2000-ad" },
    });
  });

  it("splits a trailing token as the issue when the whole string is not a series", async () => {
    seriesFile.series = [{ id: "saga", name: "Saga" }];
    expect(await resolveTarget(env, "Saga 4")).toMatchObject({
      ok: true,
      target: { type: "issue", id: "saga-4", label: "Saga #4" },
    });
  });

  it("takes everything after a # as the issue, verbatim", async () => {
    seriesFile.series = [{ id: "hellboy", name: "Hellboy" }];
    expect(await resolveTarget(env, "Hellboy #Annual 2")).toMatchObject({
      ok: true,
      target: { type: "issue", id: "hellboy-annual-2" },
    });
  });

  it("reports a failing head before the # rather than reinterpreting the string", async () => {
    seriesFile.series = [{ id: "saga", name: "Saga" }];
    const out = await resolveTarget(env, "Nonexistent #4");
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toMatch(/Nonexistent/);
  });

  describe("explicit prefixes", () => {
    it("resolves panel:", async () => {
      gallery.panels = [panel({ seq: 7, slug: "saga", issue: 4 })];
      expect(await resolveTarget(env, "panel: 7")).toMatchObject({
        ok: true,
        target: { id: "saga-4" },
      });
    });

    it("rejects a non-numeric panel reference", async () => {
      const out = await resolveTarget(env, "panel: saga");
      expect(out).toMatchObject({ ok: false });
      expect((out as { message: string }).message).toMatch(/isn't a panel number/);
    });

    it("reports a panel number nothing carries", async () => {
      const out = await resolveTarget(env, "panel:999");
      expect((out as { message: string }).message).toMatch(/No panel found/);
    });

    it("disambiguates a digit-named series with series:", async () => {
      gallery.panels = [panel({ seq: 100 })];
      seriesFile.series = [{ id: "100-percent", name: "100%" }];
      expect(await resolveTarget(env, "series:100%")).toMatchObject({
        ok: true,
        target: { type: "series", id: "100-percent" },
      });
    });

    it("labels a raw issue: id from a panel when one exists", async () => {
      gallery.panels = [panel({ slug: "saga", issue: 4, title: "Saga" })];
      expect(await resolveTarget(env, "issue:saga-4")).toMatchObject({
        ok: true,
        target: { id: "saga-4", label: "Saga #4" },
      });
    });

    it("still accepts an issue: id no panel carries", async () => {
      seriesFile.series = [{ id: "saga", name: "Saga" }];
      const out = await resolveTarget(env, "issue:saga-9");
      expect(out).toMatchObject({ ok: true, target: { type: "issue", id: "saga-9" } });
      expect((out as { target: { series: { id: string } } }).target.series.id).toBe("saga");
    });
  });

  describe("forceSeries", () => {
    it("lands a panel reference on its series", async () => {
      gallery.panels = [panel({ seq: 7, slug: "saga", issue: 4 })];
      expect(await resolveTarget(env, "7", { forceSeries: true })).toMatchObject({
        ok: true,
        target: { type: "series", id: "saga" },
      });
    });

    it("lands a named issue on its series", async () => {
      seriesFile.series = [{ id: "saga", name: "Saga" }];
      expect(await resolveTarget(env, "Saga 4", { forceSeries: true })).toMatchObject({
        ok: true,
        target: { type: "series", id: "saga" },
      });
    });

    it("leaves a series reference alone", async () => {
      seriesFile.series = [{ id: "saga", name: "Saga" }];
      expect(await resolveTarget(env, "Saga", { forceSeries: true })).toMatchObject({
        target: { type: "series", id: "saga" },
      });
    });
  });

  describe("replies", () => {
    it("uses the replied-to message's target for an empty reference", async () => {
      const replyTarget = targetForPanel(panel({ issue: 4 }), false);
      expect(await resolveTarget(env, "", { replyTarget })).toMatchObject({
        ok: true,
        target: { id: "saga-4" },
      });
    });

    it("narrows the reply target when the command forces the series", async () => {
      const replyTarget = targetForPanel(panel({ issue: 4 }), false);
      expect(await resolveTarget(env, "", { replyTarget, forceSeries: true })).toMatchObject({
        target: { type: "series", id: "saga" },
      });
    });

    it("asks which one when there is nothing to reply to", async () => {
      const out = await resolveTarget(env, "");
      expect(out.ok).toBe(false);
      expect((out as { message: string }).message).toMatch(/Which one/);
    });
  });

  describe("recovery candidates", () => {
    it("offers near misses so recovery can be a tap", async () => {
      seriesFile.series = [
        { id: "saga", name: "Saga" },
        { id: "sandman", name: "The Sandman" },
      ];
      const out = await resolveTarget(env, "sag");
      expect(out.ok).toBe(false);
      expect((out as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toContain("saga");
    });

    it("ranks a prefix match above a substring match", async () => {
      seriesFile.series = [
        { id: "x-saga", name: "The Long Saga" },
        { id: "saga", name: "Saga" },
      ];
      const out = await resolveTarget(env, "sag");
      const ids = (out as { candidates: { id: string }[] }).candidates.map((c) => c.id);
      expect(ids[0]).toBe("saga");
    });
  });

  it("names a series the gallery uses even before series.json catches up", async () => {
    // series.json is generated by a separate pass that may not have run.
    gallery.panels = [panel({ slug: "brand-new", title: "Brand New" })];
    expect(await resolveTarget(env, "Brand New")).toMatchObject({
      ok: true,
      target: { type: "series", id: "brand-new" },
    });
  });

  it("prefers series.json's name over the gallery's spelling", async () => {
    gallery.panels = [panel({ slug: "omaha", title: "Omaha" })];
    seriesFile.series = [{ id: "omaha", name: "Omaha the Cat Dancer" }];
    expect(await resolveTarget(env, "Omaha the Cat Dancer")).toMatchObject({
      ok: true,
      target: { id: "omaha" },
    });
  });

  it("reports a reference that matches nothing at all", async () => {
    const out = await resolveTarget(env, "Nothing Like This");
    expect(out).toMatchObject({ ok: false, candidates: [] });
  });
});

describe("upsertRating", () => {
  const target = targetForPanel(panel({ issue: 4 }), false);
  const user = { id: 42, name: "Jek" };

  it("records a first score and aggregates it", async () => {
    const out = await upsertRating(env, target, user, 9, null);
    expect(out.previous).toBeNull();
    expect(out.current.score).toBe(9);
    expect(out.target).toEqual({ avg: 9, count: 1 });
    expect(ratingsFile!.targets["issue:saga-4"].ratings).toHaveLength(1);
  });

  it("stores no name for an unsigned rating — the group's is the default", async () => {
    await upsertRating(env, target, user, 9, null);
    const row = ratingsFile!.targets["issue:saga-4"].ratings[0];
    expect(row.attributed).toBe(false);
    expect(row.user).toBeNull();
  });

  it("stores the first name once the rating is signed", async () => {
    const out = await upsertRating(env, target, user, 9, null, true);
    expect(out.attributed).toBe(true);
    expect(ratingsFile!.targets["issue:saga-4"].ratings[0].user).toBe("Jek");
  });

  it("keeps a rating signed through later edits", async () => {
    await upsertRating(env, target, user, 9, null, true);
    const out = await upsertRating(env, target, user, 8, null, null);
    expect(out.attributed).toBe(true);
    expect(ratingsFile!.targets["issue:saga-4"].ratings[0].user).toBe("Jek");
  });

  it("un-signs on request, dropping the stored name", async () => {
    await upsertRating(env, target, user, 9, null, true);
    await upsertRating(env, target, user, null, "still good", false);
    expect(ratingsFile!.targets["issue:saga-4"].ratings[0].user).toBeNull();
  });

  it("finds the same row on a re-rate rather than adding a second", async () => {
    await upsertRating(env, target, user, 9, null);
    const out = await upsertRating(env, target, user, 7, null);
    expect(out.previous).toEqual({ score: 9, review: null });
    expect(ratingsFile!.targets["issue:saga-4"].ratings).toHaveLength(1);
    expect(out.target).toEqual({ avg: 7, count: 1 });
  });

  it("leaves an existing review untouched when only a score is given", async () => {
    await upsertRating(env, target, user, null, "lovely");
    const out = await upsertRating(env, target, user, 9, null);
    expect(out.current).toEqual({ score: 9, review: "lovely" });
  });

  it("leaves an existing score untouched when only a review is given", async () => {
    await upsertRating(env, target, user, 9, null);
    const out = await upsertRating(env, target, user, null, "lovely");
    expect(out.current).toEqual({ score: 9, review: "lovely" });
  });

  it("counts a review-only row in neither the mean nor the count", async () => {
    await upsertRating(env, target, user, null, "no number from me");
    expect(ratingsFile!.targets["issue:saga-4"]).toMatchObject({ avg: null, count: 0 });
  });

  it("averages several raters to one decimal", async () => {
    await upsertRating(env, target, { id: 1, name: "A" }, 8, null);
    await upsertRating(env, target, { id: 2, name: "B" }, 9, null);
    const out = await upsertRating(env, target, { id: 3, name: "C" }, 9, null);
    expect(out.target).toEqual({ avg: 8.7, count: 3 });
  });

  it("drops a row left with neither score nor review, and the target with it", async () => {
    // Nothing to say about the target at all: the row is created, found
    // empty, and dropped again — leaving no empty target behind.
    const out = await upsertRating(env, target, user, null, null);
    expect(out.removed).toBe(true);
    expect(ratingsFile!.targets["issue:saga-4"]).toBeUndefined();
  });

  it("keeps the target when other raters remain", async () => {
    await upsertRating(env, target, { id: 1, name: "A" }, 8, null);
    const out = await upsertRating(env, target, { id: 2, name: "B" }, null, null);
    expect(out.removed).toBe(true);
    expect(ratingsFile!.targets["issue:saga-4"].ratings).toHaveLength(1);
  });

  it("never empties an existing row — null means 'leave it alone'", async () => {
    // That is the whole merge rule: a score alone leaves the review, a review
    // alone leaves the score, and neither leaves both. Retracting a rating is
    // therefore not something this call can express.
    await upsertRating(env, target, user, 9, "lovely");
    const out = await upsertRating(env, target, user, null, null);
    expect(out.removed).toBe(false);
    expect(out.current).toEqual({ score: 9, review: "lovely" });
  });

  it("orders rows by score, then by most recently touched", async () => {
    await upsertRating(env, target, { id: 1, name: "Low" }, 5, null);
    await upsertRating(env, target, { id: 2, name: "High" }, 9, null);
    const scores = ratingsFile!.targets["issue:saga-4"].ratings.map((r) => r.score);
    expect(scores).toEqual([9, 5]);
  });

  it("quotes the series aggregate alongside the issue's", async () => {
    const seriesT = targetForPanel(panel({ issue: 4 }), true);
    await upsertRating(env, seriesT, user, 6, null);
    const out = await upsertRating(env, target, user, 9, null);
    expect(out.target).toEqual({ avg: 9, count: 1 });
    expect(out.series).toEqual({ avg: 6, count: 1 });
  });

  it("reports an empty series aggregate when the series is unrated", async () => {
    const out = await upsertRating(env, target, user, 9, null);
    expect(out.series).toEqual({ avg: null, count: 0 });
  });

  it("writes a commit message naming the target and the rater", async () => {
    await upsertRating(env, target, user, 9, null, true);
    expect(lastCommitMessage).toContain("Saga #4");
    expect(lastCommitMessage).toContain("Jek");
  });

  it("says 'group' in the commit message for an unsigned rating", async () => {
    await upsertRating(env, target, user, 9, null);
    expect(lastCommitMessage).toContain("group");
  });

  it("refreshes the stored label", async () => {
    await upsertRating(env, target, user, 9, null);
    expect(ratingsFile!.targets["issue:saga-4"].label).toBe("Saga #4");
  });

  it("stamps generatedAt on every write", async () => {
    await upsertRating(env, target, user, 9, null);
    expect(Date.parse(ratingsFile!.generatedAt)).not.toBeNaN();
  });
});

describe("reading an index", () => {
  const index: RatingsIndex = {
    generatedAt: "",
    targets: {
      "series:saga": {
        label: "Saga",
        avg: 8.5,
        count: 2,
        ratings: [
          {
            uid: "a",
            user: null,
            attributed: false,
            score: 8,
            review: null,
            createdAt: "",
            updatedAt: "",
          },
        ],
      },
    },
  };

  it("reads an aggregate", () => {
    expect(aggregateFrom(index, "series", "saga")).toEqual({ avg: 8.5, count: 2 });
  });

  it("reports an empty aggregate for an unknown target", () => {
    expect(aggregateFrom(index, "issue", "saga-4")).toEqual({ avg: null, count: 0 });
  });

  it("reads the rows", () => {
    expect(ratingsFrom(index, "series", "saga")).toHaveLength(1);
    expect(ratingsFrom(index, "issue", "nope")).toEqual([]);
  });
});

describe("formatAggregate", () => {
  it("says so when nothing is rated", () => {
    expect(formatAggregate({ avg: null, count: 0 })).toBe("no ratings yet");
  });

  it("prints the average to one decimal beside the count", () => {
    // The count is the caveat at this group size, so it is never hidden.
    expect(formatAggregate({ avg: 8.5, count: 2 })).toBe("8.5 from 2");
    expect(formatAggregate({ avg: 9, count: 1 })).toBe("9.0 from 1");
  });
});

describe("invalidateSourceCache", () => {
  it("drops the memoised gallery and series reads", async () => {
    gallery.panels = [panel({ seq: 1, slug: "saga" })];
    await resolveTarget(env, "1");

    await invalidateSourceCache();

    // A panel posted a moment ago must be rateable by its number.
    gallery.panels = [panel({ seq: 1, slug: "saga" }), panel({ seq: 2, slug: "new", title: "New" })];
    expect(await resolveTarget(env, "2")).toMatchObject({
      ok: true,
      target: { series: { id: "new" } },
    });
  });
});
