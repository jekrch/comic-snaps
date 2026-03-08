import { useRef, useState, useCallback, useEffect } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../sorting";
import type { Filters } from "../filtering";
import PanelCard from "./PanelCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFillter";
import { buildStampPool } from "./HatchFillter";
import type { StampDef } from "./HatchFillter";
import FooterPyramid from "./FooterPryamid";
import { resolveNeighbors } from "../adjacency";
import type { NeighborMap } from "../adjacency";

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;
/**
 * Panels with aspect ratio at or above this are treated as "wide" and
 * span two columns. 1.6 catches landscape double-spreads without
 * triggering on slightly-wider-than-square panels.
 */
const WIDE_THRESHOLD = 1.4;

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
  return getAspect(panel) >= WIDE_THRESHOLD;
}


// Absolutely-positioned layout items


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
  /** Deterministic index into the cycling sequence. */
  fillerIndex: number;
  neighbors: NeighborMap;
}

type PlacedItem = PlacedPanel | PlacedFiller;


// Deterministic stamp assignment — cycles through the pool in order


/**
 * Assigns stamps to fillers by cycling sequentially through the fixed
 * pool. No randomness — the first filler gets pool[0], the second
 * gets pool[1], etc., wrapping around at the end.
 */
function assignStampsToFillers(fillers: PlacedFiller[]): void {
  const pool = buildStampPool();
  const poolSize = pool.length;

  for (let i = 0; i < fillers.length; i++) {
    fillers[i].assignedStamp = pool[i % poolSize];
    fillers[i].fillerIndex = i;
  }
}


// Panel height helper (used by adjacency resolver)


function getPanelHeight(panel: Panel, width: number): number {
  const aspect = getAspect(panel);
  return width / aspect;
}


// Layout algorithm — absolute positions for every item


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

  // Placeholder stamp and empty neighbors — will be replaced later
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

  // Assign stamps deterministically in layout order
  const fillers = items.filter((i): i is PlacedFiller => i.kind === "filler");
  assignStampsToFillers(fillers);

  // Resolve which panels border each filler
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

  // Attach resolved neighbors to each filler
  for (const filler of fillers) {
    const resolved = neighborMap.get(filler.key);
    if (resolved) {
      filler.neighbors = resolved;
    }
  }

  return { items, totalHeight };
}


// Component


interface MasonryGridProps {
  panels: Panel[];
  allPanels: Panel[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onInfoOpen?: () => void;
}

export default function MasonryGrid({
  panels,
  allPanels,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
  onInfoOpen
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);

  // Cache stamps + fillerIndex by filler key so they persist across layout
  // recalculations. This prevents fillers from changing on every resize or
  // scroll-triggered re-layout on iOS.
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

    // Stabilise filler stamps: reuse cached values for known keys,
    // cache any newly assigned ones.
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
  }, [panels]);

  // Clear the stamp cache when the panel list changes (sort/filter)
  // so that new layouts get fresh stamp assignments.
  const prevPanelIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = panels.map((p) => p.id).join(",");
    if (ids !== prevPanelIdsRef.current) {
      prevPanelIdsRef.current = ids;
      stampCacheRef.current.clear();
    }
  }, [panels]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  useEffect(() => {
    const observer = new ResizeObserver(() => layout());
    if (filterRef.current) observer.observe(filterRef.current);
    if (sortRef.current) observer.observe(sortRef.current);
    return () => observer.disconnect();
  }, [layout]);

  const lastColX = (colCount - 1) * (colWidth + GAP);

  return (
    <>
      <div ref={containerRef} className="relative" style={{ height: `${totalHeight}px` }}>
        {/* Filter control — positioned in column 0 */}
        <div
          ref={filterRef}
          className="absolute top-0 left-0"
          style={{ width: colWidth > 0 ? `${colWidth}px` : undefined }}
        >
          <FilterControl
            panels={allPanels}
            filters={filters}
            onFiltersChange={onFiltersChange}
          />
        </div>

        {/* Sort control — positioned in last column */}
        {colCount > 1 && (
          <div
            ref={sortRef}
            className="absolute top-0"
            style={{
              left: `${lastColX}px`,
              width: colWidth > 0 ? `${colWidth}px` : undefined,
            }}
          >
            <SortControl activeSort={sortMode} onSort={onSort} onInfoOpen={onInfoOpen} />
          </div>
        )}

        {/* All placed items */}
        {placed.map((item) => {
          if (item.kind === "filler") {
            return (
              <div
                key={item.key}
                className="absolute"
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.w}px`,
                  height: `${item.h}px`,
                }}
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
              className="absolute"
              style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.w}px`,
              }}
            >
              <PanelCard
                panel={item.panel}
                panels={panels}
                panelIndex={panels.indexOf(item.panel)}
              />
            </div>

          );
        })}
      </div>
      <FooterPyramid />
    </>
  );
}