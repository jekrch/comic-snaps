import { useEffect, useId } from "react";

/**
 * The layers that sit on top of the page and close on Escape, in the order
 * they opened: the Guide, a figure's zoom viewer, the code sheet, the anchor
 * picker. Only the top one answers Escape; everything underneath checks
 * `isTopOverlay` (or, for the app's own layers that aren't entries,
 * `hasOverlays`) and stands down.
 *
 * This replaces a single "is a figure viewer open" flag. One flag was enough
 * while there were two layers; with the Guide over the viewer over the graph,
 * and figures over the Guide, the question every handler actually asks is
 * "am I the top one?".
 *
 * An entry stays on the stack until its layer has finished closing, not
 * until the close starts: the Escape that starts a close also reaches the
 * window listeners underneath, and they must still see something above them.
 */
const stack: string[] = [];

export function pushOverlay(id: string): void {
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
  stack.push(id);
}

export function popOverlay(id: string): void {
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
}

export function isTopOverlay(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Whether anything is open over the page: the app's own layers stand down. */
export function hasOverlays(): boolean {
  return stack.length > 0;
}

/** For tests. */
export function resetOverlays(): void {
  stack.length = 0;
}

/**
 * Holds a place on the stack while `active`, and returns the entry's id so
 * the layer can ask whether it's on top.
 */
export function useOverlay(active: boolean, name = "overlay"): string {
  const id = `${name}${useId()}`;
  useEffect(() => {
    if (!active) return;
    pushOverlay(id);
    return () => popOverlay(id);
  }, [active, id]);
  return id;
}

// Events from a portal'd overlay still bubble up the React tree to whatever
// rendered it: the Guide's own swipe and key handlers, or the panel viewer
// the graph lives in (swipe-to-close, backdrop click). Spread these on the
// portal's root to stop them there; the overlay's own handlers have run by
// then.
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
export const STOP_EVENTS = {
  onClick: stop,
  onDoubleClick: stop,
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onMouseDown: stop,
  onTouchStart: stop,
  onTouchMove: stop,
  onTouchEnd: stop,
  onWheel: stop,
  onKeyDown: stop,
};

/**
 * Z-order of the Guide and what opens over it. The Guide sits above
 * everything it can be opened from: the info modal (z-50/70), the panel
 * viewer (the library's 50, or 110 over the visualizer).
 */
export const GUIDE_Z = 120;
export const GUIDE_OVERLAY_Z = 130;
