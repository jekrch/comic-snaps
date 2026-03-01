import HatchFiller from "./HatchFillter";

const PYRAMID_ROWS = 5;
const CELL_SIZE = 64;
const CELL_GAP = 4;

export default function FooterPyramid() {
  // Build rows: widest at top (PYRAMID_ROWS cells), narrowest at bottom (1 cell)
  const rows: number[] = [];
  for (let i = PYRAMID_ROWS; i >= 1; i--) {
    rows.push(i);
  }

  return (
    <div className="flex flex-col items-center gap-0 pt-8 pb-16">
      <p
        className="text-white/80 font-black tracking-widest uppercase text-lg mb-4"
        style={{ fontFamily: "'Space Mono', monospace" }}
      >
        Thanks for visiting
      </p>

      <div className="flex flex-col items-center" style={{ gap: `${CELL_GAP}px` }}>
        {rows.map((cellCount, rowIdx) => (
          <div
            key={rowIdx}
            className="flex"
            style={{ gap: `${CELL_GAP}px` }}
          >
            {Array.from({ length: cellCount }).map((_, cellIdx) => (
              <div
                key={cellIdx}
                className="rounded-sm overflow-hidden"
                style={{ width: CELL_SIZE, height: CELL_SIZE }}
              >
                <HatchFiller empty={true} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}