import { describe, expect, it } from "vitest";
import { buildPanelCaption, parseConfirmIndices, sanitizeProposals } from "./proposals";

describe("sanitizeProposals", () => {
  it("keeps well-formed edit commands in order, deduplicated", () => {
    const out = sanitizeProposals([
      { command: "/rename_series thrillology // Thrillogy", rationale: "Metron spelling" },
      { command: "/tag_series Saga // sci-fi", rationale: "" },
      { command: "/rename_series thrillology // Thrillogy", rationale: "again" },
    ]);
    expect(out.accepted).toEqual([
      { command: "/rename_series thrillology // Thrillogy", rationale: "Metron spelling" },
      { command: "/tag_series Saga // sci-fi", rationale: "(no rationale)" },
    ]);
    expect(out.rejected).toEqual([]);
  });

  it("rejects verbs the agent may not propose, and says why", () => {
    const out = sanitizeProposals([
      { command: "/delete 5", rationale: "" },
      { command: "/rate 5 9", rationale: "" },
    ]);
    expect(out.accepted).toEqual([]);
    expect(out.rejected.map((r) => r.command)).toEqual(["/delete 5", "/rate 5 9"]);
    expect(out.rejected[0].reason).toContain("not an allowed verb");
  });

  it("rejects malformed commands with the parser's reason", () => {
    const out = sanitizeProposals([{ command: "/update 5 slug x", rationale: "" }]);
    expect(out.rejected[0].reason).toBe(
      'Invalid field "slug". Updatable fields: title, issue, year, artist, notes, tags',
    );
  });

  it("flattens a command the model wrapped over lines", () => {
    const out = sanitizeProposals([{ command: "/rename_series hup //\n Hup!", rationale: "" }]);
    expect(out.accepted[0].command).toBe("/rename_series hup // Hup!");
  });

  it("ignores junk", () => {
    expect(sanitizeProposals("nope")).toEqual({ accepted: [], rejected: [] });
    expect(sanitizeProposals([null, 3, { rationale: "x" }])).toEqual({ accepted: [], rejected: [] });
  });
});

describe("parseConfirmIndices", () => {
  it("reads all, a list, or nothing valid", () => {
    expect(parseConfirmIndices("", 3)).toBe("all");
    expect(parseConfirmIndices(" 1 3", 3)).toEqual([1, 3]);
    expect(parseConfirmIndices("3,1,3", 3)).toEqual([3, 1]);
    expect(parseConfirmIndices("4", 3)).toBe("invalid");
    expect(parseConfirmIndices("1.5", 3)).toBe("invalid");
    expect(parseConfirmIndices("one", 3)).toBe("invalid");
  });
});

describe("buildPanelCaption", () => {
  it("builds the canonical caption and proves it parses", () => {
    const out = buildPanelCaption({
      title: "Saga",
      issue: 4,
      year: 2012,
      artist: "Fiona Staples",
      notes: "robot prince",
      tags: ["Sci-Fi"],
    });
    expect(out).toMatchObject({
      caption: "Saga // 4 // 2012 // Fiona Staples // robot prince // Sci-Fi",
      metadata: { title: "Saga", issue: 4, year: 2012, artist: "Fiona Staples" },
    });
  });

  it("drops trailing empty fields but keeps an empty artist in the middle", () => {
    expect(buildPanelCaption({ title: "Saga", issue: "2", year: 2012, artist: "" })).toMatchObject({
      caption: "Saga // 2 // 2012",
    });
    expect(
      buildPanelCaption({ title: "Saga", issue: "2", year: 2012, artist: "", notes: "x" }),
    ).toMatchObject({ caption: "Saga // 2 // 2012 //  // x", metadata: { artist: null, notes: "x" } });
  });

  it("can't be broken by a separator or newline inside a field", () => {
    const out = buildPanelCaption({
      title: "Chocolate // Vanilla",
      issue: "#1",
      year: "2026",
      artist: "A\nB",
      tags: ["a, b", "+series"],
    });
    expect(out).toMatchObject({
      caption: "Chocolate / Vanilla // 1 // 2026 // A B //  // a  b, series",
      metadata: { title: "Chocolate / Vanilla", issue: 1, artist: "A B", tags: ["a  b", "series"] },
    });
  });

  it("keeps a non-numeric issue as text", () => {
    expect(buildPanelCaption({ title: "Hellboy", issue: "Annual 2", year: 1993, artist: "x" })).toMatchObject({
      metadata: { issue: "Annual 2" },
    });
  });

  it("refuses missing or malformed essentials", () => {
    expect(buildPanelCaption({ issue: 1, year: 2012 })).toEqual({ error: "no series title" });
    expect(buildPanelCaption({ title: "Saga", year: 2012 })).toEqual({ error: "no issue" });
    expect(buildPanelCaption({ title: "Saga", issue: 1, year: "12" })).toEqual({
      error: 'year "12" isn\'t a four-digit year',
    });
  });
});
