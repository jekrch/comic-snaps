import { EMERGE_SPAN_PCT } from "./constants";
import type { Droplet, SplashEvent } from "./types";

/**
 * Droplet motion as Web Animations keyframes. These used to be injected as
 * `@keyframes` text in a `<style>` per filler, which re-parsed a stylesheet
 * and invalidated style for every filler each time an event started or
 * ended. `element.animate()` runs the same curves with no stylesheet churn.
 */
export interface DropAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

interface Key {
  /** Percentage of the active animation, 0–100. */
  pct: number;
  transform: string;
}

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

function transform(tx: number, ty: number, sx: number, sy: number): string {
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

function xAt(d: Droplet, driftFrac: number, pct: number, wobbleMul: number): number {
  return d.driftX * driftFrac + wobbleAt(d, pct) * wobbleMul;
}

/** Emerge stage: blob grows from scale 0 to (sx, sy) at its rest position. */
function emergeKeys(d: Droplet, inner: number): Key[] {
  return d.growthProfile.map((p) => {
    const pct = inner + EMERGE_SPAN_PCT * p.t;
    const { bx, by } = bulgeAt(d, pct);
    return { pct, transform: transform(0, 0, p.sx * bx, p.sy * by) };
  });
}

/**
 * Post-emerge hold: blob stays at its final size with only gentle bulge
 * oscillation. fallDistance and driftX are zero (blobs grow in place), so
 * no translation. The settle envelope tapers the bulge to exactly (1, 1) at
 * 100% so the active mask hands off to the static settled layer without any
 * scale snap.
 */
function fallKeys(d: Droplet, emergeEnd: number): Key[] {
  const fallSpan = 100 - emergeEnd;
  return d.fallProfile.map((p) => {
    const pct = emergeEnd + fallSpan * p.t;
    const settle = Math.max(0, Math.min(1, (p.t - 0.7) / 0.3));
    const smoothSettle = settle * settle * (3 - 2 * settle);
    const damp = 1 - smoothSettle;
    const { bx, by } = bulgeAt(d, pct);
    const sx = 1 + (bx - 1) * damp;
    const sy = 1 + (by - 1) * damp;
    return { pct, transform: transform(xAt(d, p.f, pct, 0), d.fallDistance * p.f, sx, sy) };
  });
}

/**
 * Keys to Web Animations keyframes. Where two keys share a percentage, the
 * later one wins, as it did when these were CSS `@keyframes` selectors.
 */
function toKeyframes(keys: Key[]): Keyframe[] {
  const out: Keyframe[] = [];
  let lastPct = -1;
  for (const k of keys) {
    const pct = Math.max(lastPct, Math.min(100, Math.max(0, k.pct)));
    const frame = { offset: pct / 100, transform: k.transform };
    if (out.length > 0 && pct - lastPct < 1e-6) out[out.length - 1] = frame;
    else out.push(frame);
    lastPct = pct;
  }
  return out;
}

function dropletKeys(d: Droplet): Key[] {
  const a = d.inner;
  const emergeEnd = a + EMERGE_SPAN_PCT;
  if (d.y < 0) {
    // Spawned above the tile: full size from the start, falls in.
    const start = transform(xAt(d, 0, 0, 1), 0, 1, 1);
    return [
      { pct: 0, transform: start },
      { pct: a, transform: transform(xAt(d, 0, a, 1), 0, 1, 1) },
      ...fallKeys(d, a),
    ];
  }
  const hidden = transform(0, 0, 0, 0);
  return [
    { pct: 0, transform: hidden },
    { pct: a, transform: hidden },
    ...emergeKeys(d, a),
    ...fallKeys(d, emergeEnd),
  ];
}

/** One animation per droplet of an in-flight splash event, in droplet order. */
export function buildDropAnimations(event: SplashEvent | null): DropAnimation[] {
  if (!event) return [];
  const duration = event.activeSec * 1000;
  if (event.isTakeover) {
    return [{
      keyframes: [
        { transform: transform(0, 0, 0, 0) },
        { transform: transform(0, 0, 1, 1) },
      ],
      options: { duration, easing: "ease-in-out", fill: "both" },
    }];
  }
  return event.droplets.map((d) => ({
    keyframes: toKeyframes(dropletKeys(d)),
    options: { duration, easing: "linear", fill: "both" },
  }));
}
