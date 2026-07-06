import { useEffect, useState, useMemo, useCallback } from "react";
import type { Gallery, Panel } from "./types";
import { SortMode, sortPanelsAsync } from "./utils/sorting.ts";
import type { Filters } from "./utils/filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./utils/filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import BackgroundEchoes from "./components/BackgroundEchoes";
import InfoModal from "./components/InfoModal";
import type { InfoTab } from "./components/InfoModal";
import type { StatsFilterPatch } from "./components/stats/StatsTab";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
import { useFilterParams } from "./hooks/useFilterParams";
import { loadMetadata } from "./utils/metadata";
import BirdIcon from "./components/BirdIcon";
import PanelViewer from "./components/PanelViewer";

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const { initialFilters, initialSort, initialTab, syncToURL, syncTab } = useFilterParams();
  const [showInfo, setShowInfo] = useState<InfoTab | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sortedPanels, setSortedPanels] = useState<Panel[]>([]);
  const [panelPositions, setPanelPositions] = useState<{ panel: Panel; y: number; h: number }[]>([]);
  const [openPanelId, setOpenPanelId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("panel")
  );
  const [viewerScope, setViewerScope] = useState<"filtered" | "all" | "custom">("filtered");
  const [customViewerPanels, setCustomViewerPanels] = useState<Panel[] | null>(null);

  useEffect(() => {
    if (initialTab) {
      requestAnimationFrame(() => setShowInfo(initialTab));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiltersChange = useCallback(
    (next: Filters) => {
      setFilters(next);
      syncToURL(next, sortMode);
    },
    [sortMode, syncToURL]
  );

  const handleSortChange = useCallback(
    (next: SortMode) => {
      setSortMode(next);
      syncToURL(filters, next);
    },
    [filters, syncToURL]
  );

  const handleOpenInfo = useCallback(
    (tab: InfoTab = "about") => {
      setShowInfo(tab);
      syncTab(tab);
    },
    [syncTab]
  );

  const handleTabChange = useCallback(
    (tab: InfoTab) => {
      setShowInfo(tab);
      syncTab(tab);
    },
    [syncTab]
  );

  const handleCloseInfo = useCallback(() => {
    setShowInfo(null);
    syncTab(null);
  }, [syncTab]);

  // A clicked bar in the stats tab replaces the active filters with its own
  const handleStatsFilter = useCallback(
    (patch: StatsFilterPatch) => {
      const next: Filters = {
        decades: new Set(patch.decades ?? []),
        tags: new Set(patch.tags ?? []),
        artists: new Set(patch.artists ?? []),
        colorists: new Set(patch.colorists ?? []),
        letterers: new Set(patch.letterers ?? []),
        credits: new Set(patch.credits ?? []),
        postedBy: new Set(),
        series: new Set(patch.series ?? []),
      };
      setFilters(next);
      syncToURL(next, sortMode);
    },
    [sortMode, syncToURL]
  );

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/gallery.json`).then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<Gallery>;
      }),
      loadMetadata(),
    ])
      .then(([gallery, { artists, series, issues }]) => {
        const seriesTagMap = new Map<string, string[]>();
        for (const s of series) {
          if (s.tags?.length) seriesTagMap.set(s.id, s.tags);
        }
        const artistTagMap = new Map<string, string[]>();
        for (const a of artists) {
          if (a.tags?.length) artistTagMap.set(a.name, a.tags);
        }
        const creditMap = new Map<string, { colorists: string[]; letterers: string[]; names: string[] }>();
        for (const i of issues) {
          const colorists = i.credits.filter((c) => c.roles.includes("Colorist")).map((c) => c.name);
          const letterers = i.credits.filter((c) => c.roles.includes("Letterer")).map((c) => c.name);
          const names = Array.from(new Set(i.credits.map((c) => c.name)));
          if (colorists.length || letterers.length || names.length) {
            creditMap.set(`${i.series}|${i.issue}`, { colorists, letterers, names });
          }
        }

        const merged = gallery.panels.map((p) => {
          const extra = [
            ...(seriesTagMap.get(p.slug) ?? []),
            ...(artistTagMap.get(p.artist) ?? []),
          ];
          const credits = creditMap.get(`${p.slug}|${p.issue}`);
          if (extra.length === 0 && !credits) return p;
          return {
            ...p,
            ...(extra.length > 0 && { tags: Array.from(new Set([...(p.tags ?? []), ...extra])) }),
            ...(credits?.colorists.length && { colorists: credits.colorists }),
            ...(credits?.letterers.length && { letterers: credits.letterers }),
            ...(credits?.names.length && { credits: credits.names }),
          };
        });

        setPanels(merged);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const filteredPanels = useMemo(
    () => applyFilters(panels, filters),
    [panels, filters]
  );

  useEffect(() => {
    let cancelled = false;
    sortPanelsAsync(filteredPanels, sortMode).then((result) => {
      if (!cancelled) setSortedPanels(result);
    });
    return () => { cancelled = true; };
  }, [filteredPanels, sortMode]);

  const handleLayoutReady = useCallback(() => {
    setImagesLoaded(true);
    setIsFirstLoad(false);
  }, []);

  const handleOpenPanel = useCallback((panel: Panel) => {
    setViewerScope("filtered");
    setOpenPanelId(panel.id);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setOpenPanelId(null);
    setViewerScope("filtered");
    setCustomViewerPanels(null);
  }, []);

  const handleSelectPanel = useCallback(
    (panel: Panel, group?: Panel[]) => {
      // A related-panel group (e.g. a whole series or an artist's panels)
      // scopes prev/next to just that group via the custom list.
      if (group && group.length > 0) {
        setCustomViewerPanels(group);
        setViewerScope("custom");
        setOpenPanelId(panel.id);
        return;
      }
      const inFiltered = sortedPanels.some((p) => p.id === panel.id);
      setViewerScope(inFiltered ? "filtered" : "all");
      setOpenPanelId(panel.id);
    },
    [sortedPanels]
  );

  // Jump from a creator's profile to the gallery filtered to their work in a
  // single role: replace filters with just that facet, close the viewer, and
  // return to the top of the masonry.
  const handleBrowseBy = useCallback(
    (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => {
      const next: Filters = { ...EMPTY_FILTERS, [dimension]: new Set([value]) };
      handleFiltersChange(next);
      setOpenPanelId(null);
      setViewerScope("filtered");
      setCustomViewerPanels(null);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [handleFiltersChange]
  );

  const viewerPanels =
    viewerScope === "custom" && customViewerPanels
      ? customViewerPanels
      : viewerScope === "all"
        ? panels
        : sortedPanels;

  const handleNavigateViewer = useCallback(
    (idx: number) => {
      const target = viewerPanels[idx];
      if (target) setOpenPanelId(target.id);
    },
    [viewerPanels]
  );

  const openIndex = useMemo(() => {
    if (!openPanelId) return -1;
    return viewerPanels.findIndex((p) => p.id === openPanelId);
  }, [openPanelId, viewerPanels]);

  return (
    <div className="min-h-screen bg-surface relative">
      <BackgroundEchoes panelPositions={panelPositions} />
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-bx border-ink-faint/30 pl-1!">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <div className="flex items-center">
            <h1
              className="font-display font-bold text-xl tracking-tight text-ink cursor-pointer"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              C0MIC SNAPS
            </h1>
            <BirdIcon />
          </div>
          <button
            onClick={() => handleOpenInfo("about")}
            className="stroke-ink/80 transition-colors cursor-pointer p-3 -m-2 -mr-1"
            title="About"
          >
            {/* <Menu size={20} strokeWidth={1.5} className="hover:stroke-white/80" /> */}
            <svg
             className="hover:stroke-ink/80"  
              width={20}
              height={12}
              viewBox="0 0 22 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <line x1="1" y1="3" x2="21" y2="3" />
              <line x1="1" y1="13" x2="21" y2="13" />
            </svg>
          </button>
        </div>
      </header>

      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {(status === "loading" || (status === "ready" && !imagesLoaded)) && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && imagesLoaded && <EmptyState />}
        {status === "ready" && panels.length > 0 && (
          <div
            className="transition-opacity duration-700 ease-out"
            style={{ opacity: imagesLoaded ? 1 : 0 }}
          >
            <MasonryGrid
              panels={sortedPanels}
              allPanels={panels}
              sortMode={sortMode}
              onSort={handleSortChange}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onInfoOpen={() => handleOpenInfo("sorts")}
              onLayoutReady={handleLayoutReady}
              onPanelPositions={setPanelPositions}
              onOpenPanel={handleOpenPanel}
              isFirstLoad={isFirstLoad}
            />
            {hasActiveFilters(filters) && sortedPanels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-ink-muted text-sm font-display tracking-wide">
                  NO MATCHES
                </p>
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors font-display tracking-wider uppercase cursor-pointer"
                >
                  CLEAR FILTERS
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {showInfo && (
        <InfoModal
          initialTab={showInfo}
          panels={panels}
          onTabChange={handleTabChange}
          onClose={handleCloseInfo}
          onApplyFilters={handleStatsFilter}
        />
      )}

      {openIndex >= 0 && (
        <PanelViewer
          panel={viewerPanels[openIndex]}
          panels={viewerPanels}
          allPanels={panels}
          currentIndex={openIndex}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateViewer}
          onSelectPanel={handleSelectPanel}
          onBrowse={handleBrowseBy}
        />
      )}
    </div>
  );
}