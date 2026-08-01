import { useEffect, useState, useMemo, useCallback, useRef, lazy, Suspense } from "react";
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
import type { BirdHandle } from "./components/BirdIcon";
import PanelViewer from "./components/PanelViewer";
import VizLaunchModal from "./components/viz/VizLaunchModal";
import VizThought from "./components/viz/VizThought";
import type { VizLaunchOptions } from "./components/viz/VizLaunchModal";
import { findPreset, initialPresetId, presetConfig } from "./components/viz/vizPresets";
import { decodeVizConfig, diffConfigJson, encodeVizConfig } from "./components/viz/vizUrl";
import type { VizConfig } from "./components/viz/vizConfig";

// The visualizer drags in the whole WebGL engine, so it stays out of the
// gallery's first paint and loads on launch instead.
const VisualizerOverlay = lazy(() => import("./components/viz/VisualizerOverlay"));

export default function App() {
  const birdRef = useRef<BirdHandle>(null);
  /** The bird has finished its intro hop, so its thought can form. */
  const [birdLanded, setBirdLanded] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const {
    initialFilters,
    initialSort,
    initialTab,
    initialViz,
    initialVizPreset,
    initialVizSpeed,
    initialVizCfg,
    syncToURL,
    syncTab,
    syncViz,
  } = useFilterParams();
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
  // The launch button opens a chooser; a `?viz=1` link skips it and runs the
  // preset the URL names, since the link already carries the choice.
  const [vizPrompt, setVizPrompt] = useState(false);
  const [vizRun, setVizRun] = useState<VizLaunchOptions | null>(() => {
    if (!initialViz) return null;
    // An unnamed preset still honours prefers-reduced-motion, and a name that
    // does not resolve falls back rather than being echoed into the run.
    const preset = findPreset(initialVizPreset ?? initialPresetId());
    const base = presetConfig(preset.id);
    // The delta is read against that preset, so an unreadable one — a truncated
    // paste, a token from a build that has since retired a tunable — lands on
    // the plain preset rather than on half a look nobody chose.
    const tuned = initialVizCfg ? decodeVizConfig(initialVizCfg, base) : null;
    const config = tuned ?? base;
    if (initialVizSpeed !== null) config.speed = initialVizSpeed;
    return {
      presetId: preset.id,
      config,
      fullscreen: false,
      pinLabel: false,
      custom: tuned !== null,
    };
  });

  /** True once the run is behind a still of itself and on its way out. */
  const [vizLeaving, setVizLeaving] = useState(false);
  /**
   * True once the run's arrival fade has landed. The chooser is left standing
   * through that fade — the run comes up over it rather than replacing it — and
   * is only taken out of the paint once there is a run in front of it to hide
   * behind.
   */
  const [vizCovered, setVizCovered] = useState(false);

  const handleOpenViz = useCallback(() => setVizPrompt(true), []);

  /**
   * The URL for a run: the preset by name, plus the delta from it when the
   * reader has tuned it. Everything that reaches this goes through the same
   * encode, so what the address bar says is always the run that is on screen —
   * which is the whole point of `vizcfg`.
   */
  const syncVizRun = useCallback(
    (presetId: string, config: VizConfig) => {
      const cfg = encodeVizConfig(config, presetConfig(presetId));
      syncViz(true, { preset: presetId, speed: config.speed, cfg });
      return cfg;
    },
    [syncViz]
  );

  const handleStartViz = useCallback(
    (options: VizLaunchOptions) => {
      const cfg = syncVizRun(options.presetId, options.config);
      setVizLeaving(false);
      setVizCovered(false);
      // The chooser is left open behind the run — the run fades up over it, and
      // leaving the run drops the reader back onto it with their preset, config
      // and speed still selected.
      setVizRun({ ...options, custom: cfg !== null });
    },
    [syncVizRun]
  );

  // Speed can change mid-run from the chrome, so it is kept in step rather than
  // going stale the moment it is touched.
  const handleVizSpeedChange = useCallback(
    (speed: number) => {
      if (!vizRun) return;
      const config = { ...vizRun.config, speed };
      syncVizRun(vizRun.presetId, config);
      // Also folded back into the run so the rate survives a remount of the
      // overlay, which rebuilds its working config from this prop.
      setVizRun({ ...vizRun, config });
    },
    [syncVizRun, vizRun]
  );

  // And for everything else, from the tuning panel. Arrives already debounced by
  // the overlay — a slider drag is a hundred of these — and carries the whole
  // working config, so the encode below decides on its own whether the run is
  // still the plain preset.
  const handleVizConfigChange = useCallback(
    (config: VizConfig) => {
      if (!vizRun) return;
      const cfg = syncVizRun(vizRun.presetId, config);
      setVizRun({ ...vizRun, config, custom: cfg !== null });
    },
    [syncVizRun, vizRun]
  );

  // Same deal for the mode: switching mid-run replaces the config the overlay
  // eases across to, and a run that started from a tuned config stops claiming
  // to be custom the moment a preset is chosen over it.
  const handleVizPresetChange = useCallback(
    (presetId: string) => {
      if (!vizRun) return;
      const config = { ...presetConfig(presetId), speed: vizRun.config.speed };
      setVizRun({ ...vizRun, presetId, custom: false, config });
      syncVizRun(presetId, config);
    },
    [syncVizRun, vizRun]
  );

  // What the running config departs from its preset by, as JSON. Handed to the
  // chooser so a tuned run — one that arrived on a link, or was tuned in place —
  // is legible and editable there rather than only encoded in the URL, and so
  // leaving the run and starting it again keeps the tuning.
  const vizCustomJson = useMemo(
    () => (vizRun?.custom ? diffConfigJson(vizRun.config, presetConfig(vizRun.presetId)) : null),
    [vizRun]
  );

  const handleCloseViz = useCallback(() => {
    setVizRun(null);
    syncViz(false);
    setVizLeaving(false);
    setVizCovered(false);
  }, [syncViz]);

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
  // return to the top of the masonry. A run is left as well — the destination
  // is the grid, which a full-screen visualizer would be sitting on top of.
  const handleBrowseBy = useCallback(
    (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => {
      const next: Filters = { ...EMPTY_FILTERS, [dimension]: new Set([value]) };
      handleFiltersChange(next);
      setOpenPanelId(null);
      setViewerScope("filtered");
      setCustomViewerPanels(null);
      handleCloseViz();
      setVizPrompt(false);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [handleCloseViz, handleFiltersChange]
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
            <BirdIcon ref={birdRef} onIntroComplete={() => setBirdLanded(true)} />
            {/* The thought only forms once the bird has settled — a balloon
                trailing off a bird still mid-hop reads as two unrelated things
                that happen to be animating. */}
            {status === "ready" && (
              <VizThought
                landed={birdLanded}             
                onLaunch={handleOpenViz}
                onNudge={() => birdRef.current?.peck()}
              />
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleOpenInfo("about")}
              className="stroke-ink/80 transition-colors cursor-pointer p-3 -m-2 -mr-1"
              title="About"
            >
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
              onLaunchViz={handleOpenViz}
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
          overViz={vizRun !== null}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateViewer}
          onSelectPanel={handleSelectPanel}
          onBrowse={handleBrowseBy}
        />
      )}

      {vizPrompt && status === "ready" && (
        <VizLaunchModal
          panelCount={sortedPanels.length}
          initialSpeed={initialVizSpeed}
          behind={vizRun !== null && !vizLeaving}
          covered={vizRun !== null && !vizLeaving && vizCovered}
          runPresetId={vizRun?.presetId ?? null}
          runCustomJson={vizCustomJson}
          onStart={handleStartViz}
          onCancel={() => setVizPrompt(false)}
        />
      )}

      {vizRun && status === "ready" && (
        <Suspense
          /* Nothing: the run fades up over what the reader is already looking at
             — the chooser, or the wall — and a black sheet thrown up while the
             engine's chunk lands would be the cut that fade exists to avoid, on
             the one launch that has to fetch it, which is the launch the reader
             sees first. Left to itself, the chooser simply stays up a moment
             longer and the run arrives over it whenever it is ready. */
          fallback={null}
        >
          <VisualizerOverlay
            panels={sortedPanels}
            config={vizRun.config}
            presetId={vizRun.custom ? null : vizRun.presetId}
            fullscreen={vizRun.fullscreen}
            pinLabel={vizRun.pinLabel}
            onPresetChange={handleVizPresetChange}
            onSpeedChange={handleVizSpeedChange}
            onConfigChange={handleVizConfigChange}
            /* The pinned label can hand a panel straight to the viewer, which
               opens on top of the run rather than in place of it: the
               composition keeps playing behind the lightbox and is still there
               when the panel is closed. */
            onOpenPanel={handleSelectPanel}
            viewerOpen={openIndex >= 0}
            onCovered={() => setVizCovered(true)}
            onLeaving={() => setVizLeaving(true)}
            onClose={handleCloseViz}
          />
        </Suspense>
      )}
    </div>
  );
}