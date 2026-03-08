import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomPanState {
  imgRef: RefObject<HTMLImageElement | null>;
  displayScale: number;
  isZoomed: boolean;
  transformRef: React.MutableRefObject<Transform>;

  /** Base (unscaled) image dimensions for clamp calculations */
  baseDimsRef: React.MutableRefObject<{ width: number; height: number }>;

  resetTransform: () => void;
  setTransform: (t: Transform, animate?: boolean) => void;
  applyTransform: (t: Transform, animate?: boolean) => void;
  clampTranslate: (x: number, y: number, scale: number) => { x: number; y: number };
  measureBaseDims: () => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
}

/**
 * Manages zoom/pan transform state, wheel zoom, clamping, and double-click toggle.
 *
 * All transform updates are applied directly to the DOM via the imgRef to avoid
 * React re-renders during active gestures. `displayScale` is a React state mirror
 * used only for UI elements (zoom %, button disabled states).
 */
export function useZoomPan(
  imgWrapperRef: RefObject<HTMLDivElement | null>,
  currentIndex: number
): ZoomPanState {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const baseDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // ── Core helpers ──

  const applyTransform = useCallback((t: Transform, animate = false) => {
    const img = imgRef.current;
    if (!img) return;
    img.style.transition = animate ? "transform 0.2s ease-out" : "none";
    img.style.transform = `scale(${t.scale}) translate(${t.x / t.scale}px, ${t.y / t.scale}px)`;
  }, []);

  const setTransform = useCallback(
    (t: Transform, animate = false) => {
      transformRef.current = t;
      applyTransform(t, animate);
      setDisplayScale(t.scale);
    },
    [applyTransform]
  );

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 }, true);
  }, [setTransform]);

  const measureBaseDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
  }, []);

  /**
   * Clamp translation so the image edge cannot pan past the viewport edge.
   *
   * The transform `scale(S) translate(x/S, y/S)` produces a screen-space
   * displacement of (x, y) pixels. The image is centered in the viewport
   * via flexbox, so:
   *   - Scaled half-width  = (baseW * scale) / 2
   *   - Viewport half-width = window.innerWidth / 2
   *   - maxX = scaledHalfW - vpHalfW  (clamped to ≥ 0)
   *
   * This allows panning until the edge of the scaled image aligns with
   * the edge of the viewport, giving full use of the screen when zoomed.
   */
  const clampTranslate = useCallback(
    (x: number, y: number, scale: number): { x: number; y: number } => {
      if (scale <= 1) return { x: 0, y: 0 };
      const { width: baseW, height: baseH } = baseDimsRef.current;
      if (baseW === 0 || baseH === 0) return { x: 0, y: 0 };

      const scaledHalfW = (baseW * scale) / 2;
      const scaledHalfH = (baseH * scale) / 2;
      const vpHalfW = window.innerWidth / 2;
      const vpHalfH = window.innerHeight / 2;

      const maxX = Math.max(0, scaledHalfW - vpHalfW);
      const maxY = Math.max(0, scaledHalfH - vpHalfH);

      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    []
  );

  // ── Reset on navigation ──

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img) {
      img.style.transition = "none";
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
    transformRef.current = { scale: 1, x: 0, y: 0 };
  }, [currentIndex]);

  useEffect(() => {
    setDisplayScale(1);
  }, [currentIndex]);

  // Set initial transform on mount
  useEffect(() => {
    const img = imgRef.current;
    if (img) {
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
  }, []);

  // ── Wheel zoom (desktop) ──

  useEffect(() => {
    const wrapper = imgWrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 100;

      const normalized = Math.max(-100, Math.min(100, dy));
      const step = -(normalized / 100) * 0.05;
      const factor = 1 + step;

      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const clamped = nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);
      setTransform({ scale: nextScale, ...clamped });
    };

    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", handleWheel);
  }, [imgWrapperRef, setTransform, clampTranslate]);

  // ── Double-click toggle ──

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (transformRef.current.scale > 1) {
        resetTransform();
      } else {
        setTransform({ scale: 1.8, x: 0, y: 0 }, true);
      }
    },
    [resetTransform, setTransform]
  );

  return {
    imgRef,
    displayScale,
    isZoomed: displayScale > 1,
    transformRef,
    baseDimsRef,
    resetTransform,
    setTransform,
    applyTransform,
    clampTranslate,
    measureBaseDims,
    handleDoubleClick,
  };
}

export { MIN_SCALE, MAX_SCALE };