import type { Panel } from "../types";

/**
 * The shape of a shelf row, shared by every view built on one.
 *
 * Uniform height is what makes a hundred-odd rows scannable and windowing
 * arithmetic rather than a packing pass (§1.1, §7), and the numbers live here
 * rather than in one of the rows because the two shelves have to agree about
 * them: a reader switching from series to artists is looking at the same
 * column with different things in it, and a row that changed height between
 * them would read as a different page rather than a second reading.
 *
 * The head is a hatched rule carrying the row's name and its dates. Rows of
 * even height with nothing between them run together — a strip of panels ends
 * wherever it ends, so the eye has no edge to cut on — and this is the one band
 * in the row that cannot be mistaken for art.
 *
 * 28px is the floor, not a round number: the name is a 15px line and the band
 * has to hold it with enough air on either side that the hatch beside it reads
 * as a rule the type is set on rather than as a texture crowding it.
 */
export const HEAD_H = 28;
export const HEAD_GAP = 8;
export const STRIP_H = 220;
export const STRIP_H_NARROW = 150;
/** Below the breakpoint the rail is a band above the strip, not a column. */
export const RAIL_BAND_H = 96;
export const ROW_GAP = 18;

/** Total height of one row at the current breakpoint. */
export function rowHeight(narrow: boolean): number {
  return HEAD_H + HEAD_GAP + (narrow ? RAIL_BAND_H + STRIP_H_NARROW : STRIP_H);
}

export const TILE_GAP = 4;

/**
 * Width of the dissolve at the strip's right edge, and the last stretch of
 * travel over which it closes — the same number for both, so the fade narrows
 * exactly as fast as the row runs out and reaches nothing at the end.
 */
export const FADE_W = 80;

/**
 * Height the strip gives up to its scrollbar, so the bar has somewhere to sit
 * that is not on top of the art. Reserved on the desktop layout only — the
 * narrow one keeps the bar hidden and the tiles take the full height — and it
 * is reserved whether or not the row actually overflows, because uniform row
 * height is what the shelf's windowing arithmetic is built on (§7).
 */
export const SCROLLBAR_H = 10;

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
export const HERO_ASPECT: readonly [number, number] = [0.62, 1.9];
/** Teases are held narrower so they never out-mass the hero. */
export const TEASE_ASPECT: readonly [number, number] = [0.62, 1.1];

export function panelAspect(panel: Panel): number {
  if (panel.width > 0 && panel.height > 0) return panel.width / panel.height;
  return 0.75;
}

export function clampAspect(aspect: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(Math.max(aspect, lo), hi);
}

export function placeholderFor(panel: Panel): string | undefined {
  const c = panel.dominantColors?.[0];
  return c ? `lab(${c[0]} ${c[1]} ${c[2]})` : undefined;
}

/** Two names plus a `+N`, so a rail never grows a third line of them. */
export function capNames<T>(names: T[]): { shown: T[]; extra: number } {
  return { shown: names.slice(0, 2), extra: Math.max(0, names.length - 2) };
}

const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/**
 * When a row's panels went up — first to last.
 *
 * Month precision across months, because what the row is answering is whether
 * this is something the group keeps coming back to or something posted once,
 * and the exact day of each panel is on the panel.
 *
 * A span that opens and closes inside one month is the case month precision
 * cannot state: "Aug 2026" for four panels reads as one post rather than as a
 * fortnight of them. Those drop to days and name the month once — the range is
 * still a range, without printing the same word at both ends. A row with a
 * genuinely single posting day keeps the one date it has always had.
 */
export function postedRange(first: number, last: number): string | null {
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
 * Which rows have already played their meter, or any other once-per-row
 * arrival. Module-scoped rather than per component because windowing unmounts
 * a row the moment it leaves the band, and a re-sort that replays twenty at
 * once is noise (§2.4).
 */
export const meterPlayed = new Set<string>();
