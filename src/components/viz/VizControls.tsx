import { X, Sliders, Maximize, Minimize, Captions, CaptionsOff } from "lucide-react";
import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";
import VizSpeedControl from "./VizSpeedControl";

interface VizControlsProps {
  visible: boolean;
  feature: Panel | null;
  /** False while the pinned bar is carrying the attribution instead. */
  showFeature: boolean;
  /** Height of the pinned label's band, so the chrome sits above it. */
  bottomInset: number;
  seed: string;
  paused: boolean;
  fullscreen: boolean;
  pinned: boolean;
  speed: number;
  onSpeedChange: (speed: number) => void;
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
  seed,
  paused,
  fullscreen,
  pinned,
  speed,
  onSpeedChange,
  onTogglePin,
  onClose,
  onToggleFullscreen,
  onToggleDebug,
}: VizControlsProps) {
  return (
    <div
      className="absolute inset-0 pointer-events-none transition-opacity duration-500"
      style={{ opacity: visible ? 1 : 0, bottom: bottomInset }}
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
        className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 flex flex-col gap-2.5
                   sm:flex-row sm:items-end sm:justify-between sm:gap-4"
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
        {/* Bottom right rather than up with the icon buttons: this is the one
            control worth reaching for mid-run, the chrome is only up for a
            couple of seconds, and on a phone the corner nearest the thumb is
            the one to spend on it. */}
        <div className="shrink-0 order-1 sm:order-2 flex flex-col items-end gap-2 pointer-events-auto">
          <VizSpeedControl
            value={speed}
            onChange={onSpeedChange}
            tone="overlay"
            tabIndex={visible ? 0 : -1}
          />
          <div className="font-display text-[10px] tracking-widest uppercase text-white/25">
            {paused ? "paused" : `seed ${seed}`}
          </div>
        </div>
      </div>
    </div>
  );
}
