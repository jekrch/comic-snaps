import { useCallback, useEffect, useRef, useState } from "react";

/** How far below the scroller's top a step heading counts as "reached". */
const SPY_OFFSET = 140;

export interface ScrollState {
  /** The step the reader is in, or null above the first one. */
  step: string | null;
  /** 0 at the top of the page, 1 at the bottom. */
  progress: number;
  /** Scrolling down (true) or up (false), past a small threshold. */
  down: boolean;
  scrollTop: number;
}

/**
 * Follows the reader through a page in a scroll container: which step
 * they're in, how far along they are, and which way they're going. Steps
 * are the `[data-step]` elements inside the container.
 */
export function useScrollSpy(
  scroller: HTMLElement | null,
  /** Re-read the steps when this changes (a new page, content that loaded). */
  contentKey: unknown
): ScrollState {
  const [state, setState] = useState<ScrollState>({ step: null, progress: 0, down: false, scrollTop: 0 });
  const last = useRef(0);
  const raf = useRef(0);

  const measure = useCallback(() => {
    raf.current = 0;
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top;
    const steps = scroller.querySelectorAll<HTMLElement>("[data-step]");
    let step: string | null = null;
    for (const el of steps) {
      if (el.getBoundingClientRect().top - top <= SPY_OFFSET) step = el.dataset.step ?? null;
      else break;
    }
    const max = scroller.scrollHeight - scroller.clientHeight;
    const st = scroller.scrollTop;
    // At the very bottom, the last step counts as reached even if it's short.
    if (max > 0 && st >= max - 4 && steps.length > 0) step = steps[steps.length - 1].dataset.step ?? step;
    const progress = max > 0 ? Math.min(1, Math.max(0, st / max)) : 1;
    const delta = st - last.current;
    setState((prev) => {
      const down = Math.abs(delta) > 6 ? delta > 0 : prev.down;
      if (Math.abs(delta) > 6) last.current = st;
      if (prev.step === step && Math.abs(prev.progress - progress) < 0.002 && prev.down === down) return prev;
      return { step, progress, down, scrollTop: st };
    });
  }, [scroller]);

  useEffect(() => {
    if (!scroller) return;
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(measure);
    };
    last.current = scroller.scrollTop;
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Content that grows after loading moves the steps without a scroll.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro) for (const child of Array.from(scroller.children)) ro.observe(child);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [scroller, measure, contentKey]);

  return state;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

// Per-viewer conveniences, never required: where the reader left each page,
// and which lessons they've read to the end. Wrapped, since storage can be
// missing or throw (private windows, blocked site data).

const POS_KEY = "comicSnaps.guide.positions";
const DONE_KEY = "comicSnaps.guide.finished";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered, then.
  }
}

export function savedPosition(page: string): number {
  const all = readJson<Record<string, number>>(POS_KEY, {});
  const v = all[page];
  return typeof v === "number" && v > 0 ? v : 0;
}

export function savePosition(page: string, top: number) {
  const all = readJson<Record<string, number>>(POS_KEY, {});
  all[page] = Math.round(top);
  writeJson(POS_KEY, all);
}

export function finishedPages(): Set<string> {
  return new Set(readJson<string[]>(DONE_KEY, []));
}

export function markFinished(page: string) {
  const all = finishedPages();
  if (all.has(page)) return;
  all.add(page);
  writeJson(DONE_KEY, [...all]);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
