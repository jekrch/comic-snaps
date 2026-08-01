import {
  X,
  Sliders,
  Maximize,
  Minimize,
  Captions,
  CaptionsOff,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";
import VizModeControl from "./VizModeControl";
import VizSpeedControl from "./VizSpeedControl";

interface VizControlsProps {
  visible: boolean;
  feature: Panel | null;
  /** False while the pinned stack is carrying the attribution instead. */
  showFeature: boolean;
  /** Live height of the pinned stack, so the chrome sits clear of it. */
  bottomInset: number;
  /** Slide class for the stack's arrival, applied to the bottom cluster alone —
   *  it is the only part of the chrome the stack displaces. Empty when nothing
   *  is moving. */
  lift?: string;
  seed: string;
  paused: boolean;
  /** The run is parked on one panel — see the note on the transport below. */
  held: boolean;
  fullscreen: boolean;
  pinned: boolean;
  speed: number;
  /** The running preset, or null while a pasted config is running. */
  presetId: string | null;
  onPresetChange: (presetId: string) => void;
  /** Raised while the mode menu is open, so the chrome stays up under it. */
  onHoldChange: (held: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onStep: (delta: -1 | 1) => void;
  onToggleHold: () => void;
  onTogglePin: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onToggleDebug?: () => void;
}

/**
 * Auto-hiding chrome. The credit line is not optional decoration — this is a
 * wall of other people's art, and a screensaver that strips the attribution
 * off it would be the wrong thing to ship.
 */
export default function VizControls({
  visible,
  feature,
  showFeature,
  bottomInset,
  lift = "",
  seed,
  paused,
  held,
  fullscreen,
  pinned,
  speed,
  presetId,
  onPresetChange,
  onHoldChange,
  onSpeedChange,
  onStep,
  onToggleHold,
  onTogglePin,
  onClose,
  onToggleFullscreen,
  onToggleDebug,
}: VizControlsProps) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        bottom: bottomInset,
        // The inset is not a constant any more — the stack under this grows
        // when it is opened — so the chrome rides it rather than jumping.
        transition: "opacity 500ms, bottom 220ms cubic-bezier(0.16, 0.84, 0.44, 1)",
      }}
      aria-hidden={!visible}
    >
      <div className="absolute top-0 right-0 flex items-center gap-1 p-3 pointer-events-auto">
        <button
          onClick={onTogglePin}
          className="viz-btn"
          title={pinned ? "Unpin the attribution label (L)" : "Pin the attribution label (L)"}
          aria-label={pinned ? "Unpin the attribution label" : "Pin the attribution label"}
          aria-pressed={pinned}
          tabIndex={visible ? 0 : -1}
        >
          {pinned ? (
            <CaptionsOff size={15} className="text-accent" />
          ) : (
            <Captions size={15} />
          )}
        </button>
        {onToggleDebug && (
          <button
            onClick={onToggleDebug}
            className="viz-btn"
            title="Tuning panel"
            tabIndex={visible ? 0 : -1}
            /* The panel closes on a press anywhere outside it; this one is the
               press that toggles it, so it is read there and skipped. */
            data-viz-tune-toggle=""
          >
            <Sliders size={15} />
          </button>
        )}
        <button
          onClick={onToggleFullscreen}
          className="viz-btn"
          title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          tabIndex={visible ? 0 : -1}
        >
          {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
        <button
          onClick={onClose}
          className="viz-btn"
          title="Exit visualizer (Esc)"
          tabIndex={visible ? 0 : -1}
        >
          <X size={16} />
        </button>
      </div>

      {/* Side by side once there is room, stacked before that: the speed pills
          are a fixed 11rem, and sharing a phone's width with them truncated the
          credit line down to a few characters. The attribution keeps the full
          width and the pills take a row of their own. */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 flex flex-col gap-2.5
                    sm:flex-row sm:items-end sm:justify-between sm:gap-4 ${lift}`}
      >
        <div className="min-w-0 order-2 sm:order-1">
          {feature && showFeature && (
            <div
              key={feature.id}
              className="font-display text-[11px] tracking-wider uppercase leading-relaxed"
              style={{ animation: "scrimIn 700ms ease-out" }}
            >
              <div className="text-white/85 truncate">
                {feature.title} {formatIssue(feature.issue)}
              </div>
              <div className="text-white/45 truncate">
                {feature.artist} · {feature.year}
              </div>
            </div>
          )}
        </div>
        {/* Bottom right rather than up with the icon buttons: these are the
            controls worth reaching for mid-run, the chrome is only up for a
            couple of seconds, and on a phone the corner nearest the thumb is
            the one to spend on it. Mode sits above speed because its menu opens
            upward — over the art rather than over the speed pills. */}
        <div className="shrink-0 order-1 sm:order-2 flex flex-col items-end gap-2 pointer-events-auto">
          {/* The transport. Hold is not the pause on the space bar: that one
              stops the clock and this one stops the *panel*, so the composition
              carries on drifting around whatever the reader wanted to look at.
              A screensaver frozen mid-crossfade is off; this is the version of
              staying still that is worth watching. */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onStep(-1)}
              className="viz-btn"
              title="Previous panel (←)"
              aria-label="Previous panel"
              tabIndex={visible ? 0 : -1}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={onToggleHold}
              className="viz-btn"
              title={held ? "Let the run carry on (H)" : "Hold on this panel (H)"}
              aria-label={held ? "Let the run carry on" : "Hold on this panel"}
              aria-pressed={held}
              tabIndex={visible ? 0 : -1}
            >
              {held ? <Play size={14} className="text-accent" /> : <Pause size={14} />}
            </button>
            <button
              onClick={() => onStep(1)}
              className="viz-btn"
              title="Next panel (→)"
              aria-label="Next panel"
              tabIndex={visible ? 0 : -1}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <VizModeControl
            presetId={presetId}
            onChange={onPresetChange}
            onOpenChange={onHoldChange}
            tabIndex={visible ? 0 : -1}
          />
          <VizSpeedControl
            value={speed}
            onChange={onSpeedChange}
            tone="overlay"
            tabIndex={visible ? 0 : -1}
          />
          <div className="font-display text-[10px] tracking-widest uppercase text-white/25">
            {paused ? "paused" : held ? "held" : `seed ${seed}`}
          </div>
        </div>
      </div>
    </div>
  );
}
