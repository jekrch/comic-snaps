// /describe_artist and /describe_series: replace an entry's description and
// add the sources it was written from to its references. The agent's
// research_description tool builds these (see research.ts); a person can also
// type one. Pure: parsing, building, and the reference merge.
//
// The command spans lines, because a description has paragraphs:
//
//   /describe_series 100
//   100% is a five-issue miniseries written and drawn by Paul Pope ...
//
//   Set in a New York of 2038 ...
//
//   Sources:
//   - Wikipedia | https://en.wikipedia.org/wiki/100%25_(comics)
//   - The Comics Journal | https://www.tcj.com/... | Article title
//
// The first line names the entry; the "Sources:" block is optional.

export type DescribeKind = "artist" | "series";

export interface DescribeReference {
  name: string;
  url: string;
  /** Set when the reference is one article rather than a whole database entry. */
  title?: string;
}

export interface DescribeCommand {
  verb: "describe";
  kind: DescribeKind;
  ref: string;
  paragraphs: string[];
  references: DescribeReference[];
}

export const DESCRIBE_VERBS = ["/describe_artist", "/describe_series"] as const;

/** Longer than any description in the data, and short enough to read in one Telegram message. */
export const MAX_DESCRIPTION_CHARS = 3000;

export const DESCRIBE_USAGE = `Expected format:
/describe_series {series}
{description, blank lines between paragraphs}
Sources:
- {source name} | {url}
- {source name} | {url} | {article title}

(/describe_artist {artist} works the same way. Sources are optional.)`;

const SOURCES_HEADER = /^sources:?$/i;
const SOURCE_LINE = /^[-*•]\s*(.+)$/;
const URL_RE = /^https?:\/\/\S+$/i;

/** Text that must stay on one line and can't contain the `|` source separator. */
function oneLine(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function cell(s: string): string {
  return oneLine(s).replace(/\s*\|\s*/g, " - ");
}

/** Build the command text. The model never writes it, so its prose can't break the format. */
export function buildDescribeCommand(
  kind: DescribeKind,
  ref: string,
  paragraphs: string[],
  references: DescribeReference[]
): string {
  const lines = [`/describe_${kind} ${oneLine(ref)}`, paragraphs.map(oneLine).filter(Boolean).join("\n\n")];
  if (references.length > 0) {
    lines.push(
      "",
      "Sources:",
      ...references.map(
        (r) => `- ${cell(r.name)} | ${r.url.trim()}${r.title ? ` | ${cell(r.title)}` : ""}`
      )
    );
  }
  return lines.join("\n");
}

/**
 * Parse everything after the verb. `{ error }` with the message to send back
 * when it can't be read.
 */
export function parseDescribeArgs(kind: DescribeKind, rest: string): DescribeCommand | { error: string } {
  const lines = rest.replace(/\r\n?/g, "\n").split("\n");
  const ref = (lines.shift() ?? "").trim();
  if (!ref) return { error: `Missing ${kind} reference.\n\n${DESCRIBE_USAGE}` };

  // The last "Sources:" line followed only by source lines starts the block,
  // so a paragraph that happens to say "Sources:" stays prose.
  let split = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!SOURCES_HEADER.test(lines[i].trim())) continue;
    const after = lines.slice(i + 1).filter((l) => l.trim());
    if (after.every((l) => SOURCE_LINE.test(l.trim()))) split = i;
    break;
  }

  const paragraphs = lines
    .slice(0, split)
    .join("\n")
    .split(/\n\s*\n/)
    .map(oneLine)
    .filter(Boolean);
  if (paragraphs.length === 0) return { error: `No description given.\n\n${DESCRIBE_USAGE}` };
  const length = paragraphs.join("\n\n").length;
  if (length > MAX_DESCRIPTION_CHARS) {
    return { error: `That description is ${length} characters; the limit is ${MAX_DESCRIPTION_CHARS}.` };
  }

  const references: DescribeReference[] = [];
  for (const line of lines.slice(split + 1)) {
    const m = line.trim().match(SOURCE_LINE);
    if (!m) continue;
    const [name, url, ...title] = m[1].split("|").map((s) => s.trim());
    if (!name || !url || !URL_RE.test(url)) {
      return { error: `Can't read source line "${line.trim()}". Use: - {name} | {url} [| {title}]` };
    }
    const t = title.join(" - ").trim();
    references.push(t ? { name, url, title: t } : { name, url });
  }

  return { verb: "describe", kind, ref, paragraphs, references };
}

/**
 * A URL reduced to what identifies the page: no scheme, `www.`, fragment or
 * trailing slash, host lowercased, percent-escapes decoded. Two references
 * with the same key are the same page.
 */
export function urlKey(url: string): string {
  let u = url.trim();
  try {
    u = decodeURI(u);
  } catch {
    // keep it encoded
  }
  u = u.replace(/^https?:\/\//i, "").replace(/#.*$/, "");
  const slash = u.indexOf("/");
  const host = (slash === -1 ? u : u.slice(0, slash)).toLowerCase().replace(/^www\./, "");
  const path = slash === -1 ? "" : u.slice(slash);
  return `${host}${path}`.replace(/\/+$/, "");
}

/** Append the references not already present (by URL). Returns how many were added. */
export function mergeReferences(existing: DescribeReference[], incoming: DescribeReference[]): number {
  const seen = new Set(existing.map((r) => urlKey(r.url)));
  let added = 0;
  for (const r of incoming) {
    const key = urlKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(r.title ? { name: r.name, url: r.url, title: r.title } : { name: r.name, url: r.url });
    added++;
  }
  return added;
}
