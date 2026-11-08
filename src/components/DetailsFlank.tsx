import { Fragment, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";

/**
 * What runs down the margins either side of the details drawer's text column
 * on anything wider than a phone: small, evenly filled sidecars of related
 * panels, each fainter than the one above it. Beside the series card and what
 * follows it, the series' other panels — the ones before this panel down the
 * left, the ones after it down the right, nearest first, wrapping round the
 * ends — stopping short of the artist's card. From the artist's card down,
 * the artist's other panels in the same fashion, in the order they were
 * published, until the page ends. They shrink with the margins, and leave
 * when there's no margin left to shrink into.
 *
 * Rendered inside the column's scroller, beside the column, so it is part of
 * the page and scrolls with it.
 */

/** Each step down the stack fades a little further. */
const ALPHAS = [0.62, 0.48, 0.37, 0.28, 0.2, 0.14];
const PER_SIDE = ALPHAS.length;
/** Below this a margin is a margin, not a space: nothing is stacked in it.
 *  It has to hold the narrowest sidecar, its inset, and a little air. */
const MIN_GUTTER = 84;
/** The sidecars' width: a share of the margin, within these bounds. They
 *  shrink toward the minimum as the screen narrows. */
const MIN_WIDTH = 56;
const MAX_WIDTH = 136;
/** Below this width a sidecar's label drops the year, which would otherwise
 *  run wider than the panel above it. */
const COMPACT_WIDTH = 80;
/** A tall panel is cropped rather than let run down the page. */
const MAX_TALL = 1.5;
/** The column's own top padding, which the stacks line up with. */
const TOP = 32;
/** Under each panel, for its label. */
const LABEL = 24;
const GAP = 14;
/** Kept clear at the page's foot, so the stacks never add scroll of their own. */
const BOTTOM_ROOM = 32;
/** Kept clear above the artist's card, so the series stacks end with the
 *  section they belong to. */
const SECTION_GAP = 28;

export interface DrawerBox {
  /** The scroller's visible width, scrollbar excluded. */
  viewW: number;
  /** The text column, from the scroller's left edge. */
  colLeft: number;
  colW: number;
  colH: number;
  /** The top of the artist's card, from the top of the page; null when the
   *  page has none. */
  artistTop: number | null;
}

/**
 * The scroller's visible width and where the text column sits in it. Offset
 * sizes, not client rects: the drawer is transformed while it rises and pages,
 * and the column while the person page trades places with it, and none of that
 * moves the margins.
 */
function useDrawerBox(
  scrollEl: HTMLElement | null,
  columnEl: HTMLElement | null,
  /** Re-measured on a change of panel, whose page puts the card elsewhere. */
  panelId: string
): DrawerBox | null {
  const [box, setBox] = useState<DrawerBox | null>(null);

  useLayoutEffect(() => {
    if (!scrollEl || !columnEl) return;
    const measure = () => {
      const next = {
        viewW: scrollEl.clientWidth,
        colLeft: columnEl.offsetLeft,
        colW: columnEl.offsetWidth,
        colH: columnEl.offsetHeight,
        // Its offset parent is the scroller, like the column's.
        artistTop: columnEl.querySelector<HTMLElement>('[data-flank-anchor="artist"]')?.offsetTop ?? null,
      };
      setBox((prev) =>
        prev &&
        prev.viewW === next.viewW &&
        prev.colLeft === next.colLeft &&
        prev.colW === next.colW &&
        prev.colH === next.colH &&
        prev.artistTop === next.artistTop
          ? prev
          : next
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    ro.observe(columnEl);
    return () => ro.disconnect();
  }, [scrollEl, columnEl, panelId]);

  return box;
}

/** Issue order, numbers numerically ("#2" before "#10", "#12" before "VOL 1"),
 *  then the order the panels were posted in for two from the same issue. */
export function compareInSeries(a: Panel, b: Panel): number {
  return (
    String(a.issue).localeCompare(String(b.issue), undefined, { numeric: true, sensitivity: "base" }) ||
    a.addedAt.localeCompare(b.addedAt)
  );
}

/** Publication order, for an artist's panels across their books: year, then
 *  title, then issue order within the book. */
export function compareByArtist(a: Panel, b: Panel): number {
  return (
    (a.year || 0) - (b.year || 0) ||
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    compareInSeries(a, b)
  );
}

export interface Neighbors {
  /** The whole group in order, which becomes the viewer's group once one of
   *  the neighbours is opened, so its arrows then walk the same line. */
  group: Panel[];
  before: Panel[];
  after: Panel[];
}

/**
 * The panels around one in an ordered pool, split evenly between the two
 * sides, nearest first — before it on the left, after it on the right —
 * wrapping round the ends so a panel at either end still has both sides
 * filled. When there's an odd one over, it goes after.
 */
function splitAround(pool: Panel[], at: number, perSide: number) {
  const n = pool.length;
  const others = n - 1;
  const nAfter = Math.min(perSide, Math.ceil(others / 2));
  const nBefore = Math.min(perSide, others - nAfter);
  return {
    before: Array.from({ length: nBefore }, (_, i) => pool[(at - 1 - i + n) % n]),
    after: Array.from({ length: nAfter }, (_, i) => pool[(at + 1 + i) % n]),
  };
}

/** The series around a panel, in reading order. Null when the panel stands
 *  alone or isn't on the wall. */
export function seriesNeighbors(panel: Panel, allPanels: Panel[], perSide = PER_SIDE): Neighbors | null {
  const group = allPanels.filter((p) => p.slug === panel.slug).sort(compareInSeries);
  const at = group.findIndex((p) => p.id === panel.id);
  if (at < 0 || group.length < 2) return null;
  return { group, ...splitAround(group, at, perSide) };
}

/**
 * The artist's other panels around this one, in publication order, leaving
 * out any the series stacks above are already showing. Null when nothing is
 * left to show.
 */
export function artistNeighbors(
  panel: Panel,
  allPanels: Panel[],
  shown: ReadonlySet<string> = new Set(),
  perSide = PER_SIDE
): Neighbors | null {
  if (!panel.artist) return null;
  const group = allPanels.filter((p) => p.artist === panel.artist).sort(compareByArtist);
  const pool = group.filter((p) => p.id === panel.id || !shown.has(p.id));
  const at = pool.findIndex((p) => p.id === panel.id);
  if (at < 0 || pool.length < 2) return null;
  return { group, ...splitAround(pool, at, perSide) };
}

export interface FlankItem {
  /** Distance from the column's edge to the item's near edge. */
  x: number;
  /** From the top of the page. */
  y: number;
  w: number;
  h: number;
}

/**
 * Where each sidecar sits: one width for both stacks, hugging the column at
 * the same inset, each panel at its own height (cropped if very tall) and
 * labelled underneath, from `top` down. A stack stops at `end` — by default
 * where the page does — rather than run past it.
 */
export function flankLayout(
  box: DrawerBox,
  sides: { before: number[]; after: number[] },
  range: { top: number; end: number } = { top: TOP, end: box.colH - BOTTOM_ROOM }
): { left: number; right: number; before: FlankItem[]; after: FlankItem[] } | null {
  const left = box.colLeft;
  const right = box.viewW - box.colLeft - box.colW;
  const gutter = Math.min(left, right);
  if (gutter < MIN_GUTTER) return null;

  const x = Math.min(40, Math.max(12, gutter * 0.06));
  const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, gutter * 0.45));
  const { top, end } = range;

  const place = (aspects: number[]) => {
    const out: FlankItem[] = [];
    let y = top;
    for (const aspect of aspects) {
      const h = Math.min(w / aspect, w * MAX_TALL);
      if (y + h + LABEL > end) break;
      out.push({ x, y, w, h });
      y += h + LABEL + GAP;
    }
    return out;
  };
  // Where the page cuts one stack shorter than the other, the longer is
  // trimmed to match (give or take the odd one over), so the two still read as
  // a pair.
  let before = place(sides.before);
  let after = place(sides.after);
  if (before.length > 0 && after.length > 0) {
    const most = Math.min(before.length, after.length) + 1;
    before = before.slice(0, most);
    after = after.slice(0, most);
  }
  return { left, right, before, after };
}

const aspectOf = (p: Panel) => (p.width > 0 && p.height > 0 ? p.width / p.height : 0.75);

function FlankSide({
  kind,
  side,
  panels,
  items,
  width,
  shown,
  onOpen,
}: {
  kind: "series" | "artist";
  side: "before" | "after";
  panels: Panel[];
  items: FlankItem[];
  width: number;
  shown: boolean;
  onOpen: (panel: Panel) => void;
}) {
  if (items.length === 0) return null;
  const left = side === "before";

  return (
    <div
      className={`details-flank-side ${shown ? "is-shown" : ""}`}
      style={{ [left ? "left" : "right"]: 0, width }}
      aria-hidden={!shown}
    >
      {items.map((it, i) => {
        const p = panels[i];
        const label = formatIssue(p.issue);
        const compact = it.w < COMPACT_WIDTH;
        return (
          <button
            key={p.id}
            type="button"
            tabIndex={shown ? 0 : -1}
            onClick={() => onOpen(p)}
            className={`details-flank-item ${left ? "is-left" : "is-right"}`}
            style={{
              [left ? "right" : "left"]: it.x,
              top: it.y,
              width: it.w,
              height: it.h,
              ["--flank-alpha" as string]: ALPHAS[i],
              ["--flank-delay" as string]: `${i * 60}ms`,
            }}
            title={`${p.title} ${label}${p.year > 0 ? ` (${p.year})` : ""}`}
            aria-label={`${left ? "Earlier" : "Later"} ${kind === "series" ? "in series" : "by this artist"}: ${p.title} ${label}`}
          >
            <span className="details-flank-body">
              <img
                src={panelImageUrl(p.image)}
                alt=""
                draggable={false}
                decoding="async"
                loading="lazy"
                className="details-flank-img"
              />
              {/* An artist's panels come from different books, so theirs name
                  the book (cut to the panel's width) where the series' give
                  the year. */}
              <span className="details-flank-label" style={{ maxWidth: it.w }}>
                {left && i === 0 && <span aria-hidden>←</span>}
                {kind === "artist" && <span className="details-flank-title">{p.title}</span>}
                <span className="shrink-0">{label}</span>
                {kind === "series" && p.year > 0 && !compact && (
                  <span className="details-flank-year">{p.year}</span>
                )}
                {!left && i === 0 && <span aria-hidden>→</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A phone, held either way. Its column fills the screen upright, but on its
 * side it can leave margins wide enough to qualify — where sidecars would
 * crowd a page already short on height, and a stray thumb in the margin would
 * open another panel.
 */
const PHONE_QUERY = "(hover: none) and (pointer: coarse) and (max-width: 1023px), (max-width: 639px)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

export default function DetailsFlank({
  panel,
  allPanels,
  scrollEl,
  columnEl,
  shown,
  overViz,
  onSelectPanel,
}: {
  panel: Panel;
  allPanels: Panel[];
  scrollEl: HTMLElement | null;
  columnEl: HTMLElement | null;
  /** The details are up: the drawer is open and no person page is over them. */
  shown: boolean;
  overViz: boolean;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
}) {
  const box = useDrawerBox(scrollEl, columnEl, panel.id);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => true);

  // A cover or a portrait isn't one of the series' panels, or the artist's.
  const onWall = !(panel.cover || panel.portrait || panel.local);

  const stacks = useMemo(() => {
    if (!box || !onWall) return null;
    const end = box.colH - BOTTOM_ROOM;
    const aspects = (nb: Neighbors) => ({ before: nb.before.map(aspectOf), after: nb.after.map(aspectOf) });

    // The series, from the top down to the artist's card, if there is one.
    const seriesNb = seriesNeighbors(panel, allPanels);
    const seriesEnd = box.artistTop !== null ? box.artistTop - SECTION_GAP : end;
    const seriesLayout = seriesNb ? flankLayout(box, aspects(seriesNb), { top: TOP, end: seriesEnd }) : null;

    // The artist, from their card to the foot of the page, without repeating
    // a panel the series stacks are already showing.
    const taken = new Set<string>();
    if (seriesNb && seriesLayout) {
      seriesNb.before.slice(0, seriesLayout.before.length).forEach((p) => taken.add(p.id));
      seriesNb.after.slice(0, seriesLayout.after.length).forEach((p) => taken.add(p.id));
    }
    const artistNb = box.artistTop !== null ? artistNeighbors(panel, allPanels, taken) : null;
    const artistLayout =
      artistNb && box.artistTop !== null
        ? flankLayout(box, aspects(artistNb), { top: box.artistTop, end })
        : null;

    return [
      seriesNb && seriesLayout ? { kind: "series" as const, nb: seriesNb, layout: seriesLayout } : null,
      artistNb && artistLayout ? { kind: "artist" as const, nb: artistNb, layout: artistLayout } : null,
    ].filter((g) => g !== null);
  }, [box, onWall, panel, allPanels]);

  // Over a running visualizer the drawer keeps its margins clear for the run;
  // faint panels in them would only muddy it.
  if (!box || !stacks || stacks.length === 0 || overViz || phone) return null;

  return (
    // Spans the scroller's width and the page's height. It gives pointer
    // events back to the column and takes them only on the panels it draws.
    <div className="details-flank" style={{ height: box.colH, pointerEvents: "none" }}>
      {stacks.map(({ kind, nb, layout }) => {
        const open = (p: Panel) => onSelectPanel(p, nb.group);
        return (
          <Fragment key={kind}>
            <FlankSide
              key={`${kind}-b-${panel.id}`}
              kind={kind}
              side="before"
              panels={nb.before}
              items={layout.before}
              width={layout.left}
              shown={shown}
              onOpen={open}
            />
            <FlankSide
              key={`${kind}-a-${panel.id}`}
              kind={kind}
              side="after"
              panels={nb.after}
              items={layout.after}
              width={layout.right}
              shown={shown}
              onOpen={open}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
