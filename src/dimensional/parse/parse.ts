import { STARTER_MODELS, inlineText, type Block, type DocSection, type Inline, type ParsedDoc, type SourceGroup } from "../model";
import { fenceEnd, fenceOf, parseBlocks, parseInline } from "./markdown";

/**
 * Reads a dimensional document into the content model, from either form:
 *
 * - The published form: each deeper layer in a `<details>` block whose
 *   summary is its level code (`L2`, `L3`), its lines quoted one step
 *   further in; facets the same with a word handle (`code`).
 * - The authoring form: the same structure in colon fences, nested by
 *   colon count (`:::: L2` holding `::: L3`), facets as `::: code ref`.
 *
 * Every tag and fence sits on its own line, so this needs no Markdown
 * parser for the structure, only for the prose inside it.
 */
export function parseDimensional(src: string): ParsedDoc {
  let lines = src.replace(/\r\n?/g, "\n").split("\n");

  // Front matter.
  const meta: Record<string, string | string[]> = {};
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^([\w-]+):\s*(.*)$/.exec(l);
        if (!m) continue;
        const v = m[2].trim();
        meta[m[1]] = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : v;
      }
      lines = lines.slice(end + 1);
    }
  }

  // Footnote definitions, the sources trailer, the title and the sections,
  // all at the top level: outside fences, and unquoted (anything inside a
  // block is quoted, so it can't be mistaken for one of these).
  const terms: Record<string, Inline[]> = {};
  const body: string[] = [];
  let trailerAt = -1;
  let seenSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = fenceOf(line);
    if (fence) {
      const end = fenceEnd(lines, i + 1, fence);
      body.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }
    const fn = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (fn) {
      let text = fn[2];
      while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) text += "\n" + lines[++i].trim();
      terms[fn[1]] = parseInline(text);
      continue;
    }
    if (/^##\s/.test(line)) seenSection = true;
    if (seenSection && line.trim() === "---") trailerAt = body.length;
    body.push(line);
  }
  const trailer = trailerAt >= 0 ? body.slice(trailerAt + 1) : [];
  const main = trailerAt >= 0 ? body.slice(0, trailerAt) : body;

  // Title, legend, intro, then a section per `##`.
  let title = "";
  let legend: string | null = null;
  const pre: string[] = [];
  const raw: { heading: string; lines: string[] }[] = [];
  let inFence: string | null = null;
  for (const line of main) {
    const f = fenceOf(line);
    if (f && !inFence) inFence = f;
    else if (f && inFence && line.trim().startsWith(inFence)) inFence = null;
    if (!inFence) {
      const h1 = /^#\s+(.*)$/.exec(line);
      if (h1 && !title && raw.length === 0) {
        title = h1[1].trim();
        continue;
      }
      const h2 = /^##\s+(.*?)\s*#*$/.exec(line);
      if (h2) {
        raw.push({ heading: h2[1], lines: [] });
        continue;
      }
    }
    (raw.length ? raw[raw.length - 1].lines : pre).push(line);
  }
  const firstText = pre.findIndex((l) => l.trim() !== "");
  if (firstText >= 0 && /Levels:|\s·\s/.test(pre[firstText])) {
    legend = pre[firstText].trim();
    pre.splice(firstText, 1);
  }

  const ids = new Set<string>(["intro"]);
  const sections = raw.map((r) => parseSection(uniqueId(slug(r.heading), ids), r.heading, r.lines));
  const intro = pre.some((l) => l.trim()) ? parseSection("intro", "", pre) : null;

  // The level names: the legend's, else the model's, cut to the deepest
  // layer the document has.
  const model = typeof meta.layers === "string" ? meta.layers : "explain";
  const fromLegend = legend ? levelsFromLegend(legend) : null;
  const deepest = Math.max(1, ...[intro, ...sections].map((s) => s?.layers.length ?? 1));
  const levels = (fromLegend ?? STARTER_MODELS[model] ?? STARTER_MODELS.explain).slice(0, deepest);
  while (levels.length < deepest) levels.push(`L${levels.length + 1}`);

  const doc: ParsedDoc = {
    meta,
    title,
    legend,
    levels,
    model,
    intro,
    sections,
    terms,
    termHome: {},
    termLabel: {},
    sources: parseSources(trailer),
  };
  markTerms(doc);
  return doc;
}

export function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= 48) return base || "section";
  const cut = base.slice(0, 48);
  return cut.slice(0, cut.lastIndexOf("-") > 24 ? cut.lastIndexOf("-") : 48);
}

function uniqueId(id: string, taken: Set<string>): string {
  let out = id;
  for (let n = 2; taken.has(out); n++) out = `${id}-${n}`;
  taken.add(out);
  return out;
}

function levelsFromLegend(legend: string): string[] | null {
  const m = /Levels:\s*(.*)$/i.exec(legend);
  if (!m) return null;
  const names = m[1]
    .split("·")
    .map((p) => p.trim().replace(/^L\d+\s+/i, ""))
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1));
  return names.length ? names : null;
}

// --- Sections ----------------------------------------------------------------

interface Region {
  text: string[];
  children: { handle: string; args: string; lines: string[] }[];
}

