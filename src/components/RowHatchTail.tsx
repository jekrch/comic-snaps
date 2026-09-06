import HatchFiller from "./HatchFillter";

interface Props {
  /** The strip's tile height; the tail takes a fraction of it. */
  tileHeight: number;
}

/** How much of a tile's height the tail band occupies. */
const BAND_RATIO = 0.5;

/**
 * The hatch a row ends on when its tiles do not reach the strip's right edge.
 *
 * Unlike the masonry's fillers this one is scenery, not a tile: it is a band
 * half the tile's height, held faint, and dissolved before the strip's right
 * edge (`.row-hatch-tail`). At full height and full ink it read as a second
 * exhibit competing with the panels the row actually has.
 *
 * It claims the leftover space and nothing more — `flex-1` off a zero basis
 * with no minimum — so a row whose tiles already fill the strip renders it at
 * zero width rather than pushing itself into overflow to make room for
 * scenery. That is also what keeps the strip's own overflow measurement
 * honest: the tail is never part of what has to fit.
 */
export default function RowHatchTail({ tileHeight }: Props) {
  return (
    <div
      className="row-hatch-tail min-w-0 flex-1 self-center overflow-hidden rounded-sm"
      style={{ height: Math.round(tileHeight * BAND_RATIO) }}
      aria-hidden="true"
    >
      <HatchFiller empty />
    </div>
  );
}
