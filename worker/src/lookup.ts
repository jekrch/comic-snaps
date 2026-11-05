// Read-only lookups against the two databases the metadata pipeline matches
// series against, so the agent can find the name they'll recognise instead of
// guessing. Each returns a JSON string for the model, or an explanation of why
// it couldn't, and never throws: a lookup failing should end a tool call, not
// the conversation.

import type { Env } from "./types";

const USER_AGENT = "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)";
const METRON_API = "https://metron.cloud/api";
const COMIC_VINE_API = "https://comicvine.gamespot.com/api";
const MAX_RESULTS = 15;

/** Metron's list results carry "Name (1987)"; the pipeline matches on the part before the year. */
const METRON_DISPLAY_RE = /^(.*?)\s*\((\d{4})\)\s*$/;

export interface MetronSeriesHit {
  id: number;
  /** The name the pipeline compares against: the display name minus "(year)". */
  name: string;
  display: string;
  yearBegan: number | null;
  issueCount: number | null;
  url: string;
}

export function normalizeMetronSeries(raw: Record<string, unknown>): MetronSeriesHit | null {
  const id = typeof raw.id === "number" ? raw.id : null;
  if (id === null) return null;
  const display = String(raw.series ?? raw.name ?? "").trim();
  const m = display.match(METRON_DISPLAY_RE);
  const yearRaw = raw.year_began ?? (m ? m[2] : null);
  const year = yearRaw == null ? null : parseInt(String(yearRaw), 10);
  const issues = raw.issue_count == null ? null : parseInt(String(raw.issue_count), 10);
  return {
    id,
    name: m ? m[1] : display,
    display,
    yearBegan: Number.isFinite(year) ? year : null,
    issueCount: Number.isFinite(issues) ? issues : null,
    url: `https://metron.cloud/series/${id}/`,
  };
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function metronGet(env: Env, path: string): Promise<unknown> {
  const resp = await fetch(`${METRON_API}/${path}`, {
    headers: {
      Authorization: `Basic ${base64Utf8(`${env.METRON_USERNAME}:${env.METRON_PASSWORD}`)}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`Metron returned HTTP ${resp.status}`);
  return resp.json();
}

export function metronConfigured(env: Env): boolean {
  return Boolean(env.METRON_USERNAME && env.METRON_PASSWORD);
}

export function comicVineConfigured(env: Env): boolean {
  return Boolean(env.COMIC_VINE_API_KEY);
}

/** Series whose name contains `name` (Metron's own search semantics). */
export async function searchMetronSeries(env: Env, name: string): Promise<string> {
  if (!metronConfigured(env)) return "Metron isn't configured for this bot.";
  try {
    const data = (await metronGet(env, `series/?name=${encodeURIComponent(name)}`)) as {
      count?: number;
      results?: Record<string, unknown>[];
    };
    const hits = (data.results ?? [])
      .map(normalizeMetronSeries)
      .filter((h): h is MetronSeriesHit => h !== null)
      .slice(0, MAX_RESULTS);
    return JSON.stringify({ total: data.count ?? hits.length, results: hits });
  } catch (err) {
    return `Metron search failed: ${(err as Error).message}`;
  }
}

/** One Metron series in detail: publisher, run, type, description. */
export async function getMetronSeries(env: Env, id: number): Promise<string> {
  if (!metronConfigured(env)) return "Metron isn't configured for this bot.";
  try {
    const raw = (await metronGet(env, `series/${id}/`)) as Record<string, unknown>;
    const named = (v: unknown) =>
      v && typeof v === "object" ? ((v as { name?: unknown }).name ?? null) : (v ?? null);
    const desc = typeof raw.desc === "string" ? raw.desc.slice(0, 600) : null;
    return JSON.stringify({
      id: raw.id,
      name: raw.name,
      volume: raw.volume ?? null,
      seriesType: named(raw.series_type),
      publisher: named(raw.publisher),
      imprint: named(raw.imprint),
      yearBegan: raw.year_began ?? null,
      yearEnd: raw.year_end ?? null,
      issueCount: raw.issue_count ?? null,
      desc,
      url: `https://metron.cloud/series/${id}/`,
    });
  } catch (err) {
    return `Metron lookup failed: ${(err as Error).message}`;
  }
}

/** Comic Vine volumes (its word for series) matching `name`. */
export async function searchComicVineVolumes(env: Env, name: string): Promise<string> {
  if (!comicVineConfigured(env)) return "Comic Vine isn't configured for this bot.";
  const params = new URLSearchParams({
    api_key: env.COMIC_VINE_API_KEY ?? "",
    format: "json",
    resources: "volume",
    query: name,
    limit: String(MAX_RESULTS),
    field_list: "id,name,start_year,publisher,count_of_issues,site_detail_url",
  });
  try {
    const resp = await fetch(`${COMIC_VINE_API}/search/?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!resp.ok) return `Comic Vine search failed: HTTP ${resp.status}`;
    const data = (await resp.json()) as { results?: Record<string, unknown>[] };
    const results = (data.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      startYear: r.start_year ?? null,
      publisher:
        r.publisher && typeof r.publisher === "object"
          ? ((r.publisher as { name?: unknown }).name ?? null)
          : null,
      issueCount: r.count_of_issues ?? null,
      url: r.site_detail_url ?? null,
    }));
    return JSON.stringify({ results });
  } catch (err) {
    return `Comic Vine search failed: ${(err as Error).message}`;
  }
}
