import type { Panel } from "./types";


// Neighbor map — which panels border a filler on each edge

export interface NeighborMap {
  top?: Panel;
  bottom?: Panel;
  left?: Panel;
  right?: Panel;
}


// Placed-item shapes (mirrors MasonryGrid's types for the resolver)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedPanelLike extends Rect {
  kind: "panel";
  panel: Panel;
  /** Panel height must be derived externally (aspect ratio). */
}

interface PlacedFillerLike extends Rect {
  kind: "filler";
}

type PlacedItemLike = PlacedPanelLike | PlacedFillerLike;


// Edge overlap helpers

const EDGE_TOLERANCE = 6; // px — how close edges must be to count as adjacent

/**
 * Height of one row in the panel index, in px. A filler only ever borders
 * panels within its own vertical span (plus the tolerance), so bucketing panels
 * by row turns the resolve from "every filler against every panel" into a scan
 * of the handful of panels level with it. Roughly a screen tall: small enough
 * to exclude nearly everything, large enough that the average panel lands in
 * one or two buckets.
 */
const BAND_HEIGHT = 512;

/** Do two ranges [a0,a1] and [b0,b1] overlap by at least `min` px? */
function rangeOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  min = 4
): boolean {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap >= min;
}


// Public resolver


/**
 * Given the full list of placed items and a function to compute panel
 * height (since PlacedPanel doesn't store `h` directly), returns a Map
 * from filler key → NeighborMap.
 *
 * `getPanelHeight` receives a Panel and the rendered width and should
 * return the pixel height of that panel card.
 */
export function resolveNeighbors(
  items: PlacedItemLike[],
  getPanelHeight: (panel: Panel, width: number) => number
): Map<string, NeighborMap> {
  // Build bounding rects for every item
  interface BoundedItem {
    kind: "panel" | "filler";
    key: string;
    panel?: Panel;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Position in layout order; ties between equally adjacent panels go to the lowest. */
    order: number;
  }

  const bounded: BoundedItem[] = items.map((item, order) => {
    if (item.kind === "panel") {
      const p = item as PlacedPanelLike;
      return {
        kind: "panel",
        key: p.panel.id,
        panel: p.panel,
        x: p.x,
        y: p.y,
        w: p.w,
        h: getPanelHeight(p.panel, p.w),
        order,
      };
    }
    const f = item as PlacedFillerLike & { key: string };
    return {
      kind: "filler",
      key: (f as any).key ?? "",
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      order,
    };
  });

  const panels = bounded.filter((b) => b.kind === "panel");
  const fillers = bounded.filter((b) => b.kind === "filler");

  // Index panels by the horizontal bands they span. Every adjacency test below
  // requires the panel to be level with the filler — an edge within
  // EDGE_TOLERANCE vertically, or an overlapping vertical range — so panels
  // outside the filler's bands can never match and are never visited.
  const bands = new Map<number, BoundedItem[]>();
  for (const p of panels) {
    const first = Math.floor((p.y - EDGE_TOLERANCE) / BAND_HEIGHT);
    const last = Math.floor((p.y + p.h + EDGE_TOLERANCE) / BAND_HEIGHT);
    for (let band = first; band <= last; band++) {
      const bucket = bands.get(band);
      if (bucket) bucket.push(p);
      else bands.set(band, [p]);
    }
  }

  const result = new Map<string, NeighborMap>();
  // Panels spanning several bands appear in each; this marks the ones already
  // considered for the current filler instead of allocating a Set per filler.
  const visited = new Map<BoundedItem, number>();

  for (let f = 0; f < fillers.length; f++) {
    const filler = fillers[f];
    const neighbors: NeighborMap = {};
    const fRight = filler.x + filler.w;
    const fBottom = filler.y + filler.h;

    // Bands are not visited in layout order, so "first match wins" would depend
    // on bucket iteration. Track the winning panel's order per side instead, so
    // ties resolve to the same panel a linear scan would have picked.
    let topOrder = Infinity;
    let bottomOrder = Infinity;
    let leftOrder = Infinity;
    let rightOrder = Infinity;

    const firstBand = Math.floor((filler.y - EDGE_TOLERANCE) / BAND_HEIGHT);
    const lastBand = Math.floor((fBottom + EDGE_TOLERANCE) / BAND_HEIGHT);

    for (let band = firstBand; band <= lastBand; band++) {
      const candidates = bands.get(band);
      if (!candidates) continue;

      for (const p of candidates) {
        if (visited.get(p) === f) continue;
        visited.set(p, f);

        const pRight = p.x + p.w;
        const pBottom = p.y + p.h;

        // Top edge of filler ≈ bottom edge of panel
        if (
          p.order < topOrder &&
          Math.abs(filler.y - pBottom) < EDGE_TOLERANCE &&
          rangeOverlap(filler.x, fRight, p.x, pRight)
        ) {
          topOrder = p.order;
          neighbors.top = p.panel;
        }

        // Bottom edge of filler ≈ top edge of panel
        if (
          p.order < bottomOrder &&
          Math.abs(fBottom - p.y) < EDGE_TOLERANCE &&
          rangeOverlap(filler.x, fRight, p.x, pRight)
        ) {
          bottomOrder = p.order;
          neighbors.bottom = p.panel;
        }

        // Left edge of filler ≈ right edge of panel
        if (
          p.order < leftOrder &&
          Math.abs(filler.x - pRight) < EDGE_TOLERANCE &&
          rangeOverlap(filler.y, fBottom, p.y, pBottom)
        ) {
          leftOrder = p.order;
          neighbors.left = p.panel;
        }

        // Right edge of filler ≈ left edge of panel
        if (
          p.order < rightOrder &&
          Math.abs(fRight - p.x) < EDGE_TOLERANCE &&
          rangeOverlap(filler.y, fBottom, p.y, pBottom)
        ) {
          rightOrder = p.order;
          neighbors.right = p.panel;
        }
      }
    }

    result.set(filler.key, neighbors);
  }

  return result;
}