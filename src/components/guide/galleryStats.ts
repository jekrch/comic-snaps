import { useEffect, useState } from "react";
import type { Panel } from "../../types";
import type { MetricKey } from "../graph/similarityConfig";
import { hammingDistanceHex, isChromatic, paletteDistance, type EmbeddingMap } from "../../utils/sorting";
import type { EmbeddingMetric } from "./specimen";

/**
 * How each method's distances spread across the whole gallery, and which
 * panel each method calls every panel's nearest. The Guide quotes these
 * instead of fixed numbers, so the ranges it gives stay true as the gallery
 * grows.
 *
 * Every pair is measured once and cached per embedding file or pool, so a
 * lesson that asks again gets the same object back.
 */

export interface Spread {
  /** The middle 90% of all pairs runs from `lo` (5th percentile) to `hi` (95th). */
  lo: number;
  /** The median pair. */
  mid: number;
  hi: number;
  /** Fraction of pairs past 1, for the cosine metrics. */
  overOne: number;
  pairs: number;
}

export interface MetricStats {
  /** Every pair, or for color, every pair of color panels. */
  spread: Spread;
  /** Color only: every pair of black-and-white panels. */
  bw?: Spread;
  /** Each panel's nearest neighbour by this method, by id. */
  nearest: Map<string, string>;
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function spreadOf(pairs: number[]): Spread | null {
  if (pairs.length < 3) return null;
  const s = Float64Array.from(pairs).sort();
  let over = 0;
  for (const d of s) if (d > 1) over++;
  return { lo: quantile(s, 0.05), mid: quantile(s, 0.5), hi: quantile(s, 0.95), overOne: over / s.length, pairs: s.length };
}

/** Every pair among `ids` by `dist`, plus each one's nearest. */
function measure(ids: string[], dist: (i: number, j: number) => number, nearest: Map<string, string>): number[] {
  const n = ids.length;
  const best = new Float64Array(n).fill(Infinity);
  const bestJ = new Int32Array(n).fill(-1);
  const pairs: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dist(i, j);
      if (!Number.isFinite(d)) continue;
      pairs.push(d);
      if (d < best[i]) (best[i] = d), (bestJ[i] = j);
      if (d < best[j]) (best[j] = d), (bestJ[j] = i);
    }
  }
  for (let i = 0; i < n; i++) if (bestJ[i] >= 0) nearest.set(ids[i], ids[bestJ[i]]);
  return pairs;
}

const embeddingCache = new WeakMap<EmbeddingMap, MetricStats | null>();

/** Spread and nearest neighbours for one embedding file. */
export function embeddingStats(map: EmbeddingMap): MetricStats | null {
  if (embeddingCache.has(map)) return embeddingCache.get(map)!;
  const ids = Object.keys(map);
  const vecs = ids.map((id) => Float64Array.from(map[id]));
  const dim = vecs[0]?.length ?? 0;
  const nearest = new Map<string, string>();
  const pairs = measure(
    ids,
    (i, j) => {
      const a = vecs[i];
      const b = vecs[j];
      if (b.length !== dim || a.length !== dim) return NaN;
      let dot = 0;
      for (let k = 0; k < dim; k++) dot += a[k] * b[k];
      return 1 - dot;
    },
    nearest
  );
  const spread = spreadOf(pairs);
  const out = spread ? { spread, nearest } : null;
  embeddingCache.set(map, out);
  return out;
}

const poolCache = new WeakMap<Panel[], { color: MetricStats | null; phash: MetricStats | null }>();

