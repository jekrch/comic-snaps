import { viewBottom } from "./scroll";

/**
 * Brings each matching element up into place the first time it scrolls into
 * view, by setting `data-reveal` to "out" and then "in" (the stylesheet does
 * the motion).
 *
 * Only what's still below the fold when this runs waits: whatever the
 * reader lands on (the top, a saved position, a linked step) is already
 * there. The element's own box never moves (CSS shifts its children), so
 * scroll spying and jump arithmetic stay exact.
 */
export function observeReveal(scroller: HTMLElement, root: Element, selector: string): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const windowed = scroller === document.scrollingElement;
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
    { root: windowed ? null : scroller, rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );
  const fold = viewBottom(scroller);
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (el.dataset.reveal) {
      if (el.dataset.reveal === "out") io.observe(el);
      continue;
    }
    if (el.getBoundingClientRect().top < fold) continue;
    el.dataset.reveal = "out";
    io.observe(el);
  }
  return () => io.disconnect();
}
