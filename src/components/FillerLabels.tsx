import type { NeighborMap } from "../adjacency";


// Configuration


/** Minimum filler dimension (px) along an axis to show a label on that edge. */
const MIN_LABEL_AXIS = 70;
/** Minimum filler dimension on the cross-axis so labels don't crowd. */
const MIN_CROSS_AXIS = 50;
/** Straight leader line length for top/bottom edges (px). */
const LEADER_LENGTH = 16;
/** Vertical drop before the horizontal turn on left/right leaders (px). */
const LEADER_VERT = 14;
/** Horizontal run toward the edge on left/right leaders (px). */
const LEADER_HORIZ = 16;
/** Padding from the filler edge to the label (px). */
const EDGE_PAD = 8;
/**
 * Per-character advance used for bbox estimation. The badge font is Space Mono
 * (monospace, 0.6em advance) plus 0.02em letter-spacing => 8.68px at 14px. We
 * round up so the estimate is never narrower than the rendered badge — an
 * under-estimate would let two badges collide after passing the overlap test.
 */
const CHAR_W = 9;
/** Badge font size (px). */
const FONT_SIZE = 14;
/** Badge horizontal padding (px). */
const BADGE_PX = 8;
/** Badge vertical padding (px). */
const BADGE_PY = 4;
/** Leader stroke width (px). */
const STROKE_W = 2.5;
/** Badge height = font size + 2 * vertical padding. */
const BADGE_H = FONT_SIZE + BADGE_PY * 2;
/** Minimum gap between label bounding boxes (px). */
const MIN_GAP = 6;
/** Step size when sliding a label along its edge looking for a free slot (px). */
const SLIDE_STEP = 6;
/** Cap on slide positions considered per label, so the placement search stays cheap. */
const MAX_SLOTS = 11;
/**
 * Score weight of keeping one label. Larger than any achievable displacement
 * sum, so placing an extra name always beats keeping the others centered.
 */
const KEEP_WEIGHT = 1e6;


// Name helpers


function lastName(artist: string): string {
  const parts = artist.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : artist;
}


// Types


type Edge = "top" | "bottom" | "left" | "right";

/** A label with its computed bounding box in filler-local coordinates. */
interface PositionedLabel {
  edge: Edge;
  displayName: string;
  /** Top-left x of the full label assembly (badge + leader). */
  x: number;
  /** Top-left y of the full label assembly (badge + leader). */
  y: number;
  /** Total width of the assembly. */
  w: number;
  /** Total height of the assembly. */
  h: number;
}


// Badge width estimation


function estimateBadgeWidth(text: string): number {
  return text.length * CHAR_W + BADGE_PX * 2;
}


// Overlap detection & resolution


interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + MIN_GAP &&
    a.x + a.w + MIN_GAP > b.x &&
    a.y < b.y + b.h + MIN_GAP &&
    a.y + a.h + MIN_GAP > b.y
  );
}

/**
 * Offsets to try along a label's edge, nearest-to-preferred first, all of them
 * inside [min, max]. Returns empty when the label is too big for the run, which
 * is the caller's signal to drop it.
 */
function slideCandidates(preferred: number, min: number, max: number): number[] {
  if (max < min) return [];

  const start = Math.min(Math.max(preferred, min), max);
  const slots = new Set([start, min, max]);
  // Widen the step on long edges rather than emitting dozens of near-identical
  // slots — the search below is exponential in the slot count.
  const step = Math.max(SLIDE_STEP, (max - min) / (MAX_SLOTS - 1));

  for (let d = step; d <= max - min; d += step) {
    if (start - d >= min) slots.add(start - d);
    if (start + d <= max) slots.add(start + d);
  }

  return [...slots].sort(
    (a, b) => Math.abs(a - start) - Math.abs(b - start)
  );
}

/**
 * Positions a label can occupy without leaving its edge. A leader points at the
 * neighbor it names, so a label only ever slides *along* its own edge — top and
 * bottom labels move horizontally, left and right labels vertically.
 */
