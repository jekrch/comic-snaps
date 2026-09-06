interface VizLaunchButtonProps {
  onLaunch: () => void;
  disabled?: boolean;
}

/**
 * The way into a run, under the two view plates at the foot of the filter
 * list — so a run always starts from the wall exactly as the reader has
 * narrowed it.
 *
 * It used to be a plate of its own, sharing the gutter with the view switch.
 * With two alternate readings to offer, that gutter belongs to navigation:
 * three plates in a 180px card is a wall of little frames, and the two that
 * take you somewhere else in the gallery are the ones a reader is looking for.
 * The visualizer is not a place — it is a thing the collection does, once, and
 * a reader who wants it knows they want it. So it is a line rather than a
 * frame: the same 9px caption type the plates wear, on the page's own surface,
 * under the rule of the plates above it.
 *
 * The mark survives the demotion, because it is the compositing model itself —
 * superimposed panels, blended. Three discs on `screen`, where every overlap
 * really is brighter than what went into it. A glyph of overlapping circles
 * only depicts that; these do it, in the same three inks the site is drawn in.
 * They hold still until hovered and then drift, slowly and continuously: a run
 * is a slow thing to watch and the door to it should not be twitching.
 */
export default function VizLaunchButton({ onLaunch, disabled }: VizLaunchButtonProps) {
  return (
    <button
      type="button"
      onClick={onLaunch}
      disabled={disabled}
      aria-label="Start the visualizer on the filtered set"
      className="viz-link font-display"
    >
      <span className="viz-link-mark plate-blend" aria-hidden="true">
        <i className="plate-disc plate-disc-a" />
        <i className="plate-disc plate-disc-b" />
        <i className="plate-disc plate-disc-c" />
      </span>
      visualize
    </button>
  );
}
