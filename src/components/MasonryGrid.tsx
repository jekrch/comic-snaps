import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../utils/sorting";
import type { Filters } from "../utils/filtering";
import PanelCard from "./PanelCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFillter";
import { buildStampPool } from "./HatchFillter";
import type { StampDef } from "./HatchFillter";
import FooterPyramid from "./FooterPryamid";
import type { GalleryView } from "./ViewControl";
import { resolveNeighbors } from "../adjacency";
import type { NeighborMap } from "../adjacency";

const GAP = 4;

/**
 * Which step of the view swap's wave a card sits on: its column plus its
 * distance below the top of the viewport, so the wall comes apart (and back
 * together) as a diagonal running out of the top-left corner of what is
 * actually on screen rather than all at once.
 *
 * Measured from the viewport and not from the page, because the render band
 * reaches 2400px above it: anchored to the page, a reader scrolled halfway
 * down would have every card they can see pinned to the same late step, and
 * the wave would play out entirely off screen. Capped for the same reason it
 * is short — its tail is dead time the swap has to wait through.
 */
const STAGGER_BAND = 420;
const STAGGER_MAX = 5;

function staggerStep(x: number, y: number, colWidth: number, viewTop: number) {
  const col = colWidth > 0 ? Math.round(x / (colWidth + GAP)) : 0;
  const down = Math.max(0, Math.floor((y - viewTop) / STAGGER_BAND));
  return Math.min(col + down, STAGGER_MAX);
}
const DEFAULT_ASPECT = 3 / 4;
const WIDE_THRESHOLD = 1.4;

// Positions are computed for every panel (masonry is sequential — a panel's
// column depends on the heights left by all the panels before it, and the full
// pass is what gives an honest scrollbar). Mounting them is the expensive part,
// so only items within this band of the viewport are rendered.
//
// RENDER_MARGIN sits deliberately above useNearViewport's 1500px PRELOAD_MARGIN
// so a card mounts before its image is wanted, leaving the existing preload
// behaviour untouched. SCROLL_BUCKET quantizes scroll so the window is
// recomputed every ~300px rather than every scroll event.
const RENDER_MARGIN = 2400;
const SCROLL_BUCKET = 300;

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

function getAspect(panel: Panel): number {
  if (panel.width && panel.height && panel.width > 0 && panel.height > 0) {
    return panel.width / panel.height;
  }
  return DEFAULT_ASPECT;
}

function isWide(panel: Panel): boolean {
  if (panel.columnSpan === 1) return false;
  if (panel.columnSpan === 2) return true;
  return getAspect(panel) >= WIDE_THRESHOLD;
}

interface PlacedPanel {
  kind: "panel";
  panel: Panel;
  x: number;
  y: number;
  w: number;
}

interface PlacedFiller {
  kind: "filler";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  assignedStamp: StampDef;
  fillerIndex: number;
  neighbors: NeighborMap;
}

type PlacedItem = PlacedPanel | PlacedFiller;

function assignStampsToFillers(fillers: PlacedFiller[]): void {
  const pool = buildStampPool();
  const poolSize = pool.length;
  for (let i = 0; i < fillers.length; i++) {
    fillers[i].assignedStamp = pool[i % poolSize];
    fillers[i].fillerIndex = i;
  }
}

function getPanelHeight(panel: Panel, width: number): number {
  const aspect = getAspect(panel);
  return width / aspect;
}

