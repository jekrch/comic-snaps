import { useRef, useState, type ReactNode } from "react";

/** Grip width in the stylesheet. The grip's centre only travels between the
 *  half-widths at each end, so a pointer maps against that inset, not the
 *  full width — otherwise the grip lags the finger at the ends. */
const GRIP_W = 10;

/** How far a touch has to travel before it has declared which gesture it is. */
const SLOP = 6;

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
 * A touch declares itself on its first few pixels: sideways is the grip's,
 * vertical is the panel scrolling, which this row then does by hand. It has to
 * be by hand, because leaving it to the browser (`touch-action: pan-y`) means
 * the list also slides under a finger that is only wandering while it drags.
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
  const gesture = useRef<{
    x: number;
    y: number;
    /** "asking" is a touch that has not yet declared itself. */
    mode: "asking" | "sliding" | "scrolling";
    scroller: HTMLElement | null;
    lastY: number;
  } | null>(null);

  const shown = dragValue ?? value;

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
    setDragValue(null);
    // A gesture that only ever scrolled has changed nothing to commit.
    if (commit && g?.mode !== "scrolling") onCommit();
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
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          inputRef.current?.focus({ preventScroll: true });
          // A mouse or pen has already said what it means by pressing; a finger
          // has not, since the same press may turn out to be a scroll.
          const touch = e.pointerType === "touch";
          gesture.current = {
            x: e.clientX,
            y: e.clientY,
            mode: touch ? "asking" : "sliding",
            scroller: touch ? scrollerOf(e.currentTarget) : null,
            lastY: e.clientY,
          };
          if (!touch) setFromX(e.clientX);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          if (g.mode === "asking") {
            const dx = Math.abs(e.clientX - g.x);
            const dy = Math.abs(e.clientY - g.y);
            if (Math.max(dx, dy) < SLOP) return;
            g.mode = dx >= dy ? "sliding" : "scrolling";
          }
          if (g.mode === "scrolling") {
            if (g.scroller) g.scroller.scrollTop -= e.clientY - g.lastY;
            g.lastY = e.clientY;
            return;
          }
          setFromX(e.clientX);
        }}
        onPointerUp={(e) => {
          // A touch that never became either gesture was a tap on the row.
          if (gesture.current?.mode === "asking") setFromX(e.clientX);
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
