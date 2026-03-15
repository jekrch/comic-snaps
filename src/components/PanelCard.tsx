import { useState, useRef, useCallback, useId, useMemo, useEffect } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../utils/sorting";
import PanelViewer from "./PanelViewer";
import { Expand } from "lucide-react";

const DOUBLE_CLICK_DELAY = 400;
const MOUSE_TOLERANCE = 20;
const TOUCH_TOLERANCE = 30;

const BLUR_COPY = {
  ew: "ew! open to view",
  nsfw: "for adult intellectuals only! open to view",
} as const;

const BLUR_GRADIENT_DIR: Record<string, string> = {
  top: "to bottom",
  bottom: "to top",
  left: "to right",
  right: "to left",
};

const HATCH_GRAD_COORDS: Record<string, { x1: string; y1: string; x2: string; y2: string }> = {
  top: { x1: "0", y1: "0", x2: "0", y2: "1" },
  bottom: { x1: "0", y1: "1", x2: "0", y2: "0" },
  left: { x1: "0", y1: "0", x2: "1", y2: "0" },
  right: { x1: "1", y1: "0", x2: "0", y2: "0" },
};

interface Props {
  panel: Panel;
  panels: Panel[];
  panelIndex: number;
  isFirstLoad?: boolean;
  sortMode?: SortMode;
}

