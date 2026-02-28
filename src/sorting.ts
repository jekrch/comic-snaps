import type { Panel } from "./types";

export type SortMode = "newest" | "oldest" | "phash" | "ahash" | "dhash" | "color";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  { value: "phash", label: "PHASH" },
  { value: "ahash", label: "AHASH" },
  { value: "dhash", label: "DHASH" },
  { value: "color", label: "COLOR" },
];

// colorfulness threshold for partitioning chromatic vs achromatic panels.
// based on RMS of std(a*) and std(b*) in CIELAB space. B&W scans with
// paper tint typically score 2–8; muted color panels 10–15; vivid color 20+.
const COLORFULNESS_THRESHOLD = 5;

/** euclidean distance between two CIELAB color vectors. */
function labDistance(a: number[], b: number[]): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * hamming distance between two hex-encoded hash strings.
 * counts the number of differing bits across all hex digits.
 */
function hammingDistanceHex(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const na = parseInt(a[i] ?? "0", 16);
    const nb = parseInt(b[i] ?? "0", 16);
    let xor = na ^ nb;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * color distance between two panels' palettes.
 *
 * compares the most dominant color (index 0) with heavy weight, and
 * secondary colors with lighter weight. the chromatic/achromatic
 * separation is handled by the colorfulness partition, so no chroma
 * penalty is needed here.
 */
export function paletteDistance(
  a: [number, number, number][] | null,
  b: [number, number, number][] | null
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;

  const primaryDist = labDistance(a[0], b[0]);

  let secondaryDist = 0;
  const minLen = Math.min(a.length, b.length);
  if (minLen > 1) {
    for (let i = 1; i < minLen; i++) {
      secondaryDist += labDistance(a[i], b[i]);
    }
    secondaryDist /= minLen - 1;
  }

  // 75% primary, 25% secondary
  return primaryDist * 0.75 + secondaryDist * 0.25;
}

/**
 * sort key for a panel's dominant color using hue-based ordering.
 * within each chromatic/achromatic partition, panels are sorted by the
 * hue angle (atan2(b*, a*)) of their most dominant CIELAB color, with
 * lightness as a tiebreaker. produces a natural spectrum walk.
 */
function colorSortKey(panel: Panel): number {
  const colors = panel.dominantColors;
  if (!colors || colors.length === 0) return Infinity;
  const [L, a, b] = colors[0];
  // atan2 gives radians in [-π, π]; shift to [0, 2π] for sorting
  const hue = Math.atan2(b, a);
  const hueNorm = hue < 0 ? hue + 2 * Math.PI : hue;
  return hueNorm * 1000 + L;
}

export function sortPanels(panels: Panel[], mode: SortMode): Panel[] {
  const sorted = [...panels];

  switch (mode) {
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );

    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );

    case "phash":
    case "ahash":
    case "dhash": {
      if (sorted.length <= 1) return sorted;
      const hashKey = mode as "phash" | "ahash" | "dhash";

      // nearest-neighbor chain by hamming distance: start from the first
      // panel, then greedily pick the closest unvisited panel at each step.
      // panels with missing hashes are appended at the end (oldest-first).
      const withHash: Panel[] = [];
      const withoutHash: Panel[] = [];
      for (const p of sorted) {
        if (p[hashKey]) withHash.push(p);
        else withoutHash.push(p);
      }
      withoutHash.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );

      if (withHash.length <= 1) return [...withHash, ...withoutHash];

      const result: Panel[] = [];
      const used = new Set<number>();

      result.push(withHash[0]);
      used.add(0);

      for (let step = 1; step < withHash.length; step++) {
        const currentHash = String(withHash[result.length - 1][hashKey]);
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < withHash.length; i++) {
          if (used.has(i)) continue;
          const dist = hammingDistanceHex(currentHash, String(withHash[i][hashKey]));
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          result.push(withHash[bestIdx]);
          used.add(bestIdx);
        }
      }

      return [...result, ...withoutHash];
    }

    case "color": {
      if (sorted.length <= 1) return sorted;

      // partition using the colorfulness score (std dev of a,b channels).
      // reliably separates B&W scans from genuinely colorful panels.
      const chromatic: Panel[] = [];
      const achromatic: Panel[] = [];
      for (const p of sorted) {
        if ((p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD) {
          chromatic.push(p);
        } else {
          achromatic.push(p);
        }
      }

      // hue angle of dominant color, lightness tiebreak, then oldest-first
      // so the result is visibly different from newest-first even when
      // color data is missing
      const byColor = (a: Panel, b: Panel) => {
        const ka = colorSortKey(a);
        const kb = colorSortKey(b);
        if (ka === Infinity && kb === Infinity) {
          return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
        }
        if (ka !== kb) return ka - kb;
        return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      };
      chromatic.sort(byColor);
      achromatic.sort(byColor);

      // chromatic first, then achromatic
      return [...chromatic, ...achromatic];
    }

    default:
      return sorted;
  }
}