function candidatePlacements(
  label: PositionedLabel,
  fillerW: number,
  fillerH: number
): PositionedLabel[] {
  if (label.edge === "top" || label.edge === "bottom") {
    return slideCandidates(label.x, EDGE_PAD, fillerW - EDGE_PAD - label.w).map(
      (x) => ({ ...label, x })
    );
  }
  return slideCandidates(label.y, EDGE_PAD, fillerH - EDGE_PAD - label.h).map(
    (y) => ({ ...label, y })
  );
}

/** How far a placement sits from the label's natural position, in px. */
function displacement(placement: PositionedLabel, natural: PositionedLabel): number {
  return placement.edge === "top" || placement.edge === "bottom"
    ? Math.abs(placement.x - natural.x)
    : Math.abs(placement.y - natural.y);
}

/**
 * Chooses positions for the whole label set at once, maximizing how many names
 * survive and, among equally full solutions, keeping each one as close to its
 * natural (centered) position as possible.
 *
 * Solving globally rather than greedily is what lets a top and bottom label
 * slide off-center to open a lane for a left or right label — placing them
 * centered first would strand the side labels with nowhere to go. A label with
 * no collision-free slot is dropped rather than drawn over a neighbor.
 *
 * Search is depth-first over at most four labels with a handful of slots each,
 * pruned whenever a partial layout already collides or cannot beat the best
 * solution so far. The common case — everything fits centered — is the first
 * branch tried, and the bound then prunes the rest of the tree immediately.
 */
function resolveOverlaps(
  labels: PositionedLabel[],
  fillerW: number,
  fillerH: number
): PositionedLabel[] {
  const options = labels.map((l) => candidatePlacements(l, fillerW, fillerH));

  const chosen: PositionedLabel[] = [];
  let best: PositionedLabel[] = [];
  let bestScore = -Infinity;

  const score = (kept: number, spread: number) => kept * KEEP_WEIGHT - spread;

  const search = (index: number, spread: number) => {
    if (index === labels.length) {
      const total = score(chosen.length, spread);
      if (total > bestScore) {
        bestScore = total;
        best = [...chosen];
      }
      return;
    }

    // Upper bound: every remaining label placed at zero extra displacement.
    if (score(chosen.length + labels.length - index, spread) <= bestScore) return;

    for (const candidate of options[index]) {
      if (chosen.some((p) => rectsOverlap(candidate, p))) continue;
      chosen.push(candidate);
      search(index + 1, spread + displacement(candidate, labels[index]));
      chosen.pop();
    }

    // Dropping this label may leave room for the ones after it.
    search(index + 1, spread);
  };

  search(0, 0);
  return best;
}


// Initial positioning (before overlap resolution)


function computeInitialPosition(
  edge: Edge,
  displayName: string,
  fillerW: number,
  fillerH: number
): PositionedLabel {
  const badgeW = estimateBadgeWidth(displayName);
  const isHorizontal = edge === "top" || edge === "bottom";

  if (isHorizontal) {
    // Total assembly: badge + leader stacked vertically
    const totalH = BADGE_H + LEADER_LENGTH;
    const totalW = badgeW;
    const x = (fillerW - totalW) / 2;
    const y =
      edge === "top" ? EDGE_PAD : fillerH - EDGE_PAD - totalH;
    return { edge, displayName, x, y, w: totalW, h: totalH };
  }

  // Left/right: badge on top, elbow leader below
  const elbowW = LEADER_HORIZ + 2;
  const elbowH = LEADER_VERT + 2;
  const totalW = Math.max(badgeW, elbowW);
  const totalH = BADGE_H + elbowH;
  const y = (fillerH - totalH) / 2;
  const x =
    edge === "left"
      ? EDGE_PAD
      : fillerW - EDGE_PAD - totalW;
  return { edge, displayName, x, y, w: totalW, h: totalH };
}


// Badge style (shared)


const BADGE_STYLE: React.CSSProperties = {
  fontSize: `${FONT_SIZE}px`,
  padding: `${BADGE_PY}px ${BADGE_PX}px`,
  backgroundColor: "rgba(255, 255, 255, 0.92)",
  color: "#111",
  borderRadius: "2px",
  letterSpacing: "0.02em",
  lineHeight: 1,
};


