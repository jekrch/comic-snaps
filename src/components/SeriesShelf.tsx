import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Panel } from "../types";
import type { Filters } from "../utils/filtering";
import type { SeriesRow as SeriesRowData } from "../utils/seriesRollup";
import type { SeriesSortMode } from "../utils/seriesSorting";
import { SERIES_SORT_OPTIONS } from "../utils/seriesSorting";
import FilterControl from "./FilterControl";
import FooterPyramid from "./FooterPryamid";
import SeriesRow, { ROW_GAP, STRIP_H, STRIP_H_NARROW, rowHeight } from "./SeriesRow";
import SortMenu from "./SortMenu";
import type { GalleryView } from "./ViewControl";

/** The wall's single breakpoint, so the two views agree about what narrow is. */
const NARROW_WIDTH = 620;

/**
 * Same idiom as the masonry: quantize scroll into buckets and render the band
 * around the viewport. With a fixed row height it is arithmetic rather than a
 * filter over placed items — about a dozen rows mount at once (§7).
 *
 * RENDER_MARGIN sits above `useNearViewport`'s 1500px preload margin so a row
 * mounts before its images are wanted.
 */
const RENDER_MARGIN = 2400;
const SCROLL_BUCKET = 300;

function isNarrow() {
  return typeof window !== "undefined" && window.innerWidth <= NARROW_WIDTH;
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(isNarrow);

  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rowH = rowHeight(narrow);
  const stride = rowH + ROW_GAP;
  const stripHeight = narrow ? STRIP_H_NARROW : STRIP_H;

  // Which rows can be jumped to — a child's breadcrumb only offers the parent
  // when the parent survived the same filters.
  const indexBySlug = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => map.set(row.slug, i));
    return map;
  }, [rows]);

  const jumpTo = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY + index * stride;
      window.scrollTo({ top: top - 16, behavior: "smooth" });
    },
    [stride],
  );

  // Scroll position in container coordinates, quantized — derived from the live
  // rect each time so it stays correct when the header above changes height.
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
        prev.bucket === bucket && prev.height === height ? prev : { bucket, height },
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

  const band = useMemo(() => {
    if (rows.length === 0) return { first: 0, last: -1 };
    const viewTop = viewport.bucket * SCROLL_BUCKET;
    const first = Math.max(0, Math.floor((viewTop - RENDER_MARGIN) / stride));
    const last = Math.min(
      rows.length - 1,
      Math.ceil((viewTop + viewport.height + RENDER_MARGIN) / stride),
    );
    return { first, last };
  }, [rows.length, viewport, stride]);

  // The wall is not the only view that can be landed on, so the shelf runs the
  // same first-paint check the masonry does — against its own images. Without
  // it, `?view=series` is a permanent spinner (§5.3).
  const calledReady = useRef(false);
  useEffect(() => {
    if (layoutReady || calledReady.current || rows.length === 0) return;

    const settle = () => {
      if (calledReady.current) return;
      calledReady.current = true;
      onLayoutReady?.();
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (calledReady.current) return;

        const pending = Array.from(
          document.querySelectorAll<HTMLImageElement>(".series-strip img"),
        ).filter((img) => {
          if (!img.src || img.src === window.location.href) return false;
          const rect = img.getBoundingClientRect();
          const inView =
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth;
          return inView && (!img.complete || img.naturalWidth === 0);
        });

        if (pending.length === 0) {
          settle();
          return;
        }

        timeout = setTimeout(settle, 5000);

        let remaining = pending.length;
        const onSettle = () => {
          remaining -= 1;
          if (remaining <= 0) {
            clearTimeout(timeout);
            settle();
          }
        };
        pending.forEach((img) => {
          img.addEventListener("load", onSettle, { once: true });
          img.addEventListener("error", onSettle, { once: true });
        });
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, [rows.length, layoutReady, onLayoutReady]);

  const visible = rows.slice(band.first, band.last + 1);

  return (
    <>
      {/* The same two cards the wall puts in its first and last columns, in the
          same order and the same idiom — this view just lays them out itself
          rather than packing them into a masonry. */}
      <div className="flex items-start justify-between gap-3 pb-4">
        <div className="w-45 shrink-0 sm:w-55">
          <FilterControl
            panels={allPanels}
            filters={filters}
            onFiltersChange={onFiltersChange}
            onLaunchViz={onLaunchViz}
            vizDisabled={rows.length === 0}
            view={view}
            onViewChange={onViewChange}
          />
        </div>
        <div className="w-45 shrink-0 sm:w-55">
          <SortMenu
            headerLabel={`BY ${SERIES_SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort}`}
            options={SERIES_SORT_OPTIONS}
            active={sort}
            onSelect={onSort}
          />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{ height: rows.length > 0 ? rows.length * stride - ROW_GAP : 0 }}
      >
        {visible.map((row, i) => {
          const index = band.first + i;
          const parentIndex = row.parent ? indexBySlug.get(row.parent.id) : undefined;
          return (
            <div
              key={row.slug}
              className="absolute inset-x-0"
              style={{
                top: index * stride,
                height: rowH,
                // Horizontal overflow in a row nobody is looking at costs
                // nothing (§7).
                contentVisibility: "auto",
                containIntrinsicSize: `auto ${rowH}px`,
              }}
            >
              <SeriesRow
                row={row}
                stripHeight={stripHeight}
                narrow={narrow}
                onSelectPanel={onSelectPanel}
                onBrowse={onBrowse}
                onJumpToParent={
                  parentIndex === undefined ? undefined : () => jumpTo(parentIndex)
                }
              />
            </div>
          );
        })}
      </div>

      {rows.length > 0 && <FooterPyramid />}
    </>
  );
}
