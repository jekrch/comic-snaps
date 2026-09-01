import { useEffect, useState } from "react";

/**
 * Whether the panel viewer currently owns the screen.
 *
 * A module-scoped flag with its own listener set rather than context: the
 * consumers are leaves scattered through both galleries, and threading a prop
 * down to them would re-render the whole tree to tell a dozen decorations to
 * go quiet.
 *
 * It also stamps `viewer-open` on the root element, which is what the page
 * underneath is actually styled off (see `.viewer-open` in `index.css`). That
 * is a synchronous DOM write rather than a render, on purpose: the class has
 * to be gone again *before* the viewer's collapse animation measures the
 * thumbnail it flies back into, and a state update scheduled from the same
 * effect would not have committed by then.
 */
let viewerOpen = false;
const listeners = new Set<() => void>();

export function setViewerOpen(open: boolean): void {
  if (viewerOpen === open) return;
  viewerOpen = open;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("viewer-open", open);
  }
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
