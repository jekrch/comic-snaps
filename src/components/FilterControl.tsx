import { useState, useMemo, useCallback } from "react";
import type { Panel } from "../types";
import type { Filters } from "../filtering";
import { hasActiveFilters, activeFilterCount, computeFacets, EMPTY_FILTERS } from "../filtering";
import FacetSection from "./FacetSection";
import DecadeLabel from "./DecadeLabel";

interface FilterControlProps {
  panels: Panel[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function FilterControl({
  panels,
  filters,
  onFiltersChange,
}: FilterControlProps) {
  const [open, setOpen] = useState(false);
  const active = hasActiveFilters(filters);
  const count = activeFilterCount(filters);

  const { decadeCounts, tagCounts, artistCounts } = useMemo(
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
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, c]) => ({ label, count: c })),
    [artistCounts]
  );

  const toggleInSet = useCallback(
    (key: keyof Filters, value: string) => {
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
    <div className="filter-control panel-item overflow-hidden rounded-sm select-none">
      {/* header row */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          w-full flex items-center justify-between
          bg-surface-raised hover:bg-surface-hover
          border border-ink-faint/20
          px-3 py-2.5
          transition-colors duration-150
          cursor-pointer
          rounded-sm
        "
      >
        <span className="flex items-center gap-2">
          <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
            FILTER
          </span>
          {active && (
            <span className="font-display text-[9px] text-surface bg-accent rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
              {count}
            </span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-faint transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M3.5 5.5L7 9L10.5 5.5" />
        </svg>
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
          <div className="border border-t-0 border-ink-faint/20 bg-surface-raised rounded-b-sm">
            <FacetSection
              title="DECADE"
              items={decadeItems}
              selected={filters.decades}
              onToggle={(v) => toggleInSet("decades", v)}
              renderLabel={(label) => <DecadeLabel decade={label} />}
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

            {active && (
              <div className="border-t border-ink-faint/10 px-3 py-2">
                <button
                  onClick={() => {
                    clearAll();
                    setOpen(false);
                  }}
                  className="
                    font-display text-[10px] tracking-wider uppercase
                    text-ink-faint hover:text-accent
                    transition-colors duration-100
                    cursor-pointer
                  "
                >
                  CLEAR ALL
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}