import HatchFiller from "./HatchFillter";

interface Props {
  /** The strip's tile height; the tail takes a fraction of it. */
  tileHeight: number;
}

/** How much of a tile's height the tail band occupies. */
const BAND_RATIO = 0.5;

/**
 * The hatch a row ends on when it has a single panel and nothing to trail off
 * into.
 *
 * Unlike the masonry's fillers this one is scenery, not a tile: it is a band
 * half the tile's height, held faint, and dissolved before the strip's right
 * edge (`.row-hatch-tail`). At full height and full ink it read as a second
 * exhibit competing with the one panel the row actually has.
 */
export default function RowHatchTail({ tileHeight }: Props) {
  return (
    <div
      className="row-hatch-tail min-w-20 flex-1 self-center overflow-hidden rounded-sm"
      style={{ height: Math.round(tileHeight * BAND_RATIO) }}
      aria-hidden="true"
    >
      <HatchFiller empty />
    </div>
  );
}
