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
 * Manages zoom/pan state for an image viewer.
 *
 * To work around iOS Safari clipping CSS-scaled content to the element's
 * original layout bounds, this hook sets the image's actual width/height
 * when zoomed and uses translate-only transforms for panning.
 *
 * Transform values in `transformRef`:
 *   x, y  = pan offset in screen pixels (0,0 = centered)
 *   scale = zoom factor (1 = unzoomed)
 */
export function useZoomPan(
  imgWrapperRef: RefObject<HTMLDivElement | null>,
  currentIndex: number
): ZoomPanState {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const baseDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const isZoomed = displayScale > 1;

  // ── Core helpers ──

  /** Ensure base dims are captured. Safe to call any time. */
  const ensureBaseDims = useCallback(() => {
    if (baseDimsRef.current.width > 0) return;
    const img = imgRef.current;
    if (!img) return;
    baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
  }, []);

  const applyTransform = useCallback((t: Transform, animate = false) => {
    const img = imgRef.current;
    if (!img) return;

    const { width: baseW, height: baseH } = baseDimsRef.current;
    const transition = animate
      ? "transform 0.2s ease-out, width 0.2s ease-out, height 0.2s ease-out"
      : "none";
    img.style.transition = transition;

    if (t.scale <= 1) {
      // Unzoomed: reset to natural sizing
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.maxHeight = "";
      img.style.transform = "translate(0px, 0px)";
    } else if (baseW > 0 && baseH > 0) {
      // Zoomed: set actual layout dimensions and use translate for panning
      const w = baseW * t.scale;
      const h = baseH * t.scale;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
      img.style.transform = `translate(${t.x}px, ${t.y}px)`;
    }
  }, []);

  const setTransform = useCallback(
    (t: Transform, animate = false) => {
      transformRef.current = t;
      ensureBaseDims();
      applyTransform(t, animate);
      setDisplayScale(t.scale);
    },
    [applyTransform, ensureBaseDims]
  );

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 }, true);
  }, [setTransform]);

  const measureBaseDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    if (transformRef.current.scale <= 1) {
      baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
    }
  }, []);

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

  // ── Re-apply transform after React re-render ──
  //
  // When isZoomed changes, React re-renders and overwrites the image's
  // inline style prop, clobbering what applyTransform set. This layout
  // effect re-applies the current transform synchronously before paint
  // so there's no visible flicker or stutter.
  useLayoutEffect(() => {
    applyTransform(transformRef.current, false);
  }, [isZoomed, applyTransform]);

  // ── Reset on navigation ──

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img) {
      img.style.transition = "none";
      img.style.transform = "translate(0px, 0px)";
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.maxHeight = "";
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
      img.style.transform = "translate(0px, 0px)";
    }
  }, []);

  // ── Wheel zoom (desktop) ──

  useEffect(() => {
    const wrapper = imgWrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      ensureBaseDims();
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
  }, [imgWrapperRef, setTransform, clampTranslate, ensureBaseDims]);

  // ── Double-click toggle ──

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      ensureBaseDims();

      if (transformRef.current.scale > 1) {
        resetTransform();
      } else {
        setTransform({ scale: 1.8, x: 0, y: 0 }, true);
      }
    },
    [resetTransform, setTransform, ensureBaseDims]
  );

  return {
    imgRef,
    displayScale,
    isZoomed,
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