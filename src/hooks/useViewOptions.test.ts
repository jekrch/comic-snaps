import { describe, expect, it } from "vitest";
import { formatViewOptions, parseViewOptions } from "./useViewOptions";

describe("view options in the URL", () => {
  it("reads the names it knows and ignores the rest", () => {
    expect(parseViewOptions("owner,age")).toEqual({ details: false, owner: true, age: true });
    expect(parseViewOptions("age,details")).toEqual({ details: true, owner: false, age: true });
    expect(parseViewOptions("owner,bogus")).toEqual({ details: false, owner: true, age: false });
    expect(parseViewOptions(null)).toEqual({ details: false, owner: false, age: false });
  });

  it("writes them in a fixed order, and nothing when all are off", () => {
    expect(formatViewOptions({ age: true, owner: true, details: true })).toBe("details,owner,age");
    expect(formatViewOptions({ details: false, owner: false, age: true })).toBe("age");
    expect(formatViewOptions({ details: false, owner: false, age: false })).toBe("");
  });

  it("round-trips", () => {
    for (const v of ["details", "owner", "age", "owner,age", "details,owner,age", ""]) {
      expect(formatViewOptions(parseViewOptions(v))).toBe(v);
    }
  });
});
