import { useCallback, useMemo } from "react";
import type { Filters } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { InfoTab } from "../components/InfoModal";

const FILTER_KEYS: (keyof Filters)[] = ["decades", "tags", "artists", "postedBy"];
const DEFAULT_SORT: SortMode = "newest";
const VALID_TABS: InfoTab[] = ["about", "sorts"];

function parseFiltersFromURL(): { filters: Filters; sort: SortMode; tab: InfoTab | null } {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    decades: new Set(params.get("decades")?.split(",").filter(Boolean) ?? []),
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    artists: new Set(params.get("artists")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  const rawTab = params.get("tab");
  const tab = rawTab && VALID_TABS.includes(rawTab as InfoTab) ? (rawTab as InfoTab) : null;

  return { filters, sort, tab };
}

function buildParams(filters: Filters, sort: SortMode, tab: InfoTab | null): string {
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

  if (tab) {
    params.set("tab", tab);
  }

  return params.toString();
}

function pushURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const syncToURL = useCallback(
    (filters: Filters, sort: SortMode, tab?: InfoTab | null) => {
      // preserve the current tab param if not explicitly provided
      const currentTab =
        tab !== undefined
          ? tab
          : new URLSearchParams(window.location.search).get("tab") as InfoTab | null;
      pushURL(buildParams(filters, sort, currentTab));
    },
    []
  );

  const syncTab = useCallback(
    (tab: InfoTab | null) => {
      const params = new URLSearchParams(window.location.search);
      if (tab) {
        params.set("tab", tab);
      } else {
        params.delete("tab");
      }
      const qs = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, "", url);
    },
    []
  );

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    initialTab: initial.tab,
    syncToURL,
    syncTab,
  };
}