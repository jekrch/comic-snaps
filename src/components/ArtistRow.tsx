import { memo, useCallback, useMemo } from "react";
import type { Panel } from "../types";
import type { ArtistRow as ArtistRowData } from "../utils/artistRollup";
import { useRowStrip } from "../hooks/useRowStrip";
import RowBackdrop from "./RowBackdrop";
import RowTile from "./RowTile";
import RowHatchTail from "./RowHatchTail";
import {
  HEAD_GAP,
  HEAD_H,
  HERO_ASPECT,
  RAIL_BAND_H,
  SCROLLBAR_H,
  TEASE_ASPECT,
  TILE_GAP,
  capNames,
  postedRange,
} from "./rowGeometry";

/** What the rail gives up under the narrow band so the row below it can
 *  breathe — and, since the portrait fills the band there, the one number the
 *  narrow face size is derived from. */
const NARROW_RAIL_PAD = 6;

/**
 * The portrait, at each breakpoint. Square, because 111 of the 124 sources are
 * already head-and-shoulders crops and the rest crop to one without losing a
 * face.
 *
 * Wide, it is the largest thing in the rail — a face at 46px was a stamp you
 * had to lean in to read, and the whole argument for this view over a filter
 * is that a directory of faces is browsable where a directory of names is not.
 * Narrow, it takes the full height of the band and the text sits beside it: the
 * band is 96px of a phone's width either way, and a portrait using all of it is
 * a picture where one floating at the top of a column of type is a bullet.
 */
const FACE = 84;
const FACE_NARROW = RAIL_BAND_H - NARROW_RAIL_PAD;

/**
 * The image the row washes its background with: the artist's own portrait,
 * dimmed almost out of sight, so a row reads as *this* person's shelf rather
 * than as a generic strip — the same move the series row makes with the book.
 *
 * 13 of the 124 names on the wall have no portrait. Those fall back to their
 * own art, skipping blurred panels: the strip covers those on purpose and the
 * backdrop must not uncover them.
 */
function backdropSrc(row: ArtistRowData): string | null {
  if (row.artist?.imageUrl) return row.artist.imageUrl;
  return row.panels.find((p) => !p.blur)?.image ?? null;
}

/** The stretch of their work this gallery holds — not a career. */
function workSpan(years: { from: number; to: number } | null): string | null {
  if (!years) return null;
  return years.from === years.to ? `${years.from}` : `${years.from}–${years.to}`;
}

interface Props {
  row: ArtistRowData;
  /** How tall the strip is; the rail matches it above the narrow breakpoint. */
  stripHeight: number;
  /** Below 620px the rail stacks above the strip instead of shrinking (§1.1). */
  narrow: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[], opts?: { info?: boolean; person?: string }) => void;
  /** Narrow the gallery to one series — every spelling of it that is on the wall. */
  onBrowseSeries: (titles: string[]) => void;
}

/**
 * One row per artist: who they are, set against a strip of the panels of
 * theirs this gallery holds.
 *
 * Deliberately the same object as a series row — same head, same rail width,
 * same strip, same height — because it is the same shelf read down a different
 * axis. What changes is what fills the rail: a series row answers *what is this
 * book and is it good*, and an artist row answers *who is this and what of
 * theirs is in here*. There is no meter on it, because nothing in
 * `ratings.json` targets a person; the rail spends that room on the portrait
 * instead, which is the one thing a creator has that a series does not.
 */
