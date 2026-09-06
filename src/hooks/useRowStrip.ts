import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { FADE_W } from "../components/rowGeometry";

/** A couple of tiles' worth of travel per arrow press, near enough. */
function scrollStep(el: HTMLElement): number {
  return Math.max(120, Math.round(el.clientWidth * 0.4));
}

/**
 * A shelf strip's right edge: whether it overflows, and how wide the dissolve
 * over it currently is.
 *
 * The strip simply overflows and a mask dissolves whatever is crossing that
 * edge, so the row ends mid-panel when there is more to see and ends cleanly
 * when there is not — the cut panel *is* the affordance, which is why there
 * are no chevrons (docs/series-view-plan.md §1.3).
 *
 * `deps` is whatever changes the strip's contents or box: the row's own key
 * and its height. Both shelves want exactly this behaviour, and it is worth
 * one hook rather than two copies of a `ResizeObserver`, an
 * `IntersectionObserver` and a rate-limited scroll handler.
 */
export function useRowStrip(deps: unknown[]) {
  const stripRef = useRef<HTMLDivElement>(null);
  /** The strip has more to show than fits, so its right edge dissolves. */
  const [overflows, setOverflows] = useState(false);
  /** How far the strip can travel; recomputed on layout, not on scroll. */
  const maxScrollRef = useRef(0);

  /**
   * Close the dissolve over the last stretch of travel.
   *
   * Written straight onto the element rather than through state: this runs on
   * every animation frame of a drag, and a row that re-rendered its whole strip
   * to move a gradient would be re-rendering a dozen lazy-load observers under
   * a moving finger. React only hears about `overflows`, which is a fact about
   * the layout and does not change while scrolling.
   */
  const paintEdge = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = Math.max(0, maxScrollRef.current - el.scrollLeft);
    el.style.setProperty("--strip-fade", `${Math.min(FADE_W, left).toFixed(1)}px`);
  }, []);

  // A row that fits has no fade at all, which is the honest signal that there
  // is nothing past the edge.
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    maxScrollRef.current = Math.max(0, el.scrollWidth - el.clientWidth);
    setOverflows(maxScrollRef.current > 2);
    paintEdge();
  }, [paintEdge]);

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

    // One repaint per frame at most. A touch scroll fires far more events than
    // that, and every one of them reads `scrollLeft` — a layout flush the
    // compositor does not owe us more than once a frame.
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paintEdge();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, paintEdge, ...deps]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const el = stripRef.current;
    if (!el) return;
    e.preventDefault();
    const step = scrollStep(el);
    el.scrollBy({ left: e.key === "ArrowRight" ? step : -step, behavior: "smooth" });
  }, []);

  return { stripRef, overflows, onKeyDown };
}