function dequote(line: string): string {
  return line.replace(/^\s*>\s?/, "");
}

/**
 * Splits a region's own prose from the blocks folded inside it, in either
 * form. Lines inside a code fence are always prose: a code sample can show
 * a `<details>` block without being one.
 */
function splitRegion(lines: string[]): Region {
  const text: string[] = [];
  const children: Region["children"] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    const fence = fenceOf(line);
    if (fence) {
      const end = fenceEnd(lines, i + 1, fence);
      text.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }

    if (t === "<details>") {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const sum = /^<summary>(.*)<\/summary>$/.exec(lines[j]?.trim() ?? "");
      if (sum) {
        const handle = sum[1].replace(/<\/?code>/g, "").trim();
        // Everything inside is quoted, so the first bare close is ours.
        let end = j + 1;
        while (end < lines.length && lines[end].trim() !== "</details>") end++;
        children.push({ handle, args: "", lines: lines.slice(j + 1, end).map(dequote) });
        i = end;
        continue;
      }
    }

    const colon = /^(:{3,})\s*(\S+)\s*(.*)$/.exec(t);
    if (colon && colon[2] !== "figure") {
      const close = new RegExp(`^${colon[1]}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end].trim())) end++;
      children.push({ handle: colon[2], args: colon[3].trim(), lines: lines.slice(i + 1, end) });
      i = end;
      continue;
    }

    text.push(line);
  }
  return { text, children };
}

function parseSection(id: string, heading: string, lines: string[]): DocSection {
  const layers: Block[][] = [];
  const facets: DocSection["facets"] = [];
  const walk = (region: Region, depth: number) => {
    layers[depth] = parseBlocks(region.text);
    for (const child of region.children) {
      const level = /^L(\d+)$/i.exec(child.handle);
      if (level) {
        // A block one level down; a skipped level (R6) still lands in order.
        const at = Math.max(depth + 1, Number(level[1]) - 1);
        walk(splitRegion(child.lines), Math.min(at, layers.length));
      } else {
        const inner = splitRegion(child.lines);
        const blocks = parseBlocks(inner.text);
        // The authoring form names the quoted code on the fence itself.
        if (child.args) blocks.unshift({ t: "snippet", ref: child.args, attrs: {}, fallback: [] });
        facets.push({ name: child.handle, blocks });
      }
    }
  };
  walk(splitRegion(lines), 0);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];
  return { id, heading, layers, facets };
}

// --- Sources -----------------------------------------------------------------

/**
 * The trailer after the last section: groups, each a line ending in a colon
 * ("Start here:") over a list. A list with no title of its own is "Sources".
 */
function parseSources(lines: string[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  let title: string | null = null;
  let chunk: string[] = [];
  const ids = new Set<string>();
  const flush = () => {
    const items: Inline[][] = [];
    for (const b of parseBlocks(chunk)) if (b.t === "list") items.push(...b.items);
    if (items.length) {
      const t = title ?? "Sources";
      groups.push({ id: uniqueId(`sources-${slug(t)}`, ids), title: t, items });
    }
    chunk = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.endsWith(":") && !/^([-*+]|\d+[.)])\s/.test(t)) {
      flush();
      title = t.slice(0, -1).replace(/^\*+|\*+$/g, "").trim();
      continue;
    }
    chunk.push(line);
  }
  flush();
  return groups;
}

// --- Terms -------------------------------------------------------------------

function eachInline(blocks: Block[], fn: (n: Inline) => void) {
  const walk = (c: Inline[]) => {
    for (const n of c) {
      fn(n);
      if ("c" in n) walk(n.c);
    }
  };
  for (const b of blocks) {
    if (b.t === "p" || b.t === "h") walk(b.c);
    else if (b.t === "list") b.items.forEach(walk);
    else if (b.t === "table") [b.head, ...b.rows].forEach((r) => r.forEach(walk));
    else if (b.t === "figure" || b.t === "snippet") eachInline(b.fallback, fn);
  }
}

/**
 * Where each term is introduced, and which uses define it: a term's home is
 * the first section that uses it, and in that section the first use in each
 * layer defines it, since each layer retells the section in full and only
 * one shows at a time.
 */
function markTerms(doc: ParsedDoc) {
  const all = [doc.intro, ...doc.sections].filter((s): s is DocSection => s !== null);
  for (const s of all) {
    for (const layer of s.layers) {
      eachInline(layer, (n) => {
        if (n.t !== "term" || doc.termHome[n.id]) return;
        doc.termHome[n.id] = s.id;
        const label = inlineText(n.c).trim();
        if (label) doc.termLabel[n.id] = label[0].toUpperCase() + label.slice(1);
      });
    }
  }
  for (const s of all) {
    for (const layer of s.layers) {
      const seen = new Set<string>();
      eachInline(layer, (n) => {
        if (n.t !== "term" || doc.termHome[n.id] !== s.id || seen.has(n.id)) return;
        seen.add(n.id);
        n.first = true;
      });
    }
  }
  for (const id of Object.keys(doc.terms)) doc.termLabel[id] ??= id;
}
