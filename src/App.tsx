import { useEffect, useState, useMemo, useCallback } from "react";
import type { Gallery, Panel } from "./types";
import { SortMode, sortPanelsAsync } from "./sorting.ts";
import type { Filters } from "./filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import InfoModal from "./components/InfoModal";
import type { InfoTab } from "./components/InfoModal";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
//import { Menu } from "lucide-react";
import { useFilterParams } from "./hooks/useFilterParams";

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

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/gallery.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<Gallery>;
      })
      .then((data) => {
        setPanels(data.panels);
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

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-bx border-ink-faint/30 pl-1!">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <h1 className="font-display font-bold text-xl tracking-tight text-ink">
            C0MIC SNAPS 
          </h1>
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
          onTabChange={handleTabChange}
          onClose={handleCloseInfo}
        />
      )}
    </div>
  );
}