import { X, Sliders, Maximize, Minimize } from "lucide-react";
import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";

interface VizControlsProps {
  visible: boolean;
  feature: Panel | null;
  seed: string;
  paused: boolean;
  fullscreen: boolean;
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
  seed,
  paused,
  fullscreen,
  onClose,
  onToggleFullscreen,
  onToggleDebug,
}: VizControlsProps) {
  return (
    <div
      className="absolute inset-0 pointer-events-none transition-opacity duration-500"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden={!visible}
    >
      <div className="absolute top-0 right-0 flex items-center gap-1 p-3 pointer-events-auto">
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

      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {feature && (
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
        <div className="font-display text-[10px] tracking-widest uppercase text-white/25 shrink-0">
          {paused ? "paused" : `seed ${seed}`}
        </div>
      </div>
    </div>
  );
}
