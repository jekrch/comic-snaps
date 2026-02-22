import { useCallback, useEffect, useRef, useState } from "react";
import type { Panel } from "./types";

interface Props {
  panel: Panel;
  onClose: () => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export default function PanelViewer({ panel, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Use a ref for the live transform to avoid re-renders during gestures.
  // The `displayScale` state is only for UI elements (zoom %, button states).
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

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

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

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
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale + delta));
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
        setTransform({ scale: 2.5, x: 0, y: 0 }, true);
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
    },
    [resetTransform]
  );

  const isZoomed = displayScale > 1;

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
      role="dialog"
      aria-modal="true"
      aria-label={`${panel.title} #${panel.issue} — full view`}
    >
      {/* Top bar — always above image content via z-20 */}
      <div
        className={`
          absolute top-0 inset-x-0 z-20 flex items-center justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/70 via-black/40 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-white/90 truncate">
            {panel.title}{" "}
            <span className="text-accent">#{panel.issue}</span>
            <span className="text-white/40 ml-1.5">({panel.year})</span>
          </p>
          <p className="text-xs text-white/50 truncate mt-0.5">{panel.artist}</p>
        </div>

        <div className="flex items-center gap-1 ml-3 shrink-0">
          {isZoomed && (
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

          <button
            onClick={(e) => {
              e.stopPropagation();
              const t = transformRef.current;
              const next = Math.min(MAX_SCALE, t.scale + 0.5);
              const clamped = clampTranslate(t.x, t.y, next);
              setTransform({ scale: next, ...clamped }, true);
            }}
            className="viewer-btn"
            title="Zoom in"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
              <path d="M5 7h4M7 5v4" />
            </svg>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              const t = transformRef.current;
              const next = Math.max(MIN_SCALE, t.scale - 0.5);
              const clamped = next <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, next);
              setTransform({ scale: next, ...clamped }, true);
            }}
            className="viewer-btn"
            title="Zoom out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
              <path d="M5 7h4" />
            </svg>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className="viewer-btn ml-1"
            title="Close (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image container — z-10, overflow visible when zoomed to use full screen */}
      <div
        className={`
          relative z-10 select-none
          transition-opacity duration-250 ease-out
          ${visible && !closing ? "opacity-100" : "opacity-0"}
          ${isZoomed ? "cursor-grab overflow-visible" : "cursor-zoom-in overflow-hidden"}
          ${gestureRef.current.isDragging ? "!cursor-grabbing" : ""}
        `}
        style={{
          maxWidth: "96vw",
          maxHeight: "94vh",
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
          className="block max-w-[96vw] max-h-[94vh] w-auto h-auto object-contain rounded-sm"
          style={{
            transform: `scale(${transformRef.current.scale}) translate(${transformRef.current.x / transformRef.current.scale}px, ${transformRef.current.y / transformRef.current.scale}px)`,
            willChange: "transform",
          }}
          draggable={false}
        />
      </div>

      {/* Bottom hint — context-aware for touch vs desktop */}
      {!isZoomed && (
        <div
          className={`
            absolute bottom-4 inset-x-0 text-center pointer-events-none z-20
            transition-all duration-250 ease-out
            ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
          `}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <span className="text-[11px] text-white/30 tracking-wide">
            {isTouchDevice
              ? "pinch to zoom · double-tap to enlarge"
              : "scroll to zoom · double-click to enlarge · esc to close"}
          </span>
        </div>
      )}
    </div>
  );
}