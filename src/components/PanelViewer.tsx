import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, GitGraph, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { ImageViewer, type ViewerRect } from "@jekrch/react-viewport-lightbox";
import type { Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import { setViewerOpen } from "../hooks/useViewerOpen";
import { useArtistIndex, useMetadata, useRatings } from "../hooks/useMetadata";
import SimilarityGraph from "./graph/SimilarityGraph";
import InfoDrawer from "./InfoDrawer";

interface Props {
  panel: Panel;
  panels: Panel[];
  allPanels: Panel[];
  currentIndex: number;
  /** Opened for the details rather than the art — the info drawer starts out. */
  openWithInfo?: boolean;
  /** Opened for a *person* — the drawer starts out with their profile over it. */
  openWithPerson?: string | null;
  /** Opened on top of a running visualizer, which keeps playing underneath. */
  overViz?: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
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
  allPanels,
  drawerOpen,
  initialPerson,
  graphOpen,
  drawerSlideDir,
  graphSlideDir,
  graphToolbarEl,
  topOffset,
  bottomOffset,
  closing,
  overViz,
  onSelectPanel,
  onBrowse,
  setContentShift,
}: {
  panel: Panel;
  allPanels: Panel[];
  drawerOpen: boolean;
  initialPerson: string | null;
  graphOpen: boolean;
  drawerSlideDir: "left" | "right" | null;
  graphSlideDir: "left" | "right" | null;
  graphToolbarEl: HTMLElement | null;
  topOffset: number;
  bottomOffset: number;
  closing: boolean;
  overViz: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  setContentShift: (transform: string | null, animate?: boolean) => void;
}) {
  const { artist, series, parentSeries, issueCredits } = useMetadata(panel.artist, panel.slug, panel.issue);
  const artistIndex = useArtistIndex();
  const { issue: issueRatings, series: seriesRatings } = useRatings(panel);

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${panel.title} ${formatIssue(panel.issue)} ${panel.year} ${panel.artist}`
  )}`;

  // Hand the page back the moment the close *starts*, rather than when the
  // viewer finally unmounts a quarter-second later: the gallery comes back
  // under a backdrop that is still up and fades out along with it, where
  // returning it on unmount would pop it in one frame after the backdrop had
  // already gone. A layout effect, and in the overlay rather than in
  // `PanelViewer` itself, so it lands before the viewer's own layout effects
  // measure the thumbnail the image collapses back into.
  useLayoutEffect(() => {
    if (closing) setViewerOpen(false);
  }, [closing]);

  // Push the image track out of the way for whichever overlay is open: up for
  // the drawer (slides from the bottom), down for the graph (slides from the
  // top). The shared-element close/collapse still measures the resting image,
  // so reset to center before the viewer tears down.
  // The very first placement snaps, in a layout effect: a viewer that opens
  // with the drawer already out is already where it belongs, and animating the
  // stage there would show the art for a beat and then slide it away.
  // Guarded on the shift last applied rather than a "have I placed" flag —
  // StrictMode runs mount effects twice, and the second pass re-sending the
  // same shift with `animate: true` is exactly what put the slide back: by
  // then the viewer's own layout effects have measured, so the stage has a
  // computed transform at rest for the transition to run from.
  const applied = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const shift = drawerOpen ? "translateY(-100vh)" : graphOpen ? "translateY(100vh)" : null;
    if (applied.current === shift) return;
    // Only a shift that is actually off-center needs snapping; a viewer opening
    // on the art is already centered, so it keeps the library's default and
    // never carries a `transition: none` into the first toggle.
    const snap = applied.current === undefined && shift !== null;
    applied.current = shift;
    setContentShift(shift, !snap);
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
        issueCredits={issueCredits}
        issueRatings={issueRatings}
        seriesRatings={seriesRatings}
        artistIndex={artistIndex}
        onBrowse={onBrowse}
        searchUrl={searchUrl}
        initialPerson={initialPerson}
        topOffset={topOffset}
        bottomOffset={bottomOffset}
        slideDir={drawerSlideDir}
        overViz={overViz}
      />

      {/* The graph always searches the whole library, never the group the
          viewer is paging through: a series opened off the shelf hands the
          viewer just that series, and neighbors drawn from it would only ever
          be the same book's other panels. */}
      <SimilarityGraph
        panel={panel}
        allPanels={allPanels}
        open={graphOpen}
        closing={closing}
        topOffset={topOffset}
        bottomOffset={bottomOffset}
        toolbarContainer={graphToolbarEl}
        slideDir={graphSlideDir}
        overViz={overViz}
      />
    </>
  );
}

