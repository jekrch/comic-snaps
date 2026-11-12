import type { Droplet, SettledGlob, SplashEvent } from "./types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far past an ellipse's edge the goo filter can still put ink. The blur
 * spreads a glob by about 3σ; the alpha threshold only ever pulls it back in.
 */
export function gooPad(blurStd: number): number {
  return blurStd * 3 + 2;
}

function clampBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): Box | null {
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(width, x1);
  const bottom = Math.min(height, y1);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The box every settled glob of a layer can paint into, goo spread included. */
export function settledBounds(
  globs: SettledGlob[],
  pad: number,
  width: number,
  height: number,
): Box | null {
  if (globs.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of globs) {
    x0 = Math.min(x0, g.x - g.rx);
    y0 = Math.min(y0, g.y - g.ry);
    x1 = Math.max(x1, g.x + g.rx);
    y1 = Math.max(y1, g.y + g.ry);
  }
  return clampBox(x0 - pad, y0 - pad, x1 + pad, y1 + pad, width, height);
}

/** Largest scale a droplet's keyframes reach on each axis. */
function peakScale(d: Droplet): { sx: number; sy: number } {
  let sx = 1;
  let sy = 1;
  for (const p of d.growthProfile) {
    sx = Math.max(sx, p.sx);
    sy = Math.max(sy, p.sy);
  }
  return { sx: sx * (1 + Math.abs(d.bulgeXAmp)), sy: sy * (1 + Math.abs(d.bulgeYAmp)) };
}

/**
 * The box an in-flight event can paint into over its whole animation: each
 * droplet at its peak bulge, its fall and drift, plus the goo spread. The
 * takeover covers the tile.
 */
export function eventBounds(
  event: SplashEvent,
  pad: number,
  width: number,
  height: number,
): Box | null {
  if (event.isTakeover) return clampBox(0, 0, width, height, width, height);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of event.droplets) {
    const { sx, sy } = peakScale(d);
    const wobble = Math.abs(d.wobbleAmp) + Math.abs(d.wobble2Amp);
    const halfW = d.rx * sx + wobble;
    const halfH = d.ry * sy;
    x0 = Math.min(x0, d.x + Math.min(0, d.driftX) - halfW);
    x1 = Math.max(x1, d.x + Math.max(0, d.driftX) + halfW);
    y0 = Math.min(y0, d.y + Math.min(0, d.fallDistance) - halfH);
    y1 = Math.max(y1, d.y + Math.max(0, d.fallDistance) + halfH);
  }
  if (!Number.isFinite(x0)) return null;
  return clampBox(x0 - pad, y0 - pad, x1 + pad, y1 + pad, width, height);
}
