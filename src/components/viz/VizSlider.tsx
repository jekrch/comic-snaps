import { useEffect, useRef, useState, type ReactNode } from "react";

/** Grip width in the stylesheet. The grip's centre only travels between the
 *  half-widths at each end, so a pointer maps against that inset, not the
 *  full width — otherwise the grip lags the finger at the ends. */
const GRIP_W = 10;

/** A press that stays put this long has claimed the row, whatever it does next. */
const HOLD_MS = 260;
/** How far a finger may drift and still count as staying put. */
const HOLD_SLOP = 8;
/** Sideways travel that claims the row outright, without the wait. */
const SLIDE_SLOP = 12;
/** Vertical travel that hands the touch to the list. Deliberately the lowest of
 *  the three: an ambiguous diagonal should scroll, because a scroll taken by
 *  mistake costs a flick to undo and a slide taken by mistake costs a setting. */
const SCROLL_SLOP = 6;
/** Ratio a sideways swipe has to beat to take the row on travel alone. */
const SLIDE_BIAS = 1.6;

/** Below this speed (px/ms) a release is a stop, not a throw. */
const FLING_MIN = 0.05;
/** Per-16ms decay of a throw, and how stale the last move may be to count as one. */
const FLING_DECAY = 0.94;
const FLING_STALE_MS = 80;

