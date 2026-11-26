import { MOTION } from "./motion";

/**
 * Overlay mode's app behind the document: kept mounted, so its scroll and
 * state are exactly as left, but taken out of reach and, once covered, out
 * of the compositor.
 *
 * Sliding it aside moves each of the host's top-level layers rather than its
 * root. A transform on the root would make it the containing block for the
 * `position: fixed` layers inside it, and a scrolled page would carry them
 * up off the screen for the length of the slide. A transform on a fixed
 * layer itself leaves it where it is.
 */
export interface AppBehind {
  /** Move the app aside by `progress` (0 = in place, 1 = fully aside). */
  shift(progress: number, transition: string | null): void;
  /** Stop painting it once it's fully covered. */
  hide(): void;
  /** Paint it again, before anything underneath measures layout. */
  show(): void;
  /** Hand it back exactly as it was. */
  restore(): void;
}

export function freezeLayers(layers: HTMLElement[], shiftShare = MOTION.appShift): AppBehind {
  const saved = layers.map((el) => ({
    el,
    transform: el.style.transform,
    transition: el.style.transition,
    visibility: el.style.visibility,
    inert: el.inert,
    hidden: el.getAttribute("aria-hidden"),
  }));
  const prevActive = document.activeElement as HTMLElement | null;
  for (const { el } of saved) {
    el.inert = true;
    el.setAttribute("aria-hidden", "true");
  }
  return {
    shift(progress, transition) {
      const px = -shiftShare * window.innerWidth * progress;
      for (const { el } of saved) {
        el.style.transition = transition ?? "none";
        el.style.transform = progress === 0 ? "" : `translate3d(${px}px, 0, 0)`;
      }
    },
    hide() {
      for (const { el } of saved) el.style.visibility = "hidden";
    },
    show() {
      for (const { el, visibility } of saved) el.style.visibility = visibility;
    },
    restore() {
      for (const s of saved) {
        s.el.style.transform = s.transform;
        s.el.style.transition = s.transition;
        s.el.style.visibility = s.visibility;
        s.el.inert = s.inert;
        if (s.hidden === null) s.el.removeAttribute("aria-hidden");
        else s.el.setAttribute("aria-hidden", s.hidden);
      }
      // Back to where the reader was: the link they followed.
      if (prevActive && document.contains(prevActive)) prevActive.focus({ preventScroll: true });
    },
  };
}

/** Room kept between a popover and the edges of the screen. */
const EDGE = 12;
/** How far the caret keeps from the popover's corners. */
const CARET_INSET = 14;

/**
 * Places a popover before it shows: under its anchor (or over it, when
 * there's no room below), slid sideways to stay on screen, with the caret
 * still pointing at the anchor. Sets `--pop-x`, `--pop-caret` and
 * `data-side` for the stylesheet. `topClear` keeps it out from under a
 * sticky masthead.
 */
export function placePopover(anchor: HTMLElement, pop: HTMLElement, topClear = 64) {
  const box = anchor.getClientRects()[0];
  if (!box) return;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Positioned against the anchor's first line (an inline box's containing
  // block starts there, even when the word wraps).
  const left = Math.max(EDGE, Math.min(box.left, vw - EDGE - w));
  const caret = Math.max(CARET_INSET, Math.min(box.left + Math.min(box.width / 2, 40) - left, w - CARET_INSET));
  const above = box.bottom + h + EDGE > vh && box.top - h - EDGE > topClear;
  pop.style.setProperty("--pop-x", `${left - box.left}px`);
  pop.style.setProperty("--pop-caret", `${caret}px`);
  pop.dataset.side = above ? "top" : "bottom";
}
