/**
 * The physics behind throwing a shelf strip with the mouse.
 *
 * A touch strip already scrolls the way a phone does, because the browser
 * scrolls it natively. A mouse gets nothing like that, only the scrollbar, and
 * a 4px hairline is a small thing to hit. So a mouse can grab the strip, drag
 * it 1:1, and let go to throw it, with the same exponential decay phones use:
 * the strip leaves at the speed of the hand and slows smoothly, quickly at first
 * and then gently, never stopping on a fixed deceleration.
 *
 * Kept free of the DOM so the numbers can be tested on their own.
 */

/**
 * The decay time constant, in ms. After one τ the glide has covered 63% of its
 * distance, after three it has covered 95%. 325ms is the figure iOS-style
 * kinetic scrolling has used for years, and it is what makes a throw read as
 * "mobile" rather than as an animation.
 */
export const GLIDE_TAU = 325;

/** Movement before a press becomes a drag, so a slightly shaky click still clicks. */
export const DRAG_THRESHOLD = 5;

/** Only the last stretch of the drag says how fast the hand was moving at release. */
export const VELOCITY_WINDOW = 80;

/**
 * A hand that stopped moving before letting go meant to put the strip down, not
 * throw it. A pause this long before the release cancels the throw.
 */
export const RELEASE_STALE = 60;

/** px/ms. A flick faster than this would cross several rows' worth of strip. */
export const MAX_VELOCITY = 6;

/** Below this (px/ms) a release is a placement, not a throw. */
export const MIN_VELOCITY = 0.08;

/** The glide stops when this little of it is left (px). */
export const SETTLE_EPSILON = 0.5;

export interface Sample {
  /** Event timestamp, in ms. */
  t: number;
  /** Pointer x, in px. */
  x: number;
}

/**
 * The pointer's velocity at release, in px/ms, positive to the right.
 *
 * Measured across the last `VELOCITY_WINDOW` of samples rather than between the
 * last two: pointer events arrive unevenly, and a two-sample slope swings by a
 * factor of several from one release to the next.
 */
export function releaseVelocity(samples: readonly Sample[], releaseT: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (releaseT - last.t > RELEASE_STALE) return 0;

  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > VELOCITY_WINDOW) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;

  const v = (last.x - first.x) / dt;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}

export interface Glide {
  from: number;
  /** Where the glide comes to rest, already clamped to the strip's travel. */
  to: number;
}

/**
 * Where a throw lands. Exponential decay starting at `velocity` covers
 * `velocity * τ` in total, and a throw that would run past either end of the
 * strip lands on that end instead, decaying into it rather than hitting it.
 *
 * `velocity` is in scroll terms (px/ms, positive moves `scrollLeft` up), which
 * is the opposite sign to the pointer's.
 */
export function planGlide(scrollLeft: number, velocity: number, maxScroll: number): Glide | null {
  if (Math.abs(velocity) < MIN_VELOCITY) return null;
  const to = Math.max(0, Math.min(maxScroll, scrollLeft + velocity * GLIDE_TAU));
  if (Math.abs(to - scrollLeft) < SETTLE_EPSILON) return null;
  return { from: scrollLeft, to };
}

/** The glide's position `elapsed` ms after release. */
export function glideAt(glide: Glide, elapsed: number): number {
  return glide.to - (glide.to - glide.from) * Math.exp(-elapsed / GLIDE_TAU);
}

/** Whether the glide has reached its resting point. */
export function glideDone(glide: Glide, elapsed: number): boolean {
  return Math.abs(glide.to - glideAt(glide, elapsed)) < SETTLE_EPSILON;
}