/**
 * The rect the viewer's image flies out of, and collapses back into.
 *
 * A wall card shows the whole panel, so the card's own box is the right
 * target. A series tile is a *crop* — a clamped width with `object-fit: cover`
 * — and flying the uncropped image into that box squashes it for the length of
 * the animation, hardest on exactly the panels the crop works hardest on. So
 * where the thumbnail crops, hand back the rect the whole image would occupy
 * at the crop's own scale: the slice actually on screen still lines up with the
 * tile, and the flight stays in proportion the whole way.
 */
function originRect(el: HTMLElement): HTMLElement | ViewerRect {
  const img = el.querySelector("img");
  if (!img || getComputedStyle(img).objectFit !== "cover") return el;
  const { naturalWidth: iw, naturalHeight: ih } = img;
  const rect = el.getBoundingClientRect();
  if (!iw || !ih || !rect.width || !rect.height) return el;
  const scale = Math.max(rect.width / iw, rect.height / ih);
  const width = iw * scale;
  const height = ih * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

export default function PanelViewer({
  panel,
  panels,
  allPanels,
  currentIndex,
  openWithInfo = false,
  openWithPerson = null,
  overViz = false,
  onClose,
  onNavigate,
  onSelectPanel,
  onBrowse,
}: Props) {
  // Drawer is only offered when there's artist/series metadata to show.
  const { hasContent } = useMetadata(panel.artist, panel.slug);

  const [graphOpen, setGraphOpen] = useState(false);
  // A details-first open starts with the drawer already out rather than
  // sliding it up after the fact: coming off a series title, the art flashing
  // by on the way to the info is the jerk, not the point.
  const [drawerOpen, setDrawerOpen] = useState(openWithInfo && hasContent);
  const [drawerSlideDir, setDrawerSlideDir] = useState<"left" | "right" | null>(null);
  const [graphSlideDir, setGraphSlideDir] = useState<"left" | "right" | null>(null);
  const [graphToolbarEl, setGraphToolbarEl] = useState<HTMLElement | null>(null);

  const items = useMemo(
    () =>
      panels.map((p) => ({
        id: p.id,
        src: panelImageUrl(p.image),
        alt: `${p.title} ${formatIssue(p.issue)}`,
      })),
    [panels]
  );

  const overlayOpen = drawerOpen || graphOpen;

  // Shared-element open/close: expand from (and collapse back into) the wall
  // card or series tile carrying the matching id. Offscreen thumbnails return
  // their (offscreen) rect and the library falls back to a plain fade, so this
  // is safe after deep nav, and so is a viewer group wider than the strip it
  // was opened from.
  // While an overlay is open the image stage is shifted off-screen, so its rect
  // no longer matches the thumbnail — return null to fall back to a fade close.
  // Over the visualizer there is no visible card to fly from either: the run
  // covers the grid, so flying out of a hidden thumbnail would read as a jump
  // from nowhere.
  const getOrigin = useCallback(
    (i: number) => {
      if (overlayOpen || overViz) return null;
      const it = items[i];
      if (!it) return null;
      const el = document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(it.id)}"]`);
      return el ? originRect(el) : null;
    },
    [items, overlayOpen, overViz]
  );

  // Tell the page behind to go quiet while the viewer owns the screen: the
  // hatch stops animating and the series washes stop painting.
  useEffect(() => {
    setViewerOpen(true);
    return () => setViewerOpen(false);
  }, []);

  // Keep the open panel id in the URL so the viewer is linkable. Neither a
  // cover nor a portrait has an id the wall can resolve on a cold load, so
  // those clear the param instead of writing a link that would open on
  // nothing — and clearing it is also what takes the previous panel's id out
  // of the URL when you page onto one.
  const offWall = panel.cover || panel.portrait;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (offWall) params.delete("panel");
    else params.set("panel", panel.id);
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
  }, [panel.id, offWall]);

  // Close any open overlay when the panel changes, then clear the slide
  // direction once the slide-out has settled. Guarded on the index it last ran
  // for rather than a "have I mounted" flag: at mount there is nothing open to
  // close, and a flag is spent by the first of StrictMode's two mount passes,
  // so the second would shut the drawer a details-first open had just put up.
  const lastIndex = useRef(currentIndex);
  useEffect(() => {
    if (lastIndex.current === currentIndex) return;
    lastIndex.current = currentIndex;
    setDrawerOpen(false);
    setGraphOpen(false);
    const t = setTimeout(() => {
      setDrawerSlideDir(null);
      setGraphSlideDir(null);
    }, 450);
    return () => clearTimeout(t);
  }, [currentIndex]);

  /**
   * Opened for the details on a cold load, where the metadata had not landed
   * in time for the drawer to be out on the first render: it comes out on its
   * own as soon as there is something to show, since sliding an empty sheet up
   * over the panel is worse than a beat of delay. A series with no record at
   * all never gets one, the same way the Info button is never offered for it.
   */
  const wantInfo = useRef(openWithInfo && !drawerOpen);
  useEffect(() => {
    if (!wantInfo.current || !hasContent) return;
    wantInfo.current = false;
    setDrawerOpen(true);
  }, [hasContent]);

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
      wantInfo.current = false;
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
      getOrigin={getOrigin}
      disableNavigation={graphOpen}
      navSlotPlacement="inline"
      showZoomControls={!overlayOpen}
      closeOnBackdropClick={!overlayOpen}
      ariaLabel={`${panel.title} ${formatIssue(panel.issue)} — full view`}
      classNames={{ root: overViz ? "rvl-over-viz" : undefined }}
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
              {panel.year > 0 && <span className="text-white/40 text-xs">({panel.year})</span>}
            </p>
            {/* Neither a cover nor a portrait was posted by anyone, and a
                cover has no artist of its own on record while a portrait's is
                the person the header has just named — so the two lines that
                would name them are left off rather than printed empty or
                twice. */}
            {!offWall && (
              <>
                <p className="text-xs text-white/60 mt-0.5 leading-snug">{panel.artist}</p>
                <p className="text-[10px] text-white/30 mt-1 leading-snug whitespace-nowrap">
                  {panel.postedBy} ·{" "}
                  {new Date(panel.addedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </>
            )}
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
      renderNavEnd={
        // Neither a cover nor a portrait carries the hashes or embeddings the
        // graph measures with, so it would open on an anchor with no
        // neighbours.
        offWall
          ? undefined
          : () => (
              <button
                type="button"
                onClick={toggleGraph}
                className={`rvl-btn ${graphOpen ? "is-active" : ""}`}
                title="Similarity graph"
                aria-label="Similarity graph"
              >
                <GitGraph size={16} strokeWidth={1.5} />
              </button>
            )
      }
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
          allPanels={allPanels}
          drawerOpen={drawerOpen}
          initialPerson={openWithPerson}
          graphOpen={graphOpen}
          drawerSlideDir={drawerSlideDir}
          graphSlideDir={graphSlideDir}
          graphToolbarEl={graphToolbarEl}
          topOffset={ctx.topBarHeight}
          bottomOffset={ctx.bottomBarHeight}
          closing={ctx.closing}
          overViz={overViz}
          onSelectPanel={onSelectPanel}
          onBrowse={onBrowse}
          setContentShift={ctx.setContentShift}
        />
      )}
    />
  );
}
