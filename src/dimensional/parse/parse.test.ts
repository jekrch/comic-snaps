import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockWords, inlineText, type Block } from "../model";
import { parseInline, splitTermWords } from "./markdown";
import { parseDimensional } from "./parse";

const PUBLISHED = `---
dimensional: 0.5-draft
layers: explain
depth: 3
---

# Perceptual Hash

Draft · 2026-11-25 · Levels: L1 essentials · L2 in depth · L3 reference

A fingerprint of where a panel is light and dark.

## Comparing two hashes means counting the bits that differ

Two fingerprints are compared by counting the bits that differ, the
Hamming distance[^hamming].

<!-- dd:figure phash-hamming -->
*The two bit grids overlaid.*
<!-- /dd:figure -->

<details>
<summary><code>L2</code></summary>

> <br>
>
> To compare two hashes, count the positions where the Hamming distance[^hamming] says they differ.
>
> \`\`\`markdown
> <details>
> ## Not a heading
> \`\`\`
>
> <details>
> <summary><code>L3</code></summary>
>
> > <br>
> >
> > | Set | n |
> > |---|---|
> > | Restorations | 61 |
> >
> > <br>
>
> </details>
>
> <br>

</details>

<details>
<summary><code>code</code></summary>

> <br>
>
> <!-- dd:code src/utils/sorting.ts#hammingDistanceHex -->
> \`\`\`ts
> export function hammingDistanceHex(a: string, b: string): number {}
> \`\`\`
> <!-- /dd:code -->
>
> <br>

</details>

## Only a low count says two images match

Unrelated panels land near 32.

---

Start here:

- Krawetz (2011), [Looks Like It](https://example.com/a). The recipe.

Papers and references:

- Hamming (1950), [Error Detecting Codes](https://example.com/b).
- Zauner (2010), [Benchmarking](https://example.com/c).

[^hamming]: The number of bit positions where two hashes differ.
`;

const AUTHORING = `---
layers: procedure
---

# Restore a panel

## Find the panel by series and issue

Search the gallery for it.

::: figure search-box
*The search box.*
:::

:::: L2
Search by series, then issue[^issue], because ids are long.

::: L3
The id is the series slug, the issue and a timestamp.
:::
::::

::: code src/utils/search.ts#findPanel
Matches series first.
:::

[^issue]: One numbered comic book.
`;

describe("parseDimensional, published form", () => {
  const doc = parseDimensional(PUBLISHED);

  it("reads the title, legend, levels and intro", () => {
    expect(doc.title).toBe("Perceptual Hash");
    expect(doc.legend).toMatch(/^Draft/);
    expect(doc.levels).toEqual(["Essentials", "In depth", "Reference"]);
    expect(doc.meta.layers).toBe("explain");
    expect(doc.intro?.layers).toHaveLength(1);
  });

  it("splits sections at statement headings, with their layers", () => {
    expect(doc.sections.map((s) => s.id)).toEqual([
      "comparing-two-hashes-means-counting-the-bits",
      "only-a-low-count-says-two-images-match",
    ]);
    const [s] = doc.sections;
    expect(s.layers).toHaveLength(3);
    expect(s.layers[0].map((b) => b.t)).toEqual(["p", "figure"]);
    expect(s.layers[2][0].t).toBe("table");
    expect(doc.sections[1].layers).toHaveLength(1);
  });

  it("treats a <details> inside a code fence as code", () => {
    const code = doc.sections[0].layers[1].find((b) => b.t === "code");
    expect(code).toMatchObject({ t: "code", lang: "markdown" });
    expect((code as Extract<Block, { t: "code" }>).v).toContain("## Not a heading");
  });

  it("keeps facets beside the layers", () => {
    const [facet] = doc.sections[0].facets;
    expect(facet.name).toBe("code");
    expect(facet.blocks[0]).toMatchObject({ t: "snippet", ref: "src/utils/sorting.ts#hammingDistanceHex" });
  });

  it("drops the <br> spacers", () => {
    const words = doc.sections[0].layers[1].flatMap((b) => (b.t === "p" ? [inlineText(b.c)] : []));
    expect(words.join(" ")).not.toContain("<br>");
  });

  it("reads terms, their home section, and the defining uses", () => {
    expect(inlineText(doc.terms.hamming)).toMatch(/^The number of bit positions/);
    expect(doc.termHome.hamming).toBe(doc.sections[0].id);
    expect(doc.termLabel.hamming).toBe("Hamming distance");
    for (const layer of doc.sections[0].layers.slice(0, 2)) {
      const p = layer.find((b) => b.t === "p") as Extract<Block, { t: "p" }>;
      expect(p.c.find((n) => n.t === "term")).toMatchObject({ id: "hamming", first: true });
    }
  });

  it("reads the sources trailer in groups", () => {
    expect(doc.sources.map((g) => [g.title, g.items.length])).toEqual([
      ["Start here", 1],
      ["Papers and references", 2],
    ]);
  });
});

