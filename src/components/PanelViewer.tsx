import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, GitGraph, Info, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ImageViewer,
  ViewerButton,
  originFromAttribute,
  type ViewerHistoryOptions,
  type ViewerItem,
} from "@jekrch/react-viewport-lightbox";
import type { Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import { setViewerOpen } from "../hooks/useViewerOpen";
import { useArtistIndex, useMetadata, usePublisherIndex, useRatings } from "../hooks/useMetadata";
import SimilarityGraph from "./graph/SimilarityGraph";
import InfoDrawer, { type PersonRequest, type PublisherRequest } from "./InfoDrawer";
import type { BrowseDimension } from "../utils/filtering";

interface Props {
  panel: Panel;
  panels: Panel[];
  allPanels: Panel[];
  currentIndex: number;
  /** Opened for the details rather than the art — the info drawer starts out. */
  openWithInfo?: boolean;
  /** Opened for a *person* — the drawer starts out with their profile over it. */
  openWithPerson?: string | null;
  /** Opened for a *publisher* — the drawer starts out with its page over it. */
  openWithPublisher?: string | null;
  /** Opened on top of a running visualizer, which keeps playing underneath. */
  overViz?: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onBrowse: (dimension: BrowseDimension, value: string) => void;
}

// Lighter chrome icons than the library's 18px / 1.75 defaults, to sit with the
// app's own UI. Hoisted so the viewer sees the same object every render.
const viewerIcons = {
  close: <X size={16} strokeWidth={1.5} />,
  zoomIn: <ZoomIn size={16} strokeWidth={1.5} />,
  zoomOut: <ZoomOut size={16} strokeWidth={1.5} />,
  prev: <ChevronLeft size={38} strokeWidth={1.5} />,
  next: <ChevronRight size={38} strokeWidth={1.5} />,
};

// Shared-element open/close: expand from (and collapse back into) the wall
// card or series tile carrying the matching id. Offscreen thumbnails return
// their (offscreen) rect and the library falls back to a plain fade, so this
// is safe after deep nav, and so is a viewer group wider than the strip it
// was opened from. While an overlay has the stage shifted off-screen the
// library fades the close instead of collapsing, so no guard is needed here.
const panelOrigin = originFromAttribute<Panel>("data-panel-id");

// Keep the open panel id in the URL (?panel=<id>) so the viewer is linkable.
// Neither a cover nor a portrait has an id the wall can resolve on a cold load,
// so those leave the param off instead of writing a link that would open on
// nothing — and leaving it off is also what takes the previous panel's id out
// of the URL when you page onto one.
const panelHistory: ViewerHistoryOptions<Panel> = {
  param: "panel",
  value: (item) => (item.data?.cover || item.data?.portrait ? null : item.id),
};

/**
 * Overlay content rendered inside the lightbox: the info drawer (slides up,
 * with the image pushed up out of its way) and the similarity graph (slides
 * down, with the image pushed down).
 */
function ViewerOverlay({
  panel,
  allPanels,
  drawerOpen,
  personRequest,
  publisherRequest,
  onDismissDrawer,
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
}: {
  panel: Panel;
  allPanels: Panel[];
  drawerOpen: boolean;
  personRequest: PersonRequest | null;
  publisherRequest: PublisherRequest | null;
  onDismissDrawer: () => void;
  graphOpen: boolean;
  drawerSlideDir: "left" | "right" | null;
  graphSlideDir: "left" | "right" | null;
  graphToolbarEl: HTMLElement | null;
  topOffset: number;
  bottomOffset: number;
  closing: boolean;
  overViz: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onBrowse: (dimension: BrowseDimension, value: string) => void;
}) {
  const { artist, series, parentSeries, issueCredits } = useMetadata(panel.artist, panel.slug, panel.issue);
  const artistIndex = useArtistIndex();
  const publisherIndex = usePublisherIndex();
  const { issue: issueRatings, series: seriesRatings } = useRatings(panel);

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${panel.title} ${formatIssue(panel.issue)} ${panel.year} ${panel.artist}`
  )}`;

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
        publisherIndex={publisherIndex}
        onBrowse={onBrowse}
        searchUrl={searchUrl}
        personRequest={personRequest}
        publisherRequest={publisherRequest}
        onDismiss={onDismissDrawer}
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

export default function PanelViewer({
  panel,
  panels,
  allPanels,
  currentIndex,
  openWithInfo = false,
  openWithPerson = null,
  openWithPublisher = null,
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
  // Opened for a person (an artist row's name), their page is the first thing
  // the drawer shows, and closing it lands on the drawer's details.
  const [personRequest, setPersonRequest] = useState<PersonRequest | null>(() =>
    openWithPerson ? { name: openWithPerson, seq: 1, returnTo: "details" } : null
  );
  const [publisherRequest] = useState<PublisherRequest | null>(() =>
    openWithPublisher ? { name: openWithPublisher, seq: 1, returnTo: "details" } : null
  );

  const items = useMemo<ViewerItem<Panel>[]>(
    () =>
      panels.map((p) => ({
        id: p.id,
        src: panelImageUrl(p.image),
        alt: `${p.title} ${formatIssue(p.issue)}`,
        data: p,
      })),
    [panels]
  );

  // Tell the page behind to go quiet while the viewer owns the screen: the
  // hatch stops animating and the series washes stop painting. It's handed back
  // the moment a close *starts* (`onCloseStart` below), so the gallery comes
  // back under the still-opaque backdrop and fades in with it; this cleanup
  // only covers a viewer torn down without a close.
  useEffect(() => {
    setViewerOpen(true);
    return () => setViewerOpen(false);
  }, []);

  const offWall = panel.cover || panel.portrait;

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

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The header's artist name opens their page in the drawer. From the art,
  // the drawer comes up just to show it, so closing the page goes back to the
  // art; with the details already out, it goes back to them.
  const openArtist = useCallback(() => {
    setGraphOpen(false);
    setPersonRequest((r) => ({
      name: panel.artist,
      seq: (r?.seq ?? 0) + 1,
      returnTo: drawerOpen ? "details" : "art",
    }));
    setDrawerOpen(true);
  }, [panel.artist, drawerOpen]);

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

  // Hand the page back the moment the close *starts*, rather than when the
  // viewer finally unmounts a quarter-second later: the gallery comes back
  // under a backdrop that is still up and fades out along with it. The library
  // calls this before it measures the thumbnail the image collapses back into,
  // so the page's own state has landed by then.
  const handleCloseStart = useCallback(() => setViewerOpen(false), []);

  // Esc (and back) closes the graph, then the drawer, then (default) the viewer.
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
    <ImageViewer<Panel>
      items={items}
      index={currentIndex}
      onIndexChange={onNavigate}
      onNavigate={handleViewerNavigate}
      onClose={onClose}
      onCloseStart={handleCloseStart}
      onEscape={handleEscape}
      // Over the visualizer there is no visible card to fly from: the run
      // covers the grid, so flying out of a hidden thumbnail would read as a
      // jump from nowhere. Without an origin the library fades instead.
      getOrigin={overViz ? undefined : panelOrigin}
      // Back closes the viewer (through handleEscape, so it takes down the
      // graph, then the drawer, first) and the URL names the open panel.
      history={panelHistory}
      // Push the image track out of the way for whichever overlay is open: up
      // for the drawer (slides from the bottom), down for the graph (slides
      // from the top). A details-first open mounts already shifted, which the
      // library places without a slide. While shifted, the zoom controls and
      // backdrop-click close are suspended.
      stageShift={drawerOpen ? "up" : graphOpen ? "down" : null}
      disableNavigation={graphOpen}
      navSlotPlacement="inline"
      closeOnBackdropClick
      ariaLabel={`${panel.title} ${formatIssue(panel.issue)} — full view`}
      classNames={{ root: overViz ? "rvl-over-viz" : undefined }}
      icons={viewerIcons}
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
                <p className="text-xs text-white/60 mt-0.5 leading-snug">
                  {panel.artist && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openArtist();
                      }}
                      className="text-left text-white/60 hover:text-accent underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-accent transition-colors"
                      title={`About ${panel.artist}`}
                    >
                      {panel.artist}
                    </button>
                  )}
                  {panel.artist && panel.artistAge != null && (
                    <span
                      className="text-white/30 text-[10px]"
                      title={`${panel.artist} was ${panel.artistAge} in ${panel.year}`}
                    >
                      {" "}· age {panel.artistAge}
                    </span>
                  )}
                </p>
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
      // With the details up, the art they're about has been pushed off the
      // screen, so it stays on as a faint reference behind the right of the
      // header, just left of the close button. It's out of the bar's flow, so
      // coming and going never moves the title.
      renderHeaderActions={() => (
        <span className={`viewer-origin ${drawerOpen ? "is-shown" : ""}`} aria-hidden>
          <img key={panel.id} src={panelImageUrl(panel.image)} alt="" draggable={false} decoding="async" />
        </span>
      )}
      renderNavStart={
        hasContent
          ? () => (
              <ViewerButton onClick={toggleDrawer} active={drawerOpen} label="Show details">
                <Info size={16} strokeWidth={1.5} />
              </ViewerButton>
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
              <ViewerButton onClick={toggleGraph} active={graphOpen} label="Similarity graph">
                <GitGraph size={16} strokeWidth={1.5} />
              </ViewerButton>
            )
      }
      // The built-in gesture hint, for a lone image only (a group's nav row
      // already says enough). Hides itself while zoomed or shifted.
      hint={items.length <= 1}
      renderOverlay={(ctx) => (
        <ViewerOverlay
          panel={panel}
          allPanels={allPanels}
          drawerOpen={drawerOpen}
          personRequest={personRequest}
          publisherRequest={publisherRequest}
          onDismissDrawer={closeDrawer}
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
        />
      )}
    />
  );
}
