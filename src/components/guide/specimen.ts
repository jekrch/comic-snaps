import { useEffect, useMemo, useState } from "react";
import type { Panel } from "../../types";
import type { MetricKey } from "../graph/similarityConfig";
import { computeNeighbors } from "../../utils/similarityUtils";
import { loadEmbeddings, peekEmbeddings, type EmbeddingMap } from "../../utils/sorting";
import { EXPLAINER_EXCLUDED_PANELS, explainerNeighbors, type NeighborInfo } from "../explainer/explainerConstants";

/**
 * The Guide's worked example: one anchor panel for the whole session, shared
 * by every lesson, so the overview's comparison and each lesson's numbers are
 * all about the same panel. The reader can shuffle it or pick their own; the
 * similarity graph hands in the panel it's centred on.
 */

export type EmbeddingMetric = "embedding-siglip" | "embedding-dino" | "embedding-gram";

export const EMBEDDING_METRICS: EmbeddingMetric[] = ["embedding-siglip", "embedding-dino", "embedding-gram"];

export function isEmbeddingMetric(m: MetricKey | undefined): m is EmbeddingMetric {
  return m === "embedding-siglip" || m === "embedding-dino" || m === "embedding-gram";
}

/** Panels the Guide may use as an anchor or show as a neighbour. */
export function specimenPool(panels: Panel[]): Panel[] {
  return panels.filter((p) => !EXPLAINER_EXCLUDED_PANELS.has(p.id) && !p.cover && !p.portrait);
}

/**
 * Whether a panel can anchor every lesson: it has a hash and a palette, and
 * a vector in every embedding file loaded so far.
 */
export function isUsableAnchor(p: Panel, maps: (EmbeddingMap | null)[]): boolean {
  if (!p.phash || !p.dominantColors?.length) return false;
  return maps.every((m) => !m || Object.keys(m).length === 0 || !!m[p.id]);
}

/**
 * A random anchor from the first half of the pool (or the first ten, in a
 * small gallery), as the old explainer drew it, skipping `avoid` (the
 * current anchor, on a shuffle) when there's anything else to pick.
 */
export function pickAnchor(
  pool: Panel[],
  maps: (EmbeddingMap | null)[] = [],
  avoid: string | null = null,
  rand: () => number = Math.random
): Panel | null {
  if (pool.length < 3) return null;
  const span = Math.min(pool.length, Math.max(Math.floor(pool.length / 2), 10));
  const head = pool.slice(0, span);
  let candidates = head.filter((p) => p.id !== avoid && isUsableAnchor(p, maps));
  if (candidates.length === 0) candidates = pool.filter((p) => p.id !== avoid && isUsableAnchor(p, maps));
  if (candidates.length === 0) candidates = head;
  return candidates[Math.floor(rand() * candidates.length)] ?? null;
}

export interface Specimen {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  /** Every neighbour, nearest first. */
  all: NeighborInfo[];
}

/** The anchor's nearest and furthest neighbours by one metric, over the whole pool. */
export function computeSpecimen(
  anchor: Panel,
  pool: Panel[],
  metric: MetricKey,
  embeddings: EmbeddingMap | null
): Specimen | null {
  const all = explainerNeighbors(computeNeighbors(anchor, pool, metric, pool.length, embeddings));
  if (all.length < 2) return null;
  return { closest: all[0], furthest: all[all.length - 1], all };
}

/** An embedding file, loaded on demand; null until it lands. */
export function useEmbeddings(metric: MetricKey | undefined): EmbeddingMap | null {
  const mode = isEmbeddingMetric(metric) ? metric : null;
  const [loaded, setLoaded] = useState<{ mode: EmbeddingMetric; map: EmbeddingMap } | null>(null);
  useEffect(() => {
    if (!mode || peekEmbeddings(mode)) return;
    let live = true;
    loadEmbeddings(mode).then((map) => {
      if (live) setLoaded({ mode, map });
    });
    return () => {
      live = false;
    };
  }, [mode]);
  if (!mode) return null;
  return peekEmbeddings(mode) ?? (loaded?.mode === mode ? loaded.map : null);
}

/** All three embedding files, each null until it lands. */
export function useAllEmbeddings(enabled: boolean): Record<EmbeddingMetric, EmbeddingMap | null> {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    for (const m of EMBEDDING_METRICS) {
      if (peekEmbeddings(m)) continue;
      loadEmbeddings(m).then(() => {
        if (live) bump((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [enabled]);
  const siglip = peekEmbeddings("embedding-siglip");
  const dino = peekEmbeddings("embedding-dino");
  const gram = peekEmbeddings("embedding-gram");
  // Stable until a file lands, so whatever is computed from it isn't redone.
  return useMemo(
    () => ({ "embedding-siglip": siglip, "embedding-dino": dino, "embedding-gram": gram }),
    [siglip, dino, gram]
  );
}

export type SpecimenStatus =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; specimen: Specimen };

/** The anchor's neighbours for one metric, loading its embeddings if needed. */
export function useSpecimen(anchor: Panel | null, pool: Panel[], metric: MetricKey | undefined): SpecimenStatus {
  const embeddings = useEmbeddings(metric);
  return useMemo<SpecimenStatus>(() => {
    if (!anchor || !metric) return { kind: "none" };
    if (isEmbeddingMetric(metric) && !embeddings) return { kind: "loading" };
    const s = computeSpecimen(anchor, pool, metric, embeddings);
    return s ? { kind: "ready", specimen: s } : { kind: "none" };
  }, [anchor, pool, metric, embeddings]);
}
