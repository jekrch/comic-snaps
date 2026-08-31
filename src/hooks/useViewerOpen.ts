import { useEffect, useState } from "react";

/**
 * Whether the panel viewer currently owns the screen.
 *
 * A module-scoped flag with its own listener set rather than context: the
 * consumers are leaves scattered through both galleries (every hatch filler,
 * every series wash), and threading a prop down to them would re-render the
 * whole tree to tell a dozen decorations to go quiet.
 *
 * What "quiet" means is the consumer's call. The hatch stops animating, since
 * nobody is watching it. The series wash stops painting: it is a masked,
 * filtered, upscaled layer per visible row, and a phone GPU compositing all of
 * them underneath a full-screen overlay is work spent on something the overlay
 * has already covered.
 */
let viewerOpen = false;
const listeners = new Set<() => void>();

export function setViewerOpen(open: boolean): void {
  if (viewerOpen === open) return;
  viewerOpen = open;
  listeners.forEach((l) => l());
}

export function useViewerOpen(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return viewerOpen;
}
