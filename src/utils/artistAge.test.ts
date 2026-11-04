import { describe, expect, it } from "vitest";
import type { Artist } from "../types";
import { ageBinOf, ageBinOrder, artistAgeAt, formatAgeBin } from "./artistAge";

const artist = (over: Partial<Artist> = {}): Artist => ({
  id: "a",
  name: "A",
  description: "",
  references: [],
  ...over,
});

describe("artistAgeAt", () => {
  it("is the publication year less the birth year", () => {
    expect(artistAgeAt(1987, artist({ birthYear: 1953 }))).toBe(34);
  });

  it("is null without a birth year or publication year", () => {
    expect(artistAgeAt(1987, artist())).toBeNull();
    expect(artistAgeAt(1987, undefined)).toBeNull();
    expect(artistAgeAt(0, artist({ birthYear: 1953 }))).toBeNull();
  });

  it("is null for a printing after the artist's death", () => {
    expect(artistAgeAt(2001, artist({ birthYear: 1930, deathYear: 1995 }))).toBeNull();
    expect(artistAgeAt(1995, artist({ birthYear: 1930, deathYear: 1995 }))).toBe(65);
  });

  it("is null for implausible ages", () => {
    expect(artistAgeAt(1960, artist({ birthYear: 1955 }))).toBeNull();
    expect(artistAgeAt(2020, artist({ birthYear: 1900 }))).toBeNull();
  });
});

describe("age brackets", () => {
  it("files an age under its five-year bracket", () => {
    expect(ageBinOf(30)).toBe("30-34");
    expect(ageBinOf(34)).toBe("30-34");
    expect(ageBinOf(35)).toBe("35-39");
  });

  it("formats and orders bracket keys", () => {
    expect(formatAgeBin("30-34")).toBe("30–34");
    expect(["35-39", "20-24", "100-104"].sort((a, b) => ageBinOrder(a) - ageBinOrder(b))).toEqual([
      "20-24",
      "35-39",
      "100-104",
    ]);
  });
});
