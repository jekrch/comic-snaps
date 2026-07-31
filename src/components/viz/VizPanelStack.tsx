import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Expand, X } from "lucide-react";
import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";

/** Height of the control row, px. The stack's own resting height, and what the
 *  chrome above it is lifted by until the list is opened. */
export const PANEL_STACK_ROW_HEIGHT = 60;

/** How long the slide down takes. Matched by `vizLiftOut` in the stylesheet,
 *  and read by the overlay, which holds the stack mounted for it. */
export const PANEL_STACK_EXIT_MS = 220;

interface VizPanelStackProps {
  /** Most prominent first while the run is live; newest first once stepped
   *  back into the trail. Never empty, and its head is always the panel being
   *  named — the overlay only mounts this with something to name. */
  stack: Panel[];
  /** How many entries back from the newest this is; 0 at the head of the trail. */
  behind: number;
  /** The run is parked on this panel rather than choosing its own. */
  held: boolean;
  canStepBack: boolean;
  /** Rendered, but on its way out: play the exit rather than the entrance. */
  leaving?: boolean;
  onStep: (delta: -1 | 1) => void;
  /** Absent when the host has nowhere to open the panel; the labels stay inert. */
  onOpen?: (panel: Panel) => void;
  onUnpin: () => void;
  /** The stack's live height, so the chrome can sit clear of it as it opens. */
  onHeightChange?: (height: number) => void;
}

/**
 * The pinned counterpart to the auto-hiding credit line.
 *
 * The composition is a superimposition, so naming one panel was always a
 * simplification of what is on screen. This names the front one and keeps the
 * rest a click away, ordered by how much of the frame each is carrying — most
 * prominent at the top of the list.
 *
 * Unlike the letterbox band it replaces, it sits *over* the art rather than
 * taking a strip away from it: the run keeps the whole frame, and legibility
 * comes from each card's own blurred ground plus a soft scrim under the row,
 * rather than from blacking out the bottom of the picture.
 *
 * It also carries the trail — the panels that have already been through the
 * frame — since a screensaver's usual failure is that the one you wanted to
 * know about is already gone.
 */
