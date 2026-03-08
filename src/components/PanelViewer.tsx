import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import type { Panel } from "../types";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { MAX_SCALE, MIN_SCALE, useZoomPan } from "../hooks/useZoomPan";
import { useBarMeasure } from "../hooks/useBarMeasure";
import { useGestureHandler } from "../hooks/useGestureHandler";
import { useSlideNavigation } from "../hooks/useSlideNavigation";

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

  const containerRef = useRef<HTMLDivElement>(null);
  const imgWrapperRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  // Navigation flags
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < panels.length - 1;

  // ── Hooks ──

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

  // ── Detect touch device ──

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // ── Viewport width tracking ──

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Animate in ──

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // ── Keyboard navigation ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowLeft" && hasPrev && displayScale <= 1) commitSlide("prev");
      if (e.key === "ArrowRight" && hasNext && displayScale <= 1) commitSlide("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, hasPrev, hasNext, displayScale, commitSlide]);

  // ── Layout calculations ──

  const hasTags = panel.tags?.length > 0;
  const IMG_PADDING = 24;
  const reservedH = topBarH + bottomBarH + IMG_PADDING * 2;
  const imgMaxHeight = `calc(100vh - ${reservedH}px)`;

  const totalDigits = String(panels.length).length;
  const counterMinWidth = `${totalDigits * 2 * 0.6 + 1.5}em`;

  // Adjacent panels for slide effect
  const prevPanel = hasPrev ? panels[currentIndex - 1] : null;
  const nextPanel = hasNext ? panels[currentIndex + 1] : null;
  const showAdjacentSlides = slideActive || slideAnimating || swipeOffset !== 0;
  const showPrev = !!prevPanel && showAdjacentSlides;
  const showNext = !!nextPanel && showAdjacentSlides;

  const slideImgStyle: React.CSSProperties = {
    maxWidth: "96vw",
    maxHeight: imgMaxHeight,
    willChange: "transform",
  };

  // ── Render ──

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
      {/* ── Clickable backdrop: closes viewer when clicking open space ── */}
      <div
        className={`
          absolute inset-0 z-0 transition-all duration-250 ease-out
          ${visible && !closing ? "backdrop-blur-sm" : "backdrop-blur-0"}
        `}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* ── Top bar ── */}
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
            <span className="text-white/40">({panel.year})</span>
          </p>
          <p className="text-xs text-white/60 mt-0.5 leading-snug">
            {panel.artist}
            <span className="text-white/25 mx-1.5">·</span>
            <span className="text-white/35">
              (posted by {panel.postedBy}:{` `}
              {new Date(panel.addedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })})
            </span>
          </p>
          </div>
        </div>

        <div className="flex items-center gap-1 ml-3 shrink-0" style={{ pointerEvents: "auto" }}>
          {!isTouchDevice && isZoomed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetTransform();
              }}
              className="viewer-btn text-[11px] tabular-nums"
              title="Reset zoom"
            >
              {Math.round(displayScale * 100)}%
            </button>
          )}

          {!isTouchDevice && (
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

          {!isTouchDevice && (
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
      </div>

      {/* ── Slide track: three-slot carousel ── */}
      <div
        ref={slideTrackRef}
        className={`
          relative z-10 flex items-center justify-center w-full h-full
          transition-opacity duration-250 ease-out
          ${visible && !closing ? "opacity-100" : "opacity-0"}
        `}
        style={{ touchAction: "none", pointerEvents: "none" }}
      >
        {/* Previous panel (off-screen left) */}
        {showPrev && prevPanel && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
            style={{ transform: `translateX(-${viewportWidth}px)` }}
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
            style={{ transform: `translateX(${viewportWidth}px)` }}
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

      {/* ── Bottom bar ── */}
      <div
        ref={bottomBarRef}
        className={`
          absolute bottom-0 inset-x-0 z-20
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))", pointerEvents: "none" }}
      >
        {/* Tags */}
        {!isZoomed && (
          <div className="flex flex-wrap justify-center gap-1.5 px-4 mb-2 min-h-[18px] mx-auto w-fit" style={{ pointerEvents: "auto" }}>
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

        {/* Navigation strip */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="mx-auto flex items-center justify-center gap-6 mb-0 w-fit" style={{ pointerEvents: "auto" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasPrev) commitSlide("prev");
              }}
              disabled={!hasPrev}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasPrev
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"}
              `}
              aria-label="Previous panel"
            >
              <ChevronLeft size={22} strokeWidth={1.5} />
            </button>

            <span
              className="text-[10px] text-white/20 tabular-nums tracking-wide select-none text-center inline-block"
              style={{ minWidth: counterMinWidth }}
            >
              {currentIndex + 1} / {panels.length}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasNext) commitSlide("next");
              }}
              disabled={!hasNext}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasNext
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"}
              `}
              aria-label="Next panel"
            >
              <ChevronRight size={22} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Hint text */}
        {!isZoomed && !hasPrev && !hasNext && (
          <div className="text-center mt-0 mx-auto w-fit" style={{ pointerEvents: "auto" }}>
            <span className="text-[11px] text-white/30 tracking-wide">
              {isTouchDevice
                ? "pinch to zoom · double-tap to enlarge"
                : "scroll to zoom · double-click to enlarge · esc to close"}
            </span>
          </div>
        )}

        {!isZoomed && (hasPrev || hasNext) && (
          <div className="text-center mt-0 mx-auto w-fit" style={{ pointerEvents: "auto" }}>
            <span className="text-[11px] text-white/20 tracking-wide">
              {isTouchDevice
                ? "swipe to navigate · pinch to zoom"
                : "← → or drag to navigate · scroll to zoom · esc to close"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}