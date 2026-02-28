import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { LoaderCircle } from "lucide-react";
import type { Gallery, Panel } from "./types";
import PanelCard from "./PanelCard";
import InfoModal from "./InfoModal";

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortMode = "newest" | "oldest" | "phash" | "ahash" | "dhash" | "color";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  { value: "phash", label: "PHASH" },
  { value: "ahash", label: "AHASH" },
  { value: "dhash", label: "DHASH" },
  { value: "color", label: "COLOR" },
];

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist + Math.abs(a.length - b.length);
}

/** Euclidean distance between two CIELAB color vectors. */
function labDistance(a: number[], b: number[]): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Colorfulness threshold for partitioning chromatic vs achromatic panels.
 * Based on RMS of std(a*) and std(b*) in CIELAB space. B&W scans with
 * paper tint typically score 2–8; muted color panels 10–15; vivid color 20+.
 */
const COLORFULNESS_THRESHOLD = 10;

/**
 * Color distance between two panels' palettes.
 *
 * Strategy: compare the most dominant color (index 0) using LAB distance,
 * then add a chroma penalty so chromatic and achromatic panels separate
 * cleanly. The secondary colors contribute a smaller weighted term.
 */
function paletteDistance(
  a: [number, number, number][] | null,
  b: [number, number, number][] | null
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;

  // Primary: distance between most dominant colors (heaviest weight)
  const primaryDist = labDistance(a[0], b[0]);

  // Chroma penalty: large when one is chromatic and the other is not
  const chromaA = labChroma(a[0]);
  const chromaB = labChroma(b[0]);
  const chromaPenalty = Math.abs(chromaA - chromaB);

  // Secondary: average LAB distance of remaining palette colors (lighter weight)
  let secondaryDist = 0;
  const minLen = Math.min(a.length, b.length);
  if (minLen > 1) {
    for (let i = 1; i < minLen; i++) {
      secondaryDist += labDistance(a[i], b[i]);
    }
    secondaryDist /= (minLen - 1);
  }

  // Weight: 60% primary, 25% chroma, 15% secondary
  return primaryDist * 0.6 + chromaPenalty * 0.25 + secondaryDist * 0.15;
}

function sortPanels(panels: Panel[], mode: SortMode): Panel[] {
  const sorted = [...panels];
  switch (mode) {
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );
    case "phash":
    case "ahash":
    case "dhash": {
      if (sorted.length <= 1) return sorted;
      const hashKey = mode as "phash" | "ahash" | "dhash";

      // Find the newest panel to use as the reference point.
      let seedIdx = 0;
      let newestTime = -Infinity;
      for (let i = 0; i < sorted.length; i++) {
        const t = new Date(sorted[i].addedAt).getTime();
        if (t > newestTime) {
          newestTime = t;
          seedIdx = i;
        }
      }

      const seedHash = sorted[seedIdx][hashKey] ?? "";
      // Sort all panels by distance from the seed (nearest first).
      // The seed itself gets distance 0, so it stays first.
      return sorted.sort((a, b) => {
        const da = hammingDistance(seedHash, a[hashKey] ?? "");
        const db = hammingDistance(seedHash, b[hashKey] ?? "");
        return da - db;
      });
    }
    case "color": {
      if (sorted.length <= 1) return sorted;

      // Find the newest panel to use as the reference point.
      let seedIdx = 0;
      let newestTime = -Infinity;
      for (let i = 0; i < sorted.length; i++) {
        const t = new Date(sorted[i].addedAt).getTime();
        if (t > newestTime) {
          newestTime = t;
          seedIdx = i;
        }
      }

      const seed = sorted[seedIdx];
      const seedColors = seed.dominantColors;
      const seedIsChromatic = (seed.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD;

      // Partition using the colorfulness score (std dev of a,b channels).
      // This reliably separates B&W scans (low variance, even with warm
      // paper tint) from genuinely colorful panels (high variance).
      const chromatic: Panel[] = [];
      const achromatic: Panel[] = [];
      for (const p of sorted) {
        if ((p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD) {
          chromatic.push(p);
        } else {
          achromatic.push(p);
        }
      }

      // Sort each group by palette distance from seed
      const byDist = (a: Panel, b: Panel) => {
        const da = paletteDistance(seedColors, a.dominantColors);
        const db = paletteDistance(seedColors, b.dominantColors);
        return da - db;
      };
      chromatic.sort(byDist);
      achromatic.sort(byDist);

      // Seed's group comes first
      return seedIsChromatic
        ? [...chromatic, ...achromatic]
        : [...achromatic, ...chromatic];
    }
    default:
      return sorted;
  }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

interface Filters {
  decades: Set<string>;
  tags: Set<string>;
  artists: Set<string>;
}

const EMPTY_FILTERS: Filters = {
  decades: new Set(),
  tags: new Set(),
  artists: new Set(),
};

function hasActiveFilters(filters: Filters): boolean {
  return filters.decades.size > 0 || filters.tags.size > 0 || filters.artists.size > 0;
}

function activeFilterCount(filters: Filters): number {
  return filters.decades.size + filters.tags.size + filters.artists.size;
}

function getDecade(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

function DecadeLabel({ decade }: { decade: string }) {
  const num = decade.replace(/s$/i, "");
  return (
    <>
      {num}<span className="text-[7px] opacity-50">s</span>
    </>
  );
}

function applyFilters(panels: Panel[], filters: Filters): Panel[] {
  if (!hasActiveFilters(filters)) return panels;
  return panels.filter((p) => {
    if (filters.decades.size > 0 && !filters.decades.has(getDecade(p.year))) return false;
    if (filters.artists.size > 0 && !filters.artists.has(p.artist)) return false;
    if (filters.tags.size > 0) {
      const panelTags = p.tags ?? [];
      if (!panelTags.some((t) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

/** Cross-dimensional facet counts: each dimension is counted against panels
 *  that pass the OTHER active filters, so counts stay meaningful. */
function computeFacets(panels: Panel[], filters: Filters) {
  const decadeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();

  for (const p of panels) {
    const passArtist = filters.artists.size === 0 || filters.artists.has(p.artist);
    const passTags = filters.tags.size === 0 || (p.tags ?? []).some((t) => filters.tags.has(t));
    const passDecade = filters.decades.size === 0 || filters.decades.has(getDecade(p.year));

    if (passArtist && passTags) {
      const dec = getDecade(p.year);
      decadeCounts.set(dec, (decadeCounts.get(dec) ?? 0) + 1);
    }
    if (passArtist && passDecade) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    if (passTags && passDecade) {
      artistCounts.set(p.artist, (artistCounts.get(p.artist) ?? 0) + 1);
    }
  }

  return { decadeCounts, tagCounts, artistCounts };
}

// ---------------------------------------------------------------------------
// Collapsible facet section
// ---------------------------------------------------------------------------

function FacetSection({
  title,
  items,
  selected,
  onToggle,
  renderLabel,
}: {
  title: string;
  items: { label: string; count: number }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  renderLabel?: (label: string) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-ink-faint/10 first:border-t-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="
          w-full flex items-center justify-between
          px-3 py-2
          text-left cursor-pointer
          hover:bg-surface-hover transition-colors duration-100
        "
      >
        <span className="font-display text-[10px] tracking-widest text-ink-faint uppercase">
          {title}
        </span>
        <span className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <span className="font-display text-[9px] text-accent tabular-nums">
              {selected.size}
            </span>
          )}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-ink-faint transition-transform duration-150 ${
              expanded ? "rotate-180" : ""
            }`}
          >
            <path d="M2.5 4L5 6.5L7.5 4" />
          </svg>
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-1 pb-1.5">
            {items.map((item) => {
              const isActive = selected.has(item.label);
              return (
                <button
                  key={item.label}
                  onClick={() => onToggle(item.label)}
                  className={`
                    w-full text-left px-2 py-1 rounded-sm
                    flex items-center justify-between gap-2
                    transition-colors duration-100
                    cursor-pointer
                    ${
                      isActive
                        ? "text-accent bg-accent/8"
                        : "text-ink-muted hover:text-ink hover:bg-surface-hover"
                    }
                  `}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {isActive && (
                      <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    )}
                    <span className="font-display text-[10px] tracking-wide uppercase truncate">
                      {renderLabel ? renderLabel(item.label) : item.label}
                    </span>
                  </span>
                  <span
                    className={`font-display text-[9px] tabular-nums flex-shrink-0 ${
                      isActive ? "text-accent/60" : "text-ink-faint"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Control (pseudo-panel — leftmost column)
// ---------------------------------------------------------------------------

function FilterControl({
  panels,
  filters,
  onFiltersChange,
}: {
  panels: Panel[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}) {
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
      {/* Header row */}
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

      {/* Expanded body */}
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

// ---------------------------------------------------------------------------
// Sort Control (pseudo-panel — rightmost column)
// ---------------------------------------------------------------------------

function SortControl({
  activeSort,
  onSort,
}: {
  activeSort: SortMode;
  onSort: (mode: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sort-control panel-item overflow-hidden rounded-sm select-none">
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
        <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
          {activeSort === "newest" || activeSort === "oldest"
            ? activeSort
            : `BY ${activeSort.toUpperCase()}`}
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

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div className="border border-t-0 border-ink-faint/20 bg-surface-raised rounded-b-sm">
            {SORT_OPTIONS.map((opt) => {
              const isActive = opt.value === activeSort;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSort(opt.value);
                    setOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2
                    font-display text-[11px] tracking-wider uppercase
                    transition-colors duration-100
                    cursor-pointer
                    ${
                      isActive
                        ? "text-accent bg-accent/8"
                        : "text-ink-muted hover:text-ink hover:bg-surface-hover"
                    }
                  `}
                >
                  <span className="flex items-center gap-2">
                    {isActive && (
                      <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    )}
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/gallery.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<Gallery>;
      })
      .then((data) => {
        setPanels(data.panels);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    if (status !== "ready" || panels.length === 0) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setImagesLoaded(true);
    }, 8000);

    const promises = panels.map(
      (panel) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `${import.meta.env.BASE_URL}${panel.image}`;
        })
    );

    Promise.all(promises).then(() => {
      if (!cancelled) {
        clearTimeout(timeout);
        setImagesLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [status, panels]);

  const filteredPanels = useMemo(
    () => applyFilters(panels, filters),
    [panels, filters]
  );
  const sortedPanels = useMemo(
    () => sortPanels(filteredPanels, sortMode),
    [filteredPanels, sortMode]
  );

  const showSpinner =
    status === "loading" || (status === "ready" && !imagesLoaded);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-ink-faint/30 pl-1!">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <h1 className="font-display font-bold text-xl tracking-tight text-ink">
            COMIC SNAPS
          </h1>
          <button
            onClick={() => setShowInfo(true)}
            className="text-ink/80 hover:text-ink transition-colors mr-2 cursor-pointer"
            title="About"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4.5 3.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-3.5 3v-3H4.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" />
              <circle cx="7" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="10" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="13" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {showSpinner && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && !showSpinner && (
          <EmptyState />
        )}
        {status === "ready" && panels.length > 0 && (
          <div
            className="transition-opacity duration-700 ease-out"
            style={{ opacity: imagesLoaded ? 1 : 0 }}
          >
            <MasonryGrid
              panels={sortedPanels}
              allPanels={panels}
              sortMode={sortMode}
              onSort={setSortMode}
              filters={filters}
              onFiltersChange={setFilters}
            />
            {hasActiveFilters(filters) && sortedPanels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-ink-muted text-sm font-display tracking-wide">
                  NO MATCHES
                </p>
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors font-display tracking-wider uppercase cursor-pointer"
                >
                  CLEAR FILTERS
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masonry grid — height-balanced columns
// ---------------------------------------------------------------------------

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

/**
 * Distribute panels into columns using shortest-column assignment for
 * height balancing, with the constraint that the first panel always goes
 * into column 0 (top-left) to preserve sort-order visibility.
 *
 * initialHeights accounts for the space occupied by controls above each
 * column (filter in col 0, sort in the last col).
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

    // Force panel 0 into column 0 so the sort-order leader is top-left.
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

function MasonryGrid({
  panels,
  allPanels,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
}: {
  panels: Panel[];
  allPanels: Panel[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}) {
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

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function SpinnerState() {
  return (
    <div className="flex items-center justify-center py-32">
      <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">Couldn't load the gallery.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">
        No panels yet. Send a photo to the Telegram bot to get started.
      </p>
    </div>
  );
}