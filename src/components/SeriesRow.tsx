import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Panel } from "../types";
import { buildCoverPanels, type SeriesRow as SeriesRowData } from "../utils/seriesRollup";
import { panelImageUrl } from "../utils/imageUrl";
import { useNearViewport } from "../hooks/useNearViewport";
import { useRowStrip } from "../hooks/useRowStrip";
import RowBackdrop from "./RowBackdrop";
import RowTile from "./RowTile";
import RowHatchTail from "./RowHatchTail";
import { ScoreBirds, formatScore } from "./ScoreMeter";
import {
  HEAD_GAP,
  HEAD_H,
  HERO_ASPECT,
  RAIL_BAND_H,
  SCROLLBAR_H,
  TEASE_ASPECT,
  TILE_GAP,
  capNames,
  meterPlayed,
  postedRange,
} from "./rowGeometry";

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
      className="row-cover relative shrink-0 cursor-pointer overflow-hidden rounded-sm border border-ink-faint/40 bg-surface-raised opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
  const { stripRef, overflows, onKeyDown: handleStripKey } = useRowStrip([row.slug, stripHeight]);

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
      className="row-head relative flex shrink-0 items-center gap-2 overflow-hidden px-2.5"
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
      <span className="row-head-rule min-w-6 flex-1" aria-hidden="true" />
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
      className={`row-rail flex min-w-0 flex-col gap-1 overflow-hidden pl-2.5 ${
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
    <section className="shelf-row relative flex h-full flex-col" aria-label={row.title}>
      {/* Atmosphere, not information: it is masked away well before the strip
          begins, so it lives behind the rail's white space and never competes
          with the panels for the same pixels. */}
      {backdrop && <RowBackdrop key={backdrop} src={backdrop} />}
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
          className={`row-strip flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden ${
            overflows ? "row-strip--masked" : ""
          }`}
          style={{ height: stripHeight, gap: TILE_GAP }}
        >
          <RowTile panel={hero} height={tileHeight} range={HERO_ASPECT} onOpen={openPanel} />
          {teases.map((panel) => (
            <RowTile
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
          {/* Whatever the panels and covers left over: the same motif the
              masonry uses for leftover space, so a strip that stops short of
              its right edge reads as part of the design rather than as a
              loading failure. A row that overflows has no leftover space and
              so no tail — the strip's own measurement is what says which. */}
          {!overflows && <RowHatchTail tileHeight={tileHeight} />}
        </div>
      </div>
    </section>
  );
}

// Rows re-render whenever the shelf re-sorts or the window moves. The row is
// the expensive part — a dozen lazy-load observers apiece — and nothing about
// it changes unless its data object does.
export default memo(SeriesRowView);
