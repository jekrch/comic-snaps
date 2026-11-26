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
 * The embedding map for a mode if it has already been loaded, else null.
 * Lets a view render real vectors on its first paint when the file is
 * already in memory, instead of flashing a placeholder for a tick.
 */
export function peekEmbeddings(
  mode: "embedding-siglip" | "embedding-dino" | "embedding-gram"
): EmbeddingMap | null {
  return embeddingCaches[mode]?.data ?? null;
}

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

// the older colour/black-and-white cut, kept for panels without chromaShare:
// RMS of std(a*) and std(b*) in CIELAB. it measures spread, not colour, so a
// page washed in one hue reads as black-and-white and a tinted B&W page under
// uneven light can read as colour.
const COLORFULNESS_THRESHOLD = 6;

/** euclidean distance between two CIELAB color vectors. */
export function labDistance(a: readonly number[], b: readonly number[]): number {
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
export function colorPerceptualWeight(L: number, a: number, b: number): number {
  const chroma = Math.sqrt(a * a + b * b);
  const chromaFactor = Math.min(1, Math.max(0.05, chroma / 50));

  // sin curve: 0 at L=0 and L=100, peaks at L=50
  const lightnessFactor = Math.max(0.1, Math.sin((L / 100) * Math.PI));

  return chromaFactor * lightnessFactor;
}

type Lab = [number, number, number];

/** one matched pair of palette colors, as `matchPalettes` returns them. */
export interface PalettePair {
  a: Lab;
  b: Lab;
  /** CIELAB distance between the two. */
  distance: number;
  /** how much the pair counts: the mean importance of its two colors. */
  weight: number;
}

const arrangementCache = new Map<string, number[][]>();

/** every ordering of `k` distinct indices drawn from 0..n-1. cached: palettes are always the same few sizes. */
function arrangements(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  const key = `${n},${k}`;
  const hit = arrangementCache.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  for (const rest of arrangements(n, k - 1)) {
    for (let i = 0; i < n; i++) if (!rest.includes(i)) out.push([...rest, i]);
  }
  arrangementCache.set(key, out);
  return out;
}

/**
 * pair two palettes color-for-color, the way that makes them closest.
 *
 * each color's importance is its perceptual weight (see
 * `colorPerceptualWeight`) times its share of the panel's pixels, so a
 * sliver of colour counts for less than a wash of it. when no shares are
 * given every color is taken to cover an equal share.
 *
 * colors are matched by trying every pairing (palettes hold three colors, so
 * that is six) and keeping the one with the lowest weighted average distance.
 * pairing by rank instead compares a panel's second color with the other's
 * second even when the same red is second in one and third in the other.
 */
export function matchPalettes(
  a: Lab[] | null,
  b: Lab[] | null,
  weightsA?: number[] | null,
  weightsB?: number[] | null
): PalettePair[] | null {
  if (!a || !b || a.length === 0 || b.length === 0) return null;

  // the shorter palette picks its partners from the longer one
  const flip = a.length > b.length;
  const [short, long] = flip ? [b, a] : [a, b];
  const [wShort, wLong] = flip ? [weightsB, weightsA] : [weightsA, weightsB];
  const importance = (c: Lab, i: number, palette: Lab[], shares?: number[] | null) =>
    colorPerceptualWeight(c[0], c[1], c[2]) * (shares?.[i] ?? 1 / palette.length);

  const iShort = short.map((c, i) => importance(c, i, short, wShort));
  const iLong = long.map((c, i) => importance(c, i, long, wLong));

  // more than six colors would make this slow; nothing stores that many
  const options = long.length <= 6 ? arrangements(long.length, short.length) : [short.map((_, i) => i)];

  let best: PalettePair[] = [];
  let bestScore = Infinity;
  for (const option of options) {
    let sum = 0;
    let total = 0;
    const pairs = option.map((j, i) => {
      const distance = labDistance(short[i], long[j]);
      const weight = (iShort[i] + iLong[j]) / 2;
      sum += distance * weight;
      total += weight;
      return flip
        ? { a: long[j], b: short[i], distance, weight }
        : { a: short[i], b: long[j], distance, weight };
    });
    // all-neutral palettes have no weight to speak of: compare them plainly
    const score = total < 1e-6 ? pairs.reduce((s, p) => s + p.distance, 0) / pairs.length : sum / total;
    if (score < bestScore) {
      bestScore = score;
      best = pairs;
    }
  }
  return best;
}

/**
 * color distance between two panels' palettes: the weighted average CIELAB
 * distance over the pairs `matchPalettes` finds. near-white and near-black
 * colors (margins, gutters, ink) and small clusters count for little, so the
 * artwork's actual colours drive the result.
 */
export function paletteDistance(
  a: Lab[] | null,
  b: Lab[] | null,
  weightsA?: number[] | null,
  weightsB?: number[] | null
): number {
  const pairs = matchPalettes(a, b, weightsA, weightsB);
  if (!pairs) return Infinity;
  let sum = 0;
  let total = 0;
  for (const p of pairs) {
    sum += p.distance * p.weight;
    total += p.weight;
  }
  if (total < 1e-6) return pairs.reduce((s, p) => s + p.distance, 0) / pairs.length;
  return sum / total;
}

/**
 * the share of a panel's pixels that must be coloured for it to count as a
 * colour panel. set against hand-checked panels: muted painted colour and
 * watercolour washes come in at 4–10%, black-and-white pages under a warm
 * lamp below 3% once the paper tint is taken out.
 */
export const CHROMA_SHARE_THRESHOLD = 0.04;

/**
 * whether a panel sorts as colour or black-and-white. panels without a
 * chromaShare (not yet measured, or local photos in the visualizer) fall back
 * to the older colorfulness score.
 */
export function isChromatic(panel: Pick<Panel, "chromaShare" | "keyColor" | "colorfulness">): boolean {
  if (panel.chromaShare != null) {
    return panel.chromaShare >= CHROMA_SHARE_THRESHOLD && panel.keyColor != null;
  }
  return (panel.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD;
}

/**
 * the colour whose hue places a panel in the color sort, in CIELAB: its
 * measured key colour, or null for a black-and-white panel. the key colour
 * comes from the panel's coloured pixels, not from the k-means palette, whose
 * centres average different hues together.
 */
export function sortColor(
  panel: Pick<Panel, "chromaShare" | "keyColor" | "colorfulness" | "dominantColors">
): Lab | null {
  if (!isChromatic(panel)) return null;
  if (panel.chromaShare != null) return panel.keyColor ?? null;
  // not yet measured: the older pick from the palette
  return panel.dominantColors ? hueSortColor(panel.dominantColors) : null;
}

/** below this chroma a palette color is too grey to give a usable hue. */
export const HUE_CHROMA_THRESHOLD = 10;

/**
 * the first palette color with meaningful chroma, or null if every entry is
 * near-neutral. this is how the color sort used to pick a panel's hue, before
 * `sortColor`; the Guide's color lesson still illustrates it.
 */
export function hueSortColor<T extends readonly number[]>(colors: readonly T[]): T | null {
  for (const c of colors) {
    if (Math.sqrt(c[1] * c[1] + c[2] * c[2]) >= HUE_CHROMA_THRESHOLD) return c;
  }
  return null;
}

/** hue angle of a CIELAB color in degrees, 0–360. */
function hueDegrees(c: Lab): number {
  const h = (Math.atan2(c[2], c[1]) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/** a panel's overall lightness: its palette's L*, weighted by pixel share. */
function panelLightness(panel: Panel): number {
  const colors = panel.dominantColors ?? [];
  const weights = panel.dominantWeights;
  let sum = 0;
  let total = 0;
  colors.forEach((c, i) => {
    const w = weights?.[i] ?? 1;
    sum += c[0] * w;
    total += w;
  });
  return total > 0 ? sum / total : 0;
}

/** how many hue bands the colour sort cuts the wheel into (30° each). */
const HUE_BANDS = 12;

const byAdded = (a: Panel, b: Panel) =>
  new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();

/**
 * the COLOR sort: colour panels around the hue wheel, then black-and-white
 * panels from light to dark, then anything not yet measured.
 *
 * the wheel starts at the widest stretch of hue no panel has, so the seam
 * falls where it splits nothing. it's cut into 30° bands, and within each band
 * panels go by lightness, alternating light-to-dark and dark-to-light from
 * one band to the next so neighbours across a band boundary stay close
 * instead of jumping from darkest to lightest.
 */
function sortByColor(panels: Panel[]): Panel[] {
  const chromatic: { panel: Panel; hue: number; L: number }[] = [];
  const achromatic: Panel[] = [];
  const unmeasured: Panel[] = [];
  for (const panel of panels) {
    const key = sortColor(panel);
    if (key) chromatic.push({ panel, hue: hueDegrees(key), L: key[0] });
    else if (panel.dominantColors?.length) achromatic.push(panel);
    else unmeasured.push(panel);
  }

  let start = 0;
  if (chromatic.length > 1) {
    const hues = chromatic.map((c) => c.hue).sort((x, y) => x - y);
    let widest = -1;
    hues.forEach((h, i) => {
      const next = i + 1 < hues.length ? hues[i + 1] : hues[0] + 360;
      if (next - h > widest) {
        widest = next - h;
        start = next % 360;
      }
    });
  }

  const band = 360 / HUE_BANDS;
  const banded = chromatic.map((c) => {
    const rel = (c.hue - start + 360) % 360;
    return { ...c, rel, band: Math.floor(rel / band) };
  });
  const occupied = [...new Set(banded.map((c) => c.band))].sort((x, y) => x - y);
  const direction = new Map(occupied.map((b, i) => [b, i % 2 === 0 ? -1 : 1]));
  banded.sort(
    (x, y) =>
      x.band - y.band ||
      direction.get(x.band)! * (x.L - y.L) ||
      x.rel - y.rel ||
      byAdded(x.panel, y.panel)
  );

  achromatic.sort((x, y) => panelLightness(y) - panelLightness(x) || byAdded(x, y));
  unmeasured.sort(byAdded);

  return [...banded.map((c) => c.panel), ...achromatic, ...unmeasured];
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

    case "color":
      return sortByColor(sorted);

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