import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";
import { lookupDoc } from "./docs";
import { extractSnippet } from "./extract";
import { COLOR_CODE, EMBEDDING_CODE, PHASH_CODE, type CodeRef } from "./snippets";
import { SOURCES } from "./sources";

const PY = `@decorator
def f(x: np.ndarray) -> int:
    """A docstring
    over two lines."""
    n = np.linalg.norm(x, axis=1)  # a comment
    return MAX_SIDE + 1.5 if True else len("s#")`;

const TS = `/** Doc. */
export function g(a: number[]): number {
  // note
  return Math.sqrt(a.length) + parseInt("f", 16);
}`;

describe("highlight", () => {
  it("keeps every character, in order", () => {
    for (const [code, lang] of [[PY, "py"], [TS, "ts"]] as const) {
      const text = highlight(code, lang)
        .map((l) => l.map((t) => t.text).join(""))
        .join("\n");
      expect(text).toBe(code);
    }
  });

  it("colours Python the way an editor would", () => {
    const toks = highlight(PY, "py").flat();
    const typeOf = (text: string) => toks.find((t) => t.text === text)?.type;
    expect(typeOf("@decorator")).toBe("decorator");
    expect(typeOf("def")).toBe("keyword");
    expect(typeOf("f")).toBe("definition");
    expect(typeOf("norm")).toBe("function");
    expect(typeOf("MAX_SIDE")).toBe("constant");
    expect(typeOf("1.5")).toBe("number");
    expect(typeOf("True")).toBe("literal");
    expect(typeOf("len")).toBe("builtin");
    expect(typeOf('"s#"')).toBe("string");
    expect(typeOf("# a comment")).toBe("comment");
    expect(toks.filter((t) => t.type === "docstring").map((t) => t.text).join("")).toContain("over two lines");
  });

  it("tracks dotted chains for lookup", () => {
    const norm = highlight(PY, "py").flat().find((t) => t.text === "norm");
    expect(norm?.chain).toBe("np.linalg.norm");
    const sqrt = highlight(TS, "ts").flat().find((t) => t.text === "sqrt");
    expect(sqrt?.chain).toBe("Math.sqrt");
  });

  it("colours TypeScript comments and calls", () => {
    const toks = highlight(TS, "ts").flat();
    expect(toks[0]).toMatchObject({ type: "comment", text: "/** Doc. */" });
    expect(toks.find((t) => t.text === "g")?.type).toBe("definition");
    expect(toks.find((t) => t.text === "parseInt")?.type).toBe("builtin");
  });
});

describe("lookupDoc", () => {
  it("finds library calls by their full chain", () => {
    expect(lookupDoc("scripts/x.py", "np.linalg.norm")?.kind).toBe("NumPy");
  });

  it("prefers a file-scoped entry", () => {
    const a = lookupDoc("scripts/compute-embeddings.py", "scale")?.text;
    const b = lookupDoc("scripts/compute-patch-maps.py", "scale")?.text;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("explains repo definitions from their own docstrings and comments", () => {
    const d = lookupDoc("scripts/compute-patch-maps.py", "dino_pixels");
    expect(d?.href?.file).toBe("scripts/compute-embeddings.py");
    expect(d?.text).toMatch(/14/);
    expect(lookupDoc("src/utils/similarityUtils.ts", "cosineDistance")?.text).toMatch(/cosine distance/i);
    expect(lookupDoc("scripts/x.py", "DINO_SHORT_SIDE")?.text).toMatch(/DINOv2/);
  });

  it("leaves unknown names alone", () => {
    expect(lookupDoc("scripts/x.py", "definitely_not_a_name")).toBeNull();
  });
});

describe("every snippet highlights losslessly", () => {
  const refs: CodeRef[] = [
    ...Object.values(EMBEDDING_CODE).flatMap((m) => Object.values(m)),
    ...Object.values(COLOR_CODE),
    ...Object.values(PHASH_CODE),
  ].filter((r): r is CodeRef => r !== null);
  for (const ref of refs) {
    for (const spec of ref.snippets) {
      it(`${spec.file} ${spec.symbol}`, () => {
        const s = extractSnippet(SOURCES[spec.file], spec)!;
        const lang = spec.file.endsWith(".py") ? "py" : "ts";
        const text = highlight(s.code, lang)
          .map((l) => l.map((t) => t.text).join(""))
          .join("\n");
        expect(text).toBe(s.code);
      });
    }
  }
});
