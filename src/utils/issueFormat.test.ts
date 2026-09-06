import { describe, expect, it } from "vitest";
import { formatIssue } from "./issueFormat";

describe("formatIssue", () => {
  it("prefixes a numeric issue with #", () => {
    expect(formatIssue(5)).toBe("#5");
    expect(formatIssue(0)).toBe("#0");
  });

  it("passes free-form text through verbatim", () => {
    expect(formatIssue("VOL 1")).toBe("VOL 1");
    expect(formatIssue("Annual 2")).toBe("Annual 2");
  });

  it("leaves the stand-in issues the rollups invent alone", () => {
    // `COVER_ISSUE` / `PORTRAIT_ISSUE` rely on this passthrough to read as
    // "Amulet Cover" rather than "#Cover".
    expect(formatIssue("Cover")).toBe("Cover");
    expect(formatIssue("Portrait")).toBe("Portrait");
  });
});
