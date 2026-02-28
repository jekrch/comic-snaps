import { useCallback, useMemo } from "react";
import type { Filters } from "../filtering";
import { EMPTY_FILTERS } from "../filtering";
import type { SortMode } from "../sorting";

const FILTER_KEYS: (keyof Filters)[] = ["decades", "tags", "artists", "postedBy"];
const DEFAULT_SORT: SortMode = "newest";

function parseFiltersFromURL(): { filters: Filters; sort: SortMode } {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    decades: new Set(params.get("decades")?.split(",").filter(Boolean) ?? []),
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    artists: new Set(params.get("artists")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  return { filters, sort };
}

function writeFiltersToURL(filters: Filters, sort: SortMode) {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const values = Array.from(filters[key]);
    if (values.length > 0) {
      params.set(key, values.join(","));
    }
  }

  if (sort !== DEFAULT_SORT) {
    params.set("sort", sort);
  }

  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const setFilters = useCallback(
    (filters: Filters, sort: SortMode) => {
      writeFiltersToURL(filters, sort);
    },
    []
  );

  return { initialFilters: initial.filters, initialSort: initial.sort, syncToURL: setFilters };
}