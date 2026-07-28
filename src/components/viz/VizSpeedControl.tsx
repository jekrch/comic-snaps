import { VIZ_SPEEDS, formatSpeed, nearestSpeed } from "./vizConfig";

interface VizSpeedControlProps {
  value: number;
  onChange: (speed: number) => void;
  /** "modal" sits on the surface colour; "overlay" sits on top of the art. */
  tone: "modal" | "overlay";
  /** Overlay chrome is focus-skipped while hidden. */
  tabIndex?: number;
}

/**
 * The one control that is worth reaching for mid-run, so it is offered in both
 * places a viewer can reach: the launch modal and the auto-hiding chrome. A
 * segmented row rather than a slider — the overlay copy has to be hit by a
 * finger inside the few seconds the chrome is up, and a tap beats a drag.
 */
export default function VizSpeedControl({
  value,
  onChange,
  tone,
  tabIndex,
}: VizSpeedControlProps) {
  const active = nearestSpeed(value);
  const overlay = tone === "overlay";

  return (
    <div
      role="radiogroup"
      aria-label="Speed"
      className={`flex items-center gap-px rounded-md p-0.5 ${
        overlay ? "border border-white/12 bg-black/55 backdrop-blur-md" : "bg-black/30"
      }`}
    >
      {VIZ_SPEEDS.map((speed) => {
        const selected = speed === active;
        return (
          <button
            key={speed}
            role="radio"
            aria-checked={selected}
            aria-label={`${formatSpeed(speed)} speed`}
            tabIndex={tabIndex}
            onClick={() => onChange(speed)}
            className={`font-mono text-[10px] leading-none rounded transition-colors duration-100
                        ${overlay ? "h-7 min-w-8 px-1.5" : "h-6 min-w-8 px-1.5"}
                        ${
                          selected
                            ? "bg-accent/20 text-accent"
                            : "text-white/40 hover:text-white/85 hover:bg-white/8"
                        }`}
          >
            {formatSpeed(speed)}
          </button>
        );
      })}
    </div>
  );
}
