import { useEffect, useState } from "react";
import type { Artist, Series } from "../types";
import { loadMetadata } from "../utils/metadata";

export function useMetadata(artistName: string, seriesSlug: string) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [parentSeries, setParentSeries] = useState<Series | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadMetadata()
      .then(({ artists, series: allSeries }) => {
        if (cancelled) return;

        setArtist(artists.find((a) => a.name === artistName) ?? null);

        const matched = allSeries.find((s) => s.id === seriesSlug) ?? null;
        setSeries(matched);

        if (matched?.parentSeries) {
          setParentSeries(allSeries.find((s) => s.id === matched.parentSeries) ?? null);
        } else {
          setParentSeries(null);
        }
      })
      .catch(() => {
        // silently ignore — info flip just won't appear
      });

    return () => { cancelled = true; };
  }, [artistName, seriesSlug]);

  return { artist, series, parentSeries, hasContent: !!(artist || series) };
}
