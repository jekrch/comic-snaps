/**
 * Scrolling, for a document that scrolls in its own box (page and overlay
 * modes) or with the window (embedded mode). A scroller is an element; the
 * window's is `document.scrollingElement`, whose top is the viewport's.
 */

function isWindowScroller(el: Element): boolean {
  return typeof document !== "undefined" && el === document.scrollingElement;
}

/** Where the scroller's visible area starts, in viewport coordinates. */
export function viewTop(scroller: Element): number {
  return isWindowScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
}

/** Where the scroller's visible area ends, in viewport coordinates. */
export function viewBottom(scroller: Element): number {
  return isWindowScroller(scroller) ? window.innerHeight : scroller.getBoundingClientRect().bottom;
}

/** What fires the scroller's scroll events. */
export function scrollEvents(scroller: Element): EventTarget {
  return isWindowScroller(scroller) ? window : scroller;
}

/** An element's offset from the top of the scroller's content. */
export function offsetIn(scroller: Element, el: Element): number {
  return el.getBoundingClientRect().top - viewTop(scroller) + scroller.scrollTop;
}

export interface SpyState {
  /** The step the reader is in, or null above the first one. */
  step: string | null;
  /** 0 at the top, 1 at the end of the reading (see `data-progress-end`). */
  progress: number;
  /** Scrolling down (true) or up (false), past a small threshold. */
  down: boolean;
  scrollTop: number;
}

export const INITIAL_SPY: SpyState = { step: null, progress: 0, down: false, scrollTop: 0 };

/**
 * How far through the reading the reader is, 0 to 1. It runs to where the
 * reading ends rather than the page's bottom: `endAt`, the scroll offset of
 * whatever is marked `data-progress-end` (the sources), and nothing after it
 * counts. Full once that mark reaches the bottom of the view.
 */
export function readingProgress(scrollTop: number, maxScroll: number, endAt: number | null, viewHeight: number): number {
  const span = endAt === null ? maxScroll : Math.min(maxScroll, Math.max(1, endAt - viewHeight));
  return span > 0 ? Math.min(1, Math.max(0, scrollTop / span)) : 1;
}

export interface SpyOptions {
  /** How far below the view's top a step counts as reached. */
  offset?: number;
  /** Where the steps are; the scroller itself by default. */
  root?: Element;
}

/**
 * Follows the reader through the `[data-step]` elements in a scroller:
 * which they're in, how far along they are, and which way they're going.
 * Calls `onChange` when any of that changes; `measure` forces a reading
 * (after content changes), and the returned `destroy` stops it.
 */
export function createScrollSpy(
  scroller: HTMLElement,
  onChange: (s: SpyState) => void,
  { offset = 140, root = scroller }: SpyOptions = {},
): { measure: () => void; destroy: () => void } {
  let raf = 0;
  let last = scroller.scrollTop;
  let state: SpyState = INITIAL_SPY;

  const measure = () => {
    raf = 0;
    const top = viewTop(scroller);
    const steps = root.querySelectorAll<HTMLElement>("[data-step]");
    let step: string | null = null;
    for (const el of steps) {
      if (el.getBoundingClientRect().top - top <= offset) step = el.dataset.step ?? null;
      else break;
    }
    const max = scroller.scrollHeight - scroller.clientHeight;
    const st = scroller.scrollTop;
    // At the very bottom, the last step counts as reached even if it's short.
    if (max > 0 && st >= max - 4 && steps.length > 0) step = steps[steps.length - 1].dataset.step ?? step;
    const end = root.querySelector<HTMLElement>("[data-progress-end]");
    const endAt = end ? end.getBoundingClientRect().top - top + st : null;
    const progress = readingProgress(st, max, endAt, scroller.clientHeight);
    const delta = st - last;
    const down = Math.abs(delta) > 6 ? delta > 0 : state.down;
    if (Math.abs(delta) > 6) last = st;
    if (state.step === step && Math.abs(state.progress - progress) < 0.002 && state.down === down) return;
    state = { step, progress, down, scrollTop: st };
    onChange(state);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  const target = scrollEvents(scroller);
  target.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  // Content that grows after loading moves the steps without a scroll.
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  if (ro) for (const child of Array.from(root.children)) ro.observe(child);
  schedule();

  return {
    measure: schedule,
    destroy() {
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Keeps a place in view while content above or around it settles (figures
 * loading after a jump), until the reader scrolls for themselves or `ms`
 * passes. `top` says where the scroller should be; null leaves it.
 */
export function holdPlace(scroller: HTMLElement, watch: Element, top: () => number | null, ms = 2500): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let first = true;
  const ro = new ResizeObserver(() => {
    if (first) {
      first = false;
      return;
    }
    const t = top();
    if (t !== null && Math.abs(scroller.scrollTop - t) > 2) scroller.scrollTo({ top: t, behavior: "auto" });
  });
  ro.observe(watch);
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const target = scrollEvents(scroller);
  const stop = () => {
    ro.disconnect();
    events.forEach((ev) => target.removeEventListener(ev, stop));
    window.clearTimeout(timer);
  };
  events.forEach((ev) => target.addEventListener(ev, stop, { passive: true }));
  const timer = window.setTimeout(stop, ms);
  return stop;
}
