import { useRef } from "react";

/** Grip width in the stylesheet. The grip's centre only travels between the
 *  half-widths at each end, so a pointer maps against that inset, not the
 *  full width — otherwise the grip lags the finger at the ends. */
const GRIP_W = 10;

/** How far a finger has to travel sideways before it counts as a drag rather
 *  than the start of a scroll. */
const DRAG_SLOP = 4;

interface VizSliderProps {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

/**
 * A range input inside a taller grab area that owns every pointer gesture, with
 * the input itself taking none. Two things make the native control hard to work
 * on a phone: its box is only as tall as the grip, and iOS Safari moves the
 * grip only for a touch that lands on the grip itself — 10px of target on a row
 * that is otherwise dead. Here a press anywhere in the row moves it.
 *
 * The input stays for what it is good at: keyboard, focus, labelling.
 */
export default function VizSlider({ id, min, max, step, value, onChange }: VizSliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set while a gesture is in flight. `live` is false for a touch that has not
   *  yet declared itself a drag rather than a scroll. */
  const drag = useRef<{ x: number; live: boolean } | null>(null);

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
    if (next !== value) onChange(next);
  };

  const fill = ((value - min) / (max - min)) * 100;

  return (
    <div
      className="viz-slider-grab"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        inputRef.current?.focus({ preventScroll: true });
        // A mouse or pen has already committed by pressing; a finger has not,
        // since the same press may turn out to be the list scrolling.
        const live = e.pointerType !== "touch";
        drag.current = { x: e.clientX, live };
        if (live) setFromX(e.clientX);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.live) {
          if (Math.abs(e.clientX - d.x) < DRAG_SLOP) return;
          d.live = true;
        }
        setFromX(e.clientX);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        // A touch that never became a drag was a tap on the row: honour it.
        if (d && !d.live) setFromX(e.clientX);
      }}
      // Vertical travel is the panel scrolling, and the browser takes the
      // gesture away from us to do it. Nothing has been committed by then.
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="viz-slider"
        style={{ "--viz-fill": `${fill}%` } as React.CSSProperties}
      />
    </div>
  );
}
