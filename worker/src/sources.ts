// Web sources for research_description: fetching a page as plain text, finding
// a quote in it, and naming it the way the data files name references.
//
// The Worker reads every source itself rather than trusting the model's
// summary of a search, so a draft's quotes can be checked against the page
// text word for word (see research.ts).

import type { DescribeReference } from "./descriptions";
import { urlKey } from "./descriptions";

const USER_AGENT = "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)";
const FETCH_TIMEOUT_MS = 10_000;
/** Enough for a long article; the rest of a page is navigation and comments. */
export const MAX_SOURCE_CHARS = 20_000;
/** Pages bigger than this are mostly markup and script, and cost CPU to strip. */
const MAX_HTML_CHARS = 2_000_000;

export interface SourceDoc {
  url: string;
  title: string;
  siteName: string | null;
  text: string;
}

export type FetchOutcome = { ok: true; doc: SourceDoc } | { ok: false; url: string; reason: string };

// ---------------------------------------------------------------------------
// Which pages are worth reading
// ---------------------------------------------------------------------------

/**
 * Hosts that never make a good source for a description: shops, social
 * media, user-edited fan wikis, and the search redirector itself.
 */
const SKIPPED_HOSTS = [
  "amazon.",
  "ebay.",
  "etsy.com",
  "pinterest.",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "threads.net",
  "reddit.com",
  "youtube.com",
  "fandom.com",
  "wikia.com",
  "quora.com",
  "goodreads.com",
  "google.com",
  "vertexaisearch.cloud.google.com",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSkippedSource(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  return SKIPPED_HOSTS.some((h) =>
    h.endsWith(".") ? host.startsWith(h) || host.includes(`.${h}`) : host === h || host.endsWith(`.${h}`)
  );
}

/**
 * Google Search grounding hands back redirect links rather than the pages
 * themselves; the real URL is the redirect's Location. Null when it can't be
 * resolved.
 */
export async function resolveGroundingUrl(uri: string): Promise<string | null> {
  if (hostOf(uri) !== "vertexaisearch.cloud.google.com") return uri;
  try {
    const resp = await fetch(uri, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = resp.headers.get("location");
    return location && /^https?:\/\//i.test(location) ? location : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML to text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  shy: "",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

const DROPPED_ELEMENTS =
  /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|figure)\b[\s\S]*?<\/\1\s*>/gi;
const BLOCK_TAGS =
  /<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|main|blockquote|dd|dt|dl|figcaption|pre)\b[^>]*>|<br\s*\/?>/gi;

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i"
  );
  const m = html.match(re);
  const v = m ? (m[1] ?? m[2]) : null;
  return v ? decodeEntities(v).trim() || null : null;
}

