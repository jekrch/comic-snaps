import { useEffect, useState } from "react";
import type { Artist, Series } from "../types";

let cachedArtists: Artist[] | null = null;
let cachedSeries: Series[] | null = null;

export function useMetadata(artistName: string, seriesSlug: string) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [parentSeries, setParentSeries] = useState<Series | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        if (!cachedArtists) {
          const res = await fetch(`${import.meta.env.BASE_URL}data/artists.json`);
          const data = await res.json();
          cachedArtists = data.artists;
        }
        if (!cachedSeries) {
          const res = await fetch(`${import.meta.env.BASE_URL}data/series.json`);
          const data = await res.json();
          cachedSeries = data.series;
        }
        if (cancelled) return;

        setArtist(cachedArtists!.find((a) => a.name === artistName) ?? null);

        const matched = cachedSeries!.find((s) => s.id === seriesSlug) ?? null;
        setSeries(matched);

        if (matched?.parentSeries) {
          setParentSeries(cachedSeries!.find((s) => s.id === matched.parentSeries) ?? null);
        } else {
          setParentSeries(null);
        }
      } catch {
        // silently ignore — info flip just won't appear
      }
    };

    load();
    return () => { cancelled = true; };
  }, [artistName, seriesSlug]);

  return { artist, series, parentSeries, hasContent: !!(artist || series) };
}
