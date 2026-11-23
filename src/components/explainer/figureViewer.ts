/**
 * Whether an explainer figure's zoom viewer is open.
 *
 * That viewer sits on top of other things that also close on Escape (the
 * explainer modal, the similarity graph's explainer, the panel viewer the
 * graph lives in), and they all listen on `window`. While it's open, Escape
 * belongs to it alone; the others check this and stand down.
 */
let open = false;

export function isFigureViewerOpen(): boolean {
  return open;
}

export function setFigureViewerOpen(value: boolean): void {
  open = value;
}
