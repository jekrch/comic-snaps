import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, GitGraph, Info } from "lucide-react";
import type { Panel } from "../types";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { MAX_SCALE, MIN_SCALE, useZoomPan } from "../hooks/useZoomPan";
import { useBarMeasure } from "../hooks/useBarMeasure";
import { useGestureHandler } from "../hooks/useGestureHandler";
import { useSlideNavigation } from "../hooks/useSlideNavigation";
import { useMetadata } from "../hooks/useMetadata";
import NavButton from "./NavButton";
import SimilarityGraph from "./graph/SimilarityGraph";
import InfoDrawer from "./InfoDrawer";

interface Props {
  panel: Panel;
  panels: Panel[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function PanelViewer({ panel, panels, currentIndex, onClose, onNavigate }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSlideDir, setDrawerSlideDir] = useState<"left" | "right" | null>(null);

  const { artist, series, parentSeries, hasContent } = useMetadata(panel.artist, panel.slug);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgWrapperRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  // Navigation flags
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < panels.length - 1;

  // Hooks

  useBodyScrollLock(containerRef);
  const { topBarH, bottomBarH } = useBarMeasure(topBarRef, bottomBarRef, currentIndex);

  const zoomPan = useZoomPan(imgWrapperRef, currentIndex);
  const {
    imgRef,
    displayScale,
    isZoomed,
    transformRef,
    resetTransform,
    setTransform,
    clampTranslate,
    measureBaseDims,
    handleDoubleClick,
  } = zoomPan;

  const slide = useSlideNavigation(panels, currentIndex, onNavigate);
  const {
    slideTrackRef,
    slideActive,
    slideAnimating,
    swipeOffset,
    commitSlide,
  } = slide;

  const gestures = useGestureHandler(zoomPan, slide, hasPrev, hasNext);

  // Detect touch device

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Viewport width tracking

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Animate in

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Search URL

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${panel.title} #${panel.issue} ${panel.year} ${panel.artist}`
  )}`;

  // Navigate with drawer slide-out — close immediately so drawer slides with the image
  const handleNavigate = useCallback((dir: "prev" | "next") => {
    if (drawerOpen) {
      setDrawerSlideDir(dir === "next" ? "left" : "right");
      setDrawerOpen(false);
    }
    commitSlide(dir);
  }, [drawerOpen, commitSlide]);

  // Close drawer on panel change
  useEffect(() => {
    setDrawerOpen(false);
    const timer = setTimeout(() => setDrawerSlideDir(null), 450);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  // Keyboard navigation

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (graphOpen) return;
      if (e.key === "Escape") {
        if (drawerOpen) { setDrawerOpen(false); return; }
        handleClose();
      }
      if (e.key === "ArrowLeft" && hasPrev && displayScale <= 1) handleNavigate("prev");
      if (e.key === "ArrowRight" && hasNext && displayScale <= 1) handleNavigate("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, hasPrev, hasNext, displayScale, commitSlide, graphOpen, drawerOpen]);

  // Layout calculations

  const hasTags = panel.tags?.length > 0;
  const IMG_PADDING = 44;
  const reservedH = bottomBarH + IMG_PADDING * 2;
  const imgMaxHeight = `calc(100vh - ${reservedH}px)`;

  const totalDigits = String(panels.length).length;
  const counterMinWidth = `${totalDigits * 2 * 0.6 + 1.5}em`;

  // Adjacent panels for slide effect
  const prevPanel = hasPrev ? panels[currentIndex - 1] : null;
  const nextPanel = hasNext ? panels[currentIndex + 1] : null;
  const showAdjacentSlides = slideActive || slideAnimating || swipeOffset !== 0;
  const showPrev = !!prevPanel && showAdjacentSlides;
  const showNext = !!nextPanel && showAdjacentSlides;
  const adjacentOpacity = Math.min(1, Math.abs(swipeOffset) / (viewportWidth * 0.8));

  const slideImgStyle: React.CSSProperties = {
    maxWidth: "96vw",
    maxHeight: imgMaxHeight,
    willChange: "transform",
  };

  // Render

  return (
    <div
      ref={containerRef}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/90" : "bg-black/0"}
      `}
      style={{ touchAction: "none" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${panel.title} #${panel.issue} — full view`}
    >
      {/* Clickable backdrop: closes viewer when clicking open space */}
      <div
        className={`
          absolute inset-0 z-0 transition-all duration-250 ease-out
          ${visible && !closing ? "backdrop-blur-sm" : "backdrop-blur-0"}
        `}
        onClick={drawerOpen ? () => setDrawerOpen(false) : handleClose}
        aria-hidden="true"
      />

      {/* Top bar */}
      <div
        ref={topBarRef}
        className={`
          absolute top-0 inset-x-0 z-20 flex items-start justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/70 via-black/40 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", pointerEvents: "none" }}
      >
        <div className="min-w-0 flex-1 px-2!" style={{ pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", width: "fit-content" }}>
            <p className="font-display text-sm text-white/90 leading-snug">
              {panel.title}{" "}
              <span className="text-accent">#{panel.issue}</span>{" "}
              <span className="text-white/40 text-xs">({panel.year})</span>
            </p>
            <p className="text-xs text-white/60 mt-0.5 leading-snug">
              {panel.artist}

            </p>
          </div>
        </div>

        <div className="flex flex-col items-end ml-3 shrink-0" style={{ pointerEvents: "auto" }}>
          <div className="flex items-center gap-1">

          {!isTouchDevice && !drawerOpen && isZoomed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetTransform();
              }}
              className="viewer-btn text-[11px] tabular-nums font-mono"
              title="Reset zoom"
            >
              {Math.round(displayScale * 100)}%
            </button>
          )}

          {!isTouchDevice && !drawerOpen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const t = transformRef.current;
                const next = Math.min(MAX_SCALE, t.scale * 1.3);
                const clamped = clampTranslate(t.x, t.y, next);
                setTransform({ scale: next, ...clamped }, true);
              }}
              className="viewer-btn"
              title="Zoom in"
            >
              <ZoomIn size={16} strokeWidth={1.5} />
            </button>
          )}

          {!isTouchDevice && !drawerOpen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const t = transformRef.current;
                const next = Math.max(MIN_SCALE, t.scale / 1.3);
                const clamped = next <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, next);
                setTransform({ scale: next, ...clamped }, true);
              }}
              className="viewer-btn"
              title="Zoom out"
            >
              <ZoomOut size={16} strokeWidth={1.5} />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className={`viewer-btn ${!isTouchDevice ? "ml-1" : ""}`}
            title="Close (Esc)"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="text-[10px] text-white/30 mt-1 leading-snug whitespace-nowrap mt-2">
          {panel.postedBy} · {new Date(panel.addedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
        </div>

      </div>

      {/* Slide track wrapper: shifts image up when drawer is open */}
      <div
        className="relative z-10 w-full h-full"
        style={{
          transform: drawerOpen ? "translateY(-100vh)" : "translateY(0)",
          transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
      <div
        ref={slideTrackRef}
        className={`
          relative flex items-center justify-center w-full h-full
          transition-opacity duration-250 ease-out
          ${visible && !closing ? "opacity-100" : "opacity-0"}
        `}
        style={{ touchAction: "none", pointerEvents: "none" }}
      >
        {/* Previous panel (off-screen left) */}
        {showPrev && prevPanel && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
            style={{ transform: `translateX(-${viewportWidth}px)`, opacity: adjacentOpacity }}
          >
            <img
              src={`${import.meta.env.BASE_URL}${prevPanel.image}`}
              alt={`${prevPanel.title} #${prevPanel.issue}`}
              className="block w-auto h-auto object-contain rounded-sm"
              style={slideImgStyle}
              draggable={false}
            />
          </div>
        )}

        {/* Current panel (center) */}
        <div
          ref={imgWrapperRef}
          className="relative flex items-center justify-center select-none overflow-hidden cursor-default"
          style={{ touchAction: "none", pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClick}
          onPointerDown={gestures.handlePointerDown}
          onPointerMove={gestures.handlePointerMove}
          onPointerUp={gestures.handlePointerUp}
          onPointerLeave={gestures.handlePointerUp}
          onTouchStart={gestures.handleTouchStart}
          onTouchMove={gestures.handleTouchMove}
          onTouchEnd={gestures.handleTouchEnd}
        >
          <img
            ref={imgRef}
            src={`${import.meta.env.BASE_URL}${panel.image}`}
            alt={`${panel.title} #${panel.issue}`}
            className="block w-auto h-auto object-contain rounded-sm"
            style={slideImgStyle}
            draggable={false}
            onLoad={measureBaseDims}
          />
        </div>

        {/* Next panel (off-screen right) */}
        {showNext && nextPanel && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
            style={{ transform: `translateX(${viewportWidth}px)`, opacity: adjacentOpacity }}
          >
            <img
              src={`${import.meta.env.BASE_URL}${nextPanel.image}`}
              alt={`${nextPanel.title} #${nextPanel.issue}`}
              className="block w-auto h-auto object-contain rounded-sm"
              style={slideImgStyle}
              draggable={false}
            />
          </div>
        )}
      </div>
      </div>

      {/* Bottom bar */}
      <div
        ref={bottomBarRef}
        className={`
          absolute bottom-0 inset-x-0 z-20 pt-6
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
        style={{ paddingBottom: "max(0.3rem, env(safe-area-inset-bottom))", pointerEvents: "none" }}
      >
        {/* Tags */}
        {!isZoomed && (
          <div className="flex flex-wrap justify-center gap-1.5 px-4 -mb-1 mx-auto w-fit min-h-4" style={{ pointerEvents: "auto" }}>
            {hasTags &&
              panel.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] leading-none px-1.5 py-[3.9px] rounded-sm bg-white/8 text-white/35"
                >
                  {tag}
                </span>
              ))}
          </div>
        )}

        {/* Navigation strip with flanking buttons */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="relative flex items-center justify-center" style={{ pointerEvents: "auto" }}>
            {/* Info button — left of nav */}
            {hasContent && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerOpen((d) => !d);
                }}
                className={`viewer-btn absolute top-1/2 -translate-y-1/2 mt-1 ${drawerOpen ? "bg-accent/25! text-white!" : ""}`}
                style={{ left: "max(16px, calc(50% - 10em - 68px))" }}
                title="Show details"
              >
                <Info size={15} strokeWidth={1.5} />
              </button>
            )}

            {/* Center nav controls */}
            <div className="flex items-center justify-center gap-6">
              <NavButton direction="prev" enabled={hasPrev} onClick={() => handleNavigate("prev")} />

              <span
                className="text-[11px] text-white/50 tabular-nums tracking-wide select-none text-center inline-block mt-3.25 font-mono"
                style={{ minWidth: counterMinWidth }}
              >
                {currentIndex + 1} / {panels.length}
              </span>

              <NavButton direction="next" enabled={hasNext} onClick={() => handleNavigate("next")} />
            </div>

            {/* Similarity graph button — right of nav */}
            <button
              onClick={() => setGraphOpen(true)}
              className="viewer-btn absolute top-1/2 -translate-y-1/2 cursor-pointer mt-1"
              style={{ right: "max(16px, calc(50% - 10em - 68px))" }}
              title="Similarity graph"
            >
              <GitGraph size={15} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Single-panel case: still show both flanking buttons */}
        {!isZoomed && !hasPrev && !hasNext && (
          <div className="relative flex items-center justify-center" style={{ pointerEvents: "auto" }}>
            {hasContent && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerOpen((d) => !d);
                }}
                className={`viewer-btn absolute top-1/2 -translate-y-1/2 mt-1 ${drawerOpen ? "bg-accent/25! text-white!" : ""}`}
                style={{ left: 16 }}
                title="Show details"
              >
                <Info size={15} strokeWidth={1.5} />
              </button>
            )}

            <div className="text-center mx-auto w-fit">
              <span className="text-[11px] text-white/30 tracking-wide">
                {isTouchDevice
                  ? "pinch to zoom · double-tap to enlarge"
                  : "scroll to zoom · double-click to enlarge · esc to close"}
              </span>
            </div>

            <button
              onClick={() => setGraphOpen(true)}
              className="viewer-btn absolute top-1/2 -translate-y-1/2 mt-1"
              style={{ right: 16 }}
              title="Similarity graph"
            >
              <GitGraph size={15} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Hint text (when nav present) */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="text-center mt-0 mx-auto w-fit" style={{ pointerEvents: "auto" }}>
            <span className="text-[11px] text-white/30 tracking-wide">
              {isTouchDevice
                ? "swipe to navigate · pinch to zoom"
                : "← → or drag to navigate · scroll to zoom · esc to close"}
            </span>
          </div>
        )}
      </div>

      {/* Info panel — z-15: above image (z-10), below controls (z-20) */}
      <InfoDrawer
        open={drawerOpen}
        closing={closing}
        panel={panel}
        artist={artist}
        series={series}
        parentSeries={parentSeries}
        searchUrl={searchUrl}
        topOffset={topBarH}
        bottomOffset={Math.max(0, bottomBarH - 24)}
        slideDir={drawerSlideDir}
      />

      {/* Similarity Graph overlay */}
      {graphOpen && (
        <SimilarityGraph
          panel={panel}
          allPanels={panels}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}
