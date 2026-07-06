import type { Panel } from "../types";

export interface Filters {
  decades: Set<string>;
  tags: Set<string>;
  artists: Set<string>;
  colorists: Set<string>;
  letterers: Set<string>;
  credits: Set<string>;
  postedBy: Set<string>;
  series: Set<string>;
}

export const EMPTY_FILTERS: Filters = {
  decades: new Set(),
  tags: new Set(),
  artists: new Set(),
  colorists: new Set(),
  letterers: new Set(),
  credits: new Set(),
  postedBy: new Set(),
  series: new Set(),
};

export function hasActiveFilters(filters: Filters): boolean {
  return activeFilterCount(filters) > 0;
}

export function activeFilterCount(filters: Filters): number {
  return (
    filters.decades.size +
    filters.tags.size +
    filters.artists.size +
    filters.colorists.size +
    filters.letterers.size +
    filters.credits.size +
    filters.postedBy.size +
    filters.series.size
  );
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
    if (filters.colorists.size > 0 && !(p.colorists ?? []).some((c) => filters.colorists.has(c))) return false;
    if (filters.letterers.size > 0 && !(p.letterers ?? []).some((l) => filters.letterers.has(l))) return false;
    if (filters.credits.size > 0 && !(p.credits ?? []).some((c) => filters.credits.has(c))) return false;
    if (filters.postedBy.size > 0 && !filters.postedBy.has(p.postedBy)) return false;
    if (filters.series.size > 0 && !filters.series.has(p.title)) return false;
    if (filters.tags.size > 0) {
      const panelTags = p.tags ?? [];
      if (!panelTags.some((t:any) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

export function computeFacets(panels: Panel[], filters: Filters) {
  const decadeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  const coloristCounts = new Map<string, number>();
  const lettererCounts = new Map<string, number>();
  const creditCounts = new Map<string, number>();
  const postedByCounts = new Map<string, number>();
  const seriesCounts = new Map<string, number>();

  for (const p of panels) {
    // pass flags per facet dimension; each facet is counted against all
    // filters except its own so the counts reflect what selecting it adds
    const pass = {
      decades: filters.decades.size === 0 || filters.decades.has(getDecade(p.year)),
      tags: filters.tags.size === 0 || (p.tags ?? []).some((t) => filters.tags.has(t)),
      artists: filters.artists.size === 0 || filters.artists.has(p.artist),
      colorists: filters.colorists.size === 0 || (p.colorists ?? []).some((c) => filters.colorists.has(c)),
      letterers: filters.letterers.size === 0 || (p.letterers ?? []).some((l) => filters.letterers.has(l)),
      credits: filters.credits.size === 0 || (p.credits ?? []).some((c) => filters.credits.has(c)),
      postedBy: filters.postedBy.size === 0 || filters.postedBy.has(p.postedBy),
      series: filters.series.size === 0 || filters.series.has(p.title),
    };

    const passAllExcept = (skip: keyof typeof pass) =>
      (Object.keys(pass) as (keyof typeof pass)[]).every((k) => k === skip || pass[k]);

    if (passAllExcept("decades")) {
      const dec = getDecade(p.year);
      decadeCounts.set(dec, (decadeCounts.get(dec) ?? 0) + 1);
    }
    if (passAllExcept("tags")) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    if (passAllExcept("artists")) {
      artistCounts.set(p.artist, (artistCounts.get(p.artist) ?? 0) + 1);
    }
    if (passAllExcept("colorists")) {
      for (const c of p.colorists ?? []) {
        coloristCounts.set(c, (coloristCounts.get(c) ?? 0) + 1);
      }
    }
    if (passAllExcept("letterers")) {
      for (const l of p.letterers ?? []) {
        lettererCounts.set(l, (lettererCounts.get(l) ?? 0) + 1);
      }
    }
    if (passAllExcept("credits")) {
      for (const c of p.credits ?? []) {
        creditCounts.set(c, (creditCounts.get(c) ?? 0) + 1);
      }
    }
    if (passAllExcept("postedBy")) {
      postedByCounts.set(p.postedBy, (postedByCounts.get(p.postedBy) ?? 0) + 1);
    }
    if (passAllExcept("series")) {
      seriesCounts.set(p.title, (seriesCounts.get(p.title) ?? 0) + 1);
    }
  }

  return { decadeCounts, tagCounts, artistCounts, coloristCounts, lettererCounts, creditCounts, postedByCounts, seriesCounts };
}
