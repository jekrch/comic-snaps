import type { Panel } from "../types";
import type { EmbeddingMap } from "./sorting";
import {
  paletteDistance,
  cosineDistance,
  hammingDistanceHex,
} from "./sorting";
import type { MetricKey } from "../components/graph/similarityConfig";

/* Neighbor type */

export interface Neighbor {
  panel: Panel;
  distance: number;
}

/* Compute nearest neighbors */

export function computeNeighbors(
  anchor: Panel,
  allPanels: Panel[],
  metric: MetricKey,
  count: number,
  embeddings: EmbeddingMap | null
): Neighbor[] {
  const candidates: Neighbor[] = [];

  for (const p of allPanels) {
    if (p.id === anchor.id) continue;

    let dist: number | null = null;

    if (
      metric === "embedding-siglip" ||
      metric === "embedding-dino" ||
      metric === "embedding-gram"
    ) {
      if (!embeddings) continue;
      const aEmb = embeddings[anchor.id];
      const bEmb = embeddings[p.id];
      if (!aEmb || !bEmb) continue;
      dist = cosineDistance(aEmb, bEmb);
    } else if (metric === "color") {
      const COLORFULNESS_THRESHOLD = 6;
      const anchorIsChromatic = (anchor.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD;
      const candidateIsChromatic = (p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD;
      if (anchorIsChromatic !== candidateIsChromatic) continue;

      dist = paletteDistance(
        anchor.dominantColors ?? null,
        p.dominantColors ?? null
      );
    } else if (metric === "phash") {
      if (!anchor.phash || !p.phash) continue;
      dist = hammingDistanceHex(String(anchor.phash), String(p.phash));
    }

    if (dist !== null && isFinite(dist)) {
      candidates.push({ panel: p, distance: dist });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, count);
}

/* Cross-distance between two panels */

export function computeCrossDistance(
  a: Panel,
  b: Panel,
  metric: MetricKey,
  embeddings: EmbeddingMap | null
): number | null {
  if (
    metric === "embedding-siglip" ||
    metric === "embedding-dino" ||
    metric === "embedding-gram"
  ) {
    if (!embeddings) return null;
    const aE = embeddings[a.id];
    const bE = embeddings[b.id];
    if (!aE || !bE) return null;
    return cosineDistance(aE, bE);
  } else if (metric === "color") {
    return paletteDistance(a.dominantColors ?? null, b.dominantColors ?? null);
  } else if (metric === "phash") {
    if (!a.phash || !b.phash) return null;
    return hammingDistanceHex(String(a.phash), String(b.phash));
  }
  return null;
}

/* Force-directed layout (simple spring simulation) */

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

export function forceLayout(
  nodeCount: number,
  edges: { source: number; target: number; weight: number; isCross?: boolean }[],
  iterations: number = 300
): { x: number; y: number }[] {
  const nodes: LayoutNode[] = [];
  const hasCrossEdges = edges.some((e) => e.isCross);
  const radius = 120 + nodeCount * 8;

  // Place node 0 at center, others in a circle
  for (let i = 0; i < nodeCount; i++) {
    if (i === 0) {
      nodes.push({ id: String(i), x: 0, y: 0, vx: 0, vy: 0, fixed: false });
    } else {
      const angle = ((i - 1) / (nodeCount - 1)) * 2 * Math.PI;
      nodes.push({
        id: String(i),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fixed: false,
      });
    }
  }

  // Normalize weights to ideal lengths
  const maxWeight = Math.max(...edges.map((e) => e.weight), 0.001);
  const layoutEdges = edges.map((e) => ({
    source: String(e.source),
    target: String(e.target),
    idealLen: e.isCross
      ? 140 + (e.weight / maxWeight) * 200 // cross-edges: longer ideal length
      : 60 + (e.weight / maxWeight) * 120, // anchor-edges: tight
    isCross: e.isCross ?? false,
  }));

  const damping = 0.85;
  // Increase repulsion when cross-edges are present to prevent clumping
  const repulsionStrength = hasCrossEdges ? 35000 : 15000;
  const anchorSpringStrength = 0.04;
  const crossSpringStrength = 0.005; // much weaker — structural hint, not a hard constraint

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Repulsion (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const distSq = dx * dx + dy * dy + 1;
        const force = (repulsionStrength * temp) / distSq;
        const fx = (dx / Math.sqrt(distSq)) * force;
        const fy = (dy / Math.sqrt(distSq)) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Spring attraction (edges)
    for (const edge of layoutEdges) {
      const si = parseInt(edge.source);
      const ti = parseInt(edge.target);
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const displacement = dist - edge.idealLen;
      const strength = edge.isCross ? crossSpringStrength : anchorSpringStrength;
      const force = strength * displacement * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[si].vx += fx;
      nodes[si].vy += fy;
      nodes[ti].vx -= fx;
      nodes[ti].vy -= fy;
    }

    // Apply velocities
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return nodes.map((n) => ({ x: n.x, y: n.y }));
}