describe("parseDimensional, authoring form", () => {
  const doc = parseDimensional(AUTHORING);

  it("nests layers by colon count and falls back to the model's level names", () => {
    expect(doc.levels).toEqual(["Steps", "With reasons", "Troubleshooting"]);
    const [s] = doc.sections;
    expect(s.layers.map((l) => l.map((b) => b.t))).toEqual([["p", "figure"], ["p"], ["p"]]);
    expect(s.facets[0]).toMatchObject({ name: "code" });
    expect(s.facets[0].blocks[0]).toMatchObject({ t: "snippet", ref: "src/utils/search.ts#findPanel" });
  });

  it("finds a term first used below L1", () => {
    expect(doc.termHome.issue).toBe(doc.sections[0].id);
  });
});

describe("inline Markdown", () => {
  it("parses emphasis, code, links and images", () => {
    const c = parseInline('A *b* **c** `d*e` [f](g.md) <img src="x.jpg" alt="y" width="45%"> snake_case_word');
    expect(c.map((n) => n.t)).toEqual(["text", "em", "text", "strong", "text", "code", "text", "link", "text", "img", "text"]);
    expect(inlineText(c)).toContain("snake_case_word");
  });

  it("chooses the words a footnote names", () => {
    expect(splitTermWords("a fingerprint, its perceptual hash", "phash").words).toBe("perceptual hash");
    expect(splitTermWords("using a discrete cosine transform", "dct").words).toBe("discrete cosine transform");
    expect(splitTermWords("written as 16 hex digits", "hex").words).toBe("hex digits");
    expect(splitTermWords("the bits that differ, the Hamming distance", "hamming").words).toBe("Hamming distance");
    expect(splitTermWords("its brightness, its luma", "luma").words).toBe("luma");
    expect(splitTermWords("Ted Nelson's stretchtext", "stretchtext").words).toBe("stretchtext");
    expect(splitTermWords("nothing matches here", "zz").words).toBe("here");
  });
});

// The real documents, when they're in the working tree (docs/ is untracked).
const DOCS = ["docs/dimensional-docs.md", "docs/dimensional-docs/phash.md", "docs/dimensional-docs/portable.md", "docs/dimensional-docs/framework.md"];
describe.each(DOCS.filter((p) => existsSync(p)))("%s", (path) => {
  const doc = parseDimensional(readFileSync(path, "utf8"));
  it("parses into sections whose deeper layers say more", () => {
    expect(doc.title).not.toBe("");
    expect(doc.sections.length).toBeGreaterThan(3);
    for (const s of doc.sections) {
      expect(s.layers[0].length).toBeGreaterThan(0);
      for (let i = 1; i < s.layers.length; i++) expect(blockWords(s.layers[i])).toBeGreaterThan(0);
      // No structure leaked into the prose as text.
      for (const b of s.layers.flat()) {
        if (b.t === "p") expect(inlineText(b.c)).not.toMatch(/^\s*(<\/?details>|<summary>|>)/);
      }
    }
  });
  it("defines every term it uses", () => {
    for (const id of Object.keys(doc.termHome)) expect(doc.terms[id], id).toBeDefined();
  });
});
