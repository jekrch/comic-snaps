import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import type { Panel } from "../types";

interface Props {
  panel: Panel;
  panels: Panel[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export default function PanelViewer({ panel, panels, currentIndex, onClose, onNavigate }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Use a ref for the live transform to avoid re-renders during gestures.
  // The `displayScale` state is only for UI elements (zoom %, button states).
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const imgWrapperRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const [bottomBarH, setBottomBarH] = useState(0);
  const [topBarH, setTopBarH] = useState(0);

  // Store the image's base (unscaled) layout dimensions so clampTranslate
  // doesn't need to reverse-engineer them from getBoundingClientRect.
  const baseDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Gesture tracking refs — no re-renders during active gestures
  const gestureRef = useRef<{
    isDragging: boolean;
    pointerStart: { x: number; y: number };
    translateStart: { x: number; y: number };
    pinchStartDist: number | null;
    pinchStartScale: number;
    pinchMidpoint: { x: number; y: number } | null;
    lastTouchPos: { x: number; y: number } | null;
  }>({
    isDragging: false,
    pointerStart: { x: 0, y: 0 },
    translateStart: { x: 0, y: 0 },
    pinchStartDist: null,
    pinchStartScale: 1,
    pinchMidpoint: null,
    lastTouchPos: null,
  });

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  // Navigation
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < panels.length - 1;

  // Double-tap detection for touch devices
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  // ── Slide transition state ──
  // swipeOffset: pixel offset of the "carousel track" during an active drag.
  // Positive = dragging right (revealing prev), negative = dragging left (revealing next).
  // Managed via ref for perf during gestures; a state mirror drives React renders
  // only when we need the adjacent images to appear/disappear.
  const swipeOffsetRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);

  // Track whether we're in an animated snap/commit so we can apply CSS transition
  const [slideAnimating, setSlideAnimating] = useState(false);

  // Slide gesture tracking
  const slideGestureRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startTime: number;
    locked: boolean;        // true once we've determined this is horizontal
    rejected: boolean;      // true if first movement was vertical (don't slide)
    isTouch: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    locked: false,
    rejected: false,
    isTouch: false,
  });

  // Ref to the slide track element for direct DOM manipulation during drag
  const slideTrackRef = useRef<HTMLDivElement>(null);

  // Detect touch device
  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Apply transform directly to DOM — no React render cycle
  const applyTransform = useCallback((t: Transform, animate = false) => {
    const img = imgRef.current;
    if (!img) return;
    if (animate) {
      img.style.transition = "transform 0.2s ease-out";
    } else {
      img.style.transition = "none";
    }
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

  // Capture the image's base layout dimensions at scale=1.
  const measureBaseDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
  }, []);

  // Clamp translation so the image doesn't drift too far off-screen.
  const clampTranslate = useCallback(
    (x: number, y: number, scale: number): { x: number; y: number } => {
      if (scale <= 1) return { x: 0, y: 0 };
      const { width: baseW, height: baseH } = baseDimsRef.current;
      if (baseW === 0 || baseH === 0) return { x: 0, y: 0 };
      const maxX = ((scale - 1) * baseW) / 2;
      const maxY = ((scale - 1) * baseH) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    []
  );

  // ── Slide helpers ──
  // Track whether a slide gesture is active (for eager adjacent-image mounting)
  const [slideActive, setSlideActive] = useState(false);

  const applySlideOffset = useCallback((offset: number, animate = false) => {
    swipeOffsetRef.current = offset;
    const track = slideTrackRef.current;
    if (track) {
      track.style.transition = animate
        ? "transform 0.28s cubic-bezier(0.2, 0, 0, 1)"
        : "none";
      track.style.transform = `translateX(${offset}px)`;
    }
    setSwipeOffset(offset);
  }, []);

  // Lock to prevent overlapping slide commits
  const commitLockRef = useRef(false);

  const commitSlide = useCallback(
    (direction: "prev" | "next") => {
      if (commitLockRef.current) return;
      commitLockRef.current = true;

      const vw = window.innerWidth;
      const targetOffset = direction === "prev" ? vw : -vw;
      setSlideActive(true);
      setSlideAnimating(true);

      requestAnimationFrame(() => {
        applySlideOffset(targetOffset, true);

        const track = slideTrackRef.current;
        let cleaned = false;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          track?.removeEventListener("transitionend", onTransitionEnd);

          // Determine the new index and preload that image BEFORE navigating
          const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
          if (newIndex < 0 || newIndex >= panels.length) {
            commitLockRef.current = false;
            return;
          }

          const newPanel = panels[newIndex];
          const preload = new Image();
          preload.src = `${import.meta.env.BASE_URL}${newPanel.image}`;

          const doNavigate = () => {
            // Navigate — useLayoutEffect will reset the track
            onNavigate(newIndex);
          };

          // decode() ensures the browser has the image fully decoded
          // and ready to paint before we trigger the React update
          preload
            .decode()
            .then(doNavigate)
            .catch(doNavigate); // fallback: navigate anyway
        };

        const onTransitionEnd = () => cleanup();

        if (track) {
          track.addEventListener("transitionend", onTransitionEnd, { once: true });
          setTimeout(cleanup, 400);
        }
      });
    },
    [applySlideOffset, currentIndex, panels, onNavigate]
  );

  const snapBack = useCallback(() => {
    setSlideAnimating(true);
    applySlideOffset(0, true);
    const track = slideTrackRef.current;
    let done = false;
    const onEnd = () => {
      if (done) return;
      done = true;
      track?.removeEventListener("transitionend", onEnd);
      setSlideAnimating(false);
      setSlideActive(false);
    };
    if (track) {
      track.addEventListener("transitionend", onEnd, { once: true });
      setTimeout(onEnd, 350);
    }
  }, [applySlideOffset]);

  const resolveSlide = useCallback(() => {
    const offset = swipeOffsetRef.current;
    const sg = slideGestureRef.current;
    const dt = Date.now() - sg.startTime;
    const velocity = Math.abs(offset) / Math.max(dt, 1); // px/ms

    const threshold = window.innerWidth * 0.25;
    const velocityThreshold = 0.4; // px/ms

    if (offset > 0 && hasPrev && (offset > threshold || velocity > velocityThreshold)) {
      commitSlide("prev");
    } else if (offset < 0 && hasNext && (Math.abs(offset) > threshold || velocity > velocityThreshold)) {
      commitSlide("next");
    } else {
      snapBack();
    }
  }, [hasPrev, hasNext, commitSlide, snapBack]);

  // Imperative DOM resets on navigation — runs before browser paint so the
  // track snap and image swap appear in a single frame. Zero state updates
  // here to avoid triggering re-renders in the pre-paint window.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img) {
      img.style.transition = "none";
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
    transformRef.current = { scale: 1, x: 0, y: 0 };

    if (commitLockRef.current) {
      const track = slideTrackRef.current;
      if (track) {
        track.style.transition = "none";
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        track.offsetHeight;
        track.style.transform = "translateX(0px)";
      }
      swipeOffsetRef.current = 0;
      commitLockRef.current = false;
    }
  }, [currentIndex]);

  // Set initial image transform on mount (since we removed inline style)
  useEffect(() => {
    const img = imgRef.current;
    if (img) {
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
  }, []);

  useLayoutEffect(() => {
    const img = imgRef.current;
    const track = slideTrackRef.current;

    // Reset image zoom/pan
    if (img) {
      img.style.transition = "none";
      img.style.transform = "scale(1) translate(0px, 0px)";
    }
    transformRef.current = { scale: 1, x: 0, y: 0 };

    // Reset slide track
    if (commitLockRef.current) {
      if (track) {
        track.style.transition = "none";
      }

      // Single reflow flushes both transition:none declarations
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      (track || img)?.offsetHeight;

      if (track) {
        track.style.transform = "translateX(0px)";
      }
      swipeOffsetRef.current = 0;
      commitLockRef.current = false;
    }
  }, [currentIndex]);

  // React state cleanup — runs after paint to avoid re-render churn
  // during the layout phase
  useEffect(() => {
    setDisplayScale(1);
    setSwipeOffset(0);
    setSlideAnimating(false);
    setSlideActive(false);
  }, [currentIndex]);

  // Measure top/bottom bars so the image can be constrained to fit between them
  useEffect(() => {
    const measure = () => {
      if (topBarRef.current) setTopBarH(topBarRef.current.offsetHeight);
      if (bottomBarRef.current) setBottomBarH(bottomBarRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (topBarRef.current) ro.observe(topBarRef.current);
    if (bottomBarRef.current) ro.observe(bottomBarRef.current);
    return () => ro.disconnect();
  }, [currentIndex]);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Keyboard: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowLeft" && hasPrev && displayScale <= 1) {
        commitSlide("prev");
      }
      if (e.key === "ArrowRight" && hasNext && displayScale <= 1) {
        commitSlide("next");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, hasPrev, hasNext, displayScale, commitSlide]);

  // Lock body scroll and prevent overscroll/bounce on iOS
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const preventScroll = (e: TouchEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = prevTouch;
      document.removeEventListener("touchmove", preventScroll);
    };
  }, []);

  // --- Wheel zoom (desktop) ---
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
  }, [setTransform, clampTranslate]);

  // --- Double click/tap toggle ---
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

  // --- Mouse drag: zoomed = pan, unzoomed = slide ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;

    if (transformRef.current.scale > 1) {
      // Zoomed: pan
      e.preventDefault();
      const g = gestureRef.current;
      g.isDragging = true;
      g.pointerStart = { x: e.clientX, y: e.clientY };
      g.translateStart = { x: transformRef.current.x, y: transformRef.current.y };
    } else {
      // Unzoomed: start slide gesture
      setSlideActive(true);
      const sg = slideGestureRef.current;
      sg.active = true;
      sg.startX = e.clientX;
      sg.startY = e.clientY;
      sg.startTime = Date.now();
      sg.locked = false;
      sg.rejected = false;
      sg.isTouch = false;
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;

      const g = gestureRef.current;
      if (g.isDragging && transformRef.current.scale > 1) {
        // Zoomed pan
        const dx = e.clientX - g.pointerStart.x;
        const dy = e.clientY - g.pointerStart.y;
        const t = transformRef.current;
        const clamped = clampTranslate(g.translateStart.x + dx, g.translateStart.y + dy, t.scale);
        setTransform({ scale: t.scale, ...clamped });
        return;
      }

      // Slide gesture
      const sg = slideGestureRef.current;
      if (!sg.active || sg.rejected) return;

      const dx = e.clientX - sg.startX;
      const dy = e.clientY - sg.startY;

      if (!sg.locked) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < 4 && absDy < 4) return; // deadzone
        if (absDy > absDx) {
          sg.rejected = true;
          return;
        }
        sg.locked = true;
      }

      // Apply resistance at edges (no prev/next available)
      let offset = dx;
      if ((offset > 0 && !hasPrev) || (offset < 0 && !hasNext)) {
        offset = offset * 0.2; // rubber-band resistance
      }
      applySlideOffset(offset);
    },
    [setTransform, clampTranslate, hasPrev, hasNext, applySlideOffset]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") {
        return;
      }

      gestureRef.current.isDragging = false;

      const sg = slideGestureRef.current;
      if (sg.active && sg.locked && !sg.rejected) {
        sg.active = false;
        resolveSlide();
      } else {
        sg.active = false;
        // If we never locked (tiny movement) or was rejected, clean up
        if (!slideAnimating) setSlideActive(false);
      }
    },
    [resolveSlide, slideAnimating]
  );

  // --- Touch: pinch + pan (zoomed) / slide (unzoomed) ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const g = gestureRef.current;

    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      g.pinchStartDist = Math.hypot(dx, dy);
      g.pinchStartScale = transformRef.current.scale;
      g.pinchMidpoint = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      g.lastTouchPos = null;
      // Cancel any slide in progress
      const sg = slideGestureRef.current;
      if (sg.active) {
        sg.active = false;
        snapBack();
      }
    } else if (e.touches.length === 1) {
      if (transformRef.current.scale > 1) {
        // Zoomed: pan
        g.lastTouchPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else {
        // Unzoomed: slide gesture
        setSlideActive(true);
        const sg = slideGestureRef.current;
        sg.active = true;
        sg.startX = e.touches[0].clientX;
        sg.startY = e.touches[0].clientY;
        sg.startTime = Date.now();
        sg.locked = false;
        sg.rejected = false;
        sg.isTouch = true;
      }
    }
  }, [snapBack]);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const g = gestureRef.current;

      if (e.touches.length === 2 && g.pinchStartDist !== null) {
        // Pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / g.pinchStartDist;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.pinchStartScale * ratio));
        const t = transformRef.current;
        const clamped =
          nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);

        const next = { scale: nextScale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
        setDisplayScale(nextScale);
      } else if (e.touches.length === 1 && g.lastTouchPos && transformRef.current.scale > 1) {
        // Zoomed pan
        const touch = e.touches[0];
        const dx = touch.clientX - g.lastTouchPos.x;
        const dy = touch.clientY - g.lastTouchPos.y;
        g.lastTouchPos = { x: touch.clientX, y: touch.clientY };

        const t = transformRef.current;
        const clamped = clampTranslate(t.x + dx, t.y + dy, t.scale);
        const next = { scale: t.scale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
      } else if (e.touches.length === 1) {
        // Slide gesture (unzoomed)
        const sg = slideGestureRef.current;
        if (!sg.active || sg.rejected) return;

        const touch = e.touches[0];
        const dx = touch.clientX - sg.startX;
        const dy = touch.clientY - sg.startY;

        if (!sg.locked) {
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          if (absDx < 6 && absDy < 6) return;
          if (absDy > absDx * 0.8) {
            sg.rejected = true;
            return;
          }
          sg.locked = true;
        }

        let offset = dx;
        if ((offset > 0 && !hasPrev) || (offset < 0 && !hasNext)) {
          offset = offset * 0.2;
        }
        applySlideOffset(offset);
      }
    },
    [applyTransform, clampTranslate, hasPrev, hasNext, applySlideOffset]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const g = gestureRef.current;
      const wasPinch = g.pinchStartDist !== null;
      g.pinchStartDist = null;
      g.pinchMidpoint = null;

      // If all fingers lifted while zoomed out, snap back
      if (e.touches.length === 0 && transformRef.current.scale <= 1) {
        // Check if slide gesture should resolve
        const sg = slideGestureRef.current;
        if (sg.active && sg.locked && !sg.rejected) {
          sg.active = false;
          resolveSlide();
          // Also reset zoom transform in case
          transformRef.current = { scale: 1, x: 0, y: 0 };
          setDisplayScale(1);
          return;
        }
        sg.active = false;

        resetTransform();
      }

      // If one finger remains after pinch, start panning from that finger
      if (e.touches.length === 1 && transformRef.current.scale > 1) {
        g.lastTouchPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else {
        g.lastTouchPos = null;
      }

      // Double-tap detection (only for single-finger taps, not after pinch, not after slide)
      const sg = slideGestureRef.current;
      if (e.touches.length === 0 && e.changedTouches.length === 1 && !wasPinch && !sg.locked) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        const timeDelta = now - last.time;
        const distDelta = Math.hypot(touch.clientX - last.x, touch.clientY - last.y);

        if (timeDelta < 300 && distDelta < 30) {
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          if (transformRef.current.scale > 1) {
            resetTransform();
          } else {
            setTransform({ scale: 2.5, x: 0, y: 0 }, true);
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        }
      }

      // Cleanup slide if released without committing
      if (e.touches.length === 0 && sg.active && !sg.locked) {
        sg.active = false;
        if (!slideAnimating) setSlideActive(false);
      }
    },
    [resetTransform, setTransform, resolveSlide, slideAnimating]
  );

  const isZoomed = displayScale > 1;
  const hasTags = panel.tags?.length > 0;

  // Padding between image and bars
  const IMG_PADDING = 24;
  const reservedH = topBarH + bottomBarH + IMG_PADDING * 2;
  const imgMaxHeight = `calc(100vh - ${reservedH}px)`;

  // Compute fixed width for the nav counter based on max possible digit count
  const totalDigits = String(panels.length).length;
  const counterMinWidth = `${totalDigits * 2 * 0.6 + 1.5}em`;

  // Adjacent panels for slide effect
  const prevPanel = hasPrev ? panels[currentIndex - 1] : null;
  const nextPanel = hasNext ? panels[currentIndex + 1] : null;

  // Mount adjacent images eagerly: as soon as the gesture starts OR while animating.
  // This ensures the incoming image is visible from the first pixel of movement.
  const showAdjacentSlides = slideActive || slideAnimating || swipeOffset !== 0;
  const showPrev = !!prevPanel && showAdjacentSlides;
  const showNext = !!nextPanel && showAdjacentSlides;

  // Common image styles for all slide slots
  const slideImgStyle: React.CSSProperties = {
    maxWidth: "96vw",
    maxHeight: imgMaxHeight,
    willChange: "transform",
  };

  return (
    <div
      ref={containerRef}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/90 backdrop-blur-sm" : "bg-black/0 backdrop-blur-0"}
      `}
      style={{ touchAction: "none" }}
      onClick={(e) => {
        if (e.target === containerRef.current) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${panel.title} #${panel.issue} — full view`}
    >
      {/* Top bar — always above image content via z-20 */}
      <div
        ref={topBarRef}
        className={`
          absolute top-0 inset-x-0 z-20 flex items-start justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/70 via-black/40 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="min-w-0 flex-1 px-2!">
          <p className="font-display text-sm text-white/90 leading-snug">
            {panel.title}{" "}
            <span className="text-accent">#{panel.issue}</span>{" "}
            <span className="text-white/40">({panel.year})</span>
          </p>
          <p className="text-xs text-white/60 mt-0.5 leading-snug">
            {panel.artist}
            <span className="text-white/25 mx-1.5">·</span>
            <span className="text-white/35">
              (posted by {panel.postedBy}:{` `}
              {new Date(panel.addedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })})
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1 ml-3 shrink-0">
          {!isTouchDevice && isZoomed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetTransform();
              }}
              className="viewer-btn text-[11px] tabular-nums"
              title="Reset zoom"
            >
              {Math.round(displayScale * 100)}%
            </button>
          )}

          {!isTouchDevice && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const t = transformRef.current;
                const next = Math.min(MAX_SCALE, t.scale * 1.3);
                const clamped = clampTranslate(t.x, t.y, next);
                setTransform({ scale: next, ...clamped }, true);
              }}
              className="viewer-btn"
              title="Zoom in"
            >
              <ZoomIn size={16} strokeWidth={1.5} />
            </button>
          )}

          {!isTouchDevice && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const t = transformRef.current;
                const next = Math.max(MIN_SCALE, t.scale / 1.3);
                const clamped = next <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, next);
                setTransform({ scale: next, ...clamped }, true);
              }}
              className="viewer-btn"
              title="Zoom out"
            >
              <ZoomOut size={16} strokeWidth={1.5} />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className={`viewer-btn ${!isTouchDevice ? "ml-1" : ""}`}
            title="Close (Esc)"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ── Slide track: three-slot carousel ── */}
      <div
        ref={slideTrackRef}
        className={`
          relative z-10 flex items-center justify-center w-full h-full
          transition-opacity duration-250 ease-out
          ${visible && !closing ? "opacity-100" : "opacity-0"}
        `}
        style={{
          touchAction: "none",
        }}
      >
        {/* Previous panel (off-screen left) */}
        {showPrev && prevPanel && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
            style={{ transform: `translateX(-${viewportWidth}px)` }}
          >
            <img
              src={`${import.meta.env.BASE_URL}${prevPanel.image}`}
              alt={`${prevPanel.title} #${prevPanel.issue}`}
              className="block w-auto h-auto object-contain rounded-sm"
              style={slideImgStyle}
              draggable={false}
            />
          </div>
        )}

        {/* Current panel (center) */}
        <div
          ref={imgWrapperRef}
          className={`
            relative flex items-center justify-center select-none
            ${isZoomed ? "cursor-grab overflow-visible" : "cursor-default overflow-hidden"}
            ${gestureRef.current.isDragging ? "!cursor-grabbing" : ""}
          `}
          style={{ touchAction: "none" }}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <img
            ref={imgRef}
            src={`${import.meta.env.BASE_URL}${panel.image}`}
            alt={`${panel.title} #${panel.issue}`}
            className="block w-auto h-auto object-contain rounded-sm"
            style={{
              ...slideImgStyle,
              //transform: `scale(${transformRef.current.scale}) translate(${transformRef.current.x / transformRef.current.scale}px, ${transformRef.current.y / transformRef.current.scale}px)`,
            }}
            draggable={false}
            onLoad={measureBaseDims}
          />
        </div>

        {/* Next panel (off-screen right) */}
        {showNext && nextPanel && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
            style={{ transform: `translateX(${viewportWidth}px)` }}
          >
            <img
              src={`${import.meta.env.BASE_URL}${nextPanel.image}`}
              alt={`${nextPanel.title} #${nextPanel.issue}`}
              className="block w-auto h-auto object-contain rounded-sm"
              style={slideImgStyle}
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div
        ref={bottomBarRef}
        className={`
          absolute bottom-0 inset-x-0 z-20
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* Tags — always reserve space to prevent layout shift between panels */}
        {!isZoomed && (
          <div className="flex flex-wrap justify-center gap-1.5 px-4 mb-2 min-h-[18px]">
            {hasTags && panel.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] leading-none px-1.5 py-0.5 rounded-sm bg-white/8 text-white/35"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Navigation strip using chevrons */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="mx-auto flex items-center justify-center gap-6 mb-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasPrev) commitSlide("prev");
              }}
              disabled={!hasPrev}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasPrev
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"
                }
              `}
              aria-label="Previous panel"
            >
              <ChevronLeft size={22} strokeWidth={1.5} />
            </button>

            <span
              className="text-[10px] text-white/20 tabular-nums tracking-wide select-none text-center inline-block"
              style={{ minWidth: counterMinWidth }}
            >
              {currentIndex + 1} / {panels.length}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasNext) commitSlide("next");
              }}
              disabled={!hasNext}
              className={`
                p-2 rounded-full transition-colors duration-150
                ${hasNext
                  ? "text-white/50 hover:text-white/80 active:text-white"
                  : "text-white/10 cursor-default"
                }
              `}
              aria-label="Next panel"
            >
              <ChevronRight size={22} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Hint text — only when no nav or when zoomed */}
        {!isZoomed && !hasPrev && !hasNext && (
          <div className="text-center mt-0">
            <span className="text-[11px] text-white/30 tracking-wide">
              {isTouchDevice
                ? "pinch to zoom · double-tap to enlarge"
                : "scroll to zoom · double-click to enlarge · esc to close"}
            </span>
          </div>
        )}

        {/* Condensed hint when nav is present */}
        {!isZoomed && (hasPrev || hasNext) && (
          <div className="text-center mt-0">
            <span className="text-[11px] text-white/20 tracking-wide">
              {isTouchDevice
                ? "swipe to navigate · pinch to zoom"
                : "← → or drag to navigate · scroll to zoom · esc to close"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}