// Component


interface FillerLabelsProps {
  neighbors: NeighborMap;
  width: number;
  height: number;
}

export default function FillerLabels({
  neighbors,
  width,
  height,
}: FillerLabelsProps) {
  if (width <= 0 || height <= 0) return null;

  // Collect candidates with space gating and deduplication
  const raw: PositionedLabel[] = [];
  const seen = new Set<string>();

  const tryAdd = (edge: Edge) => {
    const panel = neighbors[edge];
    if (!panel?.artist) return;

    const artist = panel.artist;
    if (seen.has(artist)) return;

    const isHorizontal = edge === "top" || edge === "bottom";
    const primaryAxis = isHorizontal ? width : height;
    const crossAxis = isHorizontal ? height : width;

    if (primaryAxis < MIN_LABEL_AXIS) return;
    if (crossAxis < MIN_CROSS_AXIS) return;

    const displayName = lastName(artist);
    seen.add(artist);
    raw.push(computeInitialPosition(edge, displayName, width, height));
  };

  // Priority order
  tryAdd("top");
  tryAdd("bottom");
  tryAdd("left");
  tryAdd("right");

  if (raw.length === 0) return null;

  const positioned = resolveOverlaps(raw, width, height);
  if (positioned.length === 0) return null;

  return (
    <div className="filler-labels absolute inset-0 pointer-events-none z-[2]">
      {positioned.map((label) => (
        <div
          key={label.edge}
          className="absolute"
          style={{
            left: `${label.x}px`,
            top: `${label.y}px`,
            width: `${label.w}px`,
            height: `${label.h}px`,
          }}
        >
          <LabelAssembly
            edge={label.edge}
            displayName={label.displayName}
            boxW={label.w}
            boxH={label.h}
          />
        </div>
      ))}
    </div>
  );
}


// Label assembly — renders badge + leader within the allocated box


interface LabelAssemblyProps {
  edge: Edge;
  displayName: string;
  boxW: number;
  boxH: number;
}

function LabelAssembly({ edge, displayName, boxW }: LabelAssemblyProps) {
  if (edge === "top" || edge === "bottom") {
    return (
      <StraightAssembly edge={edge} displayName={displayName} boxW={boxW} />
    );
  }
  return <ElbowAssembly edge={edge} displayName={displayName} boxW={boxW} />;
}


// Straight assembly — top / bottom


function StraightAssembly({
  edge,
  displayName,
  boxW,
}: {
  edge: "top" | "bottom";
  displayName: string;
  boxW: number;
}) {
  const isTop = edge === "top";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isTop ? "column" : "column-reverse",
        alignItems: "center",
        width: `${boxW}px`,
        height: "100%",
      }}
    >
      <svg
        width={2}
        height={LEADER_LENGTH}
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <line
          x1={1}
          y1={0}
          x2={1}
          y2={LEADER_LENGTH}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={STROKE_W}
        />
      </svg>
      <span
        className="font-display select-none whitespace-nowrap"
        style={BADGE_STYLE}
      >
        {displayName}
      </span>
    </div>
  );
}


// Elbow assembly — left / right
// Badge on top, L-shaped leader below pointing toward the edge.


function ElbowAssembly({
  edge,
  displayName,
  boxW,
}: {
  edge: "left" | "right";
  displayName: string;
  boxW: number;
}) {
  const isLeft = edge === "left";

  const svgW = LEADER_HORIZ + 2;
  const svgH = LEADER_VERT + 2;

  const startX = isLeft ? svgW - 1 : 1;
  const midY = LEADER_VERT;
  const endX = isLeft ? 0 : svgW;

  const pathD = `M ${startX} 0 L ${startX} ${midY} L ${endX} ${midY}`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "flex-end",
        width: `${boxW}px`,
        height: "100%",
      }}
    >
      <span
        className="font-display select-none whitespace-nowrap"
        style={BADGE_STYLE}
      >
        {displayName}
      </span>
      <svg
        width={svgW}
        height={svgH}
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={STROKE_W}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}