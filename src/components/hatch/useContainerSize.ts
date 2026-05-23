import { useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Tracks the bounding-box size of a container element. Re-measures after a
 * short delay too — useful for masonry/lazy-laid-out parents that finalize
 * their box after mount.
 */
export function useContainerSize(
  ref: RefObject<HTMLElement | null>,
  initial = { width: 900, height: 600 },
) {
  const [size, setSize] = useState(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    update();
    const t1 = setTimeout(update, 150);
    const t2 = setTimeout(update, 500);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ref]);

  return size;
}

/** True when the element is intersecting (with a generous rootMargin). */
export function useOnScreen(ref: RefObject<HTMLElement | null>, rootMargin = "200px") {
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);

  return onScreen;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  return reduced;
}
