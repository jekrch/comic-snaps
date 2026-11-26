import type { Block, Inline } from "../model";

/**
 * The Markdown a dimensional document's prose uses, and no more: paragraphs,
 * emphasis, code, links, images (as Markdown or `<img>`), footnote
 * references, fenced code, pipe tables, lists, rules, and the `dd:` binding
 * comments. Line-based and dependency-free, like the format itself: every
 * construct that matters starts on its own line.
 */

// --- Inline ------------------------------------------------------------------

/** A footnote reference before it's attached to the words it names. */
type Raw = Inline | { t: "fnref"; id: string };

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|<>~]/;
const WORD = /[\p{L}\p{N}]/u;

export function parseInline(src: string): Inline[] {
  return attachTerms(inlineRaw(src.replace(/\s*\n\s*/g, " ")));
}

function inlineRaw(s: string): Raw[] {
  const out: Raw[] = [];
  let text = "";
  const push = (n: Raw) => {
    if (text) out.push({ t: "text", v: text });
    text = "";
    out.push(n);
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      let run = 1;
      while (s[i + run] === "`") run++;
      const fence = "`".repeat(run);
      const end = s.indexOf(fence, i + run);
      if (end > 0) {
        let v = s.slice(i + run, end);
        if (v.length > 1 && v.startsWith(" ") && v.endsWith(" ")) v = v.slice(1, -1);
        push({ t: "code", v });
        i = end + run;
        continue;
      }
      text += fence;
      i += run;
      continue;
    }
    if (ch === "[" && s[i + 1] === "^") {
      const end = s.indexOf("]", i + 2);
      if (end > 0 && s[end + 1] !== ":") {
        push({ t: "fnref", id: s.slice(i + 2, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "!" && s[i + 1] === "[") {
      const link = readLink(s, i + 1);
      if (link) {
        push({ t: "img", src: link.href, alt: link.label });
        i = link.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = readLink(s, i);
      if (link) {
        push({ t: "link", href: link.href, c: inlineRaw(link.label) as Inline[] });
        i = link.end;
        continue;
      }
    }
    if (ch === "<") {
      const tag = readTag(s, i);
      if (tag) {
        if (tag.node) push(tag.node);
        i = tag.end;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const em = readEmphasis(s, i);
      if (em) {
        push(em.node);
        i = em.end;
        continue;
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: "text", v: text });
  return out;
}

function readLink(s: string, open: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      const end = s.indexOf("`", j + 1);
      if (end > 0) j = end;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close < 0 || s[close + 1] !== "(") return null;
  const end = s.indexOf(")", close + 2);
  if (end < 0) return null;
  const href = s.slice(close + 2, end).trim().split(/\s+/)[0] ?? "";
  return { label: s.slice(open + 1, close), href, end: end + 1 };
}

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function readTag(s: string, i: number): { node: Inline | null; end: number } | null {
  const m = /^<(\/?)([a-zA-Z][\w-]*)([^>]*)>/.exec(s.slice(i));
  if (!m) return null;
  const [whole, closing, name] = m;
  const tag = name.toLowerCase();
  const end = i + whole.length;
  if (tag === "img" && !closing) {
    const a = attrs(m[3]);
    return { node: { t: "img", src: a.src ?? "", alt: a.alt ?? "", width: a.width }, end };
  }
  if (tag === "br") return { node: { t: "br" }, end };
  if (tag === "code" && !closing) {
    const stop = s.indexOf("</code>", end);
    if (stop > 0) return { node: { t: "code", v: decodeEntities(s.slice(end, stop)) }, end: stop + 7 };
  }
  // Other inline HTML (sup, kbd, span…) is dropped and its text kept.
  if (["sup", "sub", "span", "kbd", "small", "em", "strong", "b", "i", "u", "a"].includes(tag)) return { node: null, end };
  return null;
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function readEmphasis(s: string, i: number): { node: Inline; end: number } | null {
  const ch = s[i];
  const strong = s[i + 1] === ch;
  const delim = strong ? ch + ch : ch;
  const start = i + delim.length;
  // Opening: not followed by a space; `_` only at a word's edge.
  if (!s[start] || /\s/.test(s[start])) return null;
  if (ch === "_" && i > 0 && WORD.test(s[i - 1])) return null;
  for (let j = start + 1; j <= s.length - delim.length; j++) {
    if (s[j] === "`") {
      const end = s.indexOf("`", j + 1);
      if (end > 0) j = end;
      continue;
    }
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s.startsWith(delim, j) && !/\s/.test(s[j - 1])) {
      // A single `*` must not be half of a `**`.
      if (!strong && s[j + 1] === ch) {
        j++;
        continue;
      }
      if (ch === "_" && j + delim.length < s.length && WORD.test(s[j + delim.length])) continue;
      const inner = inlineRaw(s.slice(start, j)) as Inline[];
      return { node: strong ? { t: "strong", c: inner } : { t: "em", c: inner }, end: j + delim.length };
    }
  }
  return null;
}

/**
 * Footnote references become terms around the words they follow. The
 * format marks only where a term's footnote is, not where its words start,
 * so the words are chosen by the id: the longest run of up to four words
 * before the reference that starts with the id's first letters ("hex
 * digits" for `hex`), spells it in initials ("discrete cosine transform"
 * for `dct`), or in initials and a last word ("perceptual hash" for
 * `phash`). Otherwise the one word before it. A reference after emphasis or
 * code takes that whole span.
 */
function attachTerms(raw: Raw[]): Inline[] {
  const out: Inline[] = [];
  for (const n of raw) {
    if (n.t !== "fnref") {
      if (n.t === "em" || n.t === "strong" || n.t === "link") out.push({ ...n, c: attachTerms(n.c as Raw[]) });
      else out.push(n);
      continue;
    }
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ t: "term", id: n.id, c: [] });
      continue;
    }
    if (prev.t !== "text") {
      out[out.length - 1] = { t: "term", id: n.id, c: [prev] };
      continue;
    }
    const { before, words } = splitTermWords(prev.v, n.id);
    if (!words) {
      out.push({ t: "term", id: n.id, c: [] });
      continue;
    }
    if (before) out[out.length - 1] = { t: "text", v: before };
    else out.pop();
    out.push({ t: "term", id: n.id, c: [{ t: "text", v: words }] });
  }
  return out;
}

export function splitTermWords(text: string, id: string): { before: string; words: string } {
  const m = /((?:[\p{L}\p{N}][\p{L}\p{N}'’-]*\s+){0,3}[\p{L}\p{N}][\p{L}\p{N}'’-]*)$/u.exec(text);
  if (!m) return { before: text, words: "" };
  const words = m[1].split(/\s+/);
  const key = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = (ws: string[]) => {
    const lower = ws.map((w) => w.toLowerCase());
    if (key.length >= 3 && lower[0].startsWith(key.slice(0, 3))) return true;
    if (lower.map((w) => w[0]).join("") === key) return true;
    return lower.slice(0, -1).map((w) => w[0]).join("") + lower[lower.length - 1] === key;
  };
  let take = 1;
  for (let n = words.length; n >= 1; n--) {
    if (matches(words.slice(-n))) {
      take = n;
      break;
    }
  }
  // Re-find the chosen words in the original, keeping its spacing.
  const tail = new RegExp(`(${words.slice(-take).map(escapeRe).join("\\s+")})$`, "u").exec(text);
  const chosen = tail ? tail[1] : words[words.length - 1];
  return { before: text.slice(0, text.length - chosen.length), words: chosen };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Blocks ------------------------------------------------------------------

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const DD_OPEN = /^<!--\s*dd:(figure|code)\s+(\S+)(.*?)\s*-->$/;
const DD_DATA = /^<!--\s*dd:data\s+(\S+)(.*?)\s*-->$/;
const COLON_FENCE = /^(:{3,})\s*(\S+)\s*(.*)$/;

/** Whether a line opens or closes a code fence, and with what. */
export function fenceOf(line: string): string | null {
  const m = FENCE.exec(line);
  return m ? m[2] : null;
}

/** The index of the line that closes a fence opened with `fence`, or the end. */
export function fenceEnd(lines: string[], from: number, fence: string): number {
  for (let j = from; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t.startsWith(fence[0].repeat(fence.length)) && /^[`~]+$/.test(t)) return j;
  }
  return lines.length;
}

export function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t || /^<br\s*\/?>$/i.test(t)) {
      flush();
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const end = fenceEnd(lines, i + 1, fence[2]);
      const indent = fence[1].length;
      const body = lines.slice(i + 1, end).map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)));
      out.push({ t: "code", lang: fence[3].trim().split(/\s+/)[0] ?? "", v: body.join("\n") });
      i = end + 1;
      continue;
    }

    const dd = DD_OPEN.exec(t);
    if (dd) {
      flush();
      const close = new RegExp(`^<!--\\s*/dd:${dd[1]}\\s*-->$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end].trim())) end++;
      const fallback = parseBlocks(lines.slice(i + 1, end));
      if (dd[1] === "figure") out.push({ t: "figure", id: dd[2], fallback });
      else out.push({ t: "snippet", ref: dd[2], attrs: attrs(dd[3]), fallback });
      i = end + 1;
      continue;
    }

    const data = DD_DATA.exec(t);
    if (data) {
      flush();
      const a = attrs(data[2]);
      out.push({ t: "data", ref: data[1], asOf: a["as-of"] });
      i++;
      continue;
    }

    if (t.startsWith("<!--")) {
      flush();
      let end = i;
      while (end < lines.length && !lines[end].includes("-->")) end++;
      i = end + 1;
      continue;
    }

    const colon = COLON_FENCE.exec(t);
    if (colon && colon[2] === "figure") {
      flush();
      const close = new RegExp(`^${colon[1]}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end].trim())) end++;
      out.push({ t: "figure", id: colon[3].trim(), fallback: parseBlocks(lines.slice(i + 1, end)) });
      i = end + 1;
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(t);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, c: parseInline(h[2]) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t) && para.length === 0) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if (t.startsWith("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = cells(t);
      const align = cells(lines[i + 1].trim()).map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) rows.push(cells(lines[j].trim())), j++;
      out.push({
        t: "table",
        head: head.map(parseInline),
        align,
        rows: rows.map((r) => head.map((_, k) => parseInline(r[k] ?? ""))),
      });
      i = j;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    // Bullets can interrupt a paragraph; numbers only from 1, so a line
    // that happens to start "1999." stays prose.
    if (item && (para.length === 0 || !/\d/.test(item[2]) || /^1[.)]$/.test(item[2]))) {
      flush();
      const ordered = /\d/.test(item[2]);
      const items: string[] = [];
      let j = i;
      while (j < lines.length) {
        const m = LIST_ITEM.exec(lines[j]);
        if (m && /\d/.test(m[2]) === ordered) {
          items.push(m[3]);
          j++;
          continue;
        }
        const lt = lines[j].trim();
        // A continuation line, indented or lazy; a blank ends the list
        // unless another item follows straight after.
        if (lt && !FENCE.test(lines[j]) && !lt.startsWith("<!--")) {
          items[items.length - 1] += "\n" + lt;
          j++;
          continue;
        }
        if (!lt && LIST_ITEM.test(lines[j + 1] ?? "") && /\d/.test(LIST_ITEM.exec(lines[j + 1])![2]) === ordered) {
          j++;
          continue;
        }
        break;
      }
      out.push({ t: "list", ordered, items: items.map(parseInline) });
      i = j;
      continue;
    }

    para.push(line);
    i++;
  }
  flush();
  return out;
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (ch === "\\" && r[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
