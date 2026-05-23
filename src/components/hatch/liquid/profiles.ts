import { randBetween, smoothstep } from "./util";

/**
 * Build a per-droplet fall profile: a list of (timeFrac, fallFrac) points
 * across the fall portion of the animation.
 *
 * Speed is defined at a handful of evenly-spaced control points (some
 * normal, some "slow zones"), then smoothstep-interpolated between them
 * and integrated to produce f(t). Densely sampled output keyframes mean
 * CSS's linear interpolation closely tracks the smooth curve, so the drop
 * eases gradually in and out of stalls instead of velocity jumping at
 * segment boundaries.
 */
export function generateFallProfile(): { t: number; f: number }[] {
  const controls = 8;
  const speeds: number[] = [];
  for (let i = 0; i < controls; i++) {
    const slow = Math.random() < 0.38;
    speeds.push(slow ? randBetween(0.04, 0.12) : randBetween(0.25, 0.45));
  }
  // Ease into motion: first few control points slow.
  speeds[0] = randBetween(0.01, 0.04);
  speeds[1] = randBetween(0.06, 0.14);
  speeds[2] = Math.min(speeds[2], randBetween(0.18, 0.3));
  // Ease to a stop at the final position: last few control points slow.
  speeds[controls - 3] = Math.min(speeds[controls - 3], randBetween(0.18, 0.3));
  speeds[controls - 2] = randBetween(0.06, 0.14);
  speeds[controls - 1] = randBetween(0.01, 0.04);

  const samples = 16;
  const rawF: number[] = [0];
  let acc = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const idxF = t * (controls - 1);
    const i0 = Math.min(controls - 1, Math.floor(idxF));
    const i1 = Math.min(controls - 1, i0 + 1);
    const frac = idxF - i0;
    const speed = speeds[i0] * (1 - smoothstep(frac)) + speeds[i1] * smoothstep(frac);
    acc += speed / samples;
    rawF.push(acc);
  }
  const total = rawF[rawF.length - 1];
  return rawF.map((f, i) => ({ t: i / samples, f: f / total }));
}

interface Bump {
  /** Center t where the bump peaks (0–1). */
  c: number;
  /** Half-width: bump is non-zero across [c-w, c+w]. */
  w: number;
  /** Signed peak amplitude (relative to base scale). */
  a: number;
}

/**
 * Generate 2–3 cosine bumps biased toward mid/late growth, where the blob is
 * large enough that a relative perturbation won't read as a spring jolt.
 * Mostly positive (bulge outward) with the occasional pinch.
 */
function generateBumps(): Bump[] {
  const n = 2 + Math.floor(Math.random() * 2);
  const bumps: Bump[] = [];
  for (let i = 0; i < n; i++) {
    bumps.push({
      c: randBetween(0.35, 0.92),
      w: randBetween(0.12, 0.22),
      a: Math.random() < 0.78 ? randBetween(0.12, 0.32) : -randBetween(0.05, 0.12),
    });
  }
  return bumps;
}

function bumpEffect(t: number, bumps: Bump[]): number {
  let e = 0;
  for (const b of bumps) {
    const d = (t - b.c) / b.w;
    if (d > -1 && d < 1) e += b.a * 0.5 * (1 + Math.cos(d * Math.PI));
  }
  return e;
}

/**
 * Build a per-droplet emerge profile: a sequence of (t, sx, sy) control
 * points where t spans the emerge portion (0 → 1). Base is a smoothstep ease
 * with a per-axis time skew (egg-shape early, sphere late). On top of that,
 * each axis gets a few independent cosine bumps that swell or pinch the blob
 * mid-growth, producing a bulgy, uneven inflation rather than a clean ramp.
 *
 * Bump magnitude is gated by current base size (`min(1, base*1.8)`) so small
 * sizes can't see relative jumps — the original brief was "grow in place,
 * don't jump," and a 0.2 perturbation at sx=0.1 would read as a spring.
 */
export function generateGrowthProfile(): { t: number; sx: number; sy: number }[] {
  const steps = 28;
  const skewX = randBetween(-0.18, 0.18);
  const skewY = randBetween(-0.18, 0.18);
  const bumpsX = generateBumps();
  const bumpsY = generateBumps();
  const eased = (t: number, skew: number) => {
    const u = Math.max(0, Math.min(1, t - skew * t * (1 - t)));
    return smoothstep(u);
  };
  const profile: { t: number; sx: number; sy: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const baseX = eased(t, skewX);
    const baseY = eased(t, skewY);
    const gateX = Math.min(1, baseX * 1.8);
    const gateY = Math.min(1, baseY * 1.8);
    // Taper bumps to zero at t=1 so the curve lands exactly on the final size.
    const settle = 1 - smoothstep(Math.max(0, (t - 0.85) / 0.15));
    const sx = Math.max(0, baseX * (1 + bumpEffect(t, bumpsX) * gateX * settle));
    const sy = Math.max(0, baseY * (1 + bumpEffect(t, bumpsY) * gateY * settle));
    profile.push({ t, sx, sy });
  }
  profile[profile.length - 1] = { t: 1, sx: 1, sy: 1 };
  return profile;
}
