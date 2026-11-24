/**
 * Hover explanations for names in the code views. A name resolves, most
 * specific first, to:
 *   1. a glossary entry scoped to the file being shown ("file.py:name"),
 *   2. a global glossary entry (library calls like `np.linalg.norm`),
 *   3. a definition in one of the quoted repo files, explained by its own
 *      docstring, JSDoc or comment, and linked to its lines on GitHub.
 * Dotted chains are tried whole first, then by dropping leading parts, so
 * `outputs.pooler_output` can match a `pooler_output` entry.
 */
import { extractSnippet } from "./extract";
import { GLOSSARY } from "./glossary";
import { SOURCES } from "./sources";

export interface Doc {
  /** What to call it in the popover's heading. */
  name: string;
  /** Short label: "function · scripts/x.py", "NumPy", "variable"… */
  kind: string;
  text: string;
  /** For repo definitions: where it lives. */
  href?: { file: string; startLine: number; endLine: number };
}

const DEF_PATTERNS = [
  /^(?:async\s+)?def\s+(\w+)/,
  /^class\s+(\w+)/,
  /^([A-Z][A-Z0-9_]+)\s*(?::[^=]*)?=/,
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
  /^(?:export\s+)?(?:const|interface|type)\s+(\w+)/,
];

function kindOf(line: string): string {
  if (/^(async\s+)?def\s|function\s/.test(line.replace(/^export\s+/, ""))) return "function";
  if (/^class\s/.test(line)) return "class";
  if (/^(export\s+)?(interface|type)\s/.test(line)) return "type";
  return "constant";
}

/** Clean a docstring / JSDoc / comment block down to its first paragraph. */
function firstParagraph(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\*\*?|\*\/|\*|#|\/\/)\s?/, "").replace(/\*\/\s*$/, "").trim());
  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l === "") {
      if (cur.length) paras.push(cur.join(" "));
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) paras.push(cur.join(" "));
  const text = paras.find((p) => p.length > 0) ?? "";
  return text.length > 420 ? `${text.slice(0, 417).trimEnd()}…` : text;
}

/** The explanation a definition carries: its docstring, else the comments above it. */
function docOf(code: string, defLine: string): string {
  const lines = code.split("\n");
  const at = lines.findIndex((l) => l === defLine);

  // Python def/class: a docstring opening right after the header (which may
  // span lines; it ends at the first line ending in a colon).
  if (/^(async\s+)?(def|class)\s/.test(defLine)) {
    let h = at;
    while (h < lines.length && !/:\s*(#.*)?$/.test(lines[h])) h++;
    const first = lines.slice(h + 1).findIndex((l) => l.trim() !== "");
    const open = first >= 0 ? lines[h + 1 + first].trim() : "";
    const quote = /^[rRuU]?("""|''')/.exec(open)?.[1];
    if (quote) {
      const body = lines.slice(h + 1 + first).join("\n");
      const startQ = body.indexOf(quote);
      const endQ = body.indexOf(quote, startQ + 3);
      if (endQ > startQ) return firstParagraph(body.slice(startQ + 3, endQ));
    }
  }
  // Comments / JSDoc directly above (extractSnippet includes them).
  const above = lines.slice(0, at).join("\n");
  if (above.trim()) return firstParagraph(above);
  // A trailing comment on the definition line itself.
  const inline = /\s(#|\/\/)\s*(.+)$/.exec(defLine);
  return inline ? inline[2] : "";
}

let index: Map<string, Doc> | null = null;

/** Every top-level definition across the quoted files, by name. */
function repoIndex(): Map<string, Doc> {
  if (index) return index;
  index = new Map();
  for (const [file, src] of Object.entries(SOURCES)) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    for (const line of lines) {
      for (const p of DEF_PATTERNS) {
        const m = p.exec(line);
        if (!m || index.has(m[1])) continue;
        const s = extractSnippet(src, { file, symbol: m[1], note: "" });
        if (!s) continue;
        const text = docOf(s.code, line);
        index.set(m[1], {
          name: m[1],
          kind: `${kindOf(line)} · ${file}`,
          text: text || "Defined in this repo.",
          href: { file, startLine: s.startLine, endLine: s.endLine },
        });
        break;
      }
    }
  }
  return index;
}

/**
 * The explanation for `chain` as written in `file`, or null. A `member`
 * (a name after a dot, like `.decode()`) is a field or method of something
 * else, so it's never taken for one of the repo's own top-level names.
 */
export function lookupDoc(file: string, chain: string, member = false): Doc | null {
  const parts = chain.split(".");
  const fileName = file.split("/").pop()!;
  const repo = parts.length === 1 && !member ? repoIndex().get(chain) : undefined;
  for (let k = 0; k < parts.length; k++) {
    const key = parts.slice(k).join(".");
    const entry = GLOSSARY[`${fileName}:${key}`] ?? GLOSSARY[key];
    // A plain-language entry for a repo name keeps the link to its code.
    if (entry) return { name: chain, ...entry, ...(repo ? { kind: repo.kind, href: repo.href } : null) };
  }
  return repo ?? null;
}
