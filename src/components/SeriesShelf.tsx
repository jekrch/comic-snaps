import { useCallback, useMemo } from "react";
import type { Panel } from "../types";
import type { Filters } from "../utils/filtering";
import type { SeriesRow as SeriesRowData } from "../utils/seriesRollup";
import type { SeriesSortMode } from "../utils/seriesSorting";
import { SERIES_SORT_OPTIONS } from "../utils/seriesSorting";
import RowShelf, { useNarrow } from "./RowShelf";
import SeriesRow from "./SeriesRow";
import { ROW_GAP, STRIP_H, STRIP_H_NARROW, rowHeight } from "./rowGeometry";
import type { GalleryView } from "./ViewControl";

interface Props {
  rows: SeriesRowData[];
  /** Every panel, for the filter's facet counts — the same array the wall gets. */
  allPanels: Panel[];
  sort: SeriesSortMode;
  onSort: (mode: SeriesSortMode) => void;
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onSelectPanel: (panel: Panel, group?: Panel[], opts?: { info?: boolean }) => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  onLayoutReady?: () => void;
  /** The page has already faded in, so the first-paint check has nothing to do. */
  layoutReady?: boolean;
  onLaunchViz?: () => void;
}

/**
 * One row per series. Everything about the column — the windowing, the two
 * persistent cards, the first-paint check — is `RowShelf`'s; what is left here
 * is what a series row is and the one thing only this view has, a child row's
 * jump up to its parent.
 */
export default function SeriesShelf({
  rows,
  allPanels,
  sort,
  onSort,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onSelectPanel,
  onBrowse,
  onLayoutReady,
  layoutReady,
  onLaunchViz,
}: Props) {
  const narrow = useNarrow();
  const stripHeight = narrow ? STRIP_H_NARROW : STRIP_H;

  // Which rows can be jumped to — a child's breadcrumb only offers the parent
  // when the parent survived the same filters.
  const indexBySlug = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => map.set(row.slug, i));
    return map;
  }, [rows]);

  const renderRow = useCallback(
    (row: SeriesRowData, _index: number, jumpTo: (index: number) => void) => {
      const parentIndex = row.parent ? indexBySlug.get(row.parent.id) : undefined;
      return (
        <SeriesRow
          row={row}
          stripHeight={stripHeight}
          narrow={narrow}
          onSelectPanel={onSelectPanel}
          onBrowse={onBrowse}
          onJumpToParent={parentIndex === undefined ? undefined : () => jumpTo(parentIndex)}
        />
      );
    },
    [indexBySlug, narrow, onBrowse, onSelectPanel, stripHeight],
  );

  return (
    <RowShelf
      rows={rows}
      rowKey={(row) => row.slug}
      rowHeight={rowHeight(narrow)}
      rowGap={ROW_GAP}
      renderRow={renderRow}
      allPanels={allPanels}
      sort={sort}
      sortOptions={SERIES_SORT_OPTIONS}
      onSort={onSort}
      view={view}
      onViewChange={onViewChange}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onLayoutReady={onLayoutReady}
      layoutReady={layoutReady}
      onLaunchViz={onLaunchViz}
    />
  );
}
