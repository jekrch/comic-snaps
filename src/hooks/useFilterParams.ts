import { useCallback, useMemo } from "react";
import type { Filters, FilterSetKey } from "../utils/filtering";
import { FILTER_SET_KEYS } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { InfoTab } from "../components/InfoModal";
import type { GalleryView } from "../components/ViewControl";
import type { SeriesSortMode } from "../utils/seriesSorting";
import { DEFAULT_SERIES_SORT, isSeriesSortMode } from "../utils/seriesSorting";
import { VIZ_MAX_SPEED, VIZ_MIN_SPEED } from "../components/viz/vizConfig";

const FILTER_KEYS: FilterSetKey[] = FILTER_SET_KEYS;
const DEFAULT_SORT: SortMode = "newest";
const VALID_TABS: InfoTab[] = ["about", "sorts", "stats"];
const DEFAULT_VIEW: GalleryView = "wall";

function parseFiltersFromURL(): {
  filters: Filters;
  sort: SortMode;
  tab: InfoTab | null;
  view: GalleryView;
  seriesSort: SeriesSortMode;
  viz: boolean;
  vizPreset: string | null;
  vizSpeed: number | null;
  vizCfg: string | null;
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
    searchQuery: params.get("q") ?? "",
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  // The two views are separate places to browse, and both sorts stay live
  // across a toggle — so the row sort gets its own key rather than sharing
  // `sort`, which would silently reset a colour sort to newest on the way back
  // (docs/series-view-plan.md §5.2).
  const view: GalleryView = params.get("view") === "series" ? "series" : DEFAULT_VIEW;
  const rawSsort = params.get("ssort");
  const seriesSort = isSeriesSortMode(rawSsort) ? rawSsort : DEFAULT_SERIES_SORT;

  const rawTab = params.get("tab");
  const tab = rawTab && VALID_TABS.includes(rawTab as InfoTab) ? (rawTab as InfoTab) : null;

  // Clamped rather than snapped to a rung: the pills are the common way in, but
  // the tuning panel's speed slider is finer than they are and a link has to be
  // able to say what it is actually running. The control highlights the nearest
  // pill either way.
  const rawSpeed = Number(params.get("vizspeed"));
  const vizSpeed =
    Number.isFinite(rawSpeed) && rawSpeed > 0
      ? Math.min(VIZ_MAX_SPEED, Math.max(VIZ_MIN_SPEED, rawSpeed))
      : null;

  return {
    filters,
    sort,
    tab,
    view,
    seriesSort,
    viz: params.get("viz") === "1",
    vizPreset: params.get("vizpreset"),
    vizSpeed,
    vizCfg: params.get("vizcfg"),
  };
}

/** Visualizer params, carried across unrelated URL updates. `vizseed` and
 *  `vizdebug` are read straight off the URL by the overlay, so losing them on a
 *  filter change would silently drop a run someone was replaying. */
const VIZ_KEYS = ["viz", "vizpreset", "vizspeed", "vizcfg", "vizseed", "vizdebug"] as const;

function buildParams(
  filters: Filters,
  sort: SortMode,
  tab: InfoTab | null,
  view: GalleryView,
  seriesSort: SeriesSortMode,
  carried: URLSearchParams
): string {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const values = Array.from(filters[key]);
    if (values.length > 0) {
      params.set(key, values.join(","));
    }
  }

  if (filters.searchQuery.trim()) {
    params.set("q", filters.searchQuery);
  }

  if (sort !== DEFAULT_SORT) {
    params.set("sort", sort);
  }

  if (tab) {
    params.set("tab", tab);
  }

  // Both omitted at their defaults, the way `sort=newest` is.
  if (view !== DEFAULT_VIEW) {
    params.set("view", view);
  }
  if (seriesSort !== DEFAULT_SERIES_SORT) {
    params.set("ssort", seriesSort);
  }

  // A visualizer run composes with the active filters, so both sets of params
  // have to survive each other's updates for the URL to stay linkable.
  for (const key of VIZ_KEYS) {
    const value = carried.get(key);
    if (value) params.set(key, value);
  }

  return params.toString();
}

/** What a running visualizer puts in the URL: the preset by name, the rate, and
 *  — when the reader has tuned it — everything else, encoded by `vizUrl`. */
export interface VizRunParams {
  preset?: string | null;
  speed?: number;
  cfg?: string | null;
}

function pushURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const syncToURL = useCallback(
    (
      filters: Filters,
      sort: SortMode,
      view: GalleryView,
      seriesSort: SeriesSortMode,
      tab?: InfoTab | null
    ) => {
      const params = new URLSearchParams(window.location.search);
      // preserve the current tab param if not explicitly provided
      const currentTab = tab !== undefined ? tab : (params.get("tab") as InfoTab | null);
      pushURL(buildParams(filters, sort, currentTab, view, seriesSort, params));
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

  const syncViz = useCallback((open: boolean, run: VizRunParams = {}) => {
    const params = new URLSearchParams(window.location.search);
    if (open) {
      params.set("viz", "1");
      // Always named, even under a custom config: the preset is the base the
      // `vizcfg` delta is read against, as well as the readable half of the link.
      if (run.preset) params.set("vizpreset", run.preset);
      else params.delete("vizpreset");
      // Both of the rest are only carried when they say something the preset
      // does not, so the common case leaves the URL as short as it was before
      // either existed.
      if (run.speed !== undefined && run.speed !== 1) {
        params.set("vizspeed", String(Number(run.speed.toFixed(2))));
      } else {
        params.delete("vizspeed");
      }
      if (run.cfg) params.set("vizcfg", run.cfg);
      else params.delete("vizcfg");
    } else {
      params.delete("viz");
      params.delete("vizpreset");
      params.delete("vizspeed");
      params.delete("vizcfg");
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, []);

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    initialTab: initial.tab,
    initialView: initial.view,
    initialSeriesSort: initial.seriesSort,
    initialViz: initial.viz,
    initialVizPreset: initial.vizPreset,
    initialVizSpeed: initial.vizSpeed,
    initialVizCfg: initial.vizCfg,
    syncToURL,
    syncTab,
    syncViz,
  };
}