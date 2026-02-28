import type { Panel } from "./types";

export interface Filters {
  decades: Set<string>;
  tags: Set<string>;
  artists: Set<string>;
  postedBy: Set<string>;
}

export const EMPTY_FILTERS: Filters = {
  decades: new Set(),
  tags: new Set(),
  artists: new Set(),
  postedBy: new Set(),
};

export function hasActiveFilters(filters: Filters): boolean {
  return filters.decades.size > 0 || filters.tags.size > 0 || filters.artists.size > 0 || filters.postedBy.size > 0;
}

export function activeFilterCount(filters: Filters): number {
  return filters.decades.size + filters.tags.size + filters.artists.size + filters.postedBy.size;
}

export function getDecade(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

export function applyFilters(panels: Panel[], filters: Filters): Panel[] {
  if (!hasActiveFilters(filters)) return panels;
  return panels.filter((p) => {
    if (filters.decades.size > 0 && !filters.decades.has(getDecade(p.year))) return false;
    if (filters.artists.size > 0 && !filters.artists.has(p.artist)) return false;
    if (filters.postedBy.size > 0 && !filters.postedBy.has(p.postedBy)) return false;
    if (filters.tags.size > 0) {
      const panelTags = p.tags ?? [];
      if (!panelTags.some((t) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

export function computeFacets(panels: Panel[], filters: Filters) {
  const decadeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  const postedByCounts = new Map<string, number>();

  for (const p of panels) {
    const passArtist = filters.artists.size === 0 || filters.artists.has(p.artist);
    const passTags = filters.tags.size === 0 || (p.tags ?? []).some((t) => filters.tags.has(t));
    const passDecade = filters.decades.size === 0 || filters.decades.has(getDecade(p.year));
    const passPostedBy = filters.postedBy.size === 0 || filters.postedBy.has(p.postedBy);

    if (passArtist && passTags && passPostedBy) {
      const dec = getDecade(p.year);
      decadeCounts.set(dec, (decadeCounts.get(dec) ?? 0) + 1);
    }
    if (passArtist && passDecade && passPostedBy) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    if (passTags && passDecade && passPostedBy) {
      artistCounts.set(p.artist, (artistCounts.get(p.artist) ?? 0) + 1);
    }
    if (passTags && passDecade && passArtist) {
      postedByCounts.set(p.postedBy, (postedByCounts.get(p.postedBy) ?? 0) + 1);
    }
  }

  return { decadeCounts, tagCounts, artistCounts, postedByCounts };
}