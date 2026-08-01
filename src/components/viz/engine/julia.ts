/**
 * Which Julia set the run is drawing, and where the flight into it has got to.
 *
 * Shared rather than kept in the backend because the *rate* of the flight
 * depends on the set: one turn of the wrap is worth log|lambda| e-folds of
 * magnification, lambda is a property of the seed, and the seed is walking. The
 * director integrates the phase and the backend renders it, so both of them need
 * the same answer to that question.
 */

export type Complex = [number, number];

export const cmul = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];
export const cadd = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
export const csub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]];

export function cdiv(a: Complex, b: Complex): Complex {
  const d = b[0] * b[0] + b[1] * b[1] || 1e-9;
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

/**
 * Preimages the flight travels before the picture is allowed to repeat.
 *
 * One would do, and is the obvious choice: the set is exactly invariant under
 * the inverse map, so after a single preimage the picture is the picture it
 * started from and the phase can be wrapped with nothing to see. The trouble is
 * that this is *too* true. A picture that comes back to itself every turn is a
 * picture with a period, and at the rate this mode flies that period is about
 * five seconds — short enough that the eye recognises the repeat and reads the
 * whole thing as a loop rather than as travel, however invisible the seam is.
 *
 * The set is equally invariant under five preimages, and the chart that makes
 * the wrap seamless is no less accurate over them — it is the same series about
 * the same point, and the frame's own radius, which is what bounds its error,
 * has not changed. So the seam costs nothing extra and the loop becomes half a
 * minute, by which time the walk has moved the set to somewhere that is not
 * recognisably where it began.
 *
 * What it does cost is iterations: every preimage adds one step to every orbit
 * before it exits, so JULIA_ITERS has to carry this many more than a static view
 * would need.
 */
export const JULIA_WRAP = 5;

/** Everything the shader needs about the set and the flight. All complex. */
export interface JuliaFrame {
  /** Half the multiplier — the walk's own position, before the page moves it. */
  m: Complex;
  /** The repelling fixed point, which is the flight's destination. */
  beta: Complex;
  /** Approach to it this frame: multiplication by lambda^-u. */
  step: Complex;
  /** Second- and third-order corrections to that approach. Both are exactly
   *  zero while the flight is stopped, which is what makes the whole chart
   *  inert rather than merely small at a standstill. */
  warp: Complex;
  warp3: Complex;
}

/**
 * The seed's multiplier, at this point of the walk.
 *
 * Derived rather than authored, and along one curve rather than freely, because
 * most of the complex plane is not worth visiting: a seed outside the Mandelbrot
 * set gives a set that is dust — totally disconnected, and on screen a scatter
 * of speckle with no figure in it. The main cardioid is the largest region where
 * the set is guaranteed connected, and it has an exact parametrisation:
 * c = mu/2 - mu^2/4 for |mu| < 1, where mu is the multiplier of the fixed point
 * the set is built around. So the walk is a circuit in mu, and every point of it
 * is a legitimate connected set.
 *
 * The circuit is a circle pushed off the origin rather than centred on it, and
 * that is the flight's doing rather than a matter of taste. The repelling fixed
 * point has multiplier lambda = 2 - mu, so a walk that passed near mu = 1 would
 * pass near lambda = 1 — a fixed point that barely repels, where the
 * magnification per turn falls to nothing and the chart that makes the wrap
 * seamless has a pole. Displaced to the left, the same walk keeps |lambda| above
 * 1.7 the whole way round: every set on it is worth looking at *and* can be
 * flown into. The far side of the circle is where the near-boundary filigree is
 * and the near side is a rounder, calmer set, so the walk breathes between the
 * two rather than holding one character for its whole circuit.
 *
 * The radius and the displacement sum to under 0.9, so that half of it — which
 * is what the page perturbs in the shader — stays clear of the disc's edge at
 * 0.5 even at full drive.
 */
function juliaMu(shape: number, walk: number): Complex {
  const r = 0.12 + 0.48 * Math.min(1, Math.max(0, shape));
  return [r * Math.cos(walk) - 0.3, r * Math.sin(walk)];
}

/**
 * E-folds of magnification in one preimage — the exchange rate between the
 * flight's authored speed and the phase that carries it.
 *
 * The director integrates in *turns* rather than in e-folds precisely because
 * this number drifts with the walk. Integrating e-folds and dividing here would
 * make the phase a growing quantity divided by a moving one, so a slow drift in
 * lambda would arrive multiplied by however long the run had been going — a
 * flight that sped up, stalled and reversed the longer it was watched.
 */
export function juliaEfoldsPerTurn(shape: number, walk: number): number {
  const mu = juliaMu(shape, walk);
  return Math.log(Math.hypot(2 - mu[0], -mu[1]));
}

/**
 * @param turns Preimages travelled, already wrapped into [0, JULIA_WRAP).
 */
export function juliaFrame(shape: number, walk: number, turns: number): JuliaFrame {
  const mu = juliaMu(shape, walk);
  const m: Complex = [mu[0] / 2, mu[1] / 2];
  // beta = 1 - mu/2 and lambda = 2beta = 2 - mu, both exact for this family.
  const beta: Complex = [1 - m[0], -m[1]];
  const lambda: Complex = [2 - mu[0], -mu[1]];

  const one: Complex = [1, 0];
  const logAbs = Math.log(Math.hypot(lambda[0], lambda[1]));
  const u = turns - Math.floor(turns / JULIA_WRAP) * JULIA_WRAP;
  const scale = Math.exp(-u * logAbs);
  const angle = -u * Math.atan2(lambda[1], lambda[0]);
  const step: Complex = [scale * Math.cos(angle), scale * Math.sin(angle)];

  /*
   * The Koenigs chart, to two terms.
   *
   * Its coefficients follow from the expansion of the inverse map itself,
   * g(w) = w/lambda - w^2/lambda^3 + 2w^3/lambda^5, and the requirement that the
   * chart turn g into plain multiplication. What the shader wants is not the
   * chart but the whole conjugated map, so both terms are folded down here into
   * the two coefficients of w^2 and w^3 — four complex operations that do not
   * vary across the frame, and in this form visibly zero at step = 1, which is
   * the identity the shader needs when the flight is stopped.
   *
   * Note that none of this depends on how many preimages the wrap spans: the
   * chart conjugates the map itself, so the same two coefficients carry one turn
   * or five, and the error is set by the frame's radius rather than by the
   * distance travelled. The cubic is worth its two multiplies — at the altitude
   * this mode flies at it takes the mismatch across a wrap from about two
   * percent of the frame radius to about a half. Neither term rescues a *wide*
   * view: the series is about a neighbourhood of the fixed point and says
   * nothing at the rim of the whole set, which is why the flight and a wide zoom
   * are not offered as a pair anywhere in this engine.
   */
  const a2 = cdiv(one, cmul(lambda, csub(one, lambda)));
  const lambda2 = cmul(lambda, lambda);
  const a3 = cdiv(csub(cmul([2, 0], cmul(a2, lambda)), [2, 0]), cmul(lambda2, csub(one, lambda2)));
  const rise = cmul(step, csub(one, step));
  const warp = cmul(a2, rise);
  const warp3 = cmul(rise, csub(cmul(a3, cadd(one, step)), cmul([2, 0], cmul(cmul(a2, a2), step))));

  return { m, beta, step, warp, warp3 };
}
