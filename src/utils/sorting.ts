import type { Panel } from "../types";

export type SortMode =
  | "newest"
  | "oldest"
  | "ahash"
  | "dhash"
  | "color"
  | "embedding-siglip"
  | "embedding-dino"
  | "embedding-gram"
  | "phash";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  //{ value: "ahash", label: "AHASH" },
  //{ value: "dhash", label: "DHASH" },
  { value: "color", label: "COLOR" },
  { value: "embedding-siglip", label: "SigLIP" },  // semantic / conceptual similarity
  { value: "embedding-dino", label: "DINOv2" },     // structural / perceptual similarity
  { value: "embedding-gram", label: "VGG-16 Gram" }, // line style / texture similarity
    { value: "phash", label: "PHASH" }, // experimental: best for near duplicates 
];

// --- Embedding cache (lazy-loaded, per model) ---

export type EmbeddingMap = Record<string, number[]>;

interface EmbeddingFile {
  model_version: string;
  dim: number;
  embeddings: EmbeddingMap;
}

interface EmbeddingCacheEntry {
  data: EmbeddingMap | null;
  promise: Promise<EmbeddingMap> | null;
}

const EMBEDDING_SOURCES: Record<string, string> = {
  "embedding-siglip": "/data/embeddings.json",
  "embedding-dino": "/data/embeddings-dino.json",
  "embedding-gram": "/data/embeddings-gram.json",
};

const embeddingCaches: Record<string, EmbeddingCacheEntry> = {
  "embedding-siglip": { data: null, promise: null },
  "embedding-dino": { data: null, promise: null },
  "embedding-gram": { data: null, promise: null },
};

/**
 * Lazy-load an embedding file by sort mode key.
 * Returns the cached map on subsequent calls. The file is only fetched
 * when the user first selects that embedding-based sort.
 */
