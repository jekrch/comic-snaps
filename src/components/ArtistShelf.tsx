import { useCallback } from "react";
import type { Panel } from "../types";
import type { Filters } from "../utils/filtering";
import type { ArtistRow as ArtistRowData } from "../utils/artistRollup";
import type { ArtistSortMode } from "../utils/artistSorting";
import { ARTIST_SORT_OPTIONS } from "../utils/artistSorting";
import ArtistRow from "./ArtistRow";
import RowShelf, { useNarrow } from "./RowShelf";
import { ROW_GAP, STRIP_H, STRIP_H_NARROW, rowHeight } from "./rowGeometry";
import type { GalleryView } from "./ViewControl";

interface Props {
  rows: ArtistRowData[];
  /** Every panel, for the filter's facet counts — the same array the wall gets. */
  allPanels: Panel[];
  sort: ArtistSortMode;
  onSort: (mode: ArtistSortMode) => void;
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onSelectPanel: (panel: Panel, group?: Panel[], opts?: { info?: boolean; person?: string }) => void;
  onBrowseSeries: (titles: string[]) => void;
  onLayoutReady?: () => void;
  /** The page has already faded in, so the first-paint check has nothing to do. */
  layoutReady?: boolean;
  onLaunchViz?: () => void;
}

/**
 * One row per artist. The same column the series shelf runs — `RowShelf` owns
 * the windowing, the two persistent cards and the first-paint check — with a
 * different thing in each row and no parent to jump to.
 */
export default function ArtistShelf({
  rows,
  allPanels,
  sort,
  onSort,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onSelectPanel,
  onBrowseSeries,
  onLayoutReady,
  layoutReady,
  onLaunchViz,
}: Props) {
  const narrow = useNarrow();
  const stripHeight = narrow ? STRIP_H_NARROW : STRIP_H;

  const renderRow = useCallback(
    (row: ArtistRowData) => (
      <ArtistRow
        row={row}
        stripHeight={stripHeight}
        narrow={narrow}
        onSelectPanel={onSelectPanel}
        onBrowseSeries={onBrowseSeries}
      />
    ),
    [narrow, onBrowseSeries, onSelectPanel, stripHeight],
  );

  return (
    <RowShelf
      rows={rows}
      rowKey={(row) => row.name}
      rowHeight={rowHeight(narrow)}
      rowGap={ROW_GAP}
      renderRow={renderRow}
      allPanels={allPanels}
      sort={sort}
      sortOptions={ARTIST_SORT_OPTIONS}
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
