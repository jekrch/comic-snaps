import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Panel } from "../types";
import { buildCoverPanels, type SeriesRow as SeriesRowData } from "../utils/seriesRollup";
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

/**
 * Covers close every strip, after the last panel (§1.5).
 *
 * Four is every cover the metadata has for any series, so the cap is really
 * "all of them". They come last on purpose: the panels are what the wall
 * collected and the covers are what the book looked like on a shelf, so the
 * strip reads panels-then-objects and the covers are the thing the row trails
 * off into rather than something the eye has to get past.
 */
const MAX_COVERS = 4;

const TILE_GAP = 4;

/**
 * Height the strip gives up to its scrollbar, so the bar has somewhere to sit
 * that is not on top of the art. Reserved on the desktop layout only — the
 * narrow one keeps the bar hidden and the tiles take the full height — and it
 * is reserved whether or not the row actually overflows, because uniform row
 * height is what the shelf's windowing arithmetic is built on (§7).
 */
const SCROLLBAR_H = 10;

/**
 * Row geometry. Uniform height is what makes 113 rows scannable and windowing
 * arithmetic rather than a packing pass, so these are the numbers the shelf
 * measures its column with too (§1.1, §7).
 *
 * The head is a hatched rule carrying the title and the year. Rows of even
 * height with nothing between them run together — a strip of panels ends
 * wherever it ends, so the eye has no edge to cut on — and this is the one band
 * in the row that cannot be mistaken for art.
 *
 * 28px is the floor, not a round number: the title is a 15px line and the band
 * has to hold it with enough air on either side that the hatch beside it reads
 * as a rule the type is set on rather than as a texture crowding it.
 */
export const HEAD_H = 28;
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
const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/**
 * When this series' panels went up — first to last.
 *
 * Month precision across months, because what the row is answering is whether
 * this is something the group keeps coming back to or something posted once,
 * and the exact day of each panel is on the panel.
 *
 * A span that opens and closes inside one month is the case month precision
 * cannot state: "Aug 2026" for four panels reads as one post rather than as a
 * fortnight of them. Those drop to days and name the month once — the range is
 * still a range, without printing the same word at both ends. A series with a
 * genuinely single posting day keeps the one date it has always had.
 */
function postedRange(first: number, last: number): string | null {
  if (!first || !last) return null;
  const a = new Date(first);
  const b = new Date(last);

  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    if (a.getDate() === b.getDate()) return b.toLocaleDateString(undefined, MONTH_YEAR);
    // "Aug 1 – 15, 2026": the month leads, the closing day is bare, and the
    // year is stated once at the end for both.
    const from = a.toLocaleDateString(undefined, MONTH_DAY);
    return `${from} – ${b.getDate()}, ${b.getFullYear()}`;
  }

  const from = a.toLocaleDateString(undefined, MONTH_YEAR);
  const to = b.toLocaleDateString(undefined, MONTH_YEAR);
  return `${from} – ${to}`;
}

/**
 * The image the row washes its background with: a close-up of the series
 * itself, dimmed almost out of sight, so a row reads as *this* book's shelf
 * rather than as a generic strip — the same move the info drawer makes behind
 * its series card.
 *
 * A cover the strip is not already showing comes first — never a second copy of
 * a tile a few pixels to the right — though with every cover now ending the
 * strip that leaves the series' key image, which is a different photograph of
 * the book anyway. Then the parent's, then any cover at all, and only then the
 * row's own art, skipping blurred panels: the strip covers those on purpose and
 * the backdrop must not uncover them.
 */
function backdropSrc(row: SeriesRowData, shownCovers: number): string | null {
  const spare = row.covers[shownCovers];
  if (spare) return spare;
  if (row.series?.imageUrl) return row.series.imageUrl;
  if (row.parent?.imageUrl) return row.parent.imageUrl;
  if (row.covers[0]) return row.covers[0];
  return row.panels.find((p) => !p.blur)?.image ?? null;
}

/**
 * How far past 1:1 the backdrop may be magnified, and the zoom a source big
 * enough to afford it gets.
 *
 * The covers are not one size — they run from 293x450 to 832x1280 — and
 * `object-fit: cover` has already blown a small one up to the width of the wash
 * before any zoom is applied. So the zoom is whatever is left of the budget
 * after that: a big scan gets the full close-up, a small one is left nearly
 * where cover put it rather than magnified into visible blocks.
 */
const BACKDROP_MAX_UPSCALE = 1.5;
const BACKDROP_ZOOM = 1.85;
/** Never exactly 1: a hair of overscan keeps the blur from sampling past the
 *  image's own edges and drawing a soft border inside the wash. */