/** The nearest ancestor this row can scroll on a touch's behalf. */
function scrollerOf(from: HTMLElement | null): HTMLElement | null {
  for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

interface Gesture {
  pointerId: number;
  /** Where the touch landed, which every threshold is measured from. */
  x: number;
  y: number;
  /** "asking" is a touch that has not yet declared itself. */
  mode: "asking" | "sliding" | "scrolling";
  scroller: HTMLElement | null;
  lastX: number;
  lastY: number;
  lastT: number;
  /** Smoothed vertical speed in px/ms, for the throw on release. */
  vy: number;
  /** The press landed on a list that was still moving: it stops it and means
   *  nothing else, so it neither arms the row nor counts as a tap. */
  arrest: boolean;
  timer: number | null;
}

interface VizSliderProps {
  id: string;
  label: string;
  /** The row's info icon, if the field has anything to explain. */
  hint?: ReactNode;
  /** The value as the readout should show it, at this field's precision. */
  display: (value: number) => string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Every step of a drag. Cheap by contract: the engine reads the config each
   *  frame, so this only has to write to it. */
  onInput: (value: number) => void;
  /** Once, when the gesture ends. Where anything expensive belongs. */
  onCommit: () => void;
}

/**
 * A labelled range row that owns every pointer gesture over it, with the input
 * itself taking none. Two things make the native control hard to work on a
 * phone: its box is only as tall as the grip, and iOS Safari moves the grip
 * only for a touch that lands on the grip itself — 10px of target on a row that
 * is otherwise dead. Here a press anywhere in the row moves it.
 *
 * On a phone a press on this row is ambiguous — the row is a control, but it is
 * also most of the surface of a list that has to scroll. Three ways out, and
 * the list gets the benefit of the doubt in all of them:
 *
 *   - a press that stays put for {@link HOLD_MS} takes the row, and from then
 *     on every direction is the grip's;
 *   - a decisive sideways swipe takes the row without the wait;
 *   - anything else scrolls, which this row then does by hand, throw and all.
 *
 * It has to be by hand, because leaving the scrolling to the browser
 * (`touch-action: pan-y`) means the list also slides under a finger that is
 * only wandering while it drags the grip.
 *
 * The value is held here while a drag is in flight and handed up on release.
 * The whole row's worth of React — every group, every other slider — is not
 * worth re-rendering at pointermove rate on a phone.
 *
 * The input stays for what it is good at: keyboard, focus, labelling.
 */
export default function VizSlider({
  id,
  label,
  hint,
  display,
  min,
  max,
  step,
  value,
  onInput,
  onCommit,
}: VizSliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set while a drag is in flight, and the value shown until it ends. */
  const [dragValue, setDragValue] = useState<number | null>(null);
  /** The row has taken the gesture. Touch has no hover, so this is the only
   *  thing that tells a finger the difference between a press and a drag. */
  const [armed, setArmed] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const fling = useRef<number | null>(null);

  const shown = dragValue ?? value;

  /** True if this stopped a throw that was still running. */
  const stopFling = () => {
    if (fling.current === null) return false;
    cancelAnimationFrame(fling.current);
    fling.current = null;
    return true;
  };

  // A throw outlives the gesture that started it, so it has to be called off if
  // the panel closes under it.
  useEffect(
    () => () => {
      stopFling();
    },
    [],
  );

  const throwScroller = (scroller: HTMLElement, v0: number) => {
    let v = v0;
    let last = performance.now();
    const frame = (now: number) => {
      // A frame the tab spent in the background is not travel the finger asked
      // for, so it is capped rather than paid out.
      const dt = Math.min(32, now - last);
      last = now;
      const before = scroller.scrollTop;
      scroller.scrollTop -= v * dt;
      v *= Math.pow(FLING_DECAY, dt / 16);
      // Either end of the list ends it: there is nothing left to carry.
      if (Math.abs(v) < FLING_MIN || scroller.scrollTop === before) {
        fling.current = null;
        return;
      }
      fling.current = requestAnimationFrame(frame);
    };
    fling.current = requestAnimationFrame(frame);
  };

  const setFromX = (clientX: number) => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const travel = rect.width - GRIP_W;
    if (travel <= 0) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left - GRIP_W / 2) / travel));
    const stepped = min + Math.round((t * (max - min)) / step) * step;
    // Stepping in floats leaves noise a few places down, which then shows up in
    // the readout beside the label.
    const decimals = (String(step).split(".")[1] ?? "").length;
    const next = Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
    if (next === shown) return;
    setDragValue(next);
    onInput(next);
  };

  const end = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.timer !== null) window.clearTimeout(g.timer);
    setDragValue(null);
    setArmed(false);
    // A gesture that only ever scrolled — or only ever stopped a scroll — has
    // changed nothing to commit.
    if (!commit || !g) return;
    if (g.mode === "sliding" || (g.mode === "asking" && !g.arrest)) onCommit();
  };

  return (
    <div className="mb-2 last:mb-0.5">
      <div className="flex items-center gap-1 font-mono text-[10px] text-ink-muted">
        <label htmlFor={id} className="truncate cursor-pointer">
          {label}
        </label>
        {hint}
        <span className="ml-auto shrink-0 text-white/55 tabular-nums">{display(shown)}</span>
      </div>
      <div
        className="viz-slider-grab"
        data-armed={armed ? "true" : undefined}
        onPointerDown={(e) => {
          // A second finger on the row is not a second gesture.
          if (gesture.current) return;
          const arrest = stopFling();
          e.currentTarget.setPointerCapture(e.pointerId);
          inputRef.current?.focus({ preventScroll: true });
          // A mouse or pen has already said what it means by pressing; a finger
          // has not, since the same press may turn out to be a scroll.
          const touch = e.pointerType === "touch";
          const g: Gesture = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            mode: touch ? "asking" : "sliding",
            scroller: touch ? scrollerOf(e.currentTarget) : null,
            lastX: e.clientX,
            lastY: e.clientY,
            lastT: e.timeStamp,
            vy: 0,
            arrest,
            timer: null,
          };
          gesture.current = g;
          if (!touch) {
            setArmed(true);
            setFromX(e.clientX);
            return;
          }
          if (arrest) return;
          g.timer = window.setTimeout(() => {
            if (gesture.current !== g || g.mode !== "asking") return;
            g.timer = null;
            g.mode = "sliding";
            setArmed(true);
            // The grip comes to the finger on arming rather than on the first
            // move after it, so the row answers the press that took it.
            setFromX(g.lastX);
          }, HOLD_MS);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.pointerId) return;
          const dy = e.clientY - g.lastY;
          const dt = Math.max(1, e.timeStamp - g.lastT);

          if (g.mode === "asking") {
            const adx = Math.abs(e.clientX - g.x);
            const ady = Math.abs(e.clientY - g.y);
            // A finger that has wandered this far is no longer holding still,
            // so the hold is off — but the gesture is still undeclared until
            // one of the thresholds below is met.
            if (g.timer !== null && Math.max(adx, ady) > HOLD_SLOP) {
              window.clearTimeout(g.timer);
              g.timer = null;
            }
            if (adx >= SLIDE_SLOP && adx > ady * SLIDE_BIAS) {
              g.mode = "sliding";
              setArmed(true);
            } else if (ady >= SCROLL_SLOP) {
              g.mode = "scrolling";
            }
            // Whichever it turns out to be, it picks up from where the finger
            // is now, so nothing jumps by the slop at the moment it takes over.
            g.lastX = e.clientX;
            g.lastY = e.clientY;
            g.lastT = e.timeStamp;
            if (g.mode === "sliding") setFromX(e.clientX);
            return;
          }

          g.lastX = e.clientX;
          g.lastY = e.clientY;
          g.lastT = e.timeStamp;

          if (g.mode === "scrolling") {
            if (g.scroller) g.scroller.scrollTop -= dy;
            // Weighted towards the newest sample: the throw should follow how
            // the finger was moving as it left, not the whole drag's average.
            g.vy = 0.7 * (dy / dt) + 0.3 * g.vy;
            return;
          }
          setFromX(e.clientX);
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.pointerId) return;
          // A touch that never became either gesture was a tap on the row —
          // unless it was only ever there to stop the list.
          if (g.mode === "asking" && !g.arrest) setFromX(e.clientX);
          if (
            g.mode === "scrolling" &&
            g.scroller &&
            Math.abs(g.vy) > FLING_MIN &&
            // A finger that came to rest before lifting was placing the list,
            // not throwing it: no pointermove fires while it sits still, so the
            // last speed measured would otherwise be paid out on release.
            e.timeStamp - g.lastT < FLING_STALE_MS
          ) {
            throwScroller(g.scroller, g.vy);
          }
          end(true);
        }}
        onPointerCancel={() => end(false)}
      >
        <input
          ref={inputRef}
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => {
            // Keyboard only — the grab area above takes every pointer. One key
            // press is a whole gesture, so it commits as it goes.
            onInput(Number(e.target.value));
            onCommit();
          }}
          className="viz-slider"
          style={{ "--viz-fill": `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
