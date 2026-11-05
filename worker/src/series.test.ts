import { describe, expect, it } from "vitest";
import { byName, resolveSeries } from "./series";
import type { PanelEntry, SeriesEntry } from "./types";

const series: SeriesEntry[] = [
  { id: "thrillology", name: "Thrillogy", aliases: ["Thrillology"] },
  { id: "the-vault-of-horror", name: "Vault of Horror" },
  { id: "saga", name: "Saga" },
];

const panels = [{ slug: "hup", title: "Hup" }] as PanelEntry[];

describe("resolveSeries", () => {
  it("keeps a renamed series' slug when posting under the corrected name", () => {
    // slugify("Thrillogy") is "thrillogy", which would start a second series.
    expect(resolveSeries("Thrillogy", series, [])).toEqual({
      slug: "thrillology",
      title: "Thrillogy",
      existing: true,
    });
  });

  it("matches the old spelling through its alias", () => {
    expect(resolveSeries("thrillology", series, []).title).toBe("Thrillogy");
  });

  it("matches by slug, so casing and punctuation don't matter, and returns the canonical name", () => {
    expect(resolveSeries("the vault of horror!", series, [])).toEqual({
      slug: "the-vault-of-horror",
      title: "Vault of Horror",
      existing: true,
    });
    expect(resolveSeries("vault of horror", series, []).slug).toBe("the-vault-of-horror");
  });

  it("finds a series posted since the metadata job last ran by its panels", () => {
    expect(resolveSeries("HUP", series, panels)).toEqual({ slug: "hup", title: "HUP", existing: true });
  });

  it("starts a new series for a title nothing recognises", () => {
    expect(resolveSeries("  Black Hole ", series, panels)).toEqual({
      slug: "black-hole",
      title: "Black Hole",
      existing: false,
    });
  });
});

describe("byName", () => {
  it("orders by code point, as Python's default sort does", () => {
    const names = ["saga", "Saga", "Zap", "Ásterix"].map((name) => ({ name }));
    expect(names.sort(byName).map((n) => n.name)).toEqual(["Saga", "Zap", "saga", "Ásterix"]);
  });
});
