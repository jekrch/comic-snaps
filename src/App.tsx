import { useEffect, useState, useMemo, useCallback } from "react";
import type { Gallery, Panel } from "./types";
import { SortMode, sortPanelsAsync } from "./sorting.ts";
import type { Filters } from "./filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import InfoModal from "./components/InfoModal";
import type { InfoTab } from "./components/InfoModal";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
import { Menu } from "lucide-react";
import { useFilterParams } from "./hooks/useFilterParams";

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const { initialFilters, initialSort, initialTab, syncToURL, syncTab } = useFilterParams();
  const [showInfo, setShowInfo] = useState<InfoTab | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sortedPanels, setSortedPanels] = useState<Panel[]>([]);

  // Defer URL-driven modal open so the mount animation plays
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

  // fetch gallery data
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

  // preload images with a timeout fallback
  useEffect(() => {
    if (status !== "ready" || panels.length === 0) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setImagesLoaded(true);
    }, 8000);

    const promises = panels.map(
      (panel) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `${import.meta.env.BASE_URL}${panel.image}`;
        })
    );

    Promise.all(promises).then(() => {
      if (!cancelled) {
        clearTimeout(timeout);
        setImagesLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [status, panels]);

  const filteredPanels = useMemo(
    () => applyFilters(panels, filters),
    [panels, filters]
  );

  useEffect(() => {
    let cancelled = false;
    sortPanelsAsync(filteredPanels, sortMode).then((result) => {
      if (!cancelled) {
        setSortedPanels(result);
      }
    });
    return () => { cancelled = true; };
  }, [filteredPanels, sortMode]);

  const showSpinner = status === "loading" || (status === "ready" && !imagesLoaded);

  return (
    <div className="min-h-screen bg-surface">
      {/* header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-bx border-ink-faint/30 pl-1!">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <h1 className="font-display font-bold text-xl tracking-tight text-ink ">
            COMIC SNAPS
          </h1>
          <button
            onClick={() => handleOpenInfo("about")}
            className="text-ink/80 hover:text-ink transition-colors cursor-pointer p-3 -m-2 -mr-1"
            title="About"
          >
            <Menu size={20} strokeWidth={1.5} className="hover:stroke-white/80" />
          </button>
        </div>
      </header>

      {/* content */}
      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {showSpinner && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && !showSpinner && <EmptyState />}
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