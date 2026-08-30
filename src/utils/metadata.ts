import type { Artist, IssueCredit, IssueCredits, Series } from "../types";

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

let cachedArtists: Artist[] | null = null;
let cachedSeries: Series[] | null = null;
let cachedIssues: IssueCredits[] | null = null;
let pending: Promise<{ artists: Artist[]; series: Series[]; issues: IssueCredits[] }> | null = null;

export async function loadMetadata(): Promise<{ artists: Artist[]; series: Series[]; issues: IssueCredits[] }> {
  if (cachedArtists && cachedSeries && cachedIssues) {
    return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues };
  }
  if (pending) return pending;

  pending = (async () => {
    const [artistsRes, seriesRes, issuesRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/artists.json`),
      fetch(`${import.meta.env.BASE_URL}data/series.json`),
      fetch(`${import.meta.env.BASE_URL}data/issues.json`).catch(() => null),
    ]);
    const artistsData = await artistsRes.json();
    const seriesData = await seriesRes.json();
    // issues.json may not exist yet — treat it as optional
    let issuesData: { issues?: IssueCredits[] } = {};
    if (issuesRes?.ok) {
      issuesData = await issuesRes.json().catch(() => ({}));
    }
    cachedArtists = artistsData.artists as Artist[];
    cachedSeries = seriesData.series as Series[];
    cachedIssues = (issuesData.issues ?? []) as IssueCredits[];
    return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues };
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export function getCachedMetadata(): { artists: Artist[] | null; series: Series[] | null; issues: IssueCredits[] | null } {
  return { artists: cachedArtists, series: cachedSeries, issues: cachedIssues };
}