function computeLayout(
  panels: Panel[],
  colCount: number,
  containerWidth: number,
  initialHeights: number[]
): { items: PlacedItem[]; totalHeight: number } {
  const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;
  const colX = (col: number) => col * (colWidth + GAP);
  const heights = [...initialHeights];
  const items: PlacedItem[] = [];

  const placeholder: StampDef = { type: "word", value: "" };
  const emptyNeighbors: NeighborMap = {};

  for (let idx = 0; idx < panels.length; idx++) {
    const panel = panels[idx];
    const aspect = getAspect(panel);
    const wide = isWide(panel) && colCount >= 2;

    if (wide) {
      let bestStart = 0;
      let bestMaxH = Infinity;
      for (let s = 0; s <= colCount - 2; s++) {
        const maxH = Math.max(heights[s], heights[s + 1]);
        if (maxH < bestMaxH) {
          bestMaxH = maxH;
          bestStart = s;
        }
      }

      const col1 = bestStart;
      const col2 = bestStart + 1;
      const tallest = Math.max(heights[col1], heights[col2]);

      if (heights[col1] < tallest) {
        const fillerH = tallest - heights[col1];
        items.push({
          kind: "filler",
          key: `filler-${panel.id}-L`,
          x: colX(col1),
          y: heights[col1],
          w: colWidth,
          h: fillerH,
          col: col1,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }
      if (heights[col2] < tallest) {
        const fillerH = tallest - heights[col2];
        items.push({
          kind: "filler",
          key: `filler-${panel.id}-R`,
          x: colX(col2),
          y: heights[col2],
          w: colWidth,
          h: fillerH,
          col: col2,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }

      const spanW = colWidth * 2 + GAP;
      const panelH = spanW / aspect;
      items.push({
        kind: "panel",
        panel,
        x: colX(col1),
        y: tallest,
        w: spanW,
      });

      const newH = tallest + panelH + GAP;
      heights[col1] = newH;
      heights[col2] = newH;
    } else {
      let targetCol = 0;
      let minH = heights[0];
      for (let i = 1; i < colCount; i++) {
        if (heights[i] < minH) {
          minH = heights[i];
          targetCol = i;
        }
      }
      if (idx === 0) {
        const renderedH = colWidth / aspect;
        if (heights[0] - minH <= renderedH) {
          targetCol = 0;
        }
      }

      const panelH = colWidth / aspect;
      items.push({
        kind: "panel",
        panel,
        x: colX(targetCol),
        y: heights[targetCol],
        w: colWidth,
      });
      heights[targetCol] += panelH + GAP;
    }
  }

  const totalHeight = Math.max(...heights, 0);

  for (let col = 0; col < colCount; col++) {
    if (heights[col] < totalHeight) {
      const fillerH = totalHeight - heights[col];
      if (fillerH > GAP) {
        items.push({
          kind: "filler",
          key: `filler-end-${col}`,
          x: colX(col),
          y: heights[col],
          w: colWidth,
          h: fillerH - GAP,
          col,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }
    }
  }

  const fillers = items.filter((i): i is PlacedFiller => i.kind === "filler");
  assignStampsToFillers(fillers);

  const neighborMap = resolveNeighbors(
    items.map((item) => {
      if (item.kind === "panel") {
        return {
          kind: "panel" as const,
          panel: item.panel,
          x: item.x,
          y: item.y,
          w: item.w,
          h: getPanelHeight(item.panel, item.w),
        };
      }
      return {
        kind: "filler" as const,
        key: item.key,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      };
    }),
    getPanelHeight
  );

  for (const filler of fillers) {
    const resolved = neighborMap.get(filler.key);
    if (resolved) {
      filler.neighbors = resolved;
    }
  }

  return { items, totalHeight };
}

interface MasonryGridProps {
  panels: Panel[];
  allPanels: Panel[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onInfoOpen?: () => void;
  onLayoutReady?: () => void;
  onPanelPositions?: (positions: { panel: Panel; y: number; h: number }[]) => void;
  onOpenPanel: (panel: Panel) => void;
  onLaunchViz?: () => void;
  isFirstLoad?: boolean;
  view?: GalleryView;
  onViewChange?: (view: GalleryView) => void;
}

export default function MasonryGrid({
  panels,
  allPanels,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
  onInfoOpen,
  onLayoutReady,
  onPanelPositions,
  onOpenPanel,
  onLaunchViz,
  view,
  onViewChange,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);
  // The card currently revealing its details overlay. Tapping a card selects it;
  // tapping the selected card opens the viewer; tapping empty space clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stampCacheRef = useRef<Map<string, { stamp: StampDef; fillerIndex: number }>>(new Map());

  const layout = useCallback(() => {
    if (!containerRef.current) return;
    const cc = getColumnCount();
    setColCount(cc);
    const containerWidth = containerRef.current.offsetWidth;
    const cw = (containerWidth - GAP * (cc - 1)) / cc;
    setColWidth(cw);

    const initialHeights = new Array(cc).fill(0);
    if (filterRef.current) {
      initialHeights[0] = filterRef.current.offsetHeight + GAP;
    }
    const lastCol = cc - 1;
    if (sortRef.current && lastCol !== 0) {
      initialHeights[lastCol] = sortRef.current.offsetHeight + GAP;
    }

    const result = computeLayout(panels, cc, containerWidth, initialHeights);

    const fillers = result.items.filter(
      (i): i is PlacedFiller => i.kind === "filler"
    );
    for (const f of fillers) {
      const cached = stampCacheRef.current.get(f.key);
      if (cached) {
        f.assignedStamp = cached.stamp;
        f.fillerIndex = cached.fillerIndex;
      } else {
        stampCacheRef.current.set(f.key, {
          stamp: f.assignedStamp,
          fillerIndex: f.fillerIndex,
        });
      }
    }

    setPlaced(result.items);
    setTotalHeight(result.totalHeight);

    // Notify lazy-loading cards that positions have settled
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("masonry-layout"));
    });
  }, [panels]);

  // Scroll position expressed in container coordinates, quantized to
  // SCROLL_BUCKET. Derived from the live rect each time, so it stays correct
  // even if the content above the grid changes height.
  const [viewport, setViewport] = useState(() => ({
    bucket: 0,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = containerRef.current;
      if (!el) return;
      const bucket = Math.floor(-el.getBoundingClientRect().top / SCROLL_BUCKET);
      const height = window.innerHeight;
      setViewport((prev) =>
        prev.bucket === bucket && prev.height === height ? prev : { bucket, height }
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const visible = useMemo(() => {
    if (placed.length === 0) return placed;
    const viewTop = viewport.bucket * SCROLL_BUCKET;
    const min = viewTop - RENDER_MARGIN;
    const max = viewTop + viewport.height + RENDER_MARGIN;
    return placed.filter((item) => {
      const h = item.kind === "filler" ? item.h : getPanelHeight(item.panel, item.w);
      return item.y + h >= min && item.y <= max;
    });
  }, [placed, viewport]);

  const handleSelect = useCallback((panel: Panel) => setSelectedId(panel.id), []);

  const prevPanelIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = panels.map((p) => p.id).join(",");
    if (ids !== prevPanelIdsRef.current) {
      prevPanelIdsRef.current = ids;
      stampCacheRef.current.clear();
    }
  }, [panels]);

  // Before paint, not after: on a mount the first frame would otherwise be an
  // empty container with the cards arriving a frame later — which the view swap
  // turns from a flicker into a real fault, since the cards would miss the
  // arrival they are supposed to animate, and the geometry the swap measures
  // would be a column width short.
  useLayoutEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  // The disclosure controls grow their box for the whole 200ms of their expand,
  // so this fires once per frame and the grid re-packs continuously behind them.
  // That continuity is the point: fillers collapse smoothly and panels flow
  // between columns in a way no single transition can express. It is affordable
  // because a pass is now O(n) and only repaints the ~25 windowed items.
  useEffect(() => {
    const observer = new ResizeObserver(() => layout());
    if (filterRef.current) observer.observe(filterRef.current);
    if (sortRef.current) observer.observe(sortRef.current);
    return () => observer.disconnect();
  }, [layout]);

  // After the first layout, wait for in-viewport images to load before
  // signalling ready. Double-rAF ensures PanelCard children have rendered
  // and their srcs are set (eager on first load via isFirstLoad prop).
  const hasCalledLayoutReady = useRef(false);
  useEffect(() => {
    if (placed.length === 0 || hasCalledLayoutReady.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (hasCalledLayoutReady.current) return;

        const allImgs = Array.from(
          document.querySelectorAll<HTMLImageElement>(".panel-item img")
        );

        const visiblePending = allImgs.filter((img) => {
          // Skip images with no real src
          if (!img.src || img.src === window.location.href) return false;
          const rect = img.getBoundingClientRect();
          const inView =
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth;
          return inView && (!img.complete || img.naturalWidth === 0);
        });

        if (visiblePending.length === 0) {
          hasCalledLayoutReady.current = true;
          onLayoutReady?.();
          return;
        }

        const timeout = setTimeout(() => {
          if (!hasCalledLayoutReady.current) {
            hasCalledLayoutReady.current = true;
            onLayoutReady?.();
          }
        }, 5000);

        let remaining = visiblePending.length;
        const onSettle = () => {
          remaining -= 1;
          if (remaining <= 0) {
            clearTimeout(timeout);
            if (!hasCalledLayoutReady.current) {
              hasCalledLayoutReady.current = true;
              onLayoutReady?.();
            }
          }
        };

        visiblePending.forEach((img) => {
          img.addEventListener("load", onSettle, { once: true });
          img.addEventListener("error", onSettle, { once: true });
        });
      });
    });
  }, [placed, onLayoutReady]);

  // Clear the revealed details when the user taps/clicks outside any card.
  useEffect(() => {
    if (selectedId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".panel-item")) setSelectedId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectedId]);

  const lastColX = (colCount - 1) * (colWidth + GAP);
  /** Where the swap's wave starts — the top of the viewport, near enough. */
  const waveTop = viewport.bucket * SCROLL_BUCKET;

  useEffect(() => {
    if (!onPanelPositions || placed.length === 0) return;
    const positions = placed
      .filter((item): item is PlacedPanel => item.kind === "panel")
      .map((item) => ({ panel: item.panel, y: item.y, h: getPanelHeight(item.panel, item.w) }));
    onPanelPositions(positions);
  }, [placed, onPanelPositions]);

  return (
    <>
      <div ref={containerRef} className="relative" style={{ height: `${totalHeight}px` }}>
        <div
          ref={filterRef}
          className="absolute top-0 left-0"
          data-persist="filter"
          style={{ width: colWidth > 0 ? `${colWidth}px` : undefined }}
        >
          <FilterControl
            panels={allPanels}
            filters={filters}
            onFiltersChange={onFiltersChange}
            onLaunchViz={onLaunchViz}
            vizDisabled={panels.length === 0}
            view={view}
            onViewChange={onViewChange}
          />
        </div>

        {colCount > 1 && (
          <div
            ref={sortRef}
            className="absolute top-0"
            data-persist="sort"
            style={{
              left: `${lastColX}px`,
              width: colWidth > 0 ? `${colWidth}px` : undefined,
            }}
          >
            <SortControl activeSort={sortMode} onSort={onSort} onInfoOpen={onInfoOpen} />
          </div>
        )}

        {visible.map((item) => {
          if (item.kind === "filler") {
            return (
              <div
                key={item.key}
                className="absolute swap-card"
                style={
                  {
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.w}px`,
                    height: `${item.h}px`,
                    "--d": staggerStep(item.x, item.y, colWidth, waveTop),
                  } as CSSProperties
                }
              >
                <HatchFiller
                  assignedStamp={item.assignedStamp}
                  fillerIndex={item.fillerIndex}
                  neighbors={item.neighbors}
                />
              </div>
            );
          }
          return (
            <div
              key={item.panel.id}
              className="absolute swap-card"
              style={
                {
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.w}px`,
                  "--d": staggerStep(item.x, item.y, colWidth, waveTop),
                } as CSSProperties
              }
            >
              <PanelCard
                panel={item.panel}
                selected={selectedId === item.panel.id}
                onSelect={handleSelect}
                onOpen={onOpenPanel}
                //isFirstLoad={isFirstLoad}
              />
            </div>
          );
        })}
      </div>
      <div className="swap-tail">
        <FooterPyramid />
      </div>
    </>
  );
}