export default function VizPanelStack({
  stack,
  behind,
  held,
  canStepBack,
  leaving = false,
  onStep,
  onOpen,
  onUnpin,
  onHeightChange,
}: VizPanelStackProps) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Held, the stack is what the run was told to carry, so it is on screen
  // however far back down the trail the reader had to go to name it.
  const live = behind === 0 || held;
  const panel = stack[0];
  const more = stack.length - 1;

  // The row is a fixed height, but the open list is not — it is however many
  // panels are on screen, capped — so what the chrome has to clear is measured
  // rather than assumed.
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element || !onHeightChange) return;
    const observer = new ResizeObserver(() => onHeightChange(element.offsetHeight));
    observer.observe(element);
    onHeightChange(element.offsetHeight);
    return () => observer.disconnect();
  }, [onHeightChange]);

  // Nothing to open, and nothing to say about a stack of one.
  const stackable = stack.length > 1;
  const open = expanded && stackable;

  return (
    <div
      ref={rootRef}
      className={`absolute bottom-0 left-0 right-0 z-10
                  ${leaving ? "viz-lift-out pointer-events-none" : "viz-lift-in"}`}
      style={{ cursor: "default" }}
      aria-hidden={leaving}
    >
      {/* Reaches above the stack rather than boxing it: the art is meant to
          carry on behind this, and a hard edge across the frame is the thing
          the band used to do wrong. */}
      <div aria-hidden="true" className="viz-stack-scrim" />

      {open && (
        <ul
          className="viz-stack-list relative flex flex-col gap-1 px-2 sm:px-3 pb-1
                     max-h-[45vh] overflow-y-auto overscroll-contain"
        >
          {stack.map((entry, index) => (
            <li key={entry.id}>
              <StackCard panel={entry} rank={index} naming={index === 0} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}

      <div
        className="relative flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4"
        style={{ height: PANEL_STACK_ROW_HEIGHT }}
      >
        {open ? (
          <span className="min-w-0 flex-1 font-display text-[10px] tracking-widest uppercase text-white/40">
            {live ? `${stack.length} on screen` : "recently on screen"}
          </span>
        ) : (
          <button
            onClick={onOpen ? () => onOpen(panel) : undefined}
            disabled={!onOpen}
            className="group flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 text-left
                       cursor-pointer disabled:cursor-default"
            title={onOpen ? "Open this panel in the viewer" : undefined}
          >
            {/* Drawn as a deck when there is more behind it: the count says how
                many, but the edges are what makes it read as something to open. */}
            <span className={`relative shrink-0 ${stackable ? "viz-stack-deck" : ""}`}>
              <img
                src={`${import.meta.env.BASE_URL}${panel.image}`}
                alt=""
                aria-hidden="true"
                loading="lazy"
                /* Above the deck edges behind it: both are positioned, so
                   without this the second edge would paint over the art. */
                className="relative z-10 h-10 w-10 rounded-sm object-cover border border-white/15
                           bg-black/60 group-hover:border-white/40 transition-colors"
              />
            </span>
            <span className="min-w-0 font-display text-[11px] tracking-wider uppercase leading-relaxed viz-stack-text">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-white/90 group-hover:text-white transition-colors">
                  {panel.title} {formatIssue(panel.issue)}
                </span>
                <Expand
                  size={11}
                  className="shrink-0 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </span>
              <span className="block truncate text-white/50">
                {panel.artist} · {panel.year}
              </span>
            </span>
          </button>
        )}

        {/* The trail, and the way into the stack. Kept beside the label rather
            than in the auto-hiding chrome: stepping and browsing are the whole
            reason the label is pinned. */}
        <div className="shrink-0 flex items-center gap-0.5 sm:gap-1">
          {stackable && (
            <button
              onClick={() => setExpanded((wasOpen) => !wasOpen)}
              className="viz-btn h-7 px-1.5 gap-1"
              title={open ? "Collapse the stack" : `Show all ${stack.length} panels`}
              aria-expanded={open}
            >
              <span className="font-mono text-[10px] tabular-nums leading-none">
                {open ? stack.length : `+${more}`}
              </span>
              {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          )}
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
            className={`font-mono text-[10px] tabular-nums text-center w-9 sm:w-12 ${
              behind === 0 && !held ? "text-white/35" : "text-accent"
            }`}
            aria-live="polite"
          >
            {behind > 0 ? `−${behind}` : held ? "held" : "live"}
          </span>
          {/* Never disabled, unlike stepping back: forward past the newest panel
              seen is not the end of a list, it is the run brought on. */}
          <button
            onClick={() => onStep(1)}
            className="viz-btn h-7 min-w-7 px-1"
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
    </div>
  );
}

/**
 * One panel in the open stack. Wider than the row's label and with its own
 * ground, because this is the part a reader browses: the thumbnail is what they
 * are matching against the frame, not the title.
 */
function StackCard({
  panel,
  rank,
  naming,
  onOpen,
}: {
  panel: Panel;
  rank: number;
  naming: boolean;
  onOpen?: (panel: Panel) => void;
}) {
  return (
    <button
      onClick={onOpen ? () => onOpen(panel) : undefined}
      disabled={!onOpen}
      className={`viz-stack-card group ${naming ? "viz-stack-card-front" : ""}`}
      style={{ animationDelay: `${Math.min(rank, 5) * 28}ms` }}
      aria-current={naming ? "true" : undefined}
      title={onOpen ? "Open this panel in the viewer" : undefined}
    >
      <img
        src={`${import.meta.env.BASE_URL}${panel.image}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="h-9 w-9 shrink-0 rounded-sm object-cover border border-white/15 bg-black/60
                   group-hover:border-white/40 transition-colors"
      />
      <span className="min-w-0 flex-1 font-display text-[11px] tracking-wider uppercase leading-relaxed text-left">
        <span className="block truncate text-white/90 group-hover:text-white transition-colors">
          {panel.title} {formatIssue(panel.issue)}
        </span>
        <span className="block truncate text-white/50">
          {panel.artist} · {panel.year}
        </span>
      </span>
      <Expand
        size={11}
        className="shrink-0 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </button>
  );
}
