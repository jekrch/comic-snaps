import { EMERGE_SPAN_PCT } from "./constants";
import type { Droplet, SplashEvent } from "./types";

/** Sample the dual-sine wobble (x offset) at a given percentage of the animation. */
function wobbleAt(d: Droplet, pct: number): number {
  const u = pct / 100;
  return (
    Math.sin(u * d.wobbleFreq * 2 * Math.PI + d.wobblePhase) * d.wobbleAmp +
    Math.sin(u * d.wobble2Freq * 2 * Math.PI + d.wobble2Phase) * d.wobble2Amp
  );
}

/** Sample the per-axis bulge scale factors at a given percentage of the animation. */
function bulgeAt(d: Droplet, pct: number): { bx: number; by: number } {
  const u = pct / 100;
  return {
    bx: 1 + Math.sin(u * d.bulgeXFreq * 2 * Math.PI + d.bulgeXPhase) * d.bulgeXAmp,
    by: 1 + Math.sin(u * d.bulgeYFreq * 2 * Math.PI + d.bulgeYPhase) * d.bulgeYAmp,
  };
}

function xAt(d: Droplet, driftFrac: number, pct: number, wobbleMul: number): string {
  return (d.driftX * driftFrac + wobbleAt(d, pct) * wobbleMul).toFixed(1);
}

function yAt(d: Droplet, frac: number): string {
  return (d.fallDistance * frac).toFixed(1);
}

/** Emerge stage: blob grows from scale 0 to (sx, sy) at its rest position. */
function emergeKeyframes(d: Droplet, inner: number): string {
  return d.growthProfile.map((p) => {
    const pct = inner + EMERGE_SPAN_PCT * p.t;
    const { bx, by } = bulgeAt(d, pct);
    const sx = p.sx * bx;
    const sy = p.sy * by;
    return `${pct.toFixed(1)}% { transform: translate(0, 0) scale(${sx.toFixed(2)}, ${sy.toFixed(2)}); }`;
  }).join("\n        ");
}

/**
 * Post-emerge hold: blob stays at its final size with only gentle bulge
 * oscillation. fallDistance and driftX are zero (blobs grow in place), so
 * no translation. The settle envelope tapers the bulge to exactly (1, 1) at
 * 100% so the active mask hands off to the static settled layer without any
 * scale snap.
 */
function fallKeyframes(d: Droplet, emergeEnd: number): string {
  const fallSpan = 100 - emergeEnd;
  return d.fallProfile.map((p) => {
    const pct = emergeEnd + fallSpan * p.t;
    const settle = Math.max(0, Math.min(1, (p.t - 0.7) / 0.3));
    const smoothSettle = settle * settle * (3 - 2 * settle);
    const damp = 1 - smoothSettle;
    const { bx, by } = bulgeAt(d, pct);
    const sx = 1 + (bx - 1) * damp;
    const sy = 1 + (by - 1) * damp;
    return `${pct.toFixed(1)}% { transform: translate(${xAt(d, p.f, pct, 0)}px, ${yAt(d, p.f)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}); }`;
  }).join("\n          ");
}

function dropletKeyframes(d: Droplet, i: number, animId: string, activeSec: number): string {
  const a = d.inner;
  const emergeEnd = a + EMERGE_SPAN_PCT;
  const fromAbove = d.y < 0;

  const body = fromAbove
    ? `
        0% { transform: translate(${xAt(d, 0, 0, 1)}px, 0) scale(1); }
        ${a.toFixed(1)}% { transform: translate(${xAt(d, 0, a, 1)}px, 0) scale(1); }
        ${fallKeyframes(d, a)}
          `
    : `
        0% { transform: translate(0, 0) scale(0); }
        ${a.toFixed(1)}% { transform: translate(0, 0) scale(0); }
        ${emergeKeyframes(d, a)}
        ${fallKeyframes(d, emergeEnd)}
          `;

  return `
      @keyframes drop-${animId}-${i} { ${body} }
      .drop-${animId}-${i} {
        transform-box: fill-box;
        transform-origin: center;
        animation: drop-${animId}-${i} ${activeSec.toFixed(2)}s linear 1 both;
        will-change: transform;
      }
      `;
}

function takeoverKeyframes(animId: string, activeSec: number): string {
  return `
        @keyframes drop-${animId}-0 {
          0% { transform: translate(0, 0) scale(0); }
          100% { transform: translate(0, 0) scale(1); }
        }
        .drop-${animId}-0 {
          transform-box: fill-box;
          transform-origin: center;
          animation: drop-${animId}-0 ${activeSec.toFixed(2)}s ease-in-out 1 both;
        }
      `;
}

/** Build the @keyframes + class CSS for an in-flight splash event. */
export function buildDropKeyframes(event: SplashEvent | null, animId: string): string {
  if (!event) return "";
  if (event.isTakeover) return takeoverKeyframes(animId, event.activeSec);
  return event.droplets
    .map((d, i) => dropletKeyframes(d, i, animId, event.activeSec))
    .join("");
}
