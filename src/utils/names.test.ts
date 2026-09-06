import { describe, expect, it } from "vitest";
import { comparePersonNames, personSortKey } from "./names";

describe("personSortKey", () => {
  it("treats a single-token name as its own surname", () => {
    expect(personSortKey("Moebius")).toEqual(["Moebius", ""]);
    expect(personSortKey("Leomacs")).toEqual(["Leomacs", ""]);
  });

  it("uses the trailing token for an ordinary name", () => {
    expect(personSortKey("Jeff Lemire")).toEqual(["Lemire", "Jeff"]);
  });

  it("pulls a nobiliary particle in with the surname", () => {
    expect(personSortKey("Lorenzo de Felici")).toEqual(["de Felici", "Lorenzo"]);
    expect(personSortKey("Vincent van Gogh")).toEqual(["van Gogh", "Vincent"]);
  });

  it("chains consecutive particles", () => {
    expect(personSortKey("Anna della Valle")).toEqual(["della Valle", "Anna"]);
  });

  it("matches particles case-insensitively", () => {
    expect(personSortKey("Lorenzo De Felici")).toEqual(["De Felici", "Lorenzo"]);
  });

  it("ignores a generational suffix when locating the surname", () => {
    expect(personSortKey("Sammy Davis Jr.")).toEqual(["Davis", "Sammy Jr."]);
    expect(personSortKey("John Romita Sr")).toEqual(["Romita", "John Sr"]);
  });

  it("keeps a token ahead of the suffix, so a suffix is never the key", () => {
    // `end` stops at 1, so "Jr." alone cannot become the surname.
    expect(personSortKey("Ramos Jr.")[0]).toBe("Ramos");
  });

  it("returns empty halves for a blank name", () => {
    expect(personSortKey("")).toEqual(["", ""]);
    expect(personSortKey("   ")).toEqual(["", ""]);
  });

  it("collapses irregular whitespace", () => {
    expect(personSortKey("  Jeff   Lemire  ")).toEqual(["Lemire", "Jeff"]);
  });

  it("does not treat a leading particle as one when it is the only prefix", () => {
    // `start > 1` guards the scan, so a two-token name keeps its first token
    // as the remainder rather than folding it into the surname.
    expect(personSortKey("de Felici")).toEqual(["Felici", "de"]);
  });
});

describe("comparePersonNames", () => {
  it("orders by surname, not by the display string", () => {
    // "Jeff Lemire" files under L, so it follows a "B" surname.
    expect(comparePersonNames("Jeff Lemire", "Andy Belanger")).toBeGreaterThan(0);
  });

  it("falls back to the rest of the name when surnames tie", () => {
    expect(comparePersonNames("Andy MacDonald", "Zeb MacDonald")).toBeLessThan(0);
  });

  it("ignores case and accents so spelling variants land together", () => {
    expect(comparePersonNames("Lorenzo de Felici", "Lorenzo De Felici")).toBe(0);
  });

  it("sorts a mononym by its own name", () => {
    expect(comparePersonNames("Moebius", "Jeff Lemire")).toBeGreaterThan(0);
  });

  it("is a usable comparator", () => {
    const sorted = ["Jeff Lemire", "Moebius", "Andy Belanger", "Lorenzo de Felici"].sort(
      comparePersonNames,
    );
    expect(sorted).toEqual([
      "Andy Belanger",
      "Lorenzo de Felici",
      "Jeff Lemire",
      "Moebius",
    ]);
  });
});
