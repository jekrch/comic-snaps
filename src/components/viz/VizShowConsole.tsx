import { Maximize, MonitorX, MoveRight, Focus } from "lucide-react";
import { canPlaceOnDisplay } from "./useShowWindow";

interface VizShowConsoleProps {
  /**
   * Width the tuning panel is taking down the left, so this centres in what is
   * left rather than under it. Zero while the panel is away.
   */
  leftInset: number;
  /** Raise the show window, for when it has gone behind something. */
  onFocusShow: () => void;
  onFullscreenShow: () => void;
  /** Only offered where the browser can say where the displays are. */
  onPlaceShow: () => void;
  /** Bring the run back into this window. */
  onAttach: () => void;
}

/**
 * What this window shows once the run is somewhere else.
 *
 * Everything that drives the composition is still the ordinary chrome around
 * the edges — the same transport, mode, speed and tuning panel, pinned open
 * rather than fading out. This is only the middle of the screen: the few things
 * that are about the *window* rather than the run, and a plain statement of
 * where the run went, so a black rectangle full of controls is not mistaken for
 * a run that failed to start.
 */
export default function VizShowConsole({
  leftInset,
  onFocusShow,
  onFullscreenShow,
  onPlaceShow,
  onAttach,
}: VizShowConsoleProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none"
      style={{
        paddingLeft: `calc(1.5rem + ${leftInset}px)`,
        transition: "padding-left 220ms cubic-bezier(0.16, 0.84, 0.44, 1)",
      }}
    >
      <div
        className="flex flex-col items-center gap-3 text-center max-w-100 pointer-events-auto"
        style={{ animation: "scrimIn 500ms ease-out" }}
      >
        <div className="font-display text-[11px] tracking-widest uppercase text-accent">
          showing in its own window
        </div>
        <p className="font-mono text-[10.5px] leading-relaxed text-white/40">
          Drag that window onto the screen you are showing from, then fill it — press{" "}
          <span className="text-white/65">F</span> there, or double-click it. This screen keeps
          the controls: everything around the edges is live, and{" "}
          <span className="text-white/65">D</span> brings the sliders back if you put them away.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
          <ConsoleButton icon={<Maximize size={13} />} label="fill screen" onClick={onFullscreenShow} />
          {canPlaceOnDisplay() && (
            <ConsoleButton icon={<MoveRight size={13} />} label="other display" onClick={onPlaceShow} />
          )}
          <ConsoleButton icon={<Focus size={13} />} label="raise" onClick={onFocusShow} />
          <ConsoleButton icon={<MonitorX size={13} />} label="bring it back" onClick={onAttach} />
        </div>
      </div>
    </div>
  );
}

function ConsoleButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="viz-btn px-2.5 gap-1.5 font-display text-[9.5px] tracking-widest uppercase"
    >
      {icon}
      {label}
    </button>
  );
}
