import { useEffect, useState } from "react";
import type { Artist, IssueCredits, Series } from "../types";
import { loadMetadata } from "../utils/metadata";

export function useMetadata(artistName: string, seriesSlug: string, issue?: number | string) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [parentSeries, setParentSeries] = useState<Series | null>(null);
  const [issueCredits, setIssueCredits] = useState<IssueCredits | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadMetadata()
      .then(({ artists, series: allSeries, issues }) => {
        if (cancelled) return;

        setArtist(artists.find((a) => a.name === artistName) ?? null);

        const matched = allSeries.find((s) => s.id === seriesSlug) ?? null;
        setSeries(matched);

        if (matched?.parentSeries) {
          setParentSeries(allSeries.find((s) => s.id === matched.parentSeries) ?? null);
        } else {
          setParentSeries(null);
        }

        setIssueCredits(
          issue !== undefined
            ? issues.find((i) => i.series === seriesSlug && String(i.issue) === String(issue)) ?? null
            : null,
        );
      })
      .catch(() => {
        // silently ignore — info flip just won't appear
      });

    return () => { cancelled = true; };
  }, [artistName, seriesSlug, issue]);

  return { artist, series, parentSeries, issueCredits, hasContent: !!(artist || series) };
}
