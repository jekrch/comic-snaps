import { useCallback, useEffect, useRef, useState } from "react";
import type { Panel } from "./types";

interface Props {
  panel: Panel;
  onClose: () => void;
}

export default function PanelViewer({ panel, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [translateStart, setTranslateStart] = useState({ x: 0, y: 0 });
  const [pinchStartDist, setPinchStartDist] = useState<number | null>(null);
  const [pinchStartScale, setPinchStartScale] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  // Animate in on mount
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

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Reset transform
  const resetTransform = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Scroll / wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));
        if (next <= 1) setTranslate({ x: 0, y: 0 });
        return next;
      });
    },
    []
  );

  // Double-click/tap to toggle zoom
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (scale > 1) {
        resetTransform();
      } else {
        setScale(2.5);
      }
    },
    [scale, resetTransform]
  );

  // --- Mouse drag ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return;
      // Only handle single pointer (mouse or single touch)
      if (e.pointerType === "touch") return; // Touch handled separately for pinch
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setTranslateStart({ ...translate });
    },
    [scale, translate]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      if (e.pointerType === "touch") return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setTranslate({
        x: translateStart.x + dx,
        y: translateStart.y + dy,
      });
    },
    [isDragging, dragStart, translateStart]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // --- Touch: drag + pinch ---
  const touchRef = useRef<{ lastX: number; lastY: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        setPinchStartDist(dist);
        setPinchStartScale(scale);
        touchRef.current = null;
      } else if (e.touches.length === 1 && scale > 1) {
        // Pan start
        touchRef.current = {
          lastX: e.touches[0].clientX,
          lastY: e.touches[0].clientY,
        };
      }
    },
    [scale]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2 && pinchStartDist !== null) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = dist / pinchStartDist;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScale * ratio));
        setScale(next);
        if (next <= 1) setTranslate({ x: 0, y: 0 });
      } else if (e.touches.length === 1 && touchRef.current && scale > 1) {
        const dx = e.touches[0].clientX - touchRef.current.lastX;
        const dy = e.touches[0].clientY - touchRef.current.lastY;
        touchRef.current = {
          lastX: e.touches[0].clientX,
          lastY: e.touches[0].clientY,
        };
        setTranslate((prev) => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }));
      }
    },
    [pinchStartDist, pinchStartScale, scale]
  );

  const handleTouchEnd = useCallback(() => {
    setPinchStartDist(null);
    touchRef.current = null;
  }, []);

  const isZoomed = scale > 1;

  return (
    <div
      ref={containerRef}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/90 backdrop-blur-sm" : "bg-black/0 backdrop-blur-0"}
      `}
      onClick={(e) => {
        if (e.target === containerRef.current) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${panel.title} #${panel.issue} — full view`}
    >
      {/* Top bar */}
      <div
        className={`
          absolute top-0 inset-x-0 z-10 flex items-center justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/60 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
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
          {/* Zoom indicator */}
          {isZoomed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetTransform();
              }}
              className="viewer-btn text-[11px] tabular-nums"
              title="Reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
          )}

          {/* Zoom in */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setScale((s) => Math.min(MAX_SCALE, s + 0.5));
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

          {/* Zoom out */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setScale((s) => {
                const next = Math.max(MIN_SCALE, s - 0.5);
                if (next <= 1) setTranslate({ x: 0, y: 0 });
                return next;
              });
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

          {/* Close */}
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

      {/* Image container */}
      <div
        ref={imageRef}
        className={`
          relative select-none
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 scale-100" : "opacity-0 scale-95"}
          ${isZoomed ? "cursor-grab" : "cursor-zoom-in"}
          ${isDragging ? "!cursor-grabbing" : ""}
        `}
        style={{ maxWidth: "92vw", maxHeight: "85vh" }}
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
          src={`${import.meta.env.BASE_URL}${panel.image}`}
          alt={`${panel.title} #${panel.issue}`}
          className="block max-w-[92vw] max-h-[85vh] w-auto h-auto object-contain rounded-sm"
          style={{
            transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
            transition: isDragging || pinchStartDist !== null ? "none" : "transform 0.2s ease-out",
            willChange: "transform",
          }}
          draggable={false}
        />
      </div>

      {/* Bottom hint — shown briefly */}
      {!isZoomed && (
        <div
          className={`
            absolute bottom-4 inset-x-0 text-center pointer-events-none
            transition-all duration-250 ease-out
            ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
          `}
        >
          <span className="text-[11px] text-white/30 tracking-wide">
            scroll to zoom · double-click to enlarge · esc to close
          </span>
        </div>
      )}
    </div>
  );
}