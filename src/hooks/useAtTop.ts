import { useEffect, useState } from "react";

/**
 * True while the page is scrolled to the very top.
 *
 * The header's bird and its thought both ink solid up here and dissolve toward
 * their bottom edge once the page moves, so they read the scroll position
 * through one hook rather than each keeping its own idea of "at top" — two
 * listeners drifting apart is what makes a pair of marks stop looking like one
 * drawing.
 */
export function useAtTop(): boolean {
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY <= 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return atTop;
}
