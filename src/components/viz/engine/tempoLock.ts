import type { AudioFrame } from "./AudioReactor";
import { BEATS_PER_BAR } from "./AudioReactor";

/**
 * The composition's own durations, put in tempo — §5 of
 * `docs/visualizer-audio-reach.md`, and the one piece of this feature that adds
 * no motion whatsoever.
 *
 * ## Why this is the safest thing here
 *
 * Every other binding answers the music by *moving* something, and every round
 * of this feature so far has been an argument about how far and how fast that
 * movement may go. This one moves nothing. The engine is full of durations that
 * are currently arbitrary numbers — a trail that half-fades in 1.4 seconds, a
 * fold that turns once every 17, an effect that arrives every 9 — and each of
 * them could be a musical duration instead at no cost in velocity. Nothing gets
 * faster, nothing gains amplitude, nothing can flash. The composition simply
 * starts *being* in tempo rather than reacting to it, which is a thing a viewer
 * feels without being able to name.
 *
 * ## Snapping, not overwriting
 *
 * §5 lists what to "lock to" and reads as though the authored value is replaced
 * — a trail half-life set to one bar, a fold set to one turn per eight. That
 * would be wrong here, and for the reason every other section of both documents
 * keeps arriving at: audio deepens what the preset authored and does not replace
 * it. A preset whose whole character is a very short trail must not have it
 * stretched to two seconds because the music is slow.
 *
 * So the operation is a *snap to the nearest musical multiple*. A trail that
 * half-fades in 1.4s at 120BPM snaps to 1.5s — three-quarters of a bar — and a
 * trail authored at 0.2s snaps to an eighth note. Both stay recognisably what
 * the preset asked for, and both are now in tempo. The largest change any of
 * this can make is half the gap between adjacent musical durations, which for
 * the ratios below is at most about 20%.
 *
 * ## Everything fades
 *
 * `strength` crossfades the snapped value against the authored one on
 * `confidence`, over seconds. Below the lock threshold nothing here has any
 * effect at all and every caller gets its own argument back unchanged, which is
 * both the graceful fallback and the reason this is safe to apply widely.
 */

/**
 * The musical durations a length may snap to, as multiples of a bar.
 *
 * Ratios rather than a continuous grid: what makes a duration feel musical is
 * that it is a simple fraction of the bar, and the gaps between these are what
 * bound how far a snap can move anything. Runs from a sixteenth to eight bars,
 * which covers the engine's whole range from a trail half-life to a layer
 * lifetime.
 */
const DIVISIONS = [
  1 / 16,
  1 / 8,
  1 / 6,
  1 / 4,
  1 / 3,
  1 / 2,
  2 / 3,
  3 / 4,
  1,
  1.5,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
  24,
  32,
  48,
  64,
] as const;

/**
 * Real seconds for the lock to take hold and to let go.
 *
 * Long, and longer than the equivalent crossfade in the binding layer, because
 * what moves here are *time constants*: a trail whose half-life is being
 * retuned shows the change over its own length, so a fast crossfade between two
 * values would be visible as the trail doing something rather than as the trail
 * being a different length. Six seconds is slower than anything downstream can
 * resolve.
 */
const ENGAGE_TAU = 6;

/**
 * Bars outside which a duration is left alone entirely.
 *
 * Sixty-four rather than the eight or sixteen §5 talks in, because the engine's
 * slow end is slower than that section assumes: a layer lifetime runs to ninety
 * seconds and the drift's own period to about a hundred, which at 120BPM are
 * forty-five and fifty bars. Cutting off at sixteen would have left every one of
 * those untouched — the snap would have applied to the fast half of the engine
 * and quietly done nothing to the half where the composition's real structure
 * lives.
 */
const MAX_BARS = 64;

function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}

/**
 * The bar length the composition is currently in, and how much to believe it.
 *
 * One of these lives on the director and is handed to everything that owns a
 * duration. It holds *clock* seconds rather than real ones, because every
 * duration it is asked about is a composition duration and the speed control
 * scales all of them together — a viewer at 2× sees the piece run twice as fast
 * against music that did not, and the durations must follow the piece.
 */
export class TempoLock {
  /** Clock seconds to the bar. Zero until a lock has been held. */
  private bar = 0;
  /** How far the snap is applied, 0..1. */
  private engaged = 0;
  /**
   * Absolute position in bars, fractional — the reactor's own bar count and
   * phase, carried here so the composition can ask *when* as well as *how long*.
   *
   * The gap this closes is the whole of §16. Everything above puts a duration in
   * tempo and nothing puts a *phase* in it, so an effect that swells over exactly
   * four bars still begins on an arbitrary sixteenth and peaks nowhere in
   * particular. A viewer reads sync from coincidence — a visible change landing
   * at the same instant as a beat — and a correct length with a free phase
   * produces no coincidences at all. See `alignedDelay` and `mark`.
   */
  private position = 0;

