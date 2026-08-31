import { useEffect, useMemo, useState } from "react";
import type { Artist, IssueCredits, Panel, RatingsIndex, Series, TargetRatings } from "../types";
import { getCachedMetadata, loadMetadata } from "../utils/metadata";
import { getCachedRatings, issueTargetId, loadRatings, lookupRatings, seriesTargetId } from "../utils/ratings";

export interface ArtistIndex {
  byId: Map<string, Artist>;
  byName: Map<string, Artist>;
}

const EMPTY_INDEX: ArtistIndex = { byId: new Map(), byName: new Map() };

/**
 * Lookup table for resolving a credited person (by artistId or name) to their
 * full Artist record, so credits can link out to a profile. Loaded once from
 * the shared metadata cache.
 */
export function useArtistIndex(): ArtistIndex {
  const [artists, setArtists] = useState<Artist[] | null>(() => getCachedMetadata().artists);

  useEffect(() => {
    if (artists) return;
    let cancelled = false;
    loadMetadata()
      .then(({ artists }) => {
        if (!cancelled) setArtists(artists);
      })
      .catch(() => {
        // silently ignore — names just won't be clickable
      });
    return () => { cancelled = true; };
  }, [artists]);

  return useMemo(() => {
    if (!artists) return EMPTY_INDEX;
    const byId = new Map<string, Artist>();
    const byName = new Map<string, Artist>();
    for (const a of artists) {
      byId.set(a.id, a);
      byName.set(a.name, a);
    }
    return { byId, byName };
  }, [artists]);
}

type Loaded = { artists: Artist[]; series: Series[]; issues: IssueCredits[] };

/**
 * Resolve a panel's records out of the loaded metadata. Kept as a plain
 * function of the data so the lookup can run against the module cache on the
 * very first render — a viewer opened straight onto the info drawer needs to
 * know it has something to show before it paints, not an effect later.
 */
export function useMetadata(artistName: string, seriesSlug: string, issue?: number | string) {
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const { artists, series, issues } = getCachedMetadata();
    return artists && series && issues ? { artists, series, issues } : null;
  });

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;

    loadMetadata()
      .then((data) => {
        if (!cancelled) setLoaded(data);
      })
      .catch(() => {
        // silently ignore — info flip just won't appear
      });

    return () => { cancelled = true; };
  }, [loaded]);

  return useMemo(() => {
    if (!loaded) {
      return { artist: null, series: null, parentSeries: null, issueCredits: null, hasContent: false };
    }
    const artist = loaded.artists.find((a) => a.name === artistName) ?? null;
    const series = loaded.series.find((s) => s.id === seriesSlug) ?? null;
    const parentSeries = series?.parentSeries
      ? loaded.series.find((s) => s.id === series.parentSeries) ?? null
      : null;
    const issueCredits =
      issue !== undefined
        ? loaded.issues.find((i) => i.series === seriesSlug && String(i.issue) === String(issue)) ?? null
        : null;
    return { artist, series, parentSeries, issueCredits, hasContent: !!(artist || series) };
  }, [loaded, artistName, seriesSlug, issue]);
}

/**
 * The group's scores and reviews for a panel's issue and its series. Both come
 * back null until the index loads, so nothing flashes in and out — and the
 * two are kept apart rather than blended, since a series score shouldn't
 * outweigh a stack of issue scores (docs/ratings-plan.md §8).
 */
export function useRatings(panel: Panel): { issue: TargetRatings | null; series: TargetRatings | null } {
  const [index, setIndex] = useState<RatingsIndex | null>(getCachedRatings);

  useEffect(() => {
    if (index) return;
    let cancelled = false;
    loadRatings()
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => {
        // silently ignore — the ratings block just won't appear
      });
    return () => { cancelled = true; };
  }, [index]);

  return useMemo(
    () => ({
      issue: lookupRatings(index, "issue", issueTargetId(panel)),
      series: lookupRatings(index, "series", seriesTargetId(panel)),
    }),
    [index, panel],
  );
}
