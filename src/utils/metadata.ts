import type { Artist, IssueCredit, IssueCredits, Publisher, Series } from "../types";

/** Editorial and production credits: on the issue, but not authorship of what
 *  is on the panel. A Marvel issue's credits carry every variant cover artist
 *  and every editor, so counting them as co-creators of the panel puts names
 *  in the CREDITED facet — and in reach of the text search — that have no
 *  visible connection to the art. */
export const PRODUCTION_ROLES = new Set(["Cover", "Editor", "Designer"]);

/** True when production is *all* this person did on the issue. Someone who
 *  drew the cover and the interior keeps their credit on both counts, and a
 *  credit with no role at all is kept rather than guessed at. */
export function isProductionOnly(credit: IssueCredit): boolean {
  return credit.roles.length > 0 && credit.roles.every((r) => PRODUCTION_ROLES.has(r));
}

export interface Metadata {
  artists: Artist[];
  series: Series[];
  issues: IssueCredits[];
  /** publishers.json: publishers, imprints and self-publishing labels. */
  publishers: Publisher[];
}

let cachedArtists: Artist[] | null = null;
let cachedSeries: Series[] | null = null;
let cachedIssues: IssueCredits[] | null = null;
let cachedPublishers: Publisher[] | null = null;
let pending: Promise<Metadata> | null = null;

/** An optional data file's list, or empty when it is missing or unreadable. */
async function optionalList<T>(res: Response | null, key: string): Promise<T[]> {
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const list = data?.[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

export async function loadMetadata(): Promise<Metadata> {
  if (cachedArtists && cachedSeries && cachedIssues && cachedPublishers) {
    return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues, publishers: cachedPublishers };
  }
  if (pending) return pending;

  pending = (async () => {
    const [artistsRes, seriesRes, issuesRes, publishersRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/artists.json`),
      fetch(`${import.meta.env.BASE_URL}data/series.json`),
      // Both optional: without them the credits and publisher pages just
      // don't appear.
      fetch(`${import.meta.env.BASE_URL}data/issues.json`).catch(() => null),
      fetch(`${import.meta.env.BASE_URL}data/publishers.json`).catch(() => null),
    ]);
    const artistsData = await artistsRes.json();
    const seriesData = await seriesRes.json();
    cachedArtists = artistsData.artists as Artist[];
    cachedSeries = seriesData.series as Series[];
    cachedIssues = await optionalList<IssueCredits>(issuesRes, "issues");
    cachedPublishers = await optionalList<Publisher>(publishersRes, "publishers");
    return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues, publishers: cachedPublishers };
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export function getCachedMetadata(): {
  artists: Artist[] | null;
  series: Series[] | null;
  issues: IssueCredits[] | null;
  publishers: Publisher[] | null;
} {
  return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues, publishers: cachedPublishers };
}