export default function PanelCard({ panel, panels, panelIndex, sortMode }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(panelIndex);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hatchPatternId = useId();
  const hatchFadeId = useId();
  const hatchMaskId = useId();

  const realSrc = `${import.meta.env.BASE_URL}${panel.image}`;
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    let active = true;

    const check = () => {
      if (!active) return;
      const rect = el.getBoundingClientRect();
      const margin = 400;
      if (
        rect.height > 0 &&
        rect.bottom > -margin &&
        rect.top < window.innerHeight + margin &&
        rect.right > 0 &&
        rect.left < window.innerWidth
      ) {
        setImgSrc(realSrc);
        cleanup();
      }
    };

    const onScroll = () => requestAnimationFrame(check);

    const cleanup = () => {
      active = false;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("masonry-layout", onScroll);
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("masonry-layout", onScroll);

    const t1 = requestAnimationFrame(check);
    const t2 = setTimeout(check, 100);
    const t3 = setTimeout(check, 300);

    return () => {
      cleanup();
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [realSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  const aspectRatio =
    panel.width && panel.height && panel.width > 0 && panel.height > 0
      ? `${panel.width} / ${panel.height}`
      : "3 / 4";

  const openViewer = useCallback(() => {
    setViewerIndex(panelIndex);
    setViewerOpen(true);
  }, [panelIndex]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const now = Date.now();
      const isTouch = e.pointerType === "touch";

      if (isTouch && overlayRef.current) {
        const opacity = window.getComputedStyle(overlayRef.current).opacity;
        if (opacity === "0") {
          lastTap.current = null;
          return;
        }
      }

      const ref = isTouch ? lastTap : lastClick;
      const tolerance = isTouch ? TOUCH_TOLERANCE : MOUSE_TOLERANCE;
      const prev = ref.current;

      if (
        prev &&
        now - prev.time < DOUBLE_CLICK_DELAY &&
        Math.abs(e.clientX - prev.x) <= tolerance &&
        Math.abs(e.clientY - prev.y) <= tolerance
      ) {
        ref.current = null;
        openViewer();
      } else {
        ref.current = { time: now, x: e.clientX, y: e.clientY };
      }
    },
    [openViewer]
  );

  const isBlurred = panel.blur === "ew" || panel.blur === "nsfw";
  const hatchRotation = panel.blur === "ew" ? 45 : 135;
  const isDirectional =
    isBlurred && !!panel.blurStart && panel.blurStart !== "all";

  const blurMaskStyle = useMemo(() => {
    if (!isDirectional || !panel.blurStart) return undefined;
    const dir = BLUR_GRADIENT_DIR[panel.blurStart];
    return {
      WebkitMaskImage: `linear-gradient(${dir}, black 50%, transparent 95%)`,
      maskImage: `linear-gradient(${dir}, black 50%, transparent 95%)`,
      backdropFilter: "blur(8px) saturate(0.6)",
      WebkitBackdropFilter: "blur(8px) saturate(0.6)",
    } as React.CSSProperties;
  }, [isDirectional, panel.blurStart]);

  return (
    <>
      <div
        className="panel-item group relative cursor-pointer overflow-hidden rounded-sm bg-surface-raised"
        style={{ WebkitMaskImage: "radial-gradient(white, white)" }}
        onPointerUp={handlePointerUp}
      >
        <div ref={sentinelRef} style={{ aspectRatio, width: "100%" }}>
          {imgSrc && (
            <img
              ref={imgRef}
              src={imgSrc}
              alt={`${panel.title} #${panel.issue}`}
              className="block w-full"
              style={{
                aspectRatio,
                ...(isBlurred && !isDirectional
                  ? { filter: "blur(8px) saturate(0.6)", transform: "scale(1.05)" }
                  : {}),
              }}
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = "none";
                el.parentElement!.querySelector<HTMLDivElement>(
                  ".fallback"
                )!.style.display = "flex";
              }}
            />
          )}
          <div
            className="fallback hidden items-center justify-center bg-surface-raised text-ink-faint text-xs font-display"
            style={{ aspectRatio: "3/4" }}
          >
            {panel.title} #{panel.issue}
          </div>
        </div>

        {isDirectional && (
          <div
            className="absolute inset-0"
            style={blurMaskStyle}
            aria-hidden="true"
          />
        )}

        {isBlurred && (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center">
            <svg
              className="absolute inset-0 w-full h-full"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              style={{ opacity: 0.45, mixBlendMode: "overlay" }}
            >
              <defs>
                <pattern
                  id={hatchPatternId}
                  width="9"
                  height="9"
                  patternUnits="userSpaceOnUse"
                  patternTransform={`rotate(${hatchRotation})`}
                >
                  <line x1="0" y1="0" x2="0" y2="9" stroke="white" strokeWidth="1.5" />
                </pattern>
                {isDirectional && panel.blurStart && (
                  <>
                    <linearGradient id={hatchFadeId} {...HATCH_GRAD_COORDS[panel.blurStart]}>
                      <stop offset="20%" stopColor="white" stopOpacity="1" />
                      <stop offset="85%" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                    <mask id={hatchMaskId}>
                      <rect width="100%" height="100%" fill={`url(#${hatchFadeId})`} />
                    </mask>
                  </>
                )}
              </defs>
              <rect
                width="100%"
                height="100%"
                fill={`url(#${hatchPatternId})`}
                mask={isDirectional ? `url(#${hatchMaskId})` : undefined}
              />
            </svg>

            <span className="absolute inset-0 z-[3] flex items-center justify-center pointer-events-none">
              <span className="font-display text-xs text-white text-center px-3 py-1.5 leading-snug select-none bg-black/75">
                {BLUR_COPY[panel.blur!]}
              </span>
            </span>
          </div>
        )}

        <div
          ref={overlayRef}
          className={`panel-overlay absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3 ${
            isBlurred ? "z-[2]" : ""
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              openViewer();
            }}
            className="
              absolute top-2 right-2
              w-8 h-8 flex items-center justify-center
              rounded-md bg-black/50 backdrop-blur-sm
              text-white/70 hover:text-white hover:bg-black/70
              transition-all duration-150 ease-out
              focus:outline-none focus:ring-1 focus:ring-white/30
              active:scale-95
            "
            aria-label={`View ${panel.title} #${panel.issue} full screen`}
          >
            <Expand size={16} />
          </button>

          <p className="font-display text-sm text-ink leading-tight">
            {panel.title}{" "}
            <span className="text-accent">#{panel.issue}</span>
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            {panel.artist} · {panel.year}
          </p>
          {panel.notes && (
            <p className="text-xs text-ink-muted/70 mt-1 italic leading-snug line-clamp-2">
              {panel.notes}
            </p>
          )}
          {panel.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {panel.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] leading-none px-1.5 py-0.5 rounded-sm bg-white/10 text-ink-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewerOpen && (
        <PanelViewer
          panel={panels[viewerIndex]}
          panels={panels}
          currentIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
          onNavigate={(idx) => setViewerIndex(idx)}
          sortMode={sortMode}
        />
      )}
    </>
  );
}