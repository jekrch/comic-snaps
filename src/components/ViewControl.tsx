import type { CSSProperties } from "react";
import ActionPlate from "./ActionPlate";

/**
 * Two readings of the same filtered set: the wall, one card per panel, and the
 * shelf, one row per series (docs/series-view-plan.md §5.1).
 */
export type GalleryView = "wall" | "series";

interface Props {
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
}

/**
 * A block in the plate's miniature, in percent of the art box. The two
 * arrangements hold the same six blocks in the same order, so switching views
 * moves them rather than replacing them.
 */
interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The wall: three columns, packed to uneven heights. */
const WALL: Block[] = [
  { x: 0, y: 0, w: 30, h: 44 },
  { x: 0, y: 52, w: 30, h: 48 },
  { x: 35, y: 0, w: 30, h: 62 },
  { x: 35, y: 70, w: 30, h: 30 },
  { x: 70, y: 0, w: 30, h: 30 },
  { x: 70, y: 38, w: 30, h: 62 },
];

/** The shelf: three rows, each a cover with its strip running off to the right. */
const SHELF: Block[] = [
  { x: 0, y: 0, w: 15, h: 22 },
  { x: 20, y: 0, w: 80, h: 22 },
  { x: 0, y: 39, w: 15, h: 22 },
  { x: 20, y: 39, w: 80, h: 22 },
  { x: 0, y: 78, w: 15, h: 22 },
  { x: 20, y: 78, w: 80, h: 22 },
];

/**
 * The way across, tucked into the bottom of the filter list beside the
 * visualizer launch.
 *
 * One control naming where it goes, not a pair of pills naming where you are:
 * the view is already obvious from the page, and a segmented toggle parked
 * permanently over the wall claimed more of it than a second reading of the
 * same set deserves. It sits with the other action on the narrowed set, since
 * that is what it is — both views take the filters with them.
 *
 * The plate draws its destination instead of captioning a symbol, which means
 * the click has somewhere to land: the same six blocks re-pack from the wall's
 * uneven columns into the shelf's rows, staggered the way the masonry itself
 * settles. The control performs the switch it just made, and afterwards it is
 * sitting on the drawing of the way back.
 */
export default function ViewControl({ view, onViewChange }: Props) {
  const goingToSeries = view === "wall";
  const blocks = goingToSeries ? SHELF : WALL;

  return (
    <ActionPlate
      label={goingToSeries ? "by series" : "by panel"}
      ariaLabel={goingToSeries ? "Show one row per series" : "Show one card per panel"}
      onClick={() => onViewChange(goingToSeries ? "series" : "wall")}
    >
      <span className="plate-grid" aria-hidden="true">
        {blocks.map((b, i) => (
          <i
            key={i}
            className="plate-block"
            style={
              {
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                "--i": i,
              } as CSSProperties
            }
          />
        ))}
      </span>
    </ActionPlate>
  );
}
