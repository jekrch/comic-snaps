import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ZoomIn, ZoomOut, GitGraph, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { ImageViewer } from "@jekrch/react-viewport-lightbox";
import type { Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { setHatchViewerOpen } from "../hooks/useHatchPause";
import { useMetadata } from "../hooks/useMetadata";
import SimilarityGraph from "./graph/SimilarityGraph";
import InfoDrawer from "./InfoDrawer";

interface Props {
  panel: Panel;
  panels: Panel[];
  allPanels: Panel[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectPanel: (panel: Panel) => void;
}

/**
 * Overlay content rendered inside the lightbox: the info drawer (slides up,
 * pushing the image up) and the similarity graph (slides down, pushing the
 * image down). Lives in its own component so it can call `setContentShift`
 * from an effect — that hook is only available on the viewer context handed to
 * render slots.
 */
function ViewerOverlay({
  panel,
  panels,
  allPanels,
  drawerOpen,
  graphOpen,
  drawerSlideDir,
  graphSlideDir,
  graphToolbarEl,
  topOffset,
  bottomOffset,
  closing,
  onSelectPanel,
  setContentShift,
}: {
  panel: Panel;
  panels: Panel[];
  allPanels: Panel[];
  drawerOpen: boolean;
  graphOpen: boolean;
  drawerSlideDir: "left" | "right" | null;
  graphSlideDir: "left" | "right" | null;
  graphToolbarEl: HTMLElement | null;
  topOffset: number;
  bottomOffset: number;
  closing: boolean;
  onSelectPanel: (panel: Panel) => void;
  setContentShift: (transform: string | null, animate?: boolean) => void;
}) {
  const { artist, series, parentSeries } = useMetadata(panel.artist, panel.slug);

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${panel.title} ${formatIssue(panel.issue)} ${panel.year} ${panel.artist}`
  )}`;

  // Push the image track out of the way for whichever overlay is open: up for
  // the drawer (slides from the bottom), down for the graph (slides from the
  // top). The shared-element close/collapse still measures the resting image,
  // so reset to center before the viewer tears down.
  useEffect(() => {
    if (drawerOpen) setContentShift("translateY(-100vh)");
    else if (graphOpen) setContentShift("translateY(100vh)");
    else setContentShift(null);
  }, [drawerOpen, graphOpen, setContentShift]);

  return (
    <>
      <InfoDrawer
        open={drawerOpen}
        closing={closing}
        panel={panel}
        allPanels={allPanels}
        onSelectPanel={onSelectPanel}
        artist={artist}
        series={series}
        parentSeries={parentSeries}
        searchUrl={searchUrl}
        topOffset={topOffset}
        bottomOffset={bottomOffset}
        slideDir={drawerSlideDir}
      />

      <SimilarityGraph
        panel={panel}
        allPanels={panels}
        open={graphOpen}
        closing={closing}
        topOffset={topOffset}
        bottomOffset={bottomOffset}
        toolbarContainer={graphToolbarEl}
        slideDir={graphSlideDir}
      />
    </>
  );
}

export default function PanelViewer({
  panel,
  panels,
  allPanels,
  currentIndex,
  onClose,
  onNavigate,
  onSelectPanel,
}: Props) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSlideDir, setDrawerSlideDir] = useState<"left" | "right" | null>(null);
  const [graphSlideDir, setGraphSlideDir] = useState<"left" | "right" | null>(null);
  const [graphToolbarEl, setGraphToolbarEl] = useState<HTMLElement | null>(null);

  // Drawer is only offered when there's artist/series metadata to show.
  const { hasContent } = useMetadata(panel.artist, panel.slug);

  const items = useMemo(
    () =>
      panels.map((p) => ({
        id: p.id,
        src: `${import.meta.env.BASE_URL}${p.image}`,
        alt: `${p.title} ${formatIssue(p.issue)}`,
      })),
    [panels]
  );

  const overlayOpen = drawerOpen || graphOpen;

  // Shared-element open/close: expand from (and collapse back into) the gallery
  // card with the matching id. Offscreen cards return their (offscreen) rect and
  // the library falls back to a plain fade, so this is safe after deep nav.
  // While an overlay is open the image stage is shifted off-screen, so its rect
  // no longer matches the thumbnail — return null to fall back to a fade close.
  const getOriginRect = useCallback(
    (i: number) => {
      if (overlayOpen) return null;
      const it = items[i];
      if (!it) return null;
      const el = document.querySelector(`[data-panel-id="${CSS.escape(it.id)}"]`);
      return el ? el.getBoundingClientRect() : null;
    },
    [items, overlayOpen]
  );

  // Pause the background hatch animation while the viewer owns the screen.
  useEffect(() => {
    setHatchViewerOpen(true);
    return () => setHatchViewerOpen(false);
  }, []);

  // Keep the open panel id in the URL so the viewer is linkable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("panel", panel.id);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);

    return () => {
      const p = new URLSearchParams(window.location.search);
      if (p.get("panel") === panel.id) {
        p.delete("panel");
        const q = p.toString();
        window.history.replaceState(null, "", q ? `${window.location.pathname}?${q}` : window.location.pathname);
      }
    };
  }, [panel.id]);

  // Close any open overlay when the panel changes, then clear the slide
  // direction once the slide-out has settled.
  useEffect(() => {
    setDrawerOpen(false);
    setGraphOpen(false);
    const t = setTimeout(() => {
      setDrawerSlideDir(null);
      setGraphSlideDir(null);
    }, 450);
    return () => clearTimeout(t);
  }, [currentIndex]);

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((d) => {
      if (!d) setGraphOpen(false);
      return !d;
    });
  }, []);

  const toggleGraph = useCallback(() => {
    setGraphOpen((g) => {
      if (!g) setDrawerOpen(false);
      return !g;
    });
  }, []);

  // Slide the open overlay out horizontally in sync with the image as it
  // navigates (fires before the slide + index change).
  const handleViewerNavigate = useCallback(
    (dir: "prev" | "next") => {
      const slideOut = dir === "next" ? "left" : "right";
      if (drawerOpen) {
        setDrawerSlideDir(slideOut);
        setDrawerOpen(false);
      }
      if (graphOpen) {
        setGraphSlideDir(slideOut);
        setGraphOpen(false);
      }
    },
    [drawerOpen, graphOpen]
  );

  // Esc closes the graph, then the drawer, then (default) the viewer.
  const handleEscape = useCallback(() => {
    if (graphOpen) {
      setGraphOpen(false);
      return true;
    }
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    return false;
  }, [graphOpen, drawerOpen]);

  return (
    <ImageViewer
      items={items}
      index={currentIndex}
      onIndexChange={onNavigate}
      onNavigate={handleViewerNavigate}
      onClose={onClose}
      onEscape={handleEscape}
      getOriginRect={getOriginRect}
      disableNavigation={graphOpen}
      navSlotPlacement="inline"
      showZoomControls={!overlayOpen}
      closeOnBackdropClick={!overlayOpen}
      ariaLabel={`${panel.title} ${formatIssue(panel.issue)} — full view`}
      icons={{
        close: <X size={16} strokeWidth={1.5} />,
        zoomIn: <ZoomIn size={16} strokeWidth={1.5} />,
        zoomOut: <ZoomOut size={16} strokeWidth={1.5} />,
        prev: <ChevronLeft size={38} strokeWidth={1.5} />,
        next: <ChevronRight size={38} strokeWidth={1.5} />,
      }}
      renderHeader={() =>
        graphOpen ? (
          // Portal target for the graph's toolbar (replaces the title while open).
          <div ref={setGraphToolbarEl} className="min-w-0 flex-1 flex items-center" />
        ) : (
          <div className="min-w-0">
            <p className="font-display text-sm text-white/90 leading-snug">
              {panel.title} <span className="text-accent">{formatIssue(panel.issue)}</span>{" "}
              <span className="text-white/40 text-xs">({panel.year})</span>
            </p>
            <p className="text-xs text-white/60 mt-0.5 leading-snug">{panel.artist}</p>
            <p className="text-[10px] text-white/30 mt-1 leading-snug whitespace-nowrap">
              {panel.postedBy} ·{" "}
              {new Date(panel.addedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        )
      }
      renderNavStart={
        hasContent
          ? () => (
              <button
                type="button"
                onClick={toggleDrawer}
                className={`rvl-btn ${drawerOpen ? "is-active" : ""}`}
                title="Show details"
                aria-label="Show details"
              >
                <Info size={16} strokeWidth={1.5} />
              </button>
            )
          : undefined
      }
      renderNavEnd={() => (
        <button
          type="button"
          onClick={toggleGraph}
          className={`rvl-btn ${graphOpen ? "is-active" : ""}`}
          title="Similarity graph"
          aria-label="Similarity graph"
        >
          <GitGraph size={16} strokeWidth={1.5} />
        </button>
      )}
      renderFooter={
        items.length <= 1
          ? (ctx) => (
              <div className="rvl-hint">
                <span>
                  {ctx.isTouchDevice
                    ? "pinch to zoom · double-tap to enlarge"
                    : "scroll to zoom · double-click to enlarge · esc to close"}
                </span>
              </div>
            )
          : undefined
      }
      renderOverlay={(ctx) => (
        <ViewerOverlay
          panel={panel}
          panels={panels}
          allPanels={allPanels}
          drawerOpen={drawerOpen}
          graphOpen={graphOpen}
          drawerSlideDir={drawerSlideDir}
          graphSlideDir={graphSlideDir}
          graphToolbarEl={graphToolbarEl}
          topOffset={ctx.topBarHeight}
          bottomOffset={ctx.bottomBarHeight}
          closing={ctx.closing}
          onSelectPanel={onSelectPanel}
          setContentShift={ctx.setContentShift}
        />
      )}
    />
  );
}
