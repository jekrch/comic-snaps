/**
 * The overlay stack now lives in the dimensional framework
 * (src/dimensional/core/overlayStack.ts), so the Guide, the framework's
 * documents and the app's own layers share one stack and agree on who is on
 * top for Escape. Re-exported here for the Guide's existing imports.
 */
export {
  STOP_EVENTS,
  hasOverlays,
  isTopOverlay,
  popOverlay,
  pushOverlay,
  resetOverlays,
} from "../../dimensional/core/overlayStack";
export { useOverlay } from "../../dimensional/react/hooks";

/**
 * Z-order of the Guide and what opens over it. The Guide sits above
 * everything it can be opened from: the info modal (z-50/70), the panel
 * viewer (the library's 50, or 110 over the visualizer).
 */
export const GUIDE_Z = 120;
export const GUIDE_OVERLAY_Z = 130;
