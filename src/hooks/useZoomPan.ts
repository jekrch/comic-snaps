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
 * Uses transform-origin: 0 0 with translate() scale() to avoid an iOS Safari
 * compositing bug where scale() from center clips to the element's original
 * layout bounds. The centering offset is baked into the translate so the image
 * appears to scale from center visually.
 *
 * Transform values in `transformRef` use screen-pixel coordinates:
 *   x, y = pan offset in screen pixels (0,0 = centered)
 *   scale = zoom factor (1 = unzoomed)
 *
 * The applied CSS is:
 *   transform-origin: 0 0;
 *   transform: translate(tx, ty) scale(S);
 * where tx = -(baseW*(S-1))/2 + x, ty = -(baseH*(S-1))/2 + y
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

    const { width: baseW, height: baseH } = baseDimsRef.current;

    // Centering offset: with transform-origin 0 0, scale expands right/down.
    // Shift left/up by half the growth to keep the image visually centered.
    const cx = -(baseW * (t.scale - 1)) / 2;
    const cy = -(baseH * (t.scale - 1)) / 2;

    const tx = cx + t.x;
    const ty = cy + t.y;

    img.style.transition = animate ? "transform 0.2s ease-out" : "none";
    img.style.transformOrigin = "0 0";
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${t.scale})`;
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
   * x, y are screen-pixel pan offsets (0 = centered). The image is centered
   * in the viewport via flexbox, so:
   *   scaledHalf = (base * scale) / 2
   *   vpHalf     = viewportSize / 2
   *   maxPan     = max(0, scaledHalf - vpHalf)
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
      img.style.transformOrigin = "0 0";
      img.style.transform = "translate(0px, 0px) scale(1)";
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
      img.style.transformOrigin = "0 0";
      img.style.transform = "translate(0px, 0px) scale(1)";
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