function ArtistRowView({ row, stripHeight, narrow, onSelectPanel, onBrowseSeries }: Props) {
  const { stripRef, overflows, onKeyDown: handleStripKey } = useRowStrip([row.name, stripHeight]);

  const hero = row.panels[0];
  const teases = row.panels.slice(1);
  const hatchTail = row.panels.length === 1;

  // What prev/next walks: this person's panels, in the order the strip draws
  // them, so paging from any tile stops at the row's ends rather than wandering
  // into the next artist.
  const group = row.panels;

  const openPanel = useCallback(
    (panel: Panel) => onSelectPanel(panel, group),
    [onSelectPanel, group],
  );

  /**
   * The name opens the row's first panel with this person's profile already
   * out — their portrait, their dates, their references and their work in
   * every role are what a reader clicking the name is after, and the profile
   * is where all of that already lives. The panel behind it is the row's own
   * hero, so the viewer still pages the strip from where the row starts.
   */
  const openProfile = useCallback(
    () => onSelectPanel(hero, group, { info: true, person: row.name }),
    [onSelectPanel, hero, group, row.name],
  );

  // The bar sits inside the strip's own box, so the tiles are shorter than the
  // strip by exactly its height and the row keeps the height the shelf placed it at.
  const tileHeight = narrow ? stripHeight : stripHeight - SCROLLBAR_H;

  const backdrop = useMemo(() => backdropSrc(row), [row]);
  const posted = useMemo(
    () => postedRange(row.firstPostedAt, row.lastPostedAt),
    [row.firstPostedAt, row.lastPostedAt],
  );
  const span = workSpan(row.years);
  const face = narrow ? FACE_NARROW : FACE;
  const series = capNames(row.series);

  /**
   * The hatched rule, exactly as the series shelf sets it: the name, the wall's
   * own filler motif taking whatever room is left, and the dates. See
   * `SeriesRow` for why the hatch runs *between* the two rather than behind
   * them.
   *
   * The years on the right are the cover dates of the panels in this row, not
   * the person's lifespan — the head is about what is in the strip underneath
   * it. The lifespan is in the rail, under the face, where it belongs to the
   * person rather than to the work.
   */
  const head = (
    <div
      className="row-head relative flex shrink-0 items-center gap-2 overflow-hidden px-2.5"
      style={{ height: HEAD_H }}
    >
      <button
        type="button"
        onClick={openProfile}
        className="min-w-0 max-w-[62%] truncate font-display text-[15px] leading-[1.5] tracking-wide text-ink hover:text-accent transition-colors cursor-pointer"
        title={`About ${row.name}`}
      >
        {row.name}
      </button>
      <span className="row-head-rule min-w-6 flex-1" aria-hidden="true" />
      {narrow && (
        <span className="shrink-0 font-display text-[11px] leading-none tracking-wider tabular-nums text-white/30">
          {row.panels.length}
        </span>
      )}
      {span && (
        <span className="shrink-0 font-display text-[11px] leading-none tracking-wider tabular-nums text-ink-muted">
          {span}
        </span>
      )}
    </div>
  );

  /**
   * The portrait: at the head of the rail where a series row puts its
   * publisher, and down the left of it under the narrow band.
   *
   * A face is the whole reason this view is worth having as something other
   * than a filter. The panels are still the subject of the row — the strip is
   * four times the width of the rail either way — but within the rail the
   * portrait is what the eye lands on first, which is what makes the column
   * scannable at a hundred and twenty-four rows.
   *
   * The 13 people with no portrait get their initial cut into the same box,
   * the way the profile's hero does, rather than a grey square or a stock
   * silhouette that would claim to be them. It is sized off the box rather
   * than set in a fixed step, so it fills either one.
   */
  const portrait = (
    <div
      className="relative shrink-0 overflow-hidden rounded-sm bg-surface-raised ring-1 ring-inset ring-ink-faint/25"
      style={{ width: face, height: face }}
      aria-hidden="true"
    >
      {row.artist?.imageUrl ? (
        <img
          src={row.artist.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ objectPosition: "center 22%" }}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center font-display leading-none text-white/15 select-none"
          style={{ fontSize: Math.round(face * 0.46) }}
        >
          {row.name.charAt(0)}
        </span>
      )}
    </div>
  );

  /** "colours 4 · letters 2" — the roles the strip is not already showing. */
  const alsoParts: string[] = [];
  if (row.alsoColorist > 0) alsoParts.push(`colours ${row.alsoColorist}`);
  if (row.alsoLetterer > 0) alsoParts.push(`letters ${row.alsoLetterer}`);
  if (row.alsoCredited > 0) alsoParts.push(`credited ${row.alsoCredited}`);

  /** Dates and country — absent, never "Unknown": 51 of the 124 records carry
   *  no country and 80 no dates, and a column of "Unknown" would read as a
   *  data-quality bug rather than as silence. */
  const identity = (row.life || row.country) && (
    <div className="flex min-w-0 flex-col gap-0.5">
      {row.life && (
        <p className="truncate text-[11px] leading-snug tabular-nums text-ink-muted">{row.life}</p>
      )}
      {row.country && (
        <p className="truncate text-[10px] uppercase tracking-wider leading-snug text-white/30">
          {row.country}
        </p>
      )}
    </div>
  );

  /* Which books they are on here, most panels first. A click narrows the
     gallery to that series, passing every spelling of it the wall carries
     (§9) — the same jump the series shelf's own rows make. */
  const seriesLine = series.shown.length > 0 && (
    <p className="flex items-baseline gap-1.5 text-xs leading-snug">
      <span className="w-2 shrink-0 font-display text-[10px] uppercase text-white/25">S</span>
      <span className="min-w-0 truncate text-ink-muted">
        {series.shown.map((s, i) => (
          <span key={s.slug}>
            {i > 0 && <span className="text-white/20">, </span>}
            <button
              type="button"
              onClick={() => onBrowseSeries(s.titles)}
              className="cursor-pointer hover:text-accent transition-colors"
            >
              {s.title}
            </button>
          </span>
        ))}
        {series.extra > 0 && <span className="text-white/25"> +{series.extra}</span>}
      </span>
    </p>
  );

  const postedLine = posted && (
    <p className="flex items-baseline gap-1.5 text-[10px] leading-snug">
      <span className="font-display uppercase tracking-widest text-white/25">posted</span>
      <span className="truncate tabular-nums text-white/40">{posted}</span>
    </p>
  );

  const tally = (
    <div className="flex flex-col gap-0.5">
      <p className="font-display text-[10px] uppercase tracking-widest text-white/35 tabular-nums">
        {row.panels.length} {row.panels.length === 1 ? "panel" : "panels"}
        <span className="text-white/15"> · </span>
        {row.series.length} {row.series.length === 1 ? "series" : "series"}
      </p>
      {alsoParts.length > 0 && (
        <p className="truncate text-[10px] uppercase tracking-widest text-white/20">
          also {alsoParts.join(" · ")}
        </p>
      )}
    </div>
  );

  /**
   * The rail, laid out twice.
   *
   * Wide, it is a column: the portrait heads it with the dates set beside the
   * face, and the lines that can run long — the series list above all — keep
   * the rail's full 260px to truncate in.
   *
   * Narrow, the band is 96px tall and as wide as the phone, which is the
   * opposite shape: stacking a portrait on top of three lines of type wastes
   * the width and starves the height. So the portrait takes the left of the
   * band at its full height and every line sits to its right, which is also
   * the arrangement the plate in the filter list draws.
   */
  const rail = narrow ? (
    <div
      className="row-rail flex w-full min-w-0 items-stretch gap-2.5 overflow-hidden pl-2.5 pr-2.5"
      style={{ height: RAIL_BAND_H, paddingBottom: NARROW_RAIL_PAD }}
    >
      {portrait}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        {identity}
        {seriesLine}
        {postedLine}
      </div>
    </div>
  ) : (
    <div
      className="row-rail flex w-65 min-w-0 shrink-0 flex-col gap-1 overflow-hidden pl-2.5 pr-3"
      style={{ height: stripHeight }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {portrait}
        {identity}
      </div>
      {seriesLine && <div className="mt-1">{seriesLine}</div>}
      {postedLine}
      <div className="mt-auto">{tally}</div>
    </div>
  );

  return (
    <section className="shelf-row relative flex h-full flex-col" aria-label={row.name}>
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
          aria-label={`${row.name} panels`}
          onKeyDown={handleStripKey}
          className={`row-strip flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden ${
            overflows ? "row-strip--masked" : ""
          }`}
          style={{ height: stripHeight, gap: TILE_GAP }}
        >
          <RowTile
            panel={hero}
            height={tileHeight}
            range={HERO_ASPECT}
            subtitle={hero.title}
            onOpen={openPanel}
          />
          {teases.map((panel) => (
            <RowTile
              key={panel.id}
              panel={panel}
              height={tileHeight}
              range={TEASE_ASPECT}
              subtitle={panel.title}
              onOpen={openPanel}
            />
          ))}
          {/* 67 of the 124 artists have exactly one panel here, and unlike a
              series there is no cover to trail off into — so the tail is the
              masonry's own motif for leftover space, and the empty stretch
              reads as part of the design rather than as a loading failure. */}
          {hatchTail && <RowHatchTail tileHeight={tileHeight} />}
        </div>
      </div>
    </section>
  );
}

// Rows re-render whenever the shelf re-sorts or the window moves. The row is
// the expensive part — a dozen lazy-load observers apiece — and nothing about
// it changes unless its data object does.
export default memo(ArtistRowView);
