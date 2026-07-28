import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";

/** Height of the letterbox band, px. The engine surface is inset by exactly
 *  this much, so the art is never behind the label. */
export const ATTRIBUTION_BAR_HEIGHT = 64;

interface VizAttributionBarProps {
  panel: Panel;
  /** How many entries back from the newest this is; 0 while it is live. */
  behind: number;
  canStepBack: boolean;
  canStepForward: boolean;
  onStep: (delta: -1 | 1) => void;
  /** Absent when the host has nowhere to open the panel; the label stays inert. */
  onOpen?: (panel: Panel) => void;
  onUnpin: () => void;
}

/**
 * The pinned counterpart to the auto-hiding credit line. Because it never
 * fades, it gets a letterbox band of its own rather than sitting over the art:
 * the surface is inset above it, so nothing is ever covered and the label stays
 * legible without a scrim fighting whatever is on screen.
 *
 * It also carries the trail — the panels that have already been through the
 * frame — since a screensaver's usual failure is that the one you wanted to
 * know about is already gone.
 */
export default function VizAttributionBar({
  panel,
  behind,
  canStepBack,
  canStepForward,
  onStep,
  onOpen,
  onUnpin,
}: VizAttributionBarProps) {
  const live = behind === 0;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 sm:gap-3
                 border-t border-white/10 bg-black px-2.5 sm:px-4"
      style={{ height: ATTRIBUTION_BAR_HEIGHT, cursor: "default" }}
    >
      <button
        onClick={onOpen ? () => onOpen(panel) : undefined}
        disabled={!onOpen}
        className="group flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 text-left
                   cursor-pointer disabled:cursor-default"
        title={onOpen ? "Open this panel in the viewer" : undefined}
      >
        <img
          src={`${import.meta.env.BASE_URL}${panel.image}`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-sm object-cover border border-white/12
                     group-hover:border-white/35 transition-colors"
        />
        <span className="min-w-0 font-display text-[11px] tracking-wider uppercase leading-relaxed">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-white/85 group-hover:text-white transition-colors">
              {panel.title} {formatIssue(panel.issue)}
            </span>
            <Expand
              size={11}
              className="shrink-0 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </span>
          <span className="block truncate text-white/45">
            {panel.artist} · {panel.year}
          </span>
        </span>
      </button>

      {/* The trail. Kept beside the label rather than in the auto-hiding chrome:
          stepping back is the whole reason the bar is pinned. */}
      <div className="shrink-0 flex items-center gap-0.5 sm:gap-1">
        <button
          onClick={() => onStep(-1)}
          disabled={!canStepBack}
          className="viz-btn h-7 min-w-7 px-1 disabled:opacity-25 disabled:hover:bg-black/55
                     disabled:hover:text-white/75 disabled:hover:border-white/12 disabled:active:scale-100"
          title="Previous panel (←)"
          aria-label="Previous panel"
        >
          <ChevronLeft size={15} />
        </button>
        <span
          className={`font-mono text-[10px] tabular-nums text-center w-12 sm:w-14 ${
            live ? "text-white/30" : "text-accent"
          }`}
          aria-live="polite"
        >
          {live ? "live" : `−${behind}`}
        </span>
        <button
          onClick={() => onStep(1)}
          disabled={!canStepForward}
          className="viz-btn h-7 min-w-7 px-1 disabled:opacity-25 disabled:hover:bg-black/55
                     disabled:hover:text-white/75 disabled:hover:border-white/12 disabled:active:scale-100"
          title="Next panel (→)"
          aria-label="Next panel"
        >
          <ChevronRight size={15} />
        </button>
        <button
          onClick={onUnpin}
          className="viz-btn h-7 min-w-7 px-1 ml-0.5 sm:ml-1"
          title="Unpin the label (L)"
          aria-label="Unpin the attribution label"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
