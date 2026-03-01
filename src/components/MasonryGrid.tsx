import { useRef, useState, useCallback, useEffect } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../sorting";
import type { Filters } from "../filtering";
import PanelCard from "./PanelCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFillter";

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;
/**
 * Panels with aspect ratio at or above this are treated as "wide" and
 * span two columns. 1.6 catches landscape double-spreads without
 * triggering on slightly-wider-than-square panels.
 */
const WIDE_THRESHOLD = 1.2;

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

// ---------------------------------------------------------------------------
// Absolutely-positioned layout items
// ---------------------------------------------------------------------------

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
}

type PlacedItem = PlacedPanel | PlacedFiller;

// ---------------------------------------------------------------------------
// Layout algorithm — absolute positions for every item
// ---------------------------------------------------------------------------

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

  for (let idx = 0; idx < panels.length; idx++) {
    const panel = panels[idx];
    const aspect = getAspect(panel);
    const wide = isWide(panel) && colCount >= 2;

    if (wide) {
      // --- Wide panel: spans 2 adjacent columns ---

      // Pick the best adjacent pair (lowest max-height = most compact)
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

      // Hatch filler in whichever column is shorter, filling the gap
      // between its current bottom edge and the top of the wide panel
      if (heights[col1] < tallest) {
        const fillerH = tallest - heights[col1];
        items.push({
          kind: "filler",
          key: `filler-${panel.id}-L`,
          x: colX(col1),
          y: heights[col1],
          w: colWidth,
          h: fillerH,
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
        });
      }

      // Place the wide panel spanning both columns
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
      // --- Normal panel: single column, shortest-column assignment ---
      let targetCol = 0;
      let minH = heights[0];
      for (let i = 1; i < colCount; i++) {
        if (heights[i] < minH) {
          minH = heights[i];
          targetCol = i;
        }
      }
      // For the very first panel, prefer col 0 if it's close to shortest
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
  return { items, totalHeight };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MasonryGridProps {
  panels: Panel[];
  allPanels: Panel[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function MasonryGrid({
  panels,
  allPanels,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);

  const layout = useCallback(() => {
    if (!containerRef.current) return;
    const cc = getColumnCount();
    setColCount(cc);
    const containerWidth = containerRef.current.offsetWidth;
    const cw = (containerWidth - GAP * (cc - 1)) / cc;
    setColWidth(cw);

    // Initial heights account for filter/sort controls
    const initialHeights = new Array(cc).fill(0);
    if (filterRef.current) {
      initialHeights[0] = filterRef.current.offsetHeight + GAP;
    }
    const lastCol = cc - 1;
    if (sortRef.current && lastCol !== 0) {
      initialHeights[lastCol] = sortRef.current.offsetHeight + GAP;
    }

    const result = computeLayout(panels, cc, containerWidth, initialHeights);
    setPlaced(result.items);
    setTotalHeight(result.totalHeight);
  }, [panels]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  // Re-layout when controls resize (e.g. filter panel expands)
  useEffect(() => {
    const observer = new ResizeObserver(() => layout());
    if (filterRef.current) observer.observe(filterRef.current);
    if (sortRef.current) observer.observe(sortRef.current);
    return () => observer.disconnect();
  }, [layout]);

  const lastColX = (colCount - 1) * (colWidth + GAP);

  return (
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
          <SortControl activeSort={sortMode} onSort={onSort} />
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
              <HatchFiller />
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
            <PanelCard panel={item.panel} />
          </div>
        );
      })}
    </div>
  );
}