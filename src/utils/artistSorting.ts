import type { ArtistRow } from "./artistRollup";
import { comparePersonNames } from "./names";

/**
 * How the artist rows order. Its own type for the same reason `SeriesSortMode`
 * is: a nearest-neighbour chain over hashes has no meaning for a row holding
 * nine images, and a panel sort has none for a person.
 *
 * There is no RATING here — nothing in `ratings.json` targets a creator, only
 * issues and series — and no BORN, because 44 of 124 records carry a birth
 * year and a sort that buries two thirds of the view under "unknown" is not a
 * sort. YEAR is the cover date of their earliest panel on the wall, which
 * every row has.
 */
export type ArtistSortMode = "newest" | "panels" | "series" | "year" | "name";

export const ARTIST_SORT_OPTIONS: { value: ArtistSortMode; label: string }[] = [
  { value: "newest", label: "LAST POSTED" },
  { value: "panels", label: "PANELS" },
  { value: "series", label: "SERIES" },
  { value: "year", label: "YEAR" },
  { value: "name", label: "NAME" },
];

export const DEFAULT_ARTIST_SORT: ArtistSortMode = "newest";

const VALID = new Set<string>(ARTIST_SORT_OPTIONS.map((o) => o.value));

export function isArtistSortMode(value: string | null): value is ArtistSortMode {
  return value !== null && VALID.has(value);
}

/**
 * The tiebreak, and the whole of the NAME sort: by surname, the way the facet
 * lists already read. "Jeff Lemire" files under L.
 */
function byName(a: ArtistRow, b: ArtistRow): number {
  return comparePersonNames(a.name, b.name);
}

/** Rows, ordered. Returns a new array — the caller's is the rollup's. */
export function sortArtistRows(rows: ArtistRow[], mode: ArtistSortMode): ArtistRow[] {
  const sorted = [...rows];

  switch (mode) {
    case "newest":
      sorted.sort((a, b) => b.lastPostedAt - a.lastPostedAt || byName(a, b));
      break;

    case "panels":
      sorted.sort((a, b) => b.panels.length - a.panels.length || byName(a, b));
      break;

    case "series":
      sorted.sort(
        (a, b) => b.series.length - a.series.length || b.panels.length - a.panels.length || byName(a, b),
      );
      break;

    case "year":
      // Oldest work first is the reading that makes this sort worth having —
      // it puts the EC and Warren pages at the top and the current books at
      // the bottom, which is the one ordering the wall cannot show.
      sorted.sort((a, b) => {
        const ya = a.years?.from ?? null;
        const yb = b.years?.from ?? null;
        if (ya === null && yb === null) return byName(a, b);
        if (ya === null) return 1;
        if (yb === null) return -1;
        return ya - yb || byName(a, b);
      });
      break;

    case "name":
      sorted.sort(byName);
      break;
  }

  return sorted;
}
