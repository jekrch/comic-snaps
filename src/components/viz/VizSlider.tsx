import { useRef, useState, type ReactNode } from "react";

/** Grip width in the stylesheet. The grip's centre only travels between the
 *  half-widths at each end, so a pointer maps against that inset, not the
 *  full width — otherwise the grip lags the finger at the ends. */
const GRIP_W = 10;

/** The grip's touch target. Its size and position live in the stylesheet;
 *  testing a touch against the element itself keeps the area the browser
 *  scrolls and the area this row drags exactly the same shape, whatever that
 *  shape turns out to be. */
const GRIP_HIT = "viz-slider-grip-hit";

interface Drag {
  pointerId: number;
  /** Where the pointer sat relative to the grip's centre when it took hold.
   *  Kept for the length of the drag, so a finger that lands on the edge of a
   *  target much wider than the grip does not drag the value across to meet
   *  it. */
  offset: number;
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
 * itself taking none — iOS Safari's native range only answers to a touch that
 * lands on the grip, and its box is only as tall as the grip is.
 *
 * A mouse gets the whole row: pressing anywhere brings the grip to the cursor
 * and drags from there.
 *
 * A finger gets the grip alone. The row sits in a panel that has to scroll, and
 * a press that could mean either is a press the browser has to guess at — which
 * it does late, mid-gesture, and visibly. So the only part of the row a touch
 * can drag is a target riding the grip ({@link GRIP_HIT}), generously sized and
 * the only thing here holding `touch-action: none`. Everywhere else the row is
 * `pan-y` and the panel just scrolls, natively, with nothing to work out.
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
  /** The row has the gesture. Touch has no hover, so this is the only thing
   *  that tells a finger it has hold of the grip. */
  const [armed, setArmed] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** Whether this gesture has moved the value, and so has anything to commit. */
  const changed = useRef(false);

  const shown = dragValue ?? value;
  const frac = (shown - min) / (max - min);

  /** The grip's centre in client coordinates — the same inset travel the
   *  stylesheet places it along. */
  const gripCentre = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return rect.left + GRIP_W / 2 + frac * (rect.width - GRIP_W);
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
    changed.current = true;
    setDragValue(next);
    onInput(next);
  };

  const end = (commit: boolean) => {
    if (!drag.current) return;
    drag.current = null;
    setDragValue(null);
    setArmed(false);
    // A press that never moved the grip — a tap on the target, a click on the
    // value it already held — has nothing to commit.
    if (commit && changed.current) onCommit();
    changed.current = false;
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
        style={
          {
            "--viz-frac": frac,
            "--viz-fill": `${frac * 100}%`,
          } as React.CSSProperties
        }
        onPointerDown={(e) => {
          // A second finger on the row is not a second gesture.
          if (drag.current) return;
          const touch = e.pointerType === "touch";
          let offset = 0;
          if (touch) {
            // Off the grip, this touch is the panel's to scroll: leaving it
            // uncaptured is what lets the browser do that without a fight.
            if (!(e.target instanceof Element) || !e.target.closest(`.${GRIP_HIT}`)) return;
            const centre = gripCentre();
            if (centre === null) return;
            offset = e.clientX - centre;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          inputRef.current?.focus({ preventScroll: true });
          drag.current = { pointerId: e.pointerId, offset };
          setArmed(true);
          // A mouse has said where it wants the grip. A finger already has it.
          if (!touch) setFromX(e.clientX);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.pointerId) return;
          setFromX(e.clientX - d.offset);
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointerId !== e.pointerId) return;
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
        />
        {/* Rides the grip, and on a phone is the whole of what a finger can
            drag. Empty and invisible: it is a hit target, not a part. */}
        <span className={GRIP_HIT} aria-hidden="true" />
      </div>
    </div>
  );
}
