import { afterEach, describe, expect, it, vi } from "vitest";
import { issueTargetId, lookupRatings, ratingSortKey, seriesTargetId } from "./ratings";
import type { RatingsIndex, TargetRatings } from "../types";
import { makePanel } from "./testPanel";

function target(avg: number | null, count = 1): TargetRatings {
  return { label: "x", avg, count, ratings: [] };
}

describe("issueTargetId", () => {
  it("joins the slug and a slugified issue", () => {
    expect(issueTargetId(makePanel({ slug: "saga", issue: 4 }))).toBe("saga-4");
  });

  it("collapses two panels from one issue onto the same target", () => {
    const a = makePanel({ id: "a", slug: "saga", issue: 4 });
    const b = makePanel({ id: "b", slug: "saga", issue: 4 });
    expect(issueTargetId(a)).toBe(issueTargetId(b));
  });

  it("slugifies a free-form issue the way the worker does", () => {
    expect(issueTargetId(makePanel({ slug: "hellboy", issue: "VOL 1" }))).toBe("hellboy-vol-1");
    expect(issueTargetId(makePanel({ slug: "x", issue: "Annual #2" }))).toBe("x-annual-2");
  });

  it("strips leading and trailing separators from the issue", () => {
    expect(issueTargetId(makePanel({ slug: "x", issue: "  -1-  " }))).toBe("x-1");
  });
});

describe("seriesTargetId", () => {
  it("is the panel's slug", () => {
    expect(seriesTargetId(makePanel({ slug: "arzach" }))).toBe("arzach");
  });
});

describe("lookupRatings", () => {
  const index: RatingsIndex = {
    generatedAt: "",
    targets: { "issue:saga-4": target(8), "series:saga": target(7) },
  };

  it("keys by type and id", () => {
    expect(lookupRatings(index, "issue", "saga-4")?.avg).toBe(8);
    expect(lookupRatings(index, "series", "saga")?.avg).toBe(7);
  });

  it("returns null for an unknown target", () => {
    expect(lookupRatings(index, "issue", "saga-9")).toBeNull();
  });

  it("returns null when there is no index at all", () => {
    expect(lookupRatings(null, "series", "saga")).toBeNull();
  });
});

describe("ratingSortKey", () => {
  const panel = makePanel({ slug: "saga", issue: 4 });

  it("prefers the issue's score", () => {
    const index: RatingsIndex = {
      generatedAt: "",
      targets: { "issue:saga-4": target(9), "series:saga": target(6) },
    };
    expect(ratingSortKey(index, panel)).toBe(9);
  });

  it("falls back to the series when the issue is unrated", () => {
    const index: RatingsIndex = { generatedAt: "", targets: { "series:saga": target(6) } };
    expect(ratingSortKey(index, panel)).toBe(6);
  });

  it("falls through an issue target whose average is null", () => {
    // A review-only row leaves `avg` null; that is not a score, so the ladder
    // must keep walking rather than stopping on it.
    const index: RatingsIndex = {
      generatedAt: "",
      targets: { "issue:saga-4": target(null, 0), "series:saga": target(6) },
    };
    expect(ratingSortKey(index, panel)).toBe(6);
  });

  it("is null when neither rung is rated", () => {
    expect(ratingSortKey({ generatedAt: "", targets: {} }, panel)).toBeNull();
    expect(ratingSortKey(null, panel)).toBeNull();
  });

  it("keeps a zero score rather than treating it as unrated", () => {
    const index: RatingsIndex = { generatedAt: "", targets: { "issue:saga-4": target(0) } };
    expect(ratingSortKey(index, panel)).toBe(0);
  });
});

describe("loadRatings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads the file once and caches it", async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ generatedAt: "2026-01-01", targets: { "series:saga": target(8) } }),
    }));
    vi.stubGlobal("fetch", mock);
    const mod = await import("./ratings");

    expect((await mod.loadRatings()).targets["series:saga"].avg).toBe(8);
    await mod.loadRatings();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty index when the file does not exist yet", async () => {
    // ratings.json is only committed once the first rating is cast.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const mod = await import("./ratings");
    expect(await mod.loadRatings()).toEqual({ generatedAt: "", targets: {} });
  });

  it("fills in missing fields on a partial file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const mod = await import("./ratings");
    expect(await mod.loadRatings()).toEqual({ generatedAt: "", targets: {} });
  });

  it("has nothing cached before the first load", async () => {
    const mod = await import("./ratings");
    expect(mod.getCachedRatings()).toBeNull();
  });

  it("exposes the loaded index through the cache accessor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ generatedAt: "2026-01-01", targets: {} }),
      })),
    );
    const mod = await import("./ratings");
    await mod.loadRatings();
    expect(mod.getCachedRatings()?.generatedAt).toBe("2026-01-01");
  });
});
