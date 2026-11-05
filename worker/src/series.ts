import type { PanelEntry, SeriesEntry } from "./types";
import { slugify } from "./caption";
import { findSeries } from "./github";

export interface ResolvedSeries {
  /** The slug panels of this series are grouped under (series.json's `id`). */
  slug: string;
  /** The name to store on the panel: the series' canonical name when it has one. */
  title: string;
  /** Whether the series already exists, in series.json or in the gallery. */
  existing: boolean;
}

/**
 * Work out which series a typed title means.
 *
 * A series' identity is its slug, fixed when its first panel was posted, while
 * its name can be corrected later (`/rename_series`). Deriving the slug from
 * whatever title was typed would start a second series the first time someone
 * posts under the corrected name, so an existing series is looked up first: by
 * slug, then by name or alias. Only a title nothing recognises gets a new slug.
 *
 * The gallery is consulted after series.json because a series posted since the
 * metadata job last ran has panels but no series.json entry yet.
 */
export function resolveSeries(
  title: string,
  series: SeriesEntry[],
  panels: PanelEntry[]
): ResolvedSeries {
  const typed = title.trim();
  const slug = slugify(typed);

  const bySlug = series.find((s) => s.id === slug);
  if (bySlug) return { slug: bySlug.id, title: bySlug.name, existing: true };

  const byName = findSeries(series, typed);
  if (byName) return { slug: byName.id, title: byName.name, existing: true };

  if (panels.some((p) => p.slug === slug)) return { slug, title: typed, existing: true };

  return { slug, title: typed, existing: false };
}

/**
 * Python's default string ordering (code point), which seed_series sorts
 * series.json by. Sorting the same way after a rename keeps the next metadata
 * run from reshuffling the file.
 */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
