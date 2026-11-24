/**
 * Cuts one top-level definition out of a source file's text, so the
 * explainer's code views quote the real code rather than a copy that can
 * drift. Works on this repo's Python and TypeScript: a definition runs from
 * its first line (plus the comments and decorators directly above it) to
 * the line before the next top-level statement, with brackets tracked so a
 * multi-line signature or literal doesn't end it early.
 */

export interface SnippetSpec {
  /** Repo-relative path; a key of the sources map. */
  file: string;
  /** Name of the def / class / function / const / assignment to quote. */
  symbol: string;
  /** Extend the quote through the end of this later top-level symbol. */
  through?: string;
  /** Start at the first line of the definition containing this text. */
  from?: string;
  /** End at the first line (at or after `from`) containing this text. */
  to?: string;
  /** One line on what this code does, shown above it. */
  note: string;
}

export interface Snippet {
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  code: string;
  /** Lines of the definition left out above / below the quote. */
  elidedBefore: boolean;
  elidedAfter: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function definitionLine(lines: string[], symbol: string): number {
  const name = escape(symbol);
  const patterns = [
    new RegExp(`^(async\\s+)?def\\s+${name}\\b`),
    new RegExp(`^class\\s+${name}\\b`),
    new RegExp(`^${name}\\s*(:[^=]*)?=`),
    new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${name}\\b`),
    new RegExp(`^(export\\s+)?(const|let|var|interface|type|class)\\s+${name}\\b`),
  ];
  return lines.findIndex((l) => patterns.some((p) => p.test(l)));
}

const isComment = (l: string) => /^\s*(#|\/\/|\/\*|\*)/.test(l);
const isDecorator = (l: string) => /^@/.test(l);

/** Bracket depth change on a line, ignoring comments and string contents. */
function depthDelta(line: string): number {
  let d = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "#" || (ch === "/" && line[i + 1] === "/")) break;
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) d++;
    else if (")]}".includes(ch)) d--;
  }
  return d;
}

/** [first, last] 0-based line indices of the definition starting at `start`. */
function definitionRange(lines: string[], start: number): [number, number] {
  let first = start;
  while (first > 0 && (isComment(lines[first - 1]) || isDecorator(lines[first - 1]))) first--;

  let depth = 0;
  let last = start;
  let inDocstring = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && depth <= 0 && !inDocstring && line.trim() !== "" && !/^\s/.test(line)) {
      // A top-level line. In TS a lone closing bracket still belongs to us.
      if (!/^[)\]}]/.test(line)) break;
    }
    // Python triple-quoted strings can hold anything; skip their contents.
    const triples = (line.match(/"""|'''/g) ?? []).length;
    if (inDocstring) {
      if (triples % 2 === 1) inDocstring = false;
    } else {
      if (triples % 2 === 1) inDocstring = true;
      else depth += depthDelta(line);
    }
    if (line.trim() !== "") last = i;
  }
  return [first, last];
}

/** The quoted code for `spec`, or null if the symbol (or a marker) isn't found. */
export function extractSnippet(source: string, spec: SnippetSpec): Snippet | null {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const start = definitionLine(lines, spec.symbol);
  if (start < 0) return null;
  let [first, last] = definitionRange(lines, start);

  if (spec.through) {
    const end = definitionLine(lines, spec.through);
    if (end < start) return null;
    last = definitionRange(lines, end)[1];
  }

  let elidedBefore = false;
  let elidedAfter = false;
  if (spec.from) {
    const i = lines.findIndex((l, n) => n >= first && n <= last && l.includes(spec.from!));
    if (i < 0) return null;
    elidedBefore = i > first;
    first = i;
  }
  if (spec.to) {
    const i = lines.findIndex((l, n) => n >= first && n <= last && l.includes(spec.to!));
    if (i < 0) return null;
    elidedAfter = i < last;
    last = i;
  }

  return {
    file: spec.file,
    startLine: first + 1,
    endLine: last + 1,
    code: lines.slice(first, last + 1).join("\n"),
    elidedBefore,
    elidedAfter,
  };
}
