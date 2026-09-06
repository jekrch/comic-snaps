import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Panel } from "../types";
import type { Filters } from "../utils/filtering";
import FilterControl from "./FilterControl";
import FooterPyramid from "./FooterPryamid";
import SortMenu from "./SortMenu";
import type { SortMenuOption } from "./SortMenu";
import type { GalleryView } from "./ViewControl";

/** The wall's single breakpoint, so every view agrees about what narrow is. */
export const NARROW_WIDTH = 620;

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

export function isNarrow() {
  return typeof window !== "undefined" && window.innerWidth <= NARROW_WIDTH;
}

/** Tracks the breakpoint for a shelf that has to place rows itself. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

interface Props<Row, Mode extends string> {
  rows: Row[];
  /** Stable per row, and the windowing's whole basis — see `rowHeight`. */
  rowKey: (row: Row) => string;
  /** Uniform, in px. Every row in a shelf is exactly this tall. */
  rowHeight: number;
  /** Vertical space between rows. */
  rowGap: number;
  /** `index` is the row's place in the whole list, not in the mounted band. */
  renderRow: (row: Row, index: number, jumpTo: (index: number) => void) => ReactNode;
  /** Every panel, for the filter's facet counts — the same array the wall gets. */
  allPanels: Panel[];
  sort: Mode;
  sortOptions: SortMenuOption<Mode>[];
  onSort: (mode: Mode) => void;
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onLayoutReady?: () => void;
  /** The page has already faded in, so the first-paint check has nothing to do. */
  layoutReady?: boolean;
  onLaunchViz?: () => void;
}

/**
 * The machinery every shelf shares: the two persistent cards at the top, the
 * windowed column of fixed-height rows, the first-paint check and the tail.
 *
 * Two views are built on it — one row per series, one row per artist — and
 * they differ only in what a row *is*. Everything here is about the column
 * rather than its contents: the scroll arithmetic that keeps 124 rows to a
 * dozen mounted, the wave the view swap is dealt in, and the check that stops
 * a cold load on `?view=…` from spinning forever (§5.3, §7). Duplicating it
 * per view would mean two copies of the subtlest code in the gallery.
 */
export default function RowShelf<Row, Mode extends string>({
  rows,
  rowKey,
  rowHeight,
  rowGap,
  renderRow,
  allPanels,
  sort,
  sortOptions,
  onSort,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onLayoutReady,
  layoutReady,
  onLaunchViz,
}: Props<Row, Mode>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stride = rowHeight + rowGap;

  // Kept in a ref so `jumpTo` is stable across a re-sort — a row hands it out
  // to its own children, and a new identity every render would re-render every
  // memoized row in the band.
  const strideRef = useRef(stride);
  strideRef.current = stride;
  const jumpTo = useRef((index: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + index * strideRef.current;
    window.scrollTo({ top: top - 16, behavior: "smooth" });
  }).current;

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

  // The wall is not the only view that can be landed on, so a shelf runs the
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
          document.querySelectorAll<HTMLImageElement>(".row-strip img"),
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
  // Where the view swap's wave starts: the first row at or below the top of
  // the viewport, not the first one mounted — the band reaches 2400px above it,
  // and a wave anchored there would be over before it reached the screen.
  const waveFirst = Math.max(band.first, Math.floor((viewport.bucket * SCROLL_BUCKET) / stride));

  return (
    <>
      {/* The same two cards the wall puts in its first and last columns, in the
          same order and the same idiom — this view just lays them out itself
          rather than packing them into a masonry. `data-persist` is that claim
          made literal: on a view switch they are not repainted, they are moved
          from wherever the other view was holding them (see App). */}
      <div className="flex items-start justify-between gap-3 pb-4">
        <div className="w-45 shrink-0 sm:w-55" data-persist="filter">
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
        <div className="w-45 shrink-0 sm:w-55" data-persist="sort">
          <SortMenu
            headerLabel={`BY ${sortOptions.find((o) => o.value === sort)?.label ?? sort}`}
            options={sortOptions}
            active={sort}
            onSelect={onSort}
          />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{ height: rows.length > 0 ? rows.length * stride - rowGap : 0 }}
      >
        {visible.map((row, i) => {
          const index = band.first + i;
          return (
            <div
              key={rowKey(row)}
              className="absolute inset-x-0 swap-row"
              style={
                {
                  top: index * stride,
                  height: rowHeight,
                  // Horizontal overflow in a row nobody is looking at costs
                  // nothing (§7).
                  contentVisibility: "auto",
                  containIntrinsicSize: `auto ${rowHeight}px`,
                  // Its step of the view swap's wave — the shelf is dealt from
                  // the top down. Capped for the same reason the wall's is.
                  "--d": Math.min(Math.max(0, index - waveFirst), 5),
                } as CSSProperties
              }
            >
              {renderRow(row, index, jumpTo)}
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="swap-tail">
          <FooterPyramid />
        </div>
      )}
    </>
  );
}
