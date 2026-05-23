import { COVERAGE_COLS, COVERAGE_ROWS } from "./constants";
import type { SettledGlob } from "./types";

/**
 * Iterate the cells of the coverage grid that the glob's ellipse touches
 * (within a 1.2 slack to account for the gooey blur fattening blobs).
 */
function forEachCell(
  glob: SettledGlob,
  width: number,
  height: number,
  visit: (idx: number) => void,
): void {
  if (width <= 0 || height <= 0) return;
  const cellW = width / COVERAGE_COLS;
  const cellH = height / COVERAGE_ROWS;
  const x0 = Math.max(0, Math.floor((glob.x - glob.rx) / cellW));
  const x1 = Math.min(COVERAGE_COLS - 1, Math.floor((glob.x + glob.rx) / cellW));
  const y0 = Math.max(0, Math.floor((glob.y - glob.ry) / cellH));
  const y1 = Math.min(COVERAGE_ROWS - 1, Math.floor((glob.y + glob.ry) / cellH));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ccx = (cx + 0.5) * cellW;
      const ccy = (cy + 0.5) * cellH;
      const dx = (ccx - glob.x) / glob.rx;
      const dy = (ccy - glob.y) / glob.ry;
      if (dx * dx + dy * dy <= 1.2) {
        visit(cy * COVERAGE_COLS + cx);
      }
    }
  }
}

/** Mark every cell whose center lies inside (or close to) the glob's ellipse. */
export function markCoverage(
  grid: Uint8Array,
  glob: SettledGlob,
  width: number,
  height: number,
): void {
  forEachCell(glob, width, height, (idx) => {
    grid[idx] = 1;
  });
}

/**
 * Score a candidate rest position by how much new territory it would paint.
 * `mask` (optional) restricts scoring to cells whose mask value is 1 — used
 * in the light phase to favor positions over already-dark cells.
 */
export function scoreCandidate(
  grid: Uint8Array,
  glob: SettledGlob,
  width: number,
  height: number,
  mask: Uint8Array | null,
): number {
  let score = 0;
  forEachCell(glob, width, height, (idx) => {
    if (grid[idx]) return;
    if (mask && !mask[idx]) return;
    score++;
  });
  return score;
}

export function coverageRatio(grid: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) count++;
  return count / grid.length;
}
