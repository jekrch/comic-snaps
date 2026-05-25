import type { Artist, Series } from "../types";

let cachedArtists: Artist[] | null = null;
let cachedSeries: Series[] | null = null;
let pending: Promise<{ artists: Artist[]; series: Series[] }> | null = null;

export async function loadMetadata(): Promise<{ artists: Artist[]; series: Series[] }> {
  if (cachedArtists && cachedSeries) {
    return { artists: cachedArtists, series: cachedSeries };
  }
  if (pending) return pending;

  pending = (async () => {
    const [artistsRes, seriesRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/artists.json`),
      fetch(`${import.meta.env.BASE_URL}data/series.json`),
    ]);
    const artistsData = await artistsRes.json();
    const seriesData = await seriesRes.json();
    cachedArtists = artistsData.artists as Artist[];
    cachedSeries = seriesData.series as Series[];
    return { artists: cachedArtists, series: cachedSeries };
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export function getCachedMetadata(): { artists: Artist[] | null; series: Series[] | null } {
  return { artists: cachedArtists, series: cachedSeries };
}
