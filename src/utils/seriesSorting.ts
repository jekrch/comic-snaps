import type { SeriesRow } from "./seriesRollup";

/**
 * How the rows order. Deliberately its own type rather than a member of
 * `SortMode`: a nearest-neighbour chain over hashes or embeddings has no
 * meaning for a row holding five images, and `name` has none for a panel
 * (docs/series-view-plan.md §3.1). Both sorts stay live at once — the panel
 * sort still orders the strips.
 */
export type SeriesSortMode = "rating" | "name" | "newest" | "year" | "panels";

/**
 * `newest` is named LAST POSTED on screen because that is the question it
 * answers — which series someone came back to most recently, not which one
 * showed up first. The key stays `newest` so existing `?ssort=` links keep
 * working.
 */
export const SERIES_SORT_OPTIONS: { value: SeriesSortMode; label: string }[] = [
  { value: "newest", label: "LAST POSTED" },
  { value: "rating", label: "RATING" },
  { value: "panels", label: "PANELS" },
  { value: "year", label: "YEAR" },
  { value: "name", label: "NAME" },
];

export const DEFAULT_SERIES_SORT: SeriesSortMode = "newest";

const VALID = new Set<string>(SERIES_SORT_OPTIONS.map((o) => o.value));

export function isSeriesSortMode(value: string | null): value is SeriesSortMode {
  return value !== null && VALID.has(value);
}

/**
 * A title's place in an alphabetical list: leading articles dropped, `&` spoken
 * aloud. `The Nice House by the Sea` files under N.
 *
 * `comparePersonNames` is deliberately not reused — it sorts on the trailing
 * token because people have surnames, and series titles do not.
 */
export function titleSortKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function byName(a: SeriesRow, b: SeriesRow): number {
  return titleSortKey(a.title).localeCompare(titleSortKey(b.title), undefined, {
    sensitivity: "base",
  });
}

/**
 * Rows, ordered. Returns a new array — the caller's is the rollup's, and the
 * strips inside it are shared by reference.
 */
export function sortSeriesRows(rows: SeriesRow[], mode: SeriesSortMode): SeriesRow[] {
  const sorted = [...rows];

  switch (mode) {
    case "rating":
      // Unrated last, ordered among themselves by name: a row with no score is
      // not a zero, and sorting it as one would bury the good unrated stuff
      // under the bad rated stuff (docs/ratings-plan.md §8).
      sorted.sort((a, b) => {
        const sa = a.rating?.avg ?? null;
        const sb = b.rating?.avg ?? null;
        if (sa === null && sb === null) return byName(a, b);
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sb - sa || (b.rating?.count ?? 0) - (a.rating?.count ?? 0) || byName(a, b);
      });
      break;

    case "name":
      sorted.sort(byName);
      break;

    case "newest":
      sorted.sort((a, b) => b.lastPostedAt - a.lastPostedAt || byName(a, b));
      break;

    case "year":
      sorted.sort((a, b) => {
        if (a.year === null && b.year === null) return byName(a, b);
        if (a.year === null) return 1;
        if (b.year === null) return -1;
        return b.year - a.year || byName(a, b);
      });
      break;

    case "panels":
      sorted.sort((a, b) => b.panels.length - a.panels.length || byName(a, b));
      break;
  }

  return sorted;
}
