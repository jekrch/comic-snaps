import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import type { Panel } from "../types";

interface Props {
  panel: Panel;
  panels: Panel[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export default function PanelViewer({ panel, panels, currentIndex, onClose, onNavigate }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Use a ref for the live transform to avoid re-renders during gestures.
  // The `displayScale` state is only for UI elements (zoom %, button states).
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const [bottomBarH, setBottomBarH] = useState(0);
  const [topBarH, setTopBarH] = useState(0);

  // Gesture tracking refs — no re-renders during active gestures
  const gestureRef = useRef<{
    isDragging: boolean;
    pointerStart: { x: number; y: number };
    translateStart: { x: number; y: number };
    pinchStartDist: number | null;
    pinchStartScale: number;
    pinchMidpoint: { x: number; y: number } | null;
    lastTouchPos: { x: number; y: number } | null;
  }>({
    isDragging: false,
    pointerStart: { x: 0, y: 0 },
    translateStart: { x: 0, y: 0 },
    pinchStartDist: null,
    pinchStartScale: 1,
    pinchMidpoint: null,
    lastTouchPos: null,
  });

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  // Navigation
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < panels.length - 1;

  // Double-tap detection for touch devices
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  // Detect touch device
  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Apply transform directly to DOM — no React render cycle
  const applyTransform = useCallback((t: Transform, animate = false) => {
    const img = imgRef.current;
    if (!img) return;
    if (animate) {
      img.style.transition = "transform 0.2s ease-out";
    } else {
      img.style.transition = "none";
    }
    img.style.transform = `scale(${t.scale}) translate(${t.x / t.scale}px, ${t.y / t.scale}px)`;
  }, []);

  const setTransform = useCallback(
    (t: Transform, animate = false) => {
      transformRef.current = t;
      applyTransform(t, animate);
      // Update display scale for UI (debounced via rAF is fine since this is just for buttons)
      setDisplayScale(t.scale);
    },
    [applyTransform]
  );

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 }, true);
  }, [setTransform]);

  // Clamp translation so the image doesn't drift too far off-screen
  const clampTranslate = useCallback(
    (x: number, y: number, scale: number): { x: number; y: number } => {
      const img = imgRef.current;
      if (!img || scale <= 1) return { x: 0, y: 0 };
      const rect = img.getBoundingClientRect();
      const baseW = rect.width / transformRef.current.scale;
      const baseH = rect.height / transformRef.current.scale;
      const maxX = ((scale - 1) * baseW) / 2;
      const maxY = ((scale - 1) * baseH) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    []
  );

  // Reset zoom when navigating to a new panel
  useEffect(() => {
    transformRef.current = { scale: 1, x: 0, y: 0 };
    setDisplayScale(1);
    const img = imgRef.current;
    if (img) {
      img.style.transition = "none";
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
  }, [currentIndex]);

  // Measure top/bottom bars so the image can be constrained to fit between them
  useEffect(() => {
    const measure = () => {
      if (topBarRef.current) setTopBarH(topBarRef.current.offsetHeight);
      if (bottomBarRef.current) setBottomBarH(bottomBarRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (topBarRef.current) ro.observe(topBarRef.current);
    if (bottomBarRef.current) ro.observe(bottomBarRef.current);
    return () => ro.disconnect();
  }, [currentIndex]);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Keyboard: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowLeft" && hasPrev && displayScale <= 1) {
        onNavigate(currentIndex - 1);
      }
      if (e.key === "ArrowRight" && hasNext && displayScale <= 1) {
        onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, hasPrev, hasNext, currentIndex, onNavigate, displayScale]);

  // Lock body scroll and prevent overscroll/bounce on iOS
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    // Prevent iOS Safari rubber-banding
    const preventScroll = (e: TouchEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = prevTouch;
      document.removeEventListener("touchmove", preventScroll);
    };
  }, []);

  // --- Wheel zoom (desktop) ---
  // Normalize deltaY so discrete mouse wheels (which send large deltas like ±100/±120
  // per notch) and trackpads/smooth-scroll mice (which send many small deltas per
  // gesture) both produce a gentle, consistent zoom feel.
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;

      // deltaMode: 0 = pixels, 1 = lines, 2 = pages
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; // lines → rough pixel equivalent
      if (e.deltaMode === 2) dy *= 100;

      // Clamp the normalized delta so one discrete notch (typically ±100-120px)
      // and a trackpad micro-tick (±1-4px) both land in a usable range.
      // Then convert to a small multiplier: ±0.03 per ~100px of delta.
      const normalized = Math.max(-100, Math.min(100, dy));
      const step = -(normalized / 100) * 0.05; // positive step = zoom in
      const factor = 1 + step;

      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const clamped = nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);
      setTransform({ scale: nextScale, ...clamped });
    },
    [setTransform, clampTranslate]
  );

  // --- Double click/tap toggle ---
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (transformRef.current.scale > 1) {
        resetTransform();
      } else {
        setTransform({ scale: 1.8, x: 0, y: 0 }, true);
      }
    },
    [resetTransform, setTransform]
  );

  // --- Mouse drag (desktop) ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (transformRef.current.scale <= 1) return;
    if (e.pointerType === "touch") return;
    e.preventDefault();
    const g = gestureRef.current;
    g.isDragging = true;
    g.pointerStart = { x: e.clientX, y: e.clientY };
    g.translateStart = { x: transformRef.current.x, y: transformRef.current.y };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g.isDragging || e.pointerType === "touch") return;
      const dx = e.clientX - g.pointerStart.x;
      const dy = e.clientY - g.pointerStart.y;
      const t = transformRef.current;
      const clamped = clampTranslate(g.translateStart.x + dx, g.translateStart.y + dy, t.scale);
      setTransform({ scale: t.scale, ...clamped });
    },
    [setTransform, clampTranslate]
  );

  const handlePointerUp = useCallback(() => {
    gestureRef.current.isDragging = false;
  }, []);

  // --- Touch: pinch + pan ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const g = gestureRef.current;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      g.pinchStartDist = Math.hypot(dx, dy);
      g.pinchStartScale = transformRef.current.scale;
      g.pinchMidpoint = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      g.lastTouchPos = null;
    } else if (e.touches.length === 1 && transformRef.current.scale > 1) {
      g.lastTouchPos = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const g = gestureRef.current;

      if (e.touches.length === 2 && g.pinchStartDist !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / g.pinchStartDist;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.pinchStartScale * ratio));
        const t = transformRef.current;
        const clamped =
          nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);

        // Apply directly to DOM — no setState
        const next = { scale: nextScale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
        // Throttled UI update
        setDisplayScale(nextScale);
      } else if (e.touches.length === 1 && g.lastTouchPos && transformRef.current.scale > 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - g.lastTouchPos.x;
        const dy = touch.clientY - g.lastTouchPos.y;
        g.lastTouchPos = { x: touch.clientX, y: touch.clientY };

        const t = transformRef.current;
        const clamped = clampTranslate(t.x + dx, t.y + dy, t.scale);
        const next = { scale: t.scale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
      }
    },
    [applyTransform, clampTranslate]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const g = gestureRef.current;
      const wasPinch = g.pinchStartDist !== null;
      g.pinchStartDist = null;
      g.pinchMidpoint = null;

      // If all fingers lifted while zoomed out, snap back
      if (e.touches.length === 0 && transformRef.current.scale <= 1) {
        resetTransform();
      }

      // If one finger remains after pinch, start panning from that finger
      if (e.touches.length === 1 && transformRef.current.scale > 1) {
        g.lastTouchPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else {
        g.lastTouchPos = null;
      }

      // Double-tap detection (only for single-finger taps, not after pinch)
      if (e.touches.length === 0 && e.changedTouches.length === 1 && !wasPinch) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        const timeDelta = now - last.time;
        const distDelta = Math.hypot(touch.clientX - last.x, touch.clientY - last.y);

        if (timeDelta < 300 && distDelta < 30) {
          // Double-tap detected — toggle zoom
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          if (transformRef.current.scale > 1) {
            resetTransform();
          } else {
            setTransform({ scale: 2.5, x: 0, y: 0 }, true);
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        }
      }
    },
    [resetTransform, setTransform]
  );

  // --- Swipe navigation (touch, when not zoomed) ---
  const swipeRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null);

  const handleNavTouchStart = useCallback((e: React.TouchEvent) => {
    if (displayScale > 1) return;
    if (e.touches.length === 1) {
      swipeRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTime: Date.now(),
      };
    }
  }, [displayScale]);

  const handleNavTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swipeRef.current || displayScale > 1) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = touch.clientY - swipeRef.current.startY;
    const dt = Date.now() - swipeRef.current.startTime;
    swipeRef.current = null;

    // Must be a horizontal swipe: fast enough, far enough, more horizontal than vertical
    if (dt < 400 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && hasPrev) {
        onNavigate(currentIndex - 1);
      } else if (dx < 0 && hasNext) {
        onNavigate(currentIndex + 1);
      }
    }
  }, [displayScale, hasPrev, hasNext, currentIndex, onNavigate]);

  const isZoomed = displayScale > 1;
  const hasTags = panel.tags?.length > 0;

  // Padding between image and bars
  const IMG_PADDING = 24;
  const reservedH = topBarH + bottomBarH + IMG_PADDING * 2;
  const imgMaxHeight = isZoomed
    ? undefined
    : `calc(100vh - ${reservedH}px)`;

  // Compute fixed width for the nav counter based on max possible digit count
  const totalDigits = String(panels.length).length;
  // Each digit ≈ 0.6em at the counter's font size; " / " adds ~1.5em
  const counterMinWidth = `${totalDigits * 2 * 0.6 + 1.5}em`;

  return (
    <div
      ref={containerRef}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/90 backdrop-blur-sm" : "bg-black/0 backdrop-blur-0"}
      `}
      style={{ touchAction: "none" }}
      onClick={(e) => {
        if (e.target === containerRef.current) handleClose();
      }}
      onTouchStart={handleNavTouchStart}
      onTouchEnd={handleNavTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={`${panel.title} #${panel.issue} — full view`}
    >
      {/* Top bar — always above image content via z-20 */}
      <div
        ref={topBarRef}
        className={`
          absolute top-0 inset-x-0 z-20 flex items-start justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/70 via-black/40 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="min-w-0 flex-1 px-2!">
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

        <div className="flex items-center gap-1 ml-3 shrink-0">
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

      {/* Image container — z-10, overflow visible when zoomed to use full screen */}
      <div
        className={`
          relative z-10 flex items-center justify-center select-none
          transition-opacity duration-250 ease-out
          ${visible && !closing ? "opacity-100" : "opacity-0"}
          ${isZoomed ? "cursor-grab overflow-visible" : "cursor-zoom-in overflow-hidden"}
          ${gestureRef.current.isDragging ? "!cursor-grabbing" : ""}
        `}
        style={{
          touchAction: "none",
        }}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          ref={imgRef}
          src={`${import.meta.env.BASE_URL}${panel.image}`}
          alt={`${panel.title} #${panel.issue}`}
          className="block w-auto h-auto object-contain rounded-sm"
          style={{
            maxWidth: "96vw",
            maxHeight: imgMaxHeight ?? "none",
            transform: `scale(${transformRef.current.scale}) translate(${transformRef.current.x / transformRef.current.scale}px, ${transformRef.current.y / transformRef.current.scale}px)`,
            willChange: "transform",
          }}
          draggable={false}
        />
      </div>

      {/* Bottom bar */}
      <div
        ref={bottomBarRef}
        className={`
          absolute bottom-0 inset-x-0 z-20
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* Tags — hidden when zoomed */}
        {!isZoomed && hasTags && (
          <div className="flex flex-wrap justify-center gap-1.5 px-4 mb-2">
            {panel.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] leading-none px-1.5 py-0.5 rounded-sm bg-white/8 text-white/35"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Navigation strip using chevrons */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="mx-auto flex items-center justify-center gap-6 mb-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasPrev) onNavigate(currentIndex - 1);
              }}
              disabled={!hasPrev}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasPrev
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"
                }
              `}
              aria-label="Previous panel"
            >
              <ChevronLeft size={22} strokeWidth={1.5}/>
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
                if (hasNext) onNavigate(currentIndex + 1);
              }}
              disabled={!hasNext}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasNext
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"
                }
              `}
              aria-label="Next panel"
            >
              <ChevronRight size={22} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Hint text — only when no nav or when zoomed */}
        {!isZoomed && !hasPrev && !hasNext && (
          <div className="text-center mt-0">
            <span className="text-[11px] text-white/30 tracking-wide">
              {isTouchDevice
                ? "pinch to zoom · double-tap to enlarge"
                : "scroll to zoom · double-click to enlarge · esc to close"}
            </span>
          </div>
        )}

        {/* Condensed hint when nav is present */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="text-center mt-0">
            <span className="text-[11px] text-white/20 tracking-wide">
              {isTouchDevice
                ? "swipe to navigate · pinch to zoom"
                : "← → to navigate · scroll to zoom · esc to close"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}