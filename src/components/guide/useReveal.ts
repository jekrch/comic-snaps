import { useEffect } from "react";

/** What gets revealed: a lesson's steps and the glossary's entries. */
const SELECTOR = ".guide-step, .guide-glossary-entry";

/**
 * Brings each step up into place the first time it scrolls into view.
 *
 * Only what's still below the fold when a page is shown waits for this:
 * whatever the reader lands on (the top, a saved position, a linked step)
 * is already there. The step's own box never moves (CSS shifts its children
 * instead), so the scroll spy and the jump-to-step arithmetic stay exact.
 */
export function useReveal(
  scroller: HTMLElement | null,
  /** Look again when this changes (a new page, content that loaded). */
  contentKey: unknown,
  enabled: boolean
) {
  useEffect(() => {
    if (!scroller || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = "in";
          io.unobserve(e.target);
        }
      },
      // A little above the bottom edge, so the motion is seen, not finished
      // off-screen.
      { root: scroller, rootMargin: "0px 0px -8% 0px", threshold: 0 }
    );
    const fold = scroller.getBoundingClientRect().bottom;
    for (const el of scroller.querySelectorAll<HTMLElement>(SELECTOR)) {
      if (el.dataset.reveal) {
        if (el.dataset.reveal === "out") io.observe(el);
        continue;
      }
      if (el.getBoundingClientRect().top < fold) continue;
      el.dataset.reveal = "out";
      io.observe(el);
    }
    return () => io.disconnect();
  }, [scroller, contentKey, enabled]);
}
