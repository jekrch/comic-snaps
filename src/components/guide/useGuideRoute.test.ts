import { describe, expect, it } from "vitest";
import { guideUrl, parseGuideRoute, type GuideRoute } from "./useGuideRoute";

describe("the Guide's place in the URL", () => {
  it("is absent without a guide param", () => {
    expect(parseGuideRoute("?sort=color", "")).toBeNull();
    expect(parseGuideRoute("", "#attention")).toBeNull();
  });

  it("reads a bare ?guide as the overview", () => {
    expect(parseGuideRoute("?guide", "")).toEqual({ page: "overview", step: null, anchor: null });
    expect(parseGuideRoute("?sort=color&guide=", "")).toEqual({ page: "overview", step: null, anchor: null });
  });

  it("reads a lesson, a step and an anchor", () => {
    expect(parseGuideRoute("?guide=siglip&anchor=saga-1", "#attention")).toEqual({
      page: "siglip",
      step: "attention",
      anchor: "saga-1",
    });
  });

  it("falls back to the overview for a page it doesn't know", () => {
    expect(parseGuideRoute("?guide=embedding-siglip", "")?.page).toBe("overview");
  });

  it("writes a lesson on top of the gallery's own params", () => {
    expect(guideUrl("/", "?sort=color&view=series", { page: "dino", step: null, anchor: null })).toBe(
      "/?sort=color&view=series&guide=dino"
    );
  });

  it("writes the overview as a bare ?guide", () => {
    expect(guideUrl("/", "", { page: "overview", step: null, anchor: null })).toBe("/?guide");
    expect(guideUrl("/", "?sort=color", { page: "overview", step: null, anchor: "x" })).toBe("/?sort=color&guide&anchor=x");
  });

  it("drops the layers the Guide covers, and keeps everything else", () => {
    expect(
      guideUrl("/", "?panel=abc&tab=sorts&tags=noir", { page: "gram", step: "angle", anchor: "abc" })
    ).toBe("/?tags=noir&guide=gram&anchor=abc#angle");
  });

  it("takes only its own params off when closing", () => {
    expect(guideUrl("/", "?sort=color&guide=siglip&anchor=a", null)).toBe("/?sort=color");
    expect(guideUrl("/", "?guide", null)).toBe("/");
  });

  it("round-trips", () => {
    const routes: GuideRoute[] = [
      { page: "overview", step: null, anchor: null },
      { page: "overview", step: "methods", anchor: "saga-1" },
      { page: "color", step: "hue", anchor: null },
      { page: "vectors", step: "dot", anchor: "a b/c" },
      { page: "glossary", step: null, anchor: null },
    ];
    for (const r of routes) {
      const url = new URL(guideUrl("/", "?sort=newest", r), "https://example.test");
      expect(parseGuideRoute(url.search, url.hash)).toEqual(r);
    }
  });
});
