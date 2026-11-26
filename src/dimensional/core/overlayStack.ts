/**
 * The layers that sit on top of the page and close on Escape, in the order
 * they opened: a document over an app, a figure's zoom viewer over the
 * document, a code sheet. Only the top one answers Escape; everything
 * underneath checks `isTopOverlay` (or, for a host's own layers that aren't
 * entries, `hasOverlays`) and stands down.
 *
 * One stack per page, shared by everything that imports this module, so a
 * host's own overlays and the framework's agree on who is on top.
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

/** Whether anything is open over the page: the host's own layers stand down. */
export function hasOverlays(): boolean {
  return stack.length > 0;
}

/** For tests. */
export function resetOverlays(): void {
  stack.length = 0;
}

// Events from a portalled overlay still bubble up the React tree to whatever
// rendered it. Spread these on the portal's root to stop them there; the
// overlay's own handlers have run by then.
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