  /**
   * Fold in one analysed frame. `timeScale` converts the reactor's real seconds
   * into the clock the composition runs on.
   */
  update(frame: AudioFrame | null, reactivity: number, timeScale: number, dt: number): void {
    const live =
      frame !== null &&
      !frame.silent &&
      reactivity > 0 &&
      // The reactor's own lock, with hysteresis, rather than a threshold tested
      // here — and this is the consumer that most needed it. A duration being
      // retuned shows the change over its own length, so a lock that flickered
      // around a single threshold spent six seconds engaging and six letting go
      // over material that never settled either way.
      frame.locked &&
      frame.bpm > 0;

    if (live) {
      // Real seconds per beat into clock seconds per bar. A run at 2× speed
      // covers a bar of music in half a bar of clock, so the durations that
      // should match it are half as long.
      const wanted = ((60 / frame.bpm) * BEATS_PER_BAR) / Math.max(0.05, timeScale);
      // Followed rather than taken, so a tempo estimate that wobbles by a BPM
      // does not retune every duration in the engine several times a second.
      this.bar = this.bar > 0 ? this.bar + (wanted - this.bar) * coefficient(dt, ENGAGE_TAU) : wanted;
      /*
       * Taken from the reactor rather than integrated here, and that is the same
       * decision `AudioBinding` makes about `barPhase` for the same reason: only
       * the reactor knows where beat one is, and a bar position accumulated
       * downstream starts on whichever beat the lock happened to open on. The
       * reactor's own `trackBar` already slides this onto the detected downbeat
       * over several bars, so what arrives here is continuous — a consumer that
       * quantises against it never sees the correction as a skipped boundary.
       */
      this.position = frame.barCount + frame.barPhase;
    } else if (this.bar > 0) {
      /*
       * Free-run through the six seconds `engaged` takes to fade, rather than
       * holding the last position the reactor gave.
       *
       * A frozen position is a stopped clock, and `mark` is an edge detector
       * over it — so every consumer that quantises would silently stop firing
       * for the whole of a fade-out and then be handed a jump when the lock came
       * back. Free-running is what the reactor's own grid does between onsets and
       * for the same reason: a bar with nothing in it is still a bar.
       */
      // `this.bar` is already a clock duration, so the real `dt` has to become
      // one too before the two can be divided.
      this.position += (dt * Math.max(0.05, timeScale)) / this.bar;
    }
    this.engaged += ((live ? 1 : 0) - this.engaged) * coefficient(dt, ENGAGE_TAU);
  }

  /** Whether anything here would change a value. Lets callers skip the work. */
  get active(): boolean {
    return this.engaged > 0.002 && this.bar > 0;
  }

  /** Clock seconds to the bar, or 0 when there is no lock. For callers that
   *  want the length itself rather than a snap. */
  get barSeconds(): number {
    return this.active ? this.bar : 0;
  }

  get strength(): number {
    return this.engaged;
  }

  /**
   * A duration in clock seconds, snapped toward the nearest musical multiple of
   * the bar and blended back against what was asked for.
   *
   * Chosen in log space, because what makes two durations feel like the same
   * duration is their ratio: an absolute nearest would pull everything short
   * toward a sixteenth note and leave the long end untouched.
   */
  duration(seconds: number): number {
    if (!this.active || !(seconds > 0)) return seconds;
    const bars = seconds / this.bar;
    if (bars > MAX_BARS || bars < DIVISIONS[0] * 0.5) return seconds;
    let best = DIVISIONS[0];
    let bestError = Infinity;
    for (const division of DIVISIONS) {
      const error = Math.abs(Math.log(bars / division));
      if (error < bestError) {
        bestError = error;
        best = division;
      }
    }
    return seconds + (best * this.bar - seconds) * this.engaged;
  }

  /**
   * A rate in turns (or cycles) per clock second, snapped so that a whole number
   * of cycles fits a whole number of bars.
   *
   * The quiet one of §5 and possibly the best of them: a fold completing exactly
   * one rotation every eight bars is locked to the music in a way nobody can
   * name and nothing can see as a reaction. It is the reciprocal of `duration`,
   * and it is a separate method only so that the sign survives — a rate may run
   * backwards and a duration may not.
   */
  rate(perSecond: number): number {
    if (!this.active || perSecond === 0) return perSecond;
    const period = this.duration(1 / Math.abs(perSecond));
    if (!(period > 0)) return perSecond;
    return Math.sign(perSecond) / period;
  }

  /**
   * Clock seconds from now to the first `everyBars` boundary at or after
   * `delay` — the scheduling half of §16, and the primitive every discrete
   * gesture in the composition should be going through.
   *
   * The caller keeps its own timing. It says "in about nine seconds" and gets
   * back "in ten and a bit, which is a downbeat", so what the boundary size
   * costs is bounded by that size and nothing else: the composition's own pace
   * survives, and the *instant* it acts on is one the music also acts on.
   *
   * Never returns a delay in the past, and never zero when `delay` is zero and
   * the boundary has just gone by — `ceil` takes the boundary at or after the
   * requested moment, so a caller that asks for "now" and happens to be exactly
   * on one fires immediately rather than waiting a whole period.
   *
   * Unlocked, the argument comes straight back. That is the same graceful
   * fallback `duration` has and it means a caller can route through this
   * unconditionally.
   */
  alignedDelay(delay: number, everyBars: number): number {
    const wanted = Math.max(0, delay);
    if (!this.active) return wanted;
    const every = Math.max(1, Math.round(everyBars));
    const at = this.position + wanted / this.bar;
    const next = Math.ceil(at / every) * every;
    return (next - this.position) * this.bar;
  }

  /**
   * Which `everyBars` period the composition is currently in, or -1 with no
   * lock — the *edge* half of §16.
   *
   * A counter rather than a predicate, so a consumer that stores the last value
   * it saw fires exactly once per boundary however long a frame runs and
   * whatever the frame rate is. `alignedDelay` is for something that wants to be
   * scheduled; this is for something that wants to be told.
   */
  mark(everyBars: number): number {
    if (!this.active) return -1;
    return Math.floor(this.position / Math.max(1, Math.round(everyBars)));
  }

  reset(): void {
    this.bar = 0;
    this.engaged = 0;
    this.position = 0;
  }
}
