import { describe, expect, it } from "vitest";
import { normalizeCountry } from "./country";

describe("normalizeCountry", () => {
  it("folds every spelling of the United States into one", () => {
    for (const raw of ["United States", "USA", "U.S.A.", "U.S.A", "U.S.", "United States of America"]) {
      expect(normalizeCountry(raw)).toBe("United States");
    }
  });

  it("folds the UK and its constituent countries into one", () => {
    for (const raw of ["UK", "U.K.", "England", "England, United Kingdom", "Scotland, United Kingdom", "Northern Ireland"]) {
      expect(normalizeCountry(raw)).toBe("United Kingdom");
    }
  });

  it("keeps the last part of a place, country value", () => {
    expect(normalizeCountry("Buenos Aires, Argentina")).toBe("Argentina");
  });

  it("fixes the known misspelling", () => {
    expect(normalizeCountry("Phillipines")).toBe("Philippines");
  });

  it("passes unrecognised names through trimmed", () => {
    expect(normalizeCountry("  Croatia ")).toBe("Croatia");
    expect(normalizeCountry("Puerto Rico")).toBe("Puerto Rico");
  });

  it("returns null for an empty value", () => {
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(" , ")).toBeNull();
  });
});
