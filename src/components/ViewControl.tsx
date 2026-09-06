import type { CSSProperties } from "react";
import ActionPlate from "./ActionPlate";

/**
 * Three readings of the same filtered set: the wall, one card per panel; the
 * shelf, one row per series; and the roster, one row per artist
 * (docs/series-view-plan.md §5.1).
 */
export type GalleryView = "wall" | "series" | "artists";

/** The alternate readings — the two the wall is not. */
export type ViewTarget = Exclude<GalleryView, "wall">;

interface Props {
  /** Which alternate reading this plate is the way to. */
  target: ViewTarget;
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
}

/**
 * A block in the plate's miniature, in percent of the art box. All three
 * arrangements hold the same six blocks in the same order, so switching views
 * moves them rather than replacing them.
 */
interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn as a disc rather than a rule — a person rather than a book. */
  face?: boolean;
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
 * The roster: the same three rows, but what leads each one is a head rather
 * than a cover.
 *
 * Two views of rows need to be told apart at 40x30px, and the only thing about
 * the artists view that a rectangle cannot say is that the row is a person.
 * So the leading block is round and the strip beside it starts a little
 * further in, which is also what the row actually looks like — the portrait
 * chip sits inside the rail, not hard against the left edge.
 */
const ROSTER: Block[] = [
  { x: 0, y: 0, w: 11, h: 22, face: true },
  { x: 17, y: 3, w: 83, h: 16 },
  { x: 0, y: 39, w: 11, h: 22, face: true },
  { x: 17, y: 42, w: 83, h: 16 },
  { x: 0, y: 78, w: 11, h: 22, face: true },
  { x: 17, y: 81, w: 83, h: 16 },
];

const DESTINATION: Record<ViewTarget, { blocks: Block[]; label: string; aria: string }> = {
  series: { blocks: SHELF, label: "by series", aria: "Show one row per series" },
  artists: { blocks: ROSTER, label: "by artist", aria: "Show one row per artist" },
};

const BACK = { blocks: WALL, label: "by panel", aria: "Show one card per panel" };

/**
 * The way across, at the bottom of the filter list.
 *
 * One plate per alternate reading, each naming where it goes rather than where
 * you are: the view is already obvious from the page, and a segmented toggle
 * parked permanently over the wall claimed more of it than a second reading of
 * the same set deserves. They sit with the other action on the narrowed set,
 * since that is what they are — every view takes the filters with it.
 *
 * A plate whose destination is the view you are already in turns around and
 * offers the wall instead, so there is always a way back and never a control
 * that does nothing. From the shelf, the artists plate still goes straight to
 * the roster: the two alternate readings are peers, not branches off the wall.
 *
 * The plate draws its destination instead of captioning a symbol, which means
 * the click has somewhere to land: the same six blocks re-pack from the wall's
 * uneven columns into rows, staggered the way the masonry itself settles. The
 * control performs the switch it just made, and afterwards it is sitting on the
 * drawing of the way back.
 */
export default function ViewControl({ target, view, onViewChange }: Props) {
  const here = view === target;
  const { blocks, label, aria } = here ? BACK : DESTINATION[target];

  return (
    <ActionPlate
      label={label}
      ariaLabel={aria}
      onClick={() => onViewChange(here ? "wall" : target)}
    >
      <span className="plate-grid" aria-hidden="true">
        {blocks.map((b, i) => (
          <i
            key={i}
            className={`plate-block${b.face ? " plate-block--face" : ""}`}
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