/** Spread and nearest neighbours for the two methods that read the panels themselves. */
export function poolStats(pool: Panel[]): { color: MetricStats | null; phash: MetricStats | null } {
  const hit = poolCache.get(pool);
  if (hit) return hit;

  const hashed = pool.filter((p) => p.phash);
  const phashNearest = new Map<string, string>();
  const phashPairs = measure(
    hashed.map((p) => p.id),
    (i, j) => hammingDistanceHex(String(hashed[i].phash), String(hashed[j].phash)),
    phashNearest
  );
  const phashSpread = spreadOf(phashPairs);

  // Color neighbours never cross the color / black-and-white line, so each
  // group is measured on its own, as the similarity graph does.
  const colorNearest = new Map<string, string>();
  const paletted = pool.filter((p) => p.dominantColors?.length);
  const group = (chromatic: boolean) => {
    const ps = paletted.filter((p) => isChromatic(p) === chromatic);
    return spreadOf(
      measure(
        ps.map((p) => p.id),
        (i, j) =>
          paletteDistance(
            ps[i].dominantColors,
            ps[j].dominantColors,
            ps[i].dominantWeights,
            ps[j].dominantWeights
          ),
        colorNearest
      )
    );
  };
  const colorSpread = group(true);
  const bwSpread = group(false);

  const out = {
    color: colorSpread ? { spread: colorSpread, bw: bwSpread ?? undefined, nearest: colorNearest } : null,
    phash: phashSpread ? { spread: phashSpread, nearest: phashNearest } : null,
  };
  poolCache.set(pool, out);
  return out;
}

/** Share of panels both methods have a nearest for on which they name the same one. */
export function agreement(a: Map<string, string>, b: Map<string, string>): number {
  let both = 0;
  let same = 0;
  for (const [id, n] of a) {
    const m = b.get(id);
    if (m === undefined) continue;
    both++;
    if (m === n) same++;
  }
  return both > 0 ? same / both : NaN;
}

/**
 * Measuring every pair takes a moment on a phone, so the first time it waits
 * for the browser to be idle, after the page has painted, and the text fills
 * in when it's done. Once measured, the cached result is read straight away,
 * so a step that remounts (opening it mid-glide) does no work at all.
 * Null until then.
 */
function useDeferred<T>(compute: () => T, cached: () => T | undefined, deps: readonly unknown[]): T | null {
  const [state, setState] = useState<{ deps: readonly unknown[]; value: T } | null>(null);
  const fresh = state && state.deps.length === deps.length && state.deps.every((d, i) => d === deps[i]);
  const hit = fresh ? undefined : cached();
  useEffect(() => {
    if (cached() !== undefined) return;
    let live = true;
    const run = () => {
      const value = compute();
      if (live) setState({ deps, value });
    };
    const idle = typeof window !== "undefined" && "requestIdleCallback" in window;
    const handle = idle ? window.requestIdleCallback(run, { timeout: 1500 }) : window.setTimeout(run, 50);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    // compute and cached read only what deps name
  }, deps);
  if (fresh) return state.value;
  return hit ?? null;
}

/** One embedding file's stats, measured when idle; null while loading or measuring. */
export function useEmbeddingStats(map: EmbeddingMap | null): MetricStats | null {
  return useDeferred(
    () => (map ? embeddingStats(map) : null),
    () => (!map ? null : embeddingCache.has(map) ? embeddingCache.get(map)! : undefined),
    [map]
  );
}

/** The pool's color and pHash stats, measured when idle. */
export function usePoolStats(pool: Panel[] | undefined): { color: MetricStats | null; phash: MetricStats | null } | null {
  return useDeferred(
    () => (pool && pool.length > 2 ? poolStats(pool) : null),
    () => (!pool || pool.length <= 2 ? null : poolCache.get(pool)),
    [pool]
  );
}

/** The stats for every method the Overview compares, each null until it's ready. */
export function useAllStats(
  pool: Panel[],
  maps: Record<EmbeddingMetric, EmbeddingMap | null>
): Partial<Record<MetricKey, MetricStats | null>> {
  const panels = usePoolStats(pool);
  const siglip = useEmbeddingStats(maps["embedding-siglip"]);
  const dino = useEmbeddingStats(maps["embedding-dino"]);
  const gram = useEmbeddingStats(maps["embedding-gram"]);
  return {
    color: panels?.color ?? null,
    phash: panels?.phash ?? null,
    "embedding-siglip": siglip,
    "embedding-dino": dino,
    "embedding-gram": gram,
  };
}

/** "0.27–0.49" */
export function rangeText(s: Spread, digits = 2): string {
  return `${s.lo.toFixed(digits)}–${s.hi.toFixed(digits)}`;
}

/** "53%", or "under 1%" */
export function percent(x: number): string {
  const p = Math.round(x * 100);
  return p < 1 ? "under 1%" : `${p}%`;
}
