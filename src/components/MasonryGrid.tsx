import { useRef, useState, useCallback, useEffect } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../sorting";
import type { Filters } from "../filtering";
import type { TextSearchStatus } from "../hooks/useTextSearch";
import PanelCard from "./PanelCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFillter";
import { buildStampPool } from "./HatchFillter";
import type { StampDef } from "./HatchFillter";
import FooterPyramid from "./FooterPryamid";

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
  col: number;
  assignedStamp: StampDef;
}

type PlacedItem = PlacedPanel | PlacedFiller;

// ---------------------------------------------------------------------------
// Stamp identity helpers
// ---------------------------------------------------------------------------

function stampId(s: StampDef): string {
  if (s.type === "word") return `word:${s.value}`;
  const pool = buildStampPool();
  const idx = pool.findIndex(
    (p) => p.type === "icon" && p.value === s.value
  );
  return `icon:${idx}`;
}

// ---------------------------------------------------------------------------
// Shuffle utility (Fisher-Yates)
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Sequential stamp assigner with adjacency conflict avoidance
// ---------------------------------------------------------------------------

/**
 * Assigns stamps to fillers in the order they appear, cycling through
 * a shuffled pool. Before assigning, checks that the candidate doesn't
 * match any adjacent filler (same column predecessor, or side-by-side
 * neighbour at similar Y). If it conflicts, advances to the next in
 * the sequence. With a pool of 5 items this always resolves quickly.
 */
function assignStampsToFillers(fillers: PlacedFiller[]): void {
  const pool = shuffle(buildStampPool());
  const poolSize = pool.length;
  let cursor = 0;

  // Track the last stamp assigned per column for vertical adjacency
  const lastInCol = new Map<number, string>();

  for (let i = 0; i < fillers.length; i++) {
    const filler = fillers[i];

    // Collect stamp IDs to avoid: same-column predecessor + side-by-side neighbours
    const avoid = new Set<string>();

    const prevInCol = lastInCol.get(filler.col);
    if (prevInCol) avoid.add(prevInCol);

    // Check already-assigned neighbours in adjacent columns at similar Y
    for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
      const other = fillers[j];
      if (
        Math.abs(other.col - filler.col) === 1 &&
        Math.abs(other.y - filler.y) < GAP + 1
      ) {
        avoid.add(stampId(other.assignedStamp));
      }
    }

    // Walk the pool from cursor, pick first non-conflicting
    let chosen = pool[cursor % poolSize];
    let attempts = 0;
    while (avoid.has(stampId(chosen)) && attempts < poolSize) {
      cursor++;
      attempts++;
      chosen = pool[cursor % poolSize];
    }

    filler.assignedStamp = chosen;
    lastInCol.set(filler.col, stampId(chosen));
    cursor++;
  }
}

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

  // Placeholder stamp — will be replaced by assignStampsToFillers
  const placeholder: StampDef = { type: "word", value: "" };

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
        });
      }
    }
  }

  // Assign stamps sequentially with adjacency avoidance
  const fillers = items.filter((i): i is PlacedFiller => i.kind === "filler");
  assignStampsToFillers(fillers);

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
  textSearchStatus?: TextSearchStatus;
  textSearchProgress?: number;
}

export default function MasonryGrid({
  panels,
  allPanels,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
  textSearchStatus,
  textSearchProgress,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);

  // Cache stamps by filler key so they persist across layout recalculations.
  // This prevents fillers from randomising new stamps on every resize or
  // scroll-triggered re-layout on iOS.
  const stampCacheRef = useRef<Map<string, StampDef>>(new Map());

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

    // Stabilise filler stamps: reuse cached stamps for known keys,
    // cache any newly assigned ones.
    const fillers = result.items.filter(
      (i): i is PlacedFiller => i.kind === "filler"
    );
    for (const f of fillers) {
      const cached = stampCacheRef.current.get(f.key);
      if (cached) {
        f.assignedStamp = cached;
      } else {
        stampCacheRef.current.set(f.key, f.assignedStamp);
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
            textSearchStatus={textSearchStatus}
            textSearchProgress={textSearchProgress}
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
                <HatchFiller assignedStamp={item.assignedStamp} />
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
      <FooterPyramid />
    </>
  );
}