// The agent's deterministic pieces: Metron result handling, the rollup, model
// pricing, Telegram chunking, and thread trimming.

import { describe, expect, it } from "vitest";
import { normalizeMetronSeries } from "./lookup";
import { buildRollup, seriesDetail, type CollectionDocs } from "./rollup";
import { estimateCost, formatCostLine } from "./pricing";
import { chunkForTelegram } from "./telegram";
import { trimHistory } from "./agent";
import type { Content } from "@google/genai";
import type { PanelEntry } from "./types";

describe("normalizeMetronSeries", () => {
  it("lifts the matchable name and year out of the display name", () => {
    expect(
      normalizeMetronSeries({ id: 6195, series: "100% (2002)", issue_count: 5, volume: 1 }),
    ).toEqual({
      id: 6195,
      name: "100%",
      display: "100% (2002)",
      yearBegan: 2002,
      issueCount: 5,
      url: "https://metron.cloud/series/6195/",
    });
  });

  it("prefers an explicit year_began and tolerates a display with no year", () => {
    expect(normalizeMetronSeries({ id: 1, series: "Hup", year_began: 1987 })).toMatchObject({
      name: "Hup",
      yearBegan: 1987,
    });
  });

  it("drops a result with no id", () => {
    expect(normalizeMetronSeries({ series: "Hup (1987)" })).toBeNull();
  });
});

function panel(over: Partial<PanelEntry>): PanelEntry {
  return {
    seq: 1,
    id: "x",
    title: "Saga",
    slug: "saga",
    issue: 1,
    year: 2012,
    artist: "Fiona Staples",
    image: "",
    notes: null,
    tags: [],
    postedBy: "Jacob",
    addedAt: "",
    ...over,
  };
}

const docs: CollectionDocs = {
  gallery: {
    panels: [
      panel({ seq: 2, issue: 4, notes: "the robot | prince\nscene", tags: ["sci-fi"] }),
      panel({ seq: 1 }),
      panel({ seq: 3, slug: "hup", title: "Hup", artist: "R. Crumb" }),
    ],
  },
  series: {
    series: [
      {
        id: "saga",
        name: "Saga",
        aliases: ["SAGA"],
        startYear: 2012,
        publisher: "Image",
        references: [{ name: "Metron", url: "https://metron.cloud/series/1/" }],
        sources: ["wikipedia", "metron"],
        coverImages: ["data/covers/saga/a.jpg"],
      },
    ],
  },
  artists: { artists: [{ id: "jean-giraud", name: "Jean Giraud", aliases: ["Moebius", "Gir"] }] },
  disambiguation: {
    "metron:series": {
      Hup: { id: null, candidates: [{ id: 11, name: "Hup (1987)" }] },
      Done: { id: 5, candidates: [] },
    },
  },
};

describe("buildRollup", () => {
  const rollup = buildRollup(docs);
  const lines = rollup.split("\n");

  it("has one line per series, then its panels by seq", () => {
    const at = lines.indexOf("saga | Saga | 2012 | Image | -");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 3)).toEqual(["  1 | #1 | 2012 | Fiona Staples", "  2 | #4 | 2012 | Fiona Staples"]);
  });

  it("leaves out aliases, tags, notes and posters", () => {
    for (const absent of ["SAGA", "sci-fi", "robot", "Jacob"]) expect(rollup).not.toContain(absent);
  });

  it("flags a lookup that ran without a match", () => {
    const unmatched = buildRollup({
      ...docs,
      series: { series: [{ ...docs.series.series[0], sources: ["metron", "comicvine"] }] },
    });
    expect(unmatched).toContain("saga | Saga | 2012 | Image | comicvine");
  });

  it("lists series posted since the metadata job last ran", () => {
    const at = lines.indexOf("hup | Hup | - | - | (not in series.json yet)");
    expect(lines[at + 1]).toBe("  3 | #1 | 2012 | R. Crumb");
  });

  it("lists artists with aliases and only unresolved disambiguation rows", () => {
    expect(rollup).toContain("Jean Giraud (aka Moebius; Gir)");
    expect(rollup).toContain("metron:series | Hup | 11 Hup (1987)");
    expect(rollup).not.toContain("| Done |");
  });
});

describe("seriesDetail", () => {
  it("returns the series entry without cover noise, plus its panels", () => {
    const out = JSON.parse(seriesDetail(docs, "saga"));
    expect(out.series.name).toBe("Saga");
    expect(out.series).not.toHaveProperty("coverImages");
    expect(out.panels.map((p: { seq: number }) => p.seq)).toEqual([2, 1]);
  });

  it("finds by alias, and handles a series with panels but no entry", () => {
    expect(JSON.parse(seriesDetail(docs, "saga")).series.id).toBe("saga");
    expect(JSON.parse(seriesDetail(docs, "SAGA")).series.id).toBe("saga");
    expect(JSON.parse(seriesDetail(docs, "hup"))).toMatchObject({ series: null });
    expect(seriesDetail(docs, "nope")).toBe('No series "nope".');
  });
});

describe("pricing", () => {
  it("prices cached input at the cached rate and switches periods on schedule", () => {
    const usage = { prompt: 100_000, cached: 20_000, output: 0 };
    expect(estimateCost("gemini-4-argon", usage, new Date("2026-11-15"))).toBeCloseTo(0.162, 6);
    expect(estimateCost("gemini-4-argon", usage, new Date("2026-12-01"))).toBeCloseTo(0.324, 6);
    expect(estimateCost("unknown", usage)).toBeNull();
    expect(formatCostLine("unknown", usage)).toBe("");
  });
});

describe("chunkForTelegram", () => {
  it("leaves short text alone and splits long text at a newline", () => {
    expect(chunkForTelegram("hi")).toEqual(["hi"]);
    const long = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
    expect(chunkForTelegram(long)).toEqual(["a".repeat(3000), "b".repeat(3000)]);
  });
});

describe("trimHistory", () => {
  const ask = (text: string): Content => ({ role: "user", parts: [{ text }] });
  const call: Content = { role: "model", parts: [{ functionCall: { name: "get_series", args: {} } }] };
  const result: Content = {
    role: "user",
    parts: [{ functionResponse: { name: "get_series", response: { result: "{}" } } }],
  };
  const answer = (text: string): Content => ({ role: "model", parts: [{ text }] });

  it("keeps the last exchanges whole, tool calls and their results included", () => {
    const history = [ask("a"), answer("A"), ask("b"), call, result, answer("B"), ask("c"), answer("C")];
    expect(trimHistory(history, 2)).toEqual([ask("b"), call, result, answer("B"), ask("c"), answer("C")]);
  });

  it("leaves a short thread alone", () => {
    const history = [ask("a"), call, result, answer("A")];
    expect(trimHistory(history, 2)).toBe(history);
  });
});
