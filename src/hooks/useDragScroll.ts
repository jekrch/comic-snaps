import { useEffect } from "react";
import type { RefObject } from "react";
import {
  DRAG_THRESHOLD,
  VELOCITY_WINDOW,
  glideAt,
  glideDone,
  planGlide,
  releaseVelocity,
  type Glide,
  type Sample,
} from "../components/stripGlide";

/**
 * The class every drag-scrollable strip carries in its markup, for the styles
 * that do not depend on state: no text selection, and the grab hand over a strip
 * that has somewhere to go. Kept in the markup rather than added here, because
 * React rewrites a `className` it owns whenever that prop changes.
 */
export const DRAG_SCROLL = "drag-scroll";
/** Set while a hand is on the strip: the grabbing cursor, no hover changes. */
const DRAGGING = "drag-scroll--dragging";
/**
 * Set from the first drag until the next wheel or arrow key. Scroll snapping
 * applies to programmatic scrolls too, so with it on, every `scrollLeft` the
 * drag writes would be pulled toward a tile edge and the strip would judder
 * under the hand. It stays off after the glide ends because turning it back
 * on can make the browser re-snap, and a strip that moves by itself once it
 * has come to rest reads as a glitch. A wheel or arrow key steps the strip
 * anyway, so that is when snapping comes back.
 */
const FREE = "drag-scroll--free";
/**
 * Whether there is anything to drag, refreshed each time the mouse comes onto
 * the strip. Checking on entry rather than with observers is always current at
 * the moment it matters, and costs nothing while the pointer is elsewhere.
 */
const OVERFLOWS = "drag-scroll--overflows";

function canScroll(el: HTMLElement): boolean {
  return el.scrollWidth - el.clientWidth > 2;
}

/**
 * Grab, drag and throw a horizontal strip with the mouse, the way a phone
 * scrolls one with a finger (see `stripGlide.ts` for the physics).
 *
 * Mouse only. Touch and pen already scroll the strip natively with the
 * platform's own momentum, and anything written here would only compete
 * with it.
 *
 * A press that moves less than `DRAG_THRESHOLD` is a click and opens the tile
 * under it as before. A press that becomes a drag swallows the click its
 * release would otherwise fire, so letting go over a tile does not open it.
 * Pressing on a gliding strip catches it, as a finger does on a phone, and that
 * press does not open anything either.
 *
 * Usable straight as a callback ref, `ref={attachDragScroll}`: it is one
 * function for the life of the module, so React attaches it once per element
 * and runs the cleanup it returns when the element goes. The element also
 * needs `DRAG_SCROLL` in its class list.
 */
export function attachDragScroll(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let press: {
    id: number;
    startX: number;
    startScroll: number;
    samples: Sample[];
    dragging: boolean;
  } | null = null;
  let glideRaf = 0;
  let swallowClick = false;
  let clearSwallow: ReturnType<typeof setTimeout> | undefined;

  const stopGlide = () => {
    if (glideRaf) cancelAnimationFrame(glideRaf);
    glideRaf = 0;
  };

  const startGlide = (glide: Glide) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const elapsed = now - t0;
      if (glideDone(glide, elapsed)) {
        el.scrollLeft = glide.to;
        glideRaf = 0;
        return;
      }
      el.scrollLeft = glideAt(glide, elapsed);
      glideRaf = requestAnimationFrame(step);
    };
    glideRaf = requestAnimationFrame(step);
  };

  /**
   * The click a release fires is dispatched in the same task as the
   * `pointerup`, so a flag cleared on the next tick covers exactly that click
   * and nothing after it. A keyboard Enter on a tile a moment later still opens it.
   */
  const swallowNextClick = () => {
    swallowClick = true;
    clearTimeout(clearSwallow);
    clearSwallow = setTimeout(() => {
      swallowClick = false;
    }, 0);
  };

  const endDrag = () => {
    if (press?.dragging && el.hasPointerCapture(press.id)) el.releasePointerCapture(press.id);
    el.classList.remove(DRAGGING);
    press = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    // A strip that fits has nowhere to go.
    if (!canScroll(el)) return;
    // A press on the scrollbar belongs to the scrollbar. It is drawn below
    // the client area, so anything under `clientHeight` is the strip itself.
    if (e.clientY - el.getBoundingClientRect().top >= el.clientTop + el.clientHeight) return;

    const wasGliding = glideRaf !== 0;
    stopGlide();
    swallowClick = false;
    if (wasGliding) swallowNextClick();

    press = {
      id: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      samples: [{ t: e.timeStamp, x: e.clientX }],
      dragging: false,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.startX;

    if (!press.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      press.dragging = true;
      // Captured so the drag keeps going when the pointer leaves the strip,
      // or the window, and the release still lands here.
      el.setPointerCapture(press.id);
      el.classList.add(DRAGGING, FREE);
    }

    // 1:1 from where the strip was grabbed, threshold included, so the art
    // stays under the same spot of the cursor for the whole drag.
    el.scrollLeft = press.startScroll - dx;

    const samples = press.samples;
    samples.push({ t: e.timeStamp, x: e.clientX });
    while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW * 2) samples.shift();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      press = null;
      return;
    }

    swallowNextClick();
    const velocity = -releaseVelocity(press.samples, e.timeStamp);
    endDrag();

    if (reduceMotion.matches) return;
    const glide = planGlide(el.scrollLeft, velocity, el.scrollWidth - el.clientWidth);
    if (glide) startGlide(glide);
  };

  // A cancelled pointer, such as a context menu or a lost capture, puts the
  // strip down where it is, with no throw.
  const onPointerCancel = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    endDrag();
  };

  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // The browser's own image drag, the ghost thumbnail, would take the
  // gesture away from the strip on the first few pixels of movement.
  const onDragStart = (e: DragEvent) => e.preventDefault();

  // A stepping input takes over from a throw: it stops the glide and brings
  // back the snapping that steps are meant to land on. A vertical wheel is the
  // page scrolling past, so it leaves the strip alone.
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) && !e.shiftKey) return;
    stopGlide();
    el.classList.remove(FREE);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    stopGlide();
    el.classList.remove(FREE);
  };

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType === "mouse") el.classList.toggle(OVERFLOWS, canScroll(el));
  };

  el.addEventListener("pointerenter", onPointerEnter);
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  el.addEventListener("lostpointercapture", onPointerCancel);
  el.addEventListener("click", onClick, true);
  el.addEventListener("dragstart", onDragStart);
  el.addEventListener("wheel", onWheel, { passive: true });
  el.addEventListener("keydown", onKeyDown, true);
  return () => {
    stopGlide();
    clearTimeout(clearSwallow);
    el.removeEventListener("pointerenter", onPointerEnter);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    el.removeEventListener("lostpointercapture", onPointerCancel);
    el.removeEventListener("click", onClick, true);
    el.removeEventListener("dragstart", onDragStart);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("keydown", onKeyDown, true);
  };
}

/** `attachDragScroll` for an element already held in a ref. */
export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => attachDragScroll(ref.current), [ref]);
}
