import { useCallback } from "react";
import ThoughtBalloon from "./ThoughtBalloon";
import { HEADER_FADE_MASK } from "../BirdIcon";
import { useAtTop } from "../../hooks/useAtTop";

/**
 * The visualizer's entry point in the header: what the bird is thinking about.
 * The balloon's trail runs back toward its head — so the word is attributed to
 * the bird rather than parked next to it, and the run gets a door that isn't
 * buried at the bottom of the filter list.
 *
 * Nothing is drawn until the bird has finished its intro hop, and then it
 * arrives in the order a thought does: the bubble at its head, the next one out,
 * then the balloon. Sequencing it against the landing is the difference between
 * a bird that is thinking and a header that has a graphic in it.
 *
 * Once the page is scrolled the balloon dissolves toward the bottom of the bar
 * exactly as the bird does — two copies stacked, the solid one fading off to
 * leave the masked one behind, because a `mask-image` cannot be transitioned.
 * The bird thinning out while its thought stayed inked was the whole tell that
 * the two were separate marks.
 */

interface VizThoughtProps {
  onLaunch: () => void;
  /** Makes the bird peck. It is being read, after all. */
  onNudge?: () => void;
  /** True once the bird's intro hop has landed; until then, nothing is drawn. */
  landed?: boolean;
}

export default function VizThought({ onLaunch, onNudge, landed }: VizThoughtProps) {
  const atTop = useAtTop();

  const nudge = useCallback(() => {
    onNudge?.();
    // The overlay is lazily chunked, so the first launch of a session otherwise
    // waits on a fetch. Intent to click is a good moment to have it in hand.
    void import("./VisualizerOverlay");
  }, [onNudge]);

  return (
    <button
      onClick={onLaunch}
      onMouseEnter={nudge}
      onFocus={nudge}
      title=""
      aria-label="play with the visualizer"
      /* The balloon is taller than the header row and is meant to be — `-my-2`
         takes the overhang back out of the layout so it spills over the bar
         instead of growing it. `p-1 -m-1` is hit area at the same price, and
         `ml-1` keeps the trail within a thought's reach of the bird. */
      className="viz-think cursor-pointer p-1 -m-1 -my-2 ml-1 -translate-y-0.5 -translate-x-1.5 focus:outline-none scale-75"
    >
      {/* The two copies are the same drawing at the same place, so at the top of
          the page the masked one is simply hidden under the solid one. */}
      <div className="relative">
        <div
          className={`transition-opacity duration-300 ease-in ${
            landed && !atTop ? "opacity-0" : "opacity-100"
          }`}
        >
          <ThoughtBalloon shown={!!landed} label="" />
        </div>
        <div
          className="absolute inset-0"
          style={{ maskImage: HEADER_FADE_MASK, WebkitMaskImage: HEADER_FADE_MASK }}
        >
          <ThoughtBalloon shown={!!landed} label="" />
        </div>
      </div>
    </button>
  );
}
