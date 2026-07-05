import type { Artist, IssueCredits, Series } from "../types";

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
