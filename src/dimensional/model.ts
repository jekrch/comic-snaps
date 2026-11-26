/**
 * The content model: what a dimensional document contains, apart from how
 * it is written down (the published Markdown or the authoring form) and how
 * it is shown (GitHub, this framework, a model's context).
 *
 * A document is a run of sections. Each section has up to three layers, each
 * a complete retelling of the section at more depth (L1 first), and facets
 * that sit beside the layers at any depth (code, for now). Terms are defined
 * once for the whole document; sources trail the last section.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "em"; c: Inline[] }
  | { t: "strong"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "img"; src: string; alt: string; width?: string }
  /**
   * A term in use: `c` is the words it names (taken from the text before a
   * footnote reference), `id` the footnote. `first` marks the occurrence
   * that defines it: the first use in the term's home section's layer.
   */
  | { t: "term"; id: string; c: Inline[]; first?: boolean }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "table"; head: Inline[][]; align: ("left" | "center" | "right" | null)[]; rows: Inline[][][] }
  | { t: "hr" }
  /** A named slot (`dd:figure` / `::: figure`): a renderer that knows the name replaces the fallback. */
  | { t: "figure"; id: string; fallback: Block[] }
  /** A quote of the codebase (`dd:code`): a file and symbol, with the snippet as of the last refresh. */
  | { t: "snippet"; ref: string; attrs: Record<string, string>; fallback: Block[] }
  /** Where a section's numbers come from, and when (`dd:data`). */
  | { t: "data"; ref: string; asOf?: string };

export interface DocSection {
  id: string;
  /** A statement, ten words or fewer (R4). Empty for the untitled intro. */
  heading: string;
  /**
   * L1, then each deeper layer. L1 also holds the section-level figures,
   * which show at every depth (see `sectionLevel`).
   */
  layers: Block[][];
  /** Beside the layers, at any depth: `code` and any other word handle. */
  facets: { name: string; blocks: Block[] }[];
}

export interface SourceGroup {
  id: string;
  title: string;
  items: Inline[][];
}

export interface ParsedDoc {
  /** Front matter, as written. */
  meta: Record<string, string | string[]>;
  title: string;
  /** The line under the title: draft, date, and the level legend. */
  legend: string | null;
  /** The level names, from the legend or the named model. */
  levels: string[];
  model: string;
  /** What sits between the title and the first heading, with its own layers. */
  intro: DocSection | null;
  sections: DocSection[];
  /** Footnote definitions, by id. */
  terms: Record<string, Inline[]>;
  /** Where each term is introduced: the first section that uses it. */
  termHome: Record<string, string>;
  /** Each term's name, as first used. */
  termLabel: Record<string, string>;
  sources: SourceGroup[];
}

/** The starter layer models (0.4 spec), each level's name. */
export const STARTER_MODELS: Record<string, string[]> = {
  explain: ["Overview", "Explanation", "Reference"],
  procedure: ["Steps", "With reasons", "Troubleshooting"],
  decision: ["Decision", "The case", "Evidence"],
  report: ["Findings", "Reasoning", "Data and method"],
  audience: ["For everyone", "For practitioners", "For specialists"],
  scope: ["System", "Components", "Implementation"],
  teach: ["Intuition", "Formal", "Derivation"],
};

/** Blocks that belong to the whole section and show at every depth. */
export function sectionLevel(b: Block): boolean {
  return b.t === "figure" || b.t === "data";
}

/** Plain text of some inlines, for labels, word counts and ids. */
export function inlineText(c: Inline[]): string {
  let s = "";
  for (const n of c) {
    if (n.t === "text") s += n.v;
    else if (n.t === "code") s += n.v;
    else if (n.t === "br") s += " ";
    else if (n.t === "img") s += n.alt;
    else if ("c" in n) s += inlineText(n.c);
  }
  return s;
}

/** Words in some blocks, for reading times. Code counts at a third. */
export function blockWords(blocks: Block[]): number {
  const words = (s: string) => (s.match(/\S+/g) ?? []).length;
  let n = 0;
  for (const b of blocks) {
    if (b.t === "p" || b.t === "h") n += words(inlineText(b.c));
    else if (b.t === "list") for (const it of b.items) n += words(inlineText(it));
    else if (b.t === "table") for (const r of [b.head, ...b.rows]) for (const c of r) n += words(inlineText(c));
    else if (b.t === "code") n += words(b.v) / 3;
    else if (b.t === "figure" || b.t === "snippet") n += blockWords(b.fallback);
  }
  return n;
}
