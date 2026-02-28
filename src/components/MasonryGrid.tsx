import { useRef, useState, useCallback, useEffect } from "react";
import type { Panel } from "../types";
import type { SortMode } from "../sorting";
import type { Filters } from "../filtering";
import PanelCard from "./PanelCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

/**
 * distribute panels into columns using shortest-column assignment for
 * height balancing. first panel always goes into column 0 (top-left) to
 * preserve sort-order visibility.
 *
 * initialHeights accounts for space occupied by controls above each column
 * (filter in col 0, sort in the last col).
 */
function distributeToColumns(
  panels: Panel[],
  colCount: number,
  colWidth: number,
  initialHeights?: number[]
): Panel[][] {
  const columns: Panel[][] = Array.from({ length: colCount }, () => []);
  const heights: number[] = initialHeights
    ? [...initialHeights]
    : new Array(colCount).fill(0);

  for (let idx = 0; idx < panels.length; idx++) {
    const panel = panels[idx];
    let aspect = DEFAULT_ASPECT;
    if (panel.width && panel.height && panel.width > 0 && panel.height > 0) {
      aspect = panel.width / panel.height;
    }
    const renderedHeight = colWidth / aspect;

    // first panel goes into column 0 so sort order reads left-to-right
    let targetCol: number;
    if (idx === 0) {
      targetCol = 0;
    } else {
      targetCol = 0;
      let minHeight = heights[0];
      for (let i = 1; i < colCount; i++) {
        if (heights[i] < minHeight) {
          minHeight = heights[i];
          targetCol = i;
        }
      }
    }

    columns[targetCol].push(panel);
    heights[targetCol] += renderedHeight + GAP;
  }

  return columns;
}

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
  const [columns, setColumns] = useState<Panel[][]>([]);

  const layout = useCallback(() => {
    if (!containerRef.current) return;
    const colCount = getColumnCount();
    const containerWidth = containerRef.current.offsetWidth;
    const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;

    const initialHeights = new Array(colCount).fill(0);
    if (filterRef.current) {
      initialHeights[0] = filterRef.current.offsetHeight + GAP;
    }
    const lastCol = colCount - 1;
    if (sortRef.current && lastCol !== 0) {
      initialHeights[lastCol] = sortRef.current.offsetHeight + GAP;
    }

    setColumns(distributeToColumns(panels, colCount, colWidth, initialHeights));
  }, [panels]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  // re-layout when controls resize (e.g. filter panel expands)
  useEffect(() => {
    const observer = new ResizeObserver(() => layout());
    if (filterRef.current) observer.observe(filterRef.current);
    if (sortRef.current) observer.observe(sortRef.current);
    return () => observer.disconnect();
  }, [layout]);

  const lastColIdx = columns.length - 1;

  return (
    <div ref={containerRef} className="flex" style={{ gap: `${GAP}px` }}>
      {columns.map((colPanels, colIdx) => (
        <div
          key={colIdx}
          className="flex-1 flex flex-col min-w-0"
          style={{ gap: `${GAP}px` }}
        >
          {colIdx === 0 && (
            <div ref={filterRef}>
              <FilterControl
                panels={allPanels}
                filters={filters}
                onFiltersChange={onFiltersChange}
              />
            </div>
          )}
          {colIdx === lastColIdx && (
            <div ref={sortRef}>
              <SortControl activeSort={sortMode} onSort={onSort} />
            </div>
          )}
          {colPanels.map((panel) => (
            <PanelCard key={panel.id} panel={panel} />
          ))}
        </div>
      ))}
    </div>
  );
}