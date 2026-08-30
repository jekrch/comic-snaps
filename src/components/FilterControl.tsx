import { useState, useMemo, useCallback } from "react";
import type { Panel } from "../types";
import type { Filters, FilterSetKey } from "../utils/filtering";
import { hasActiveFilters, activeFilterCount, computeFacets, EMPTY_FILTERS } from "../utils/filtering";
import { comparePersonNames } from "../utils/names";
import FacetSection from "./FacetSection";
import DecadeLabel from "./DecadeLabel";
import { ChevronDown, Search, X, XCircle } from "lucide-react";
import VizLaunchButton from "./viz/VizLaunchButton";
import ViewControl from "./ViewControl";
import type { GalleryView } from "./ViewControl";

interface FilterControlProps {
  panels: Panel[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onLaunchViz?: () => void;
  /** Nothing survives the current filters, so there is no run to start. */
  vizDisabled?: boolean;
  /** The wall/shelf switch rides at the bottom of the list (§5.1). */
  view?: GalleryView;
  onViewChange?: (view: GalleryView) => void;
}

export default function FilterControl({
  panels,
  filters,
  onFiltersChange,
  onLaunchViz,
  vizDisabled,
  view,
  onViewChange,
}: FilterControlProps) {
  const [open, setOpen] = useState(false);
  const active = hasActiveFilters(filters);
  const count = activeFilterCount(filters);

  const { decadeCounts, tagCounts, artistCounts, coloristCounts, lettererCounts, creditCounts, postedByCounts, seriesCounts } = useMemo(
    () => computeFacets(panels, filters),
    [panels, filters]
  );

  const decadeItems = useMemo(
    () =>
      Array.from(decadeCounts.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([label, c]) => ({ label, count: c })),
    [decadeCounts]
  );

  const postedByItems = useMemo(
    () =>
      Array.from(postedByCounts.entries())
        .sort((a, b) => comparePersonNames(a[0], b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [postedByCounts]
  );

  const tagItems = useMemo(
    () =>
      Array.from(tagCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [tagCounts]
  );

  const artistItems = useMemo(
    () =>
      Array.from(artistCounts.entries())
        .sort((a, b) => comparePersonNames(a[0], b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [artistCounts]
  );

  const coloristItems = useMemo(
    () =>
      Array.from(coloristCounts.entries())
        .sort((a, b) => comparePersonNames(a[0], b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [coloristCounts]
  );

  const lettererItems = useMemo(
    () =>
      Array.from(lettererCounts.entries())
        .sort((a, b) => comparePersonNames(a[0], b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [lettererCounts]
  );

  const creditItems = useMemo(
    () =>
      Array.from(creditCounts.entries())
        .sort((a, b) => comparePersonNames(a[0], b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [creditCounts]
  );

  const seriesItems = useMemo(
    () =>
      Array.from(seriesCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [seriesCounts]
  );

  const toggleInSet = useCallback(
    (key: FilterSetKey, value: string) => {
      const next = new Set(filters[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      onFiltersChange({ ...filters, [key]: next });
    },
    [filters, onFiltersChange]
  );

  const clearAll = useCallback(() => {
    onFiltersChange(EMPTY_FILTERS);
  }, [onFiltersChange]);

  return (
    <div className="filter-control panel-item overflow-hidden select-none">
      {/* header row */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          w-full flex items-center
          px-3 py-2.5
          transition-colors duration-150
          cursor-pointer
        "
      >
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
            FILTER
          </span>
          {active && (
            <span className="font-display text-[9px] text-surface bg-accent rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
              {count}
            </span>
          )}
          <ChevronDown
            size={14}
            className={`text-ink-faint transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {/* expanded body */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div>
            {/* clear filters action at top of list */}
            {active && (
              <div className="px-3 py-2">
                <button
                  onClick={() => {
                    clearAll();
                    setOpen(false);
                  }}
                  className="
                    flex items-center gap-1.5
                    font-display text-[10px] tracking-wider uppercase
                    text-white/60 hover:text-accent
                    transition-colors duration-100
                    cursor-pointer
                  "
                >
                  <XCircle size={12} className="text-accent" />
                  CLEAR {count} {count === 1 ? "FILTER" : "FILTERS"}
                </button>
              </div>
            )}

            {/* free text across every field a panel carries */}
            <div className="px-3 pt-2 pb-2">
              <div className="filter-search-box flex items-center gap-2 px-2 py-1.5 rounded-sm bg-surface-raised/60 ring-1 ring-inset ring-ink-faint/15 focus-within:ring-accent/40 transition-colors">
                <Search size={12} strokeWidth={1.5} className="text-ink-muted shrink-0" />
                <input
                  type="text"
                  inputMode="search"
                  placeholder="title, artist, tags…"
                  value={filters.searchQuery}
                  onChange={(e) => onFiltersChange({ ...filters, searchQuery: e.target.value })}
                  className="filter-search-input flex-1 min-w-0 bg-transparent text-ink placeholder:text-ink-faint outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {filters.searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => onFiltersChange({ ...filters, searchQuery: "" })}
                    className="flex items-center justify-center h-4 w-4 rounded text-ink-muted hover:text-ink hover:bg-white/5 transition-colors shrink-0 cursor-pointer"
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>

            <FacetSection
              title="DECADE"
              items={decadeItems}
              selected={filters.decades}
              onToggle={(v) => toggleInSet("decades", v)}
              renderLabel={(label) => <DecadeLabel decade={label} />}
            />
            <FacetSection
              title="SERIES"
              items={seriesItems}
              selected={filters.series}
              onToggle={(v) => toggleInSet("series", v)}
            />
            <FacetSection
              title="TAGS"
              items={tagItems}
              selected={filters.tags}
              onToggle={(v) => toggleInSet("tags", v)}
            />
            <FacetSection
              title="ARTIST"
              items={artistItems}
              selected={filters.artists}
              onToggle={(v) => toggleInSet("artists", v)}
            />
            <FacetSection
              title="COLORIST"
              items={coloristItems}
              selected={filters.colorists}
              onToggle={(v) => toggleInSet("colorists", v)}
            />
            <FacetSection
              title="LETTERER"
              items={lettererItems}
              selected={filters.letterers}
              onToggle={(v) => toggleInSet("letterers", v)}
            />
            <FacetSection
              title="CREDITED"
              items={creditItems}
              selected={filters.credits}
              onToggle={(v) => toggleInSet("credits", v)}
            />
            <FacetSection
              title="POSTED BY"
              items={postedByItems}
              selected={filters.postedBy}
              onToggle={(v) => toggleInSet("postedBy", v)}
            />

            {/* Actions on the narrowed set, so they close the list */}
            {(onLaunchViz || (view && onViewChange)) && (
              <div
                className="mx-3 my-1"
                style={{
                  height: "1px",
                  background: "var(--color-border, rgba(74,71,69,0.25))",
                }}
              />
            )}
            {view && onViewChange && (
              <ViewControl
                view={view}
                onViewChange={(next) => {
                  setOpen(false);
                  onViewChange(next);
                }}
              />
            )}
            {onLaunchViz && (
              <VizLaunchButton
                onLaunch={() => {
                  setOpen(false);
                  onLaunchViz();
                }}
                disabled={vizDisabled}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}