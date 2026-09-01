import ActionPlate from "../ActionPlate";

interface VizLaunchButtonProps {
  onLaunch: () => void;
  disabled?: boolean;
}

/**
 * Sits at the foot of the filter list, so a run always starts from the wall
 * exactly as the reader has narrowed it.
 *
 * The mark is the compositing model itself — superimposed panels, blended — so
 * it is drawn rather than borrowed: three discs on `screen`, where every overlap
 * really is brighter than what went into it. A glyph of overlapping circles only
 * depicts that; these do it, on the plate, in the same three inks the site is
 * drawn in.
 *
 * They hold still until hovered and then drift, slowly and continuously, on a
 * seven-second loop. A run is a slow thing to watch and the door to it should
 * not be twitching.
 */
export default function VizLaunchButton({ onLaunch, disabled }: VizLaunchButtonProps) {
  return (
    <ActionPlate
      label="visualize"
      ariaLabel="Start the visualizer on the filtered set"
      onClick={onLaunch}
      disabled={disabled}
    >
      <span className="plate-blend" aria-hidden="true">
        <i className="plate-disc plate-disc-a" />
        <i className="plate-disc plate-disc-b" />
        <i className="plate-disc plate-disc-c" />
      </span>
    </ActionPlate>
  );
}
