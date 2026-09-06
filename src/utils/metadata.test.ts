import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_ROLES, isProductionOnly } from "./metadata";
import type { IssueCredit } from "../types";

const credit = (roles: string[]): IssueCredit => ({ artistId: null, name: "X", roles });

describe("isProductionOnly", () => {
  it("is true when every role is a production role", () => {
    expect(isProductionOnly(credit(["Cover"]))).toBe(true);
    expect(isProductionOnly(credit(["Cover", "Editor", "Designer"]))).toBe(true);
  });

  it("is false when the person also did visible work on the panel", () => {
    // Drew the cover *and* the interior — the credit stands on both counts.
    expect(isProductionOnly(credit(["Cover", "Penciller"]))).toBe(false);
    expect(isProductionOnly(credit(["Writer"]))).toBe(false);
  });

  it("keeps a credit with no role at all rather than guessing", () => {
    expect(isProductionOnly(credit([]))).toBe(false);
  });

  it("exposes the role set it filters on", () => {
    expect([...PRODUCTION_ROLES].sort()).toEqual(["Cover", "Designer", "Editor"]);
  });
});

describe("loadMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubFetch(impl: (url: string) => unknown) {
    const mock = vi.fn(async (url: string) => impl(url));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  const artists = { artists: [{ id: "a", name: "Moebius" }] };
  const series = { series: [{ id: "arzach", name: "Arzach" }] };

  it("reads the three data files and caches the result", async () => {
    const mock = stubFetch((url) => {
      if (url.includes("artists")) return { ok: true, json: async () => artists };
      if (url.includes("series")) return { ok: true, json: async () => series };
      return { ok: true, json: async () => ({ issues: [{ id: "arzach-1" }] }) };
    });
    const mod = await import("./metadata");

    const first = await mod.loadMetadata();
    expect(first.artists).toHaveLength(1);
    expect(first.series).toHaveLength(1);
    expect(first.issues).toHaveLength(1);

    await mod.loadMetadata();
    // Three files, fetched once between the two calls.
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("treats a missing issues.json as an empty credit set", async () => {
    stubFetch((url) => {
      if (url.includes("artists")) return { ok: true, json: async () => artists };
      if (url.includes("series")) return { ok: true, json: async () => series };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const mod = await import("./metadata");
    const out = await mod.loadMetadata();
    expect(out.issues).toEqual([]);
    expect(out.artists).toHaveLength(1);
  });

  it("survives issues.json being present but unparseable", async () => {
    stubFetch((url) => {
      if (url.includes("artists")) return { ok: true, json: async () => artists };
      if (url.includes("series")) return { ok: true, json: async () => series };
      return {
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      };
    });
    const mod = await import("./metadata");
    expect((await mod.loadMetadata()).issues).toEqual([]);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const mock = stubFetch((url) => {
      if (url.includes("artists")) return { ok: true, json: async () => artists };
      if (url.includes("series")) return { ok: true, json: async () => series };
      return { ok: true, json: async () => ({ issues: [] }) };
    });
    const mod = await import("./metadata");
    await Promise.all([mod.loadMetadata(), mod.loadMetadata(), mod.loadMetadata()]);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("reports nothing cached before the first load", async () => {
    const mod = await import("./metadata");
    expect(mod.getCachedMetadata()).toEqual({ artists: null, series: null, issues: null });
  });

  it("exposes the loaded data through the cache accessor", async () => {
    stubFetch((url) => {
      if (url.includes("artists")) return { ok: true, json: async () => artists };
      if (url.includes("series")) return { ok: true, json: async () => series };
      return { ok: true, json: async () => ({ issues: [] }) };
    });
    const mod = await import("./metadata");
    await mod.loadMetadata();
    expect(mod.getCachedMetadata().artists).toHaveLength(1);
  });
});
