import {
  ACTIVE_MAX_SEC,
  ACTIVE_MIN_SEC,
  DROPLET_MAX,
  DROPLET_MIN,
  REST_CANDIDATES,
  REST_MAX_SEC,
  REST_MIN_SEC,
} from "./constants";
import { markCoverage, scoreCandidate } from "./coverage";
import { generateFallProfile, generateGrowthProfile } from "./profiles";
import type { Droplet, LiquidConfig, LiquidPhase, SplashEvent } from "./types";
import { darkenHex, randBetween } from "./util";

/**
 * A non-translating, non-wobbling droplet with no fall — the resting position
 * is the spawn position. Most splash droplets fit this profile; the takeover
 * uses it too with custom radius/profile fields.
 */
function staticDroplet(overrides: Partial<Droplet> & Pick<Droplet, "x" | "y" | "rx" | "ry">): Droplet {
  return {
    fallDistance: 0,
    driftX: 0,
    finalX: overrides.x,
    finalY: overrides.y,
    inner: 0,
    // Wobble disabled — blobs should not translate. Shape variation comes
    // from the per-axis bulge oscillation (also disabled here; asymmetry
    // comes from the per-axis time skew in the growth profile).
    wobbleAmp: 0, wobbleFreq: 1, wobblePhase: 0,
    wobble2Amp: 0, wobble2Freq: 1, wobble2Phase: 0,
    // Bulge oscillation disabled — blob must come to a complete stop at its
    // final size. Any post-emerge motion (even a slow swell) breaks the
    // "ease out to a stopping position" feel.
    bulgeXAmp: 0, bulgeXFreq: 1, bulgeXPhase: 0,
    bulgeYAmp: 0, bulgeYFreq: 1, bulgeYPhase: 0,
    growthProfile: [],
    fallProfile: [],
    ...overrides,
  };
}

/**
 * Pick the best of N candidate rest positions for a single droplet. Random
 * jitter keeps it from being fully greedy. Since blobs grow in place (no
 * translation), the chosen position is used as both spawn and rest — the
 * centroid never moves.
 */
function pickBestPosition(
  workGrid: Uint8Array,
  rx: number,
  ry: number,
  width: number,
  height: number,
  margin: number,
  xRange: number,
  yRange: number,
  targetMask: Uint8Array | null,
): { x: number; y: number } {
  let bestX = margin + Math.random() * xRange;
  let bestY = margin + Math.random() * yRange;
  let bestScore = -Infinity;
  for (let k = 0; k < REST_CANDIDATES; k++) {
    const cx = margin + Math.random() * xRange;
    const cy = margin + Math.random() * yRange;
    const raw = scoreCandidate(workGrid, { x: cx, y: cy, rx, ry }, width, height, targetMask);
    const jittered = raw + Math.random() * 1.5;
    if (jittered > bestScore) {
      bestScore = jittered;
      bestX = cx;
      bestY = cy;
    }
  }
  return { x: bestX, y: bestY };
}

export function generateSplashEvent(
  id: number,
  phase: LiquidPhase,
  width: number,
  height: number,
  baseRadius: number,
  ownGrid: Uint8Array,
  targetMask: Uint8Array | null,
): SplashEvent {
  const activeSec = randBetween(ACTIVE_MIN_SEC, ACTIVE_MAX_SEC);
  const restSec = randBetween(REST_MIN_SEC, REST_MAX_SEC);

  const margin = baseRadius * 0.6;
  const xRange = Math.max(0, width - margin * 2);
  const yRange = Math.max(0, height - margin * 2);
  const count = Math.floor(randBetween(DROPLET_MIN, DROPLET_MAX + 1));

  // Working copy of the coverage grid so candidates within the same event
  // can avoid stacking on each other's intended landing spots.
  const workGrid = new Uint8Array(ownGrid);

  const droplets: Droplet[] = [];
  for (let i = 0; i < count; i++) {
    const sizeBase = randBetween(0.95, 3.1);
    // Wider per-axis variance produces eccentric, egg/oval base shapes
    // rather than near-circles — the goo blur then reads as lopsided
    // globules instead of clean disks.
    const rx = baseRadius * sizeBase * randBetween(0.65, 1.45);
    const ry = baseRadius * sizeBase * randBetween(0.65, 1.45);

    const { x, y } = pickBestPosition(workGrid, rx, ry, width, height, margin, xRange, yRange, targetMask);
    markCoverage(workGrid, { x, y, rx, ry }, width, height);

    droplets.push(staticDroplet({
      x, y, rx, ry,
      inner: randBetween(0, 14),
      growthProfile: generateGrowthProfile(),
      fallProfile: generateFallProfile(),
    }));
  }
  return { id, phase, activeSec, restSec, droplets };
}

/**
 * Build the "engulf" event that fires once MAX_LAYERS layers have settled.
 * A single glob centered on the tile, sized to cover every corner at scale 1,
 * with no wobble/bulge/fall — just a clean, smooth growth from 0 to full. The
 * fill is the base/original color (phase = "light"), so when the layers are
 * cleared at the end it lines up perfectly with the underlying base hatch.
 */
export function generateTakeoverEvent(id: number, width: number, height: number): SplashEvent {
  const reach = Math.hypot(width, height);
  const radius = reach * 0.65;
  const droplet = staticDroplet({
    x: width / 2,
    y: height / 2,
    rx: radius,
    ry: radius,
  });
  return {
    id,
    phase: "light",
    activeSec: randBetween(5, 7),
    restSec: randBetween(REST_MIN_SEC, REST_MAX_SEC),
    droplets: [droplet],
    isTakeover: true,
  };
}

export function buildLiquidConfig(
  enabled: boolean,
  width: number,
  height: number,
  baseColor: string,
): LiquidConfig {
  const darkColor = darkenHex(baseColor, 0.35);
  if (!enabled || width <= 0 || height <= 0) {
    return { enabled: false, blurStd: 0, baseRadius: 0, darkColor };
  }
  const minDim = Math.min(width, height);
  const baseRadius = minDim * 0.17;
  const blurStd = Math.max(3, Math.min(6, baseRadius * 0.32));
  return { enabled: true, blurStd, baseRadius, darkColor };
}
