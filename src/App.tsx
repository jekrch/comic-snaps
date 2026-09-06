import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import type { Artist, Gallery, IssueCredits, Panel, RatingsIndex, Series } from "./types";
import { SortMode, sortPanelsAsync } from "./utils/sorting.ts";
import type { Filters } from "./utils/filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./utils/filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import SeriesShelf from "./components/SeriesShelf";
import ArtistShelf from "./components/ArtistShelf";
import type { GalleryView } from "./components/ViewControl";
import { buildSeriesRows } from "./utils/seriesRollup";
import type { SeriesRow } from "./utils/seriesRollup";
import { sortSeriesRows } from "./utils/seriesSorting";
import type { SeriesSortMode } from "./utils/seriesSorting";
import { buildArtistRows } from "./utils/artistRollup";
import type { ArtistRow } from "./utils/artistRollup";
import { sortArtistRows } from "./utils/artistSorting";
import type { ArtistSortMode } from "./utils/artistSorting";
import { getCachedRatings, loadRatings } from "./utils/ratings";
import BackgroundEchoes from "./components/BackgroundEchoes";
import InfoModal from "./components/InfoModal";
import type { InfoTab } from "./components/InfoModal";
import type { StatsFilterPatch } from "./components/stats/StatsTab";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
import { useFilterParams } from "./hooks/useFilterParams";
import { isProductionOnly, loadMetadata } from "./utils/metadata";
import BirdIcon from "./components/BirdIcon";
import type { BirdHandle } from "./components/BirdIcon";
import PanelViewer from "./components/PanelViewer";
import VizLaunchModal from "./components/viz/VizLaunchModal";
import VizThought from "./components/viz/VizThought";
import type { VizLaunchOptions } from "./components/viz/VizLaunchModal";
import { findPreset, initialPresetId, presetConfig } from "./components/viz/vizPresets";
import { useLocalPhotos } from "./components/viz/localPhotos/useLocalPhotos";
import { decodeVizConfig, diffConfigJson, encodeVizConfig } from "./components/viz/vizUrl";
import type { VizConfig } from "./components/viz/vizConfig";

// The visualizer drags in the whole WebGL engine, so it stays out of the
// gallery's first paint and loads on launch instead.
const VisualizerOverlay = lazy(() => import("./components/viz/VisualizerOverlay"));

/**
 * How long the outgoing view has to clear out before the incoming one is
 * mounted. The two are never on screen together — only one of them holds
 * images at a time, by design (§7) — so the switch is sequential: out, swap,
 * in.
 *
 * It has to outlast the exit *and* the tail of its stagger, or the last few
 * objects are cut off mid-flight by the unmount. 150ms of travel plus five
 * steps of 14ms; both figures live in `.view-swap` in index.css, and the three
 * move together.
 */
const VIEW_LEAVE_MS = 220;

/** Read at click time, so the swap can skip its own timers rather than just
 *  its transitions — a zeroed CSS duration with a live timeout behind it is
 *  190ms of blank page. */
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * The elements both views claim as the same object: the filter card and the
 * sort card. The wall puts them in its first and last columns, the shelf lays
 * them out itself, but they are the same two cards holding the same state, and
 * the reader has no reason to believe otherwise — so on a switch they are not
 * crossed or repainted. They are moved.
 *
 * Neither view can do this alone: the outgoing copy is gone by the time the
 * incoming one exists, so the geometry has to be carried across the swap from
 * out here. It is a plain FLIP — measure before, measure after, start the new
 * copy at the old one's place and size, then let it run to its own.
 */
const PERSISTENT = "[data-persist]";
const CHROME_MS = 420;

