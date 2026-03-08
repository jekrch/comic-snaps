import { useEffect, type RefObject } from "react";

/**
 * Locks body scroll and prevents overscroll/bounce on iOS while the
 * referenced container is mounted.
 */
export function useBodyScrollLock(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const preventScroll = (e: TouchEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = prevTouch;
      document.removeEventListener("touchmove", preventScroll);
    };
  }, [containerRef]);
}