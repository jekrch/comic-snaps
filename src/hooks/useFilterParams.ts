import { useCallback, useMemo } from "react";
import type { Filters } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { InfoTab } from "../components/InfoModal";

const FILTER_KEYS: (keyof Filters)[] = ["decades", "tags", "artists", "colorists", "letterers", "credits", "postedBy", "series"];
const DEFAULT_SORT: SortMode = "newest";
const VALID_TABS: InfoTab[] = ["about", "sorts", "stats"];

function parseFiltersFromURL(): {
  filters: Filters;
  sort: SortMode;
  tab: InfoTab | null;
  viz: boolean;
  vizPreset: string | null;
} {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    decades: new Set(params.get("decades")?.split(",").filter(Boolean) ?? []),
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    artists: new Set(params.get("artists")?.split(",").filter(Boolean) ?? []),
    colorists: new Set(params.get("colorists")?.split(",").filter(Boolean) ?? []),
    letterers: new Set(params.get("letterers")?.split(",").filter(Boolean) ?? []),
    credits: new Set(params.get("credits")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
    series: new Set(params.get("series")?.split(",").filter(Boolean) ?? []),
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  const rawTab = params.get("tab");
  const tab = rawTab && VALID_TABS.includes(rawTab as InfoTab) ? (rawTab as InfoTab) : null;

  return {
    filters,
    sort,
    tab,
    viz: params.get("viz") === "1",
    vizPreset: params.get("vizpreset"),
  };
}

/** Visualizer params, carried across unrelated URL updates. `vizseed` and
 *  `vizdebug` are read straight off the URL by the overlay, so losing them on a
 *  filter change would silently drop a run someone was replaying. */
const VIZ_KEYS = ["viz", "vizpreset", "vizseed", "vizdebug"] as const;

function buildParams(
  filters: Filters,
  sort: SortMode,
  tab: InfoTab | null,
  carried: URLSearchParams
): string {
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

  // A visualizer run composes with the active filters, so both sets of params
  // have to survive each other's updates for the URL to stay linkable.
  for (const key of VIZ_KEYS) {
    const value = carried.get(key);
    if (value) params.set(key, value);
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
      const params = new URLSearchParams(window.location.search);
      // preserve the current tab param if not explicitly provided
      const currentTab = tab !== undefined ? tab : (params.get("tab") as InfoTab | null);
      pushURL(buildParams(filters, sort, currentTab, params));
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

  const syncViz = useCallback((open: boolean, preset?: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (open) {
      params.set("viz", "1");
      if (preset) params.set("vizpreset", preset);
      else params.delete("vizpreset");
    } else {
      params.delete("viz");
      params.delete("vizpreset");
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, []);

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    initialTab: initial.tab,
    initialViz: initial.viz,
    initialVizPreset: initial.vizPreset,
    syncToURL,
    syncTab,
    syncViz,
  };
}