export async function loadEmbeddings(
  mode: "embedding-siglip" | "embedding-dino" | "embedding-gram"
): Promise<EmbeddingMap> {
  const cache = embeddingCaches[mode];
  if (cache.data) return cache.data;
  if (cache.promise) return cache.promise;

  const url = EMBEDDING_SOURCES[mode];

  cache.promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load embeddings: ${res.status}`);
      return res.json();
    })
    .then((data: EmbeddingFile) => {
      cache.data = data.embeddings;
      return cache.data;
    })
    .catch((err) => {
      console.error(`Could not load embeddings from ${url}:`, err);
      cache.promise = null;
      return {} as EmbeddingMap;
    });

  return cache.promise;
}

// colorfulness threshold for partitioning chromatic vs achromatic panels.
// based on RMS of std(a*) and std(b*) in CIELAB space. B&W scans with
// paper tint typically score 2–8; muted color panels 10–15; vivid color 20+.
const COLORFULNESS_THRESHOLD = 6;

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
export function hammingDistanceHex(a: string, b: string): number {
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
 * cosine distance between two unit-normalized embedding vectors.
 * since vectors are pre-normalized, cosine similarity = dot product,
 * and distance = 1 - dot product. range: [0, 2].
 */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}

/**
 * Compute a perceptual importance weight for a CIELAB color.
 *
 * Near-white (high L*, low chroma) and near-black (low L*, low chroma)
 * colors — typical of page margins, gutters, and panel borders — receive
 * low weight so they don't dominate palette distance. Saturated, mid-tone
 * colors that carry the most visual identity get the highest weight.
 *
 * The weight is the product of two factors:
 *   - chroma factor: sqrt(a² + b²) / 50, clamped to [0.05, 1].
 *     low-chroma neutrals (greys, whites, blacks) are heavily discounted.
 *   - lightness factor: a smooth curve that peaks at L*=50 and tapers
 *     toward 0 and 100. uses sin(L* / 100 * π) so L*=0 and L*=100 map
 *     to 0, L*=50 maps to 1. a floor of 0.1 ensures extreme values
 *     still contribute a small amount.
 */
function colorPerceptualWeight(L: number, a: number, b: number): number {
  const chroma = Math.sqrt(a * a + b * b);
  const chromaFactor = Math.min(1, Math.max(0.05, chroma / 50));

  // sin curve: 0 at L=0 and L=100, peaks at L=50
  const lightnessFactor = Math.max(0.1, Math.sin((L / 100) * Math.PI));

  return chromaFactor * lightnessFactor;
}

/**
 * color distance between two panels' palettes.
 *
 * each palette entry is weighted by its perceptual importance: chroma
 * and lightness determine how much a color matters. near-white and
 * near-black entries (margins, gutters) are heavily discounted so that
 * the "real" artwork colors drive similarity.
 *
 * the distance is computed as a weighted average of per-entry CIELAB
 * distances, where each pair's contribution is the minimum weight of
 * the two entries being compared. this ensures a shared low-importance
 * color (e.g. two white margins) barely affects the total distance.
 */
export function paletteDistance(
  a: [number, number, number][] | null,
  b: [number, number, number][] | null
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;

  const minLen = Math.min(a.length, b.length);

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < minLen; i++) {
    const wA = colorPerceptualWeight(a[i][0], a[i][1], a[i][2]);
    const wB = colorPerceptualWeight(b[i][0], b[i][1], b[i][2]);
    // use the minimum: if either side is an unimportant neutral,
    // this pair contributes little regardless of the other side
    const pairWeight = Math.min(wA, wB);

    const dist = labDistance(a[i], b[i]);
    weightedSum += dist * pairWeight;
    totalWeight += pairWeight;
  }

  // fallback: if all weights are near-zero (both palettes are pure
  // black/white), fall back to unweighted average so we still get
  // a finite, comparable distance
  if (totalWeight < 0.001) {
    let sum = 0;
    for (let i = 0; i < minLen; i++) {
      sum += labDistance(a[i], b[i]);
    }
    return sum / minLen;
  }

  return weightedSum / totalWeight;
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

/**
 * generic greedy nearest-neighbor chain.
 *
 * given a list of items and a distance function, starts from the first
 * item and greedily picks the closest unvisited item at each step.
 * O(n²) but fine for gallery-sized collections.
 */
function nearestNeighborChain<T>(
  items: T[],
  distanceFn: (a: T, b: T) => number
): T[] {
  if (items.length <= 1) return [...items];

  const result: T[] = [items[0]];
  const used = new Set<number>([0]);

  for (let step = 1; step < items.length; step++) {
    const current = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      const dist = distanceFn(current, items[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      result.push(items[bestIdx]);
      used.add(bestIdx);
    }
  }

  return result;
}

/**
 * sort panels by embedding similarity using a nearest-neighbor chain.
 * panels without embeddings are appended at the end, oldest-first.
 */
function sortByEmbedding(panels: Panel[], embeddings: EmbeddingMap): Panel[] {
  const withEmb: Panel[] = [];
  const withoutEmb: Panel[] = [];

  for (const p of panels) {
    if (embeddings[p.id]) withEmb.push(p);
    else withoutEmb.push(p);
  }

  withoutEmb.sort(
    (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
  );

  if (withEmb.length <= 1) return [...withEmb, ...withoutEmb];

  const sorted = nearestNeighborChain(withEmb, (a, b) =>
    cosineDistance(embeddings[a.id], embeddings[b.id])
  );

  return [...sorted, ...withoutEmb];
}

/** Check whether a sort mode uses embeddings. */
function isEmbeddingMode(
  mode: SortMode
): mode is "embedding-siglip" | "embedding-dino" | "embedding-gram" {
  return (
    mode === "embedding-siglip" ||
    mode === "embedding-dino" ||
    mode === "embedding-gram"
  );
}

/**
 * synchronous sort for all modes except embeddings.
 */
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

      const result = nearestNeighborChain(withHash, (a, b) =>
        hammingDistanceHex(String(a[hashKey]), String(b[hashKey]))
      );

      return [...result, ...withoutHash];
    }

    case "color": {
      if (sorted.length <= 1) return sorted;

      const chromatic: Panel[] = [];
      const achromatic: Panel[] = [];
      for (const p of sorted) {
        if ((p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD) {
          chromatic.push(p);
        } else {
          achromatic.push(p);
        }
      }

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

      return [...chromatic, ...achromatic];
    }

    // embedding sorts are async — this synchronous fallback returns
    // unsorted if called directly. use sortPanelsAsync instead.
    case "embedding-siglip":
    case "embedding-dino":
    case "embedding-gram":
      return sorted;

    default:
      return sorted;
  }
}

/**
 * async sort that handles embedding modes by lazy-loading the appropriate
 * embeddings file. for all other modes, delegates to the synchronous
 * sortPanels.
 *
 * usage:
 *   const sorted = await sortPanelsAsync(panels, mode);
 */
export async function sortPanelsAsync(
  panels: Panel[],
  mode: SortMode
): Promise<Panel[]> {
  if (!isEmbeddingMode(mode)) {
    return sortPanels(panels, mode);
  }

  const embeddings = await loadEmbeddings(mode);
  return sortByEmbedding([...panels], embeddings);
}