function measurePersistent() {
  const rects = new Map<string, DOMRect>();
  for (const el of document.querySelectorAll<HTMLElement>(PERSISTENT)) {
    if (el.dataset.persist) rects.set(el.dataset.persist, el.getBoundingClientRect());
  }
  return rects;
}

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
    initialView,
    initialSeriesSort,
    initialArtistSort,
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
  // Three readings of the same filtered set: the wall, one row per series, one
  // row per artist. Every sort stays live across a toggle — a row sort orders
  // its own shelf, and the panel sort still orders the panels inside every
  // strip (docs/series-view-plan.md §1.6, §3.1).
  const [view, setView] = useState<GalleryView>(initialView);
  /**
   * Where the switch between the two readings currently is: "leaving" while the
   * old one is still mounted and on its way out, "entering" for the frame the
   * new one is painted in its offset start state, "idle" the rest of the time.
   */
  const [viewPhase, setViewPhase] = useState<"idle" | "leaving" | "entering">("idle");
  /** The pending swap's timer — also the guard that makes a second click while
   *  one is in flight a no-op rather than a second, overlapping switch. */
  const viewSwapRef = useRef<number | null>(null);
  /** Where the persistent cards were sitting in the view that is leaving. */
  const chromeRectsRef = useRef<Map<string, DOMRect> | null>(null);
  /** Timers that put the moved cards' own styles back once they have landed. */
  const chromeTimersRef = useRef<number[]>([]);
  const [seriesSort, setSeriesSort] = useState<SeriesSortMode>(initialSeriesSort);
  const [artistSort, setArtistSort] = useState<ArtistSortMode>(initialArtistSort);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  /** The metadata a row is assembled from, kept from the same boot fetch. */
  const [meta, setMeta] = useState<{ artists: Artist[]; series: Series[]; issues: IssueCredits[] }>({
    artists: [],
    series: [],
    issues: [],
  });
  const [ratings, setRatings] = useState<RatingsIndex | null>(getCachedRatings);
  const [sortedPanels, setSortedPanels] = useState<Panel[]>([]);
  const [panelPositions, setPanelPositions] = useState<{ panel: Panel; y: number; h: number }[]>([]);
  const [openPanelId, setOpenPanelId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("panel")
  );
  const [viewerScope, setViewerScope] = useState<"filtered" | "all" | "custom">("filtered");
  const [customViewerPanels, setCustomViewerPanels] = useState<Panel[] | null>(null);
  /** The viewer was opened *for* the details — a series row's title — so it
   *  comes up with the info drawer already out rather than on the bare image. */
  const [viewerInfo, setViewerInfo] = useState(false);
  /** …and for an artist row's name, the person whose profile it opens on. */
  const [viewerPerson, setViewerPerson] = useState<string | null>(null);
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
      // A link cannot carry somebody's photo folder — nothing about the local
      // set is written down, by design — so a run started from one is always
      // the gallery's.
      localPhotos: false,
      fullscreen: false,
      // A cold load has no click behind it, so a window opened here would be
      // blocked. The run starts in this one; the chrome's own button is a
      // gesture, and can send it out whenever the reader asks.
      showWindow: false,
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
  /**
   * A folder of the reader's own images, offered to the visualizer as an
   * alternative to the gallery. Held here rather than in the chooser because
   * the chooser unmounts on the way out and a run outlives it — and the `blob:`
   * URLs the run is drawing die the moment they are released.
   */
  const localPhotos = useLocalPhotos();

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
      syncToURL(next, sortMode, view, seriesSort, artistSort);
    },
    [artistSort, seriesSort, sortMode, syncToURL, view]
  );

  const handleSortChange = useCallback(
    (next: SortMode) => {
      setSortMode(next);
      syncToURL(filters, next, view, seriesSort, artistSort);
    },
    [artistSort, filters, seriesSort, syncToURL, view]
  );

  /**
   * The switch used to read as a cut: one tree unmounted, the other mounted a
   * frame later, and the page blinked — with the jump home landing in the
   * middle of it. It is staged now, and the staging is the objects' own: the
   * cards gather off the left rail, the rows are dealt back in from it (see
   * `.view-swap` in index.css). All this holds is the clock — the phase the
   * views read their motion from, and the gap between the two halves where the
   * swap and the scroll home happen unseen.
   */
  const handleViewChange = useCallback(
    (next: GalleryView) => {
      if (next === view || viewSwapRef.current !== null) return;

      const commit = () => {
        viewSwapRef.current = null;
        setView(next);
        syncToURL(filters, sortMode, next, seriesSort, artistSort);
        // The echoes are a wall texture, driven by the masonry's layout pass.
        // Nothing reports positions from the shelf, so the last wall's are
        // cleared rather than left hanging behind a different rhythm (§5.3).
        if (next !== "wall") setPanelPositions([]);
        window.scrollTo({ top: 0, behavior: "auto" });
      };

      if (prefersReducedMotion()) {
        commit();
        return;
      }

      // Taken now, while the old layout still holds them. Only from the top of
      // the page: further down the two cards are off screen, the switch jumps
      // home anyway, and there is nothing on screen to carry across.
      chromeRectsRef.current = window.scrollY < 8 ? measurePersistent() : null;

      setViewPhase("leaving");
      viewSwapRef.current = window.setTimeout(() => {
        commit();
        setViewPhase("entering");
      }, VIEW_LEAVE_MS);
    },
    [artistSort, filters, seriesSort, sortMode, syncToURL, view]
  );

  // The incoming view has to be painted once with its objects still off the
  // rail before the class comes off, or the browser has nothing to transition
  // from and the arrival is the same cut as before. Two frames: one to paint,
  // one to be sure it landed. Layout is already settled by then — both views
  // place themselves in a layout effect, so the first painted frame is the
  // real geometry, which is what the stagger is computed from.
  useEffect(() => {
    if (viewPhase !== "entering") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setViewPhase("idle"));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [viewPhase]);

  // The moved cards, picked up where the other view left them. This runs
  // before the browser paints — a layout effect, not an effect — because the
  // whole point is that the new copy is never seen anywhere but the old one's
  // place. Everything here is written straight to the DOM: the elements belong
  // to whichever view just mounted, the styles live for one animation, and
  // rendering them through React would mean threading a measurement taken
  // during the *previous* view down into the one that replaced it.
  useLayoutEffect(() => {
    if (viewPhase !== "entering") return;
    const from = chromeRectsRef.current;
    chromeRectsRef.current = null;
    if (!from) return;

    for (const t of chromeTimersRef.current) window.clearTimeout(t);
    chromeTimersRef.current = [];

    let raf = 0;
    let dropped = false;

    // The view that just mounted measures itself in its own layout effect, and
    // React flushes the state that comes out of it after this one has run — so
    // the DOM here is still a column width short of its real geometry. A
    // microtask puts this at the end of the same commit instead: everything
    // settled, and still nothing painted.
    queueMicrotask(() => {
      if (dropped) return;
      const moved: { el: HTMLElement; width: number; prev: Record<string, string> }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(PERSISTENT)) {
        const was = el.dataset.persist ? from.get(el.dataset.persist) : undefined;
        if (!was) continue;
        const now = el.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        const dw = was.width - now.width;
        // A card the two layouts happen to agree about is left alone rather
        // than handed a transition with nothing to travel.
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dw) < 1) continue;

        // Whatever the view had set itself — the wall sizes its columns inline,
        // the shelf sizes its own in a class — is put back at the end, so this
        // borrows the element for the animation rather than taking it over.
        const prev = {
          transition: el.style.transition,
          transform: el.style.transform,
          width: el.style.width,
        };
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.width = `${was.width}px`;
        moved.push({ el, width: now.width, prev });
      }
      if (moved.length === 0) return;

      // One frame with the start state on it, then let go — the same reason the
      // arriving cards and rows need theirs painted before their class comes
      // off.
      raf = requestAnimationFrame(() => {
        for (const { el, width } of moved) {
          el.style.transition = `transform ${CHROME_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1), width ${CHROME_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
          el.style.transform = "";
          el.style.width = `${width}px`;
        }
        chromeTimersRef.current.push(
          window.setTimeout(() => {
            for (const { el, prev } of moved) {
              el.style.transition = prev.transition;
              el.style.transform = prev.transform;
              el.style.width = prev.width;
            }
          }, CHROME_MS)
        );
      });
    });

    return () => {
      dropped = true;
      cancelAnimationFrame(raf);
    };
  }, [viewPhase]);

  useEffect(
    () => () => {
      if (viewSwapRef.current !== null) window.clearTimeout(viewSwapRef.current);
      for (const t of chromeTimersRef.current) window.clearTimeout(t);
    },
    []
  );

  const handleSeriesSortChange = useCallback(
    (next: SeriesSortMode) => {
      setSeriesSort(next);
      syncToURL(filters, sortMode, view, next, artistSort);
    },
    [artistSort, filters, sortMode, syncToURL, view]
  );

  const handleArtistSortChange = useCallback(
    (next: ArtistSortMode) => {
      setArtistSort(next);
      syncToURL(filters, sortMode, view, seriesSort, next);
    },
    [filters, seriesSort, sortMode, syncToURL, view]
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
        ...EMPTY_FILTERS,
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
      syncToURL(next, sortMode, view, seriesSort, artistSort);
    },
    [artistSort, seriesSort, sortMode, syncToURL, view]
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
          // Cover artists and editors are on the issue, not in the panel —
          // they are left out so the facet and the text search stay a list of
          // people who made what is on the wall (see `isProductionOnly`).
          const names = Array.from(
            new Set(i.credits.filter((c) => !isProductionOnly(c)).map((c) => c.name))
          );
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
        // The rows are assembled from the same three bundles the wall already
        // fetches at boot — nothing in the series view needs a new request.
        setMeta({ artists, series, issues });
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  // `loadRatings` caches module-side and falls back to an empty index when the
  // file does not exist yet, so this can run unconditionally on mount.
  useEffect(() => {
    let cancelled = false;
    loadRatings().then((loaded) => {
      if (!cancelled) setRatings(loaded);
    });
    return () => { cancelled = true; };
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

  // One row per slug over the *filtered* set, in the active panel order — so a
  // filter narrows both which rows appear and which panels tease inside them,
  // and switching the panel sort reorders every strip (§1.6, §4).
  const seriesRows = useMemo<SeriesRow[]>(
    () =>
      view === "series" ? sortSeriesRows(buildSeriesRows(sortedPanels, meta, ratings), seriesSort) : [],
    [view, sortedPanels, meta, ratings, seriesSort]
  );

  // One row per artist over the same filtered set, in the same active panel
  // order. Built only for the view that is up: a row holds a dozen lazy-load
  // observers, and the two shelves are never on screen together.
  const artistRows = useMemo<ArtistRow[]>(
    () =>
      view === "artists"
        ? sortArtistRows(buildArtistRows(sortedPanels, meta), artistSort)
        : [],
    [view, sortedPanels, meta, artistSort]
  );

  // The guard lives here rather than per view, so toggling never re-arms the
  // page's opening fade (§5.3).
  const layoutReadyRef = useRef(false);
  const handleLayoutReady = useCallback(() => {
    if (layoutReadyRef.current) return;
    layoutReadyRef.current = true;
    setImagesLoaded(true);
    setIsFirstLoad(false);
    // The page's first sight of the gallery is an arrival like any other, so it
    // gets the same one: the cards come in off the left rail rather than simply
    // being there once the fade is over. Set here rather than in an effect on
    // `imagesLoaded` so it lands in the same commit — a frame later, the
    // objects would be painted at rest first and have to jump back to the rail
    // to start.
    if (!prefersReducedMotion()) setViewPhase("entering");
  }, []);

  const handleOpenPanel = useCallback((panel: Panel) => {
    setViewerScope("filtered");
    setViewerInfo(false);
    setViewerPerson(null);
    setOpenPanelId(panel.id);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setOpenPanelId(null);
    setViewerScope("filtered");
    setCustomViewerPanels(null);
    setViewerInfo(false);
    setViewerPerson(null);
  }, []);

  const handleSelectPanel = useCallback(
    (panel: Panel, group?: Panel[], opts?: { info?: boolean; person?: string }) => {
      setViewerInfo(!!opts?.info);
      // An artist row's name opens on the person rather than on the panel's own
      // card — the profile is where their portrait, dates and work in every
      // role already live.
      setViewerPerson(opts?.person ?? null);
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

  /**
   * The other jump a row offers: from an artist's rail to one of the books
   * they are on. Every spelling of the title the wall carries is passed, since
   * `Filters.series` matches on the panel's own `title` and one slug already
   * carries two of them (§9).
   *
   * It narrows in place rather than changing view, which is what every other
   * jump off a row does: the roster filtered to one book is every artist on
   * it, which is this view's own answer to the question and a better one than
   * silently moving the reader somewhere else.
   */
  const handleBrowseSeries = useCallback(
    (titles: string[]) => {
      handleFiltersChange({ ...EMPTY_FILTERS, series: new Set(titles) });
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
            className="transition-opacity duration-500 ease-out"
            style={{ opacity: imagesLoaded ? 1 : 0 }}
          >
            {/* The view that is leaving is unmounted rather than hidden, so no
                two of them ever hold images in memory at once. It costs the
                wall's scroll position, which is the right trade at this size (§7).
                The wrapper carries no motion of its own — it only tells the
                cards and rows inside which half of the swap they are in. */}
            <div
              className={
                "view-swap" +
                (viewPhase === "leaving"
                  ? " is-leaving"
                  : viewPhase === "entering"
                    ? " is-entering"
                    : "")
              }
            >
              {view === "wall" ? (
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
                  view={view}
                  onViewChange={handleViewChange}
                />
              ) : view === "series" ? (
                <SeriesShelf
                  rows={seriesRows}
                  allPanels={panels}
                  sort={seriesSort}
                  onSort={handleSeriesSortChange}
                  view={view}
                  onViewChange={handleViewChange}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onSelectPanel={handleSelectPanel}
                  onBrowse={handleBrowseBy}
                  onLayoutReady={handleLayoutReady}
                  layoutReady={imagesLoaded}
                  onLaunchViz={handleOpenViz}
                />
              ) : (
                <ArtistShelf
                  rows={artistRows}
                  allPanels={panels}
                  sort={artistSort}
                  onSort={handleArtistSortChange}
                  view={view}
                  onViewChange={handleViewChange}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onSelectPanel={handleSelectPanel}
                  onBrowseSeries={handleBrowseSeries}
                  onLayoutReady={handleLayoutReady}
                  layoutReady={imagesLoaded}
                  onLaunchViz={handleOpenViz}
                />
              )}
            </div>
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
          openWithInfo={viewerInfo}
          openWithPerson={viewerPerson}
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
          photos={localPhotos}
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
            panels={vizRun.localPhotos ? (localPhotos.set?.panels ?? []) : sortedPanels}
            config={vizRun.config}
            presetId={vizRun.custom ? null : vizRun.presetId}
            fullscreen={vizRun.fullscreen}
            showWindow={vizRun.showWindow}
            pinLabel={vizRun.pinLabel}
            onPresetChange={handleVizPresetChange}
            onSpeedChange={handleVizSpeedChange}
            onConfigChange={handleVizConfigChange}
            /* The pinned label can hand a panel straight to the viewer, which
               opens on top of the run rather than in place of it: the
               composition keeps playing behind the lightbox and is still there
               when the panel is closed. Withheld on a local run — the viewer
               reads its prev/next off the wall, and the reader's own photos are
               not on it. */
            onOpenPanel={vizRun.localPhotos ? undefined : handleSelectPanel}
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