import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Panel } from "../types";
import type { SeriesRow as SeriesRowData } from "../utils/seriesRollup";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import { useNearViewport } from "../hooks/useNearViewport";
import { BLUR_COPY } from "./PanelCard";
import HatchFiller from "./HatchFillter";
import { ScoreBirds, formatScore } from "./ScoreMeter";

/**
 * Panel aspect ratios on the wall run 0.32 to 3.33. At a fixed row height a
 * naive justified strip turns the tall ones into 70px slivers and the wide ones
 * into a single panel that is the whole row, so width comes from a *clamped*
 * aspect with the image cropped to fill it (docs/series-view-plan.md §1.4).
 *
 * The crop is the point, not a compromise: a crop of a tall panel at row height
 * is a legible piece of art where the uncropped sliver is a texture sample, and
 * the panel opens uncropped in the viewer one click later.
 */
const HERO_ASPECT: readonly [number, number] = [0.62, 1.9];
/** Teases are held narrower so they never out-mass the hero. */
const TEASE_ASPECT: readonly [number, number] = [0.62, 1.1];
/** Covers are printed objects; they are all roughly this shape anyway. */
const COVER_ASPECT = 0.66;

/** The logo bird's rust, borrowed for the bare number the narrow band shows. */
const SCORE_RUST = "#8d422f";

/** Covers follow the hero, up to three (§1.5). */
const MAX_COVERS = 3;

const TILE_GAP = 4;

/**
 * Row geometry. Uniform height is what makes 113 rows scannable and windowing
 * arithmetic rather than a packing pass, so these are the numbers the shelf
 * measures its column with too (§1.1, §7).
 *
 * The head is a hatched rule carrying the title and the year. Rows of even
 * height with nothing between them run together — a strip of panels ends
 * wherever it ends, so the eye has no edge to cut on — and this is the one band
 * in the row that cannot be mistaken for art.
 */
export const HEAD_H = 26;
const HEAD_GAP = 8;
export const STRIP_H = 220;
export const STRIP_H_NARROW = 150;
/** Below the breakpoint the rail is a band above the strip, not a column. */
export const RAIL_BAND_H = 96;
export const ROW_GAP = 18;

/** Total height of one row at the current breakpoint. */
export function rowHeight(narrow: boolean): number {
  return HEAD_H + HEAD_GAP + (narrow ? RAIL_BAND_H + STRIP_H_NARROW : STRIP_H);
}

/**
 * Which rows have already played their meter. Module-scoped rather than per
 * component because windowing unmounts a row the moment it leaves the band, and
 * a re-sort that replays twenty meters at once is noise (§2.4).
 */
const meterPlayed = new Set<string>();

function panelAspect(panel: Panel): number {
  if (panel.width > 0 && panel.height > 0) return panel.width / panel.height;
  return 0.75;
}

function clampAspect(aspect: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(Math.max(aspect, lo), hi);
}

function placeholderFor(panel: Panel): string | undefined {
  const c = panel.dominantColors?.[0];
  return c ? `lab(${c[0]} ${c[1]} ${c[2]})` : undefined;
}

/** Two names plus a `+N`, so the rail never grows a third line of people. */
function capNames(names: string[]): { shown: string[]; extra: number } {
  return { shown: names.slice(0, 2), extra: Math.max(0, names.length - 2) };
}

const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };

/**
 * When this series' panels went up — first to last.
 *
 * Month precision on purpose: the exact day is on the panel, and what the row
 * is answering is whether this is something the group keeps coming back to or
 * something posted once. A series posted inside one month says so with one date.
 */
function postedRange(first: number, last: number): string | null {
  if (!first || !last) return null;
  const from = new Date(first).toLocaleDateString(undefined, MONTH_YEAR);
  const to = new Date(last).toLocaleDateString(undefined, MONTH_YEAR);
  return from === to ? to : `${from} – ${to}`;
}

interface TileProps {
  panel: Panel;
  height: number;
  range: readonly [number, number];
  onOpen: (panel: Panel) => void;
}

/**
 * One panel in the strip, cropped to its clamped width.
 *
 * The blur is honoured here rather than skipped: a row must not become the
 * place a blur does not apply. `PanelCard`'s directional variants are dropped —
 * "blurred from the left" says nothing about a centred crop of the middle — so
 * every blurred tile is covered whole, which is the safe direction to err in.
 */
function PanelTile({ panel, height, range, onOpen }: TileProps) {
  const { ref, near } = useNearViewport<HTMLButtonElement>();
  const width = Math.round(clampAspect(panelAspect(panel), range) * height);
  const isBlurred = panel.blur === "ew" || panel.blur === "nsfw";
  const label = `${panel.title} ${formatIssue(panel.issue)}`;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(panel)}
      className="series-tile relative shrink-0 overflow-hidden rounded-sm bg-surface-raised cursor-pointer"
      style={{ width, height, backgroundColor: placeholderFor(panel) }}
      aria-label={`View ${label}`}
      title={`${label} · ${panel.artist}`}
    >
      {near && (
        <img
          src={panelImageUrl(panel.image)}
          alt={label}
          decoding="async"
          className="block h-full w-full object-cover"
          style={isBlurred ? { filter: "blur(8px) saturate(0.6)", transform: "scale(1.08)" } : undefined}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      )}
      {isBlurred && (
        <>
          <span
            className="series-tile-hatch absolute inset-0"
            data-blur={panel.blur}
            aria-hidden="true"
          />
          <span className="absolute inset-0 flex items-center justify-center px-2">
            <span className="font-display text-[10px] leading-snug text-center text-white bg-black/75 px-1.5 py-1 select-none">
              {BLUR_COPY[panel.blur!]}
            </span>
          </span>
        </>
      )}
    </button>
  );
}

interface CoverProps {
  src: string;
  height: number;
  href: string | null;
}

/**
 * A cover standing in for a panel the series does not have. Visibly not a
 * panel — dimmed, outlined, labelled — and never a way into the viewer, which
 * walks panels and has nothing to page to from here (§1.5).
 */
function CoverTile({ src, height, href }: CoverProps) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const width = Math.round(COVER_ASPECT * height);
  const body = (
    <>
      {near && (
        <img
          src={panelImageUrl(src)}
          alt=""
          decoding="async"
          className="block h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      )}
      <span className="absolute bottom-1 left-1 font-display text-[8px] tracking-widest uppercase text-white/70 bg-black/60 px-1 leading-relaxed">
        cover
      </span>
    </>
  );

  return (
    <div
      ref={ref}
      className="relative shrink-0 overflow-hidden rounded-sm border border-ink-faint/40 bg-surface-raised opacity-70"
      style={{ width, height }}
    >
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="block h-full w-full">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}

interface Props {
  row: SeriesRowData;
  /** How tall the strip is; the rail matches it above the narrow breakpoint. */
  stripHeight: number;
  /** Below 620px the rail stacks above the strip instead of shrinking (§1.1). */
  narrow: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onSelectSeries: (row: SeriesRowData) => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  /** Present only when the parent series also has a row in the current set. */
  onJumpToParent?: () => void;
}

function SeriesRowView({
  row,
  stripHeight,
  narrow,
  onSelectPanel,
  onSelectSeries,
  onBrowse,
  onJumpToParent,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  /** The strip has more to show past its right edge, so the edge dissolves. */
  const [masked, setMasked] = useState(false);

  const [animateMeter] = useState(() => !meterPlayed.has(row.slug));
  useEffect(() => {
    meterPlayed.add(row.slug);
  }, [row.slug]);

  const openPanel = useCallback(
    // The group form: paging from a row walks that series and stops at its ends.
    (panel: Panel) => onSelectPanel(panel, row.panels),
    [onSelectPanel, row.panels],
  );

  const hero = row.panels[0];
  const teases = row.panels.slice(1);
  // 54 of 113 series have exactly one panel, so half the view has nothing to
  // tease with. Those rows borrow the series' own cover art (§1.5).
  const covers = row.panels.length === 1 ? row.covers.slice(0, MAX_COVERS) : [];
  const hatchTail = row.panels.length === 1 && covers.length === 0;

  const coverHref = row.series?.references?.[0]?.url ?? null;
  const score = row.rating && row.rating.count > 0 ? row.rating.avg : null;
  const posted = useMemo(
    () => postedRange(row.firstPostedAt, row.lastPostedAt),
    [row.firstPostedAt, row.lastPostedAt],
  );

  // A row that fits has no fade, which is the honest signal that there is
  // nothing past the edge; a row scrolled to its end loses it again.
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const more = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setMasked(more > 2);
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A row under `content-visibility: auto` does not lay its strip out while
    // it is skipped, so a measurement taken then reads no overflow. This
    // re-measures the moment the strip is actually on screen, which is also
    // the moment it is certainly not skipped.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) measure();
      },
      { threshold: 0 },
    );
    io.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, row.slug, stripHeight]);

  const handleStripKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const el = stripRef.current;
    if (!el) return;
    e.preventDefault();
    const step = scrollStep(el);
    el.scrollBy({ left: e.key === "ArrowRight" ? step : -step, behavior: "smooth" });
  }, []);

  const writers = capNames(row.writers);
  const artists = capNames(row.artists);

  const creditLine = (
    label: string,
    names: { shown: string[]; extra: number },
    dimension: "credits" | "artists",
  ) =>
    names.shown.length > 0 && (
      <p className="flex items-baseline gap-1.5 text-xs leading-snug">
        <span className="w-2 shrink-0 font-display text-[10px] uppercase text-white/25">{label}</span>
        <span className="min-w-0 truncate text-ink-muted">
          {names.shown.map((name, i) => (
            <span key={name}>
              {i > 0 && <span className="text-white/20">, </span>}
              <button
                type="button"
                onClick={() => onBrowse(dimension, name)}
                className="cursor-pointer hover:text-accent transition-colors"
              >
                {name}
              </button>
            </span>
          ))}
          {names.extra > 0 && <span className="text-white/25"> +{names.extra}</span>}
        </span>
      </p>
    );

  /**
   * The hatched rule: the series' name and the year its run starts. The hatch
   * is the wall's own filler motif, drawn as a gradient — a 26px rule does not
   * need `HatchFiller`'s animation machinery — and the text sits on solid
   * plates cut out of it so it stays legible over the lines.
   */
  const head = (
    <div
      className="series-head flex shrink-0 items-center gap-2 overflow-hidden px-2.5"
      style={{ height: HEAD_H }}
    >
      <button
        type="button"
        onClick={() => onSelectSeries(row)}
        className="series-head-plate min-w-0 truncate font-display text-[13px] leading-none tracking-wide text-ink hover:text-accent transition-colors cursor-pointer"
        title={`Show ${row.title} on the wall`}
      >
        {row.title}
      </button>
      <span className="min-w-4 flex-1" aria-hidden="true" />
      {/* Ten birds at phone width either wrap or shrink into blobs, and a
          shrunken bird stops being a bird (ratings-plan.md §7.2) — so the
          narrow layout trades the meter for the bare number, up here where a
          band that has run out of room cannot clip it. */}
      {narrow && score !== null && (
        <span
          className="series-head-plate shrink-0 font-display text-[13px] leading-none tabular-nums"
          style={{ color: SCORE_RUST }}
          aria-label={`${formatScore(score)} out of 10`}
        >
          {formatScore(score)}
        </span>
      )}
      {row.year !== null && (
        <span className="series-head-plate shrink-0 font-display text-[11px] leading-none tracking-wider tabular-nums text-ink-muted">
          {row.year}
        </span>
      )}
    </div>
  );

  const rail = (
    <div
      className={`series-rail flex min-w-0 flex-col gap-1 overflow-hidden pl-2.5 ${
        narrow ? "w-full pb-1.5" : "w-65 shrink-0 pr-3"
      }`}
      style={{ height: narrow ? RAIL_BAND_H : stripHeight }}
    >
      {row.publisher && <p className="truncate text-xs text-ink-muted">{row.publisher}</p>}

      {row.parent && onJumpToParent && (
        <button
          type="button"
          onClick={onJumpToParent}
          className="self-start text-[10px] uppercase tracking-wider text-white/25 hover:text-accent transition-colors cursor-pointer"
        >
          part of {row.parent.name}
        </button>
      )}

      {/* Absent, never "Unknown": 39 of 113 series have no writer, and 39 rows
          of "Unknown" would read as a data-quality bug rather than as silence. */}
      <div className="mt-0.5 flex flex-col gap-0.5">
        {creditLine("W", writers, "credits")}
        {creditLine("A", artists, "artists")}
      </div>

      {posted && (
        <p className="mt-0.5 flex items-baseline gap-1.5 text-[10px] leading-snug">
          <span className="font-display uppercase tracking-widest text-white/25">posted</span>
          <span className="truncate tabular-nums text-white/40">{posted}</span>
        </p>
      )}

      {!narrow && (
        <div className="mt-auto flex flex-col gap-0.5">
          {score !== null && (
            <div className="score-row">
              <ScoreBirds avg={score} animate={animateMeter} />
            </div>
          )}
          {/* The issue scores are rolled up and labelled, never averaged into
              the series score above them (docs/ratings-plan.md §8). */}
          {row.issueRating && (
            <p className="text-[10px] uppercase tracking-widest text-white/25">
              issues {formatScore(row.issueRating.avg)}
              <span className="text-white/15"> · {row.issueRating.count}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="series-row flex h-full flex-col" aria-label={row.title}>
      {head}
      <div
        className={`flex min-h-0 flex-1 ${narrow ? "flex-col" : "flex-row items-stretch"}`}
        style={{ marginTop: HEAD_GAP }}
      >
        {rail}
        <div
          ref={stripRef}
          tabIndex={0}
          role="group"
          aria-label={`${row.title} panels`}
          onKeyDown={handleStripKey}
          className={`series-strip flex min-w-0 flex-1 items-stretch overflow-x-auto ${
            masked ? "series-strip--masked" : ""
          }`}
          style={{ height: stripHeight, gap: TILE_GAP }}
        >
          <PanelTile panel={hero} height={stripHeight} range={HERO_ASPECT} onOpen={openPanel} />
          {teases.map((panel) => (
            <PanelTile
              key={panel.id}
              panel={panel}
              height={stripHeight}
              range={TEASE_ASPECT}
              onOpen={openPanel}
            />
          ))}
          {covers.map((src) => (
            <CoverTile key={src} src={src} height={stripHeight} href={coverHref} />
          ))}
          {/* Neither a second panel nor a cover: the same motif the masonry uses
              for leftover space, so the empty tail reads as part of the design
              rather than as a loading failure. */}
          {hatchTail && (
            <div className="min-w-20 flex-1 overflow-hidden rounded-sm" aria-hidden="true">
              <HatchFiller empty />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A couple of tiles' worth of travel per arrow press, near enough. */
function scrollStep(el: HTMLElement): number {
  return Math.max(120, Math.round(el.clientWidth * 0.4));
}

// Rows re-render whenever the shelf re-sorts or the window moves. The row is
// the expensive part — a dozen lazy-load observers apiece — and nothing about
// it changes unless its data object does.
export default memo(SeriesRowView);