const BACKDROP_MIN_ZOOM = 1.04;

/**
 * The wash itself: the series' art behind the rail, fitted to whatever
 * resolution the source actually has.
 *
 * Whatever upscale the budget cannot avoid is spent as softness instead — at
 * 19% opacity a soft wash is the effect, where a sharp grid of blocks is just a
 * small picture stretched. The fit is measured rather than assumed because the
 * box is a share of the row's width, which is the window's.
 */
function SeriesBackdrop({ src }: { src: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ transform: string; filter: string } | null>(null);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalWidth || !img.naturalHeight) return;
    const boxW = wrap.clientWidth;
    const boxH = wrap.clientHeight;
    // Under `content-visibility: auto` a row that is still skipped lays nothing
    // out; the ResizeObserver calls back the moment it does.
    if (!boxW || !boxH) return;

    const cover = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const zoom = Math.min(
      BACKDROP_ZOOM,
      Math.max(BACKDROP_MIN_ZOOM, BACKDROP_MAX_UPSCALE / cover),
    );
    const upscale = Math.max(1, cover * zoom);
    const blur = Math.min(2.2, (upscale - 1) * 1.3);

    const next = {
      transform: `scale(${zoom.toFixed(3)})`,
      filter: `saturate(0.85) contrast(1.05)${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
    };
    setFit((prev) =>
      prev && prev.transform === next.transform && prev.filter === next.filter ? prev : next,
    );
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={wrapRef} className="series-bg" data-fitted={fit ? "true" : undefined} aria-hidden="true">
      <img
        ref={imgRef}
        src={panelImageUrl(src)}
        alt=""
        loading="lazy"
        decoding="async"
        style={fit ?? undefined}
        onLoad={measure}
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
    </div>
  );
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
 *
 * `data-panel-id` is how the viewer finds the tile to fly out of and collapse
 * back into, the same handle `PanelCard` carries on the wall.
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
      data-panel-id={panel.id}
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
  panel: Panel;
  height: number;
  onOpen: (panel: Panel) => void;
}

/**
 * A cover closing out the strip. Visibly not a panel — dimmed, outlined,
 * labelled — but opened the same way one is: the viewer walks the row's panels
 * and then its covers, so a strip can be paged from end to end without the
 * covers being the one thing on it that goes somewhere else.
 *
 * It lifts to full opacity under the pointer, which is the tile saying it is a
 * way in; the dimming is there to keep a cover from reading as a panel at rest,
 * not to say it is inert.
 */
function CoverTile({ panel, height, onOpen }: CoverProps) {
  const { ref, near } = useNearViewport<HTMLButtonElement>();
  const width = Math.round(COVER_ASPECT * height);

  return (
    <button
      ref={ref}
      type="button"
      data-panel-id={panel.id}
      onClick={() => onOpen(panel)}
      className="series-cover relative shrink-0 cursor-pointer overflow-hidden rounded-sm border border-ink-faint/40 bg-surface-raised opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      style={{ width, height }}
      aria-label={`View ${panel.title} cover`}
      title={`${panel.title} · cover`}
    >
      {near && (
        <img
          src={panelImageUrl(panel.image)}
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
    </button>
  );
}

interface Props {
  row: SeriesRowData;
  /** How tall the strip is; the rail matches it above the narrow breakpoint. */
  stripHeight: number;
  /** Below 620px the rail stacks above the strip instead of shrinking (§1.1). */
  narrow: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[], opts?: { info?: boolean }) => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  /** Present only when the parent series also has a row in the current set. */
  onJumpToParent?: () => void;
}

function SeriesRowView({
  row,
  stripHeight,
  narrow,
  onSelectPanel,
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

  const hero = row.panels[0];
  const teases = row.panels.slice(1);
  // Every row that has covers ends in them — 54 of 113 series have exactly one
  // panel and nothing to tease with, and the rest are still books someone can
  // go and buy (§1.5).
  const covers = useMemo(() => buildCoverPanels(row, row.covers.slice(0, MAX_COVERS)), [row]);
  const hatchTail = row.panels.length === 1 && covers.length === 0;

  // What prev/next walks: the strip itself, in the order it is drawn, so paging
  // from any tile runs the panels and then the covers and stops at the row's
  // ends rather than wandering into the next series.
  const group = useMemo(() => [...row.panels, ...covers], [row.panels, covers]);

  const openPanel = useCallback(
    (panel: Panel) => onSelectPanel(panel, group),
    [onSelectPanel, group],
  );

  /**
   * The title opens the row's first panel with the info drawer already out —
   * the series card, its credits and its scores are what a reader clicking the
   * name is after, and the drawer is where all of that already lives. The
   * panel behind it is the row's own hero, so the viewer still pages the strip
   * from where the row starts.
   */
  const openSeriesInfo = useCallback(
    () => onSelectPanel(hero, group, { info: true }),
    [onSelectPanel, hero, group],
  );

  // The bar sits inside the strip's own box, so the tiles are shorter than the
  // strip by exactly its height and the row keeps the height the shelf placed it at.
  const tileHeight = narrow ? stripHeight : stripHeight - SCROLLBAR_H;

  const backdrop = useMemo(() => backdropSrc(row, covers.length), [row, covers.length]);

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
   * The hatched rule: the series' name and the year its run starts, strung
   * along the wall's own filler motif drawn as a gradient — a 28px rule does
   * not need `HatchFiller`'s animation machinery.
   *
   * The hatch is the flexible gap between them, not a band running behind
   * them. Type set over the full-width hatch needed a plate cut out of it to
   * stay legible, and a plate in a band this short is a near-black lozenge the
   * height of the band — so the words came with boxes attached. Here nothing
   * is cut: the title and year sit on the page's own surface and the rule
   * simply takes whatever room is left between them.
   *
   * The title is capped rather than free to fill the row, so the rule survives
   * a long name and every row's head has the same shape.
   *
   * Its line-height is not `leading-none`: `truncate` clips the button to its
   * own box, and at line-height 1 that box is the 15px em square, which Space
   * Mono's descenders hang below — a `y` came out flat-bottomed. 1.5 gives the
   * box 22px inside the 28px band, so the descenders are contained and the
   * band does not grow; the extra leading is split evenly, so the type stays
   * centred where it was.
   */
  const head = (
    <div
      className="series-head relative flex shrink-0 items-center gap-2 overflow-hidden px-2.5"
      style={{ height: HEAD_H }}
    >
      <button
        type="button"
        onClick={openSeriesInfo}
        className="min-w-0 max-w-[62%] truncate font-display text-[15px] leading-[1.5] tracking-wide text-ink hover:text-accent transition-colors cursor-pointer"
        title={`About ${row.title}`}
      >
        {row.title}
      </button>
      <span className="series-head-rule min-w-6 flex-1" aria-hidden="true" />
      {/* Ten birds at phone width either wrap or shrink into blobs, and a
          shrunken bird stops being a bird (ratings-plan.md §7.2) — so the
          narrow layout trades the meter for the bare number, up here where a
          band that has run out of room cannot clip it. */}
      {narrow && score !== null && (
        <span
          className="shrink-0 font-display text-[13px] leading-none tabular-nums"
          style={{ color: SCORE_RUST }}
          aria-label={`${formatScore(score)} out of 10`}
        >
          {formatScore(score)}
        </span>
      )}
      {row.year !== null && (
        <span className="shrink-0 font-display text-[11px] leading-none tracking-wider tabular-nums text-ink-muted">
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
    <section className="series-row relative flex h-full flex-col" aria-label={row.title}>
      {/* Atmosphere, not information: it is masked away well before the strip
          begins, so it lives behind the rail's white space and never competes
          with the panels for the same pixels. */}
      {backdrop && <SeriesBackdrop key={backdrop} src={backdrop} />}
      {head}
      <div
        className={`relative flex min-h-0 flex-1 ${narrow ? "flex-col" : "flex-row items-stretch"}`}
        style={{ marginTop: HEAD_GAP }}
      >
        {rail}
        <div
          ref={stripRef}
          tabIndex={0}
          role="group"
          aria-label={`${row.title} panels`}
          onKeyDown={handleStripKey}
          className={`series-strip flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden ${
            masked ? "series-strip--masked" : ""
          }`}
          style={{ height: stripHeight, gap: TILE_GAP }}
        >
          <PanelTile panel={hero} height={tileHeight} range={HERO_ASPECT} onOpen={openPanel} />
          {teases.map((panel) => (
            <PanelTile
              key={panel.id}
              panel={panel}
              height={tileHeight}
              range={TEASE_ASPECT}
              onOpen={openPanel}
            />
          ))}
          {covers.map((cover) => (
            <CoverTile key={cover.id} panel={cover} height={tileHeight} onOpen={openPanel} />
          ))}
          {/* Neither a second panel nor a cover: the same motif the masonry uses
              for leftover space, so the empty tail reads as part of the design
              rather than as a loading failure. */}
          {hatchTail && (
            <div
              className="min-w-20 flex-1 overflow-hidden rounded-sm"
              style={{ height: tileHeight }}
              aria-hidden="true"
            >
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