function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(DROPPED_ELEMENTS, " ")
      .replace(BLOCK_TAGS, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

/** Citation marks ("[12]", "[citation needed]") would split quotes the model copies without them. */
function tidyText(text: string): string {
  return text
    .replace(/\[(?:\d+|[a-z]|citation needed|note \d+)\]/gi, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A page's readable text, title and site name. Prefers the page's <article>
 * or <main> when that holds most of the text, which drops the site chrome.
 */
export function htmlToText(html: string): { title: string; siteName: string | null; text: string } {
  const page = html.slice(0, MAX_HTML_CHARS);
  const title =
    metaContent(page, "og:title") ??
    decodeEntities(page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const siteName = metaContent(page, "og:site_name");

  const body = page.match(/<body\b[\s\S]*$/i)?.[0] ?? page;
  let text = tidyText(stripToText(body));
  for (const tag of ["article", "main"]) {
    const m = body.match(new RegExp(`<${tag}\\b[\\s\\S]*<\\/${tag}>`, "i"));
    if (!m) continue;
    const inner = tidyText(stripToText(m[0]));
    if (inner.length >= 500) {
      text = inner;
      break;
    }
  }
  return { title, siteName, text: text.slice(0, MAX_SOURCE_CHARS) };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const WIKIPEDIA_RE = /^https?:\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i;

/** Wikipedia's plain-text extract: the article without its markup, infobox or citation marks. */
async function fetchWikipedia(url: string, lang: string, page: string): Promise<FetchOutcome> {
  let title = page;
  try {
    title = decodeURIComponent(page);
  } catch {
    // keep it as written
  }
  const api =
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1` +
    `&format=json&formatversion=2&titles=${encodeURIComponent(title.replace(/_/g, " "))}`;
  const resp = await fetch(api, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) return { ok: false, url, reason: `HTTP ${resp.status}` };
  const data = (await resp.json()) as { query?: { pages?: { title?: string; extract?: string; missing?: boolean }[] } };
  const hit = data.query?.pages?.[0];
  if (!hit || hit.missing || !hit.extract) return { ok: false, url, reason: "no such article" };
  return {
    ok: true,
    doc: {
      url,
      title: hit.title ?? title,
      siteName: "Wikipedia",
      text: tidyText(hit.extract).slice(0, MAX_SOURCE_CHARS),
    },
  };
}

/** Fetch one page as text. Never throws: a page that can't be read is reported, not fatal. */
export async function fetchSource(url: string): Promise<FetchOutcome> {
  try {
    const wiki = url.match(WIKIPEDIA_RE);
    if (wiki) return await fetchWikipedia(url, wiki[1].toLowerCase(), wiki[2]);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "Accept-Language": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return { ok: false, url, reason: `HTTP ${resp.status}` };
    const type = resp.headers.get("content-type") ?? "";
    if (type && !/html|text\/plain/i.test(type)) {
      return { ok: false, url, reason: `not a web page (${type.split(";")[0]})` };
    }
    const raw = await resp.text();
    const parsed = /text\/plain/i.test(type)
      ? { title: "", siteName: null, text: tidyText(raw).slice(0, MAX_SOURCE_CHARS) }
      : htmlToText(raw);
    if (parsed.text.length < 200) {
      return { ok: false, url, reason: "no readable text (the page may need JavaScript)" };
    }
    return { ok: true, doc: { url, ...parsed } };
  } catch (err) {
    const e = err as Error;
    return { ok: false, url, reason: e.name === "TimeoutError" ? "timed out" : e.message || "fetch failed" };
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/**
 * Text reduced for matching: diacritics, case and punctuation dropped, so
 * only the words and their order count. `map[i]` is the offset in the
 * original of normalized character i.
 */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let offset = 0;
  for (const ch of text) {
    const folded = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    for (const c of folded) {
      if (/[\p{L}\p{N}]/u.test(c)) {
        norm += c;
        map.push(offset);
      } else if (norm.length > 0 && norm[norm.length - 1] !== " ") {
        norm += " ";
        map.push(offset);
      }
    }
    offset += ch.length;
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

export function normalizeForMatch(text: string): string {
  return normalizeWithMap(text).norm;
}

/** A quote shorter than this doesn't pin a claim to a source. */
export const MIN_QUOTE_WORDS = 3;

export interface QuoteMatch {
  /** Offsets in the original source text. */
  start: number;
  end: number;
}

/**
 * Find a quote in a source, ignoring case, punctuation and diacritics. An
 * ellipsis ("..." or "…") may join pieces that appear in order. Null when it
 * isn't there, or is too short to count.
 */
export function findQuote(source: { norm: string; map: number[] }, quote: string): QuoteMatch | null {
  const pieces = quote
    .split(/\.{3}|…/)
    .map(normalizeForMatch)
    .filter(Boolean);
  const words = pieces.reduce((n, p) => n + p.split(" ").length, 0);
  if (pieces.length === 0 || words < MIN_QUOTE_WORDS) return null;

  // Each piece must start and end on word boundaries, so "art" doesn't match inside "smart".
  let from = 0;
  let first = -1;
  let last = -1;
  for (const piece of pieces) {
    let at = -1;
    for (let i = source.norm.indexOf(piece, from); i !== -1; i = source.norm.indexOf(piece, i + 1)) {
      const before = i === 0 || source.norm[i - 1] === " ";
      const end = i + piece.length;
      const after = end === source.norm.length || source.norm[end] === " ";
      if (before && after) {
        at = i;
        break;
      }
    }
    if (at === -1) return null;
    if (first === -1) first = at;
    last = at + piece.length - 1;
    from = at + piece.length;
  }
  return { start: source.map[first], end: source.map[last] + 1 };
}

/** The source text around a match, for the fact-check. */
export function quoteContext(text: string, match: QuoteMatch, radius = 300): string {
  const start = Math.max(0, match.start - radius);
  const end = Math.min(text.length, match.end + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// Naming a reference
// ---------------------------------------------------------------------------

/** Sites whose pages are database or encyclopedia entries: listed by site name, with no article title. */
const ENTRY_SITES: { host: string; name: string }[] = [
  { host: "wikipedia.org", name: "Wikipedia" },
  { host: "lambiek.net", name: "Comiclopedia" },
  { host: "metron.cloud", name: "Metron" },
  { host: "comicvine.gamespot.com", name: "Comic Vine" },
  { host: "comics.org", name: "Grand Comics Database" },
  { host: "tebeosfera.com", name: "Tebeosfera" },
  { host: "wikidata.org", name: "Wikidata" },
];

/** Sites whose pages are articles: listed by site name, with the article title under it. */
const ARTICLE_SITES: { host: string; name: string }[] = [
  { host: "tcj.com", name: "The Comics Journal" },
  { host: "comicsbeat.com", name: "The Beat" },
  { host: "solrad.co", name: "Solrad" },
  { host: "sktchd.com", name: "SKTCHD" },
  { host: "publishersweekly.com", name: "Publishers Weekly" },
  { host: "cbr.com", name: "CBR" },
  { host: "nytimes.com", name: "The New York Times" },
  { host: "theguardian.com", name: "The Guardian" },
  { host: "comicbookresources.com", name: "CBR" },
  { host: "newsarama.com", name: "Newsarama" },
  { host: "imagecomics.com", name: "Image Comics" },
  { host: "darkhorse.com", name: "Dark Horse" },
  { host: "dc.com", name: "DC" },
  { host: "marvel.com", name: "Marvel" },
];

function siteFor(host: string, list: { host: string; name: string }[]): string | null {
  return list.find((s) => host === s.host || host.endsWith(`.${s.host}`))?.name ?? null;
}

/** A page title minus a trailing " | Site" or " - Site" when that names the site. */
function articleTitle(title: string, site: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s+[|–—-]\s+([^|–—-]+)$/);
  if (!m) return t;
  const suffix = normalizeForMatch(m[2]);
  const name = normalizeForMatch(site);
  return suffix && (suffix === name || suffix.includes(name) || name.includes(suffix)) ? m[1].trim() : t;
}

/**
 * The reference for a source, named the way the data files already name
 * them: "Wikipedia" for the subject's own article ("Wikipedia: Pacific
 * Comics" for another), the site name alone for database entries, and site
 * name plus article title for everything else.
 */
export function referenceFor(doc: SourceDoc, subjectName: string): DescribeReference {
  const host = hostOf(doc.url);
  const entry = siteFor(host, ENTRY_SITES);
  if (entry === "Wikipedia") {
    const own = normalizeForMatch(doc.title).startsWith(normalizeForMatch(subjectName));
    const lang = host.split(".")[0];
    const base = lang && lang !== "en" ? `Wikipedia (${lang.toUpperCase()})` : "Wikipedia";
    return { name: own ? base : `${base}: ${doc.title}`, url: doc.url };
  }
  if (entry) return { name: entry, url: doc.url };

  const name = siteFor(host, ARTICLE_SITES) ?? doc.siteName ?? host;
  const title = doc.title ? articleTitle(doc.title, name) : "";
  return title && normalizeForMatch(title) !== normalizeForMatch(name)
    ? { name, url: doc.url, title }
    : { name, url: doc.url };
}

/** Deduplicate URLs by page, keeping the first spelling of each. */
export function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = urlKey(u);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}
