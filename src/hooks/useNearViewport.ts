import { useEffect, useRef, useState } from "react";

// How far ahead of the viewport (in px) to begin loading an image. ~1.5 phone
// screens of lead time so panels are decoded before they scroll into view on
// iOS Safari, whose native loading="lazy" fires far too late during fast scrolls.
const PRELOAD_MARGIN = 1500;

let observer: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = callbacks.get(entry.target);
        if (cb) {
          cb();
          observer!.unobserve(entry.target);
          callbacks.delete(entry.target);
        }
      }
    },
    { rootMargin: `${PRELOAD_MARGIN}px 0px ${PRELOAD_MARGIN}px 0px` }
  );
  return observer;
}

/**
 * Returns a ref and a boolean that flips to true once the element is within
 * PRELOAD_MARGIN of the viewport. Uses a single shared IntersectionObserver
 * across all callers, and a synchronous initial check so above-the-fold items
 * load immediately on mount (keeps first-paint readiness logic working).
 */
export function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;

    // Synchronous initial check: load anything already near the viewport
    // without waiting for the observer's first (async) callback.
    const rect = el.getBoundingClientRect();
    if (
      rect.top < window.innerHeight + PRELOAD_MARGIN &&
      rect.bottom > -PRELOAD_MARGIN
    ) {
      setNear(true);
      return;
    }

    const obs = getObserver();
    callbacks.set(el, () => setNear(true));
    obs.observe(el);
    return () => {
      obs.unobserve(el);
      callbacks.delete(el);
    };
  }, [near]);

  return { ref, near };
}
