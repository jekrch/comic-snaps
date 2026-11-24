import { describe, expect, it } from "vitest";
import { extractSnippet } from "./extract";
import { COLOR_CODE, EMBEDDING_CODE, PHASH_CODE, type CodeRef } from "./snippets";
import { SOURCES } from "./sources";

const PY = `import os

# A constant.
LIMIT = 4


@decorator
def f(
    a: int,
) -> int:
    """Docstring with an unbalanced ( paren
    and a line at
column zero."""
    x = {
        "k": a,
    }
    return x


class C:
    def m(self):
        pass

AFTER = 1
`;

const TS = `const a = 1;

/**
 * Doc.
 */
export function g(x: number): number {
  if (x) {
    return 1;
  }
  return 2;
}

export const h = 3;
`;

describe("extractSnippet", () => {
  it("takes a Python def with its decorator, docstring and multi-line pieces", () => {
    const s = extractSnippet(PY, { file: "x.py", symbol: "f", note: "" })!;
    expect(s.startLine).toBe(7);
    expect(s.code.split("\n")[0]).toBe("@decorator");
    expect(s.code.trimEnd().endsWith("return x")).toBe(true);
  });

  it("takes an assignment with the comment above it", () => {
    const s = extractSnippet(PY, { file: "x.py", symbol: "LIMIT", note: "" })!;
    expect(s.code).toBe("# A constant.\nLIMIT = 4");
  });

  it("takes a class with its methods and stops at the next statement", () => {
    const s = extractSnippet(PY, { file: "x.py", symbol: "C", note: "" })!;
    expect(s.code).toBe("class C:\n    def m(self):\n        pass");
  });

  it("takes a TS function with its JSDoc and closing brace", () => {
    const s = extractSnippet(TS, { file: "x.ts", symbol: "g", note: "" })!;
    expect(s.startLine).toBe(3);
    expect(s.endLine).toBe(11);
  });

  it("narrows with from/to and marks what was left out", () => {
    const s = extractSnippet(PY, { file: "x.py", symbol: "f", from: "x = {", to: "}", note: "" })!;
    expect(s.code.trim().split("\n")).toHaveLength(3);
    expect(s.elidedBefore).toBe(true);
    expect(s.elidedAfter).toBe(true);
  });

  it("returns null for a missing symbol", () => {
    expect(extractSnippet(TS, { file: "x.ts", symbol: "nope", note: "" })).toBeNull();
  });
});

describe("the explainers' code references", () => {
  const refs: CodeRef[] = [
    ...Object.values(EMBEDDING_CODE).flatMap((m) => Object.values(m)),
    ...Object.values(COLOR_CODE),
    ...Object.values(PHASH_CODE),
  ].filter((r): r is CodeRef => r !== null);

  for (const ref of refs) {
    for (const spec of ref.snippets) {
      it(`${ref.title}: ${spec.file} ${spec.symbol}${spec.from ? ` from "${spec.from}"` : ""}`, () => {
        const src = SOURCES[spec.file];
        expect(src, `${spec.file} is not in SOURCES`).toBeDefined();
        const s = extractSnippet(src, spec);
        expect(s, "symbol or marker not found").not.toBeNull();
        // Whole definitions are short enough to read in a modal.
        expect(s!.endLine - s!.startLine).toBeLessThan(120);
      });
    }
  }
});
