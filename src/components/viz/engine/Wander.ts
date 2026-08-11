import type { VizConfig } from "../vizConfig";
import type { Rng } from "./rng";
import type { TempoLock } from "./tempoLock";
import type { PostParams } from "./types";

const TAU = Math.PI * 2;

/**
 * Fold counts the tube steps between. A ladder rather than a range: 7 wedges
 * looks like 6 wedges drawn badly, whereas 6 -> 8 -> 12 reads as the mirror
 * being changed.
 */
const SEGMENT_LADDER = [3, 4, 5, 6, 8, 10, 12, 16];
/** The mirror never opens all the way — the piece stays a kaleidoscope. */
const FOLD_FLOOR = 0.4;
/** Fold under which a segment change may begin, and over which the next is armed. */
const REROLL_FOLD = 0.5;
const REARM_FOLD = 0.78;
/**
 * Rate the live count closes on its target, per clock second. An exponential
 * approach rather than a constant glide: a linear ramp starts and stops with a
 * velocity step, and a wedge count lurching into motion is exactly the kind of
 * event this whole class exists not to produce.
 */
const SEGMENT_EASE = 0.7;
/** Widest excursion of the tube's rotation, radians per clock second. */
const SPIN_MAX = 0.24;
/**
 * How fast the trail's arc may open, as a fraction of the rate the fold itself
 * is turning. Under 1 on purpose: the arc reads as the fold's own smear only
 * while it lags the fold, and the moment it leads, it separates and becomes a
 * second motion the eye has to track.
 */
const TRAIL_FOLLOW = 0.5;
/** What the trail may still do with the tube stopped, radians per frame. */
const TRAIL_FLOOR = 0.0003;
/** Fold depth below which there is no symmetry on screen to be judged against. */
const TRAIL_GOVERNED_FOLD = 0.25;
/**
 * The drift's heading, quantised — §16 of
 * `docs/visualizer-audio-attribution.md`, and the composition's answer to
 * "change direction on a beat".
 *
 * `heading` is one of the slow sines above, so on its own it turns the current
 * through the frame by a couple of degrees a second and *nothing about it is
 * ever an event*. Holding it and re-latching it on a downbeat changes nothing
 * either, for the arithmetic reason worth recording: over two bars the sine has
 * moved by well under a degree, so the latch would deliver a step nobody could
 * see.
 *
 * What makes it legible is quantising the *value* rather than the moment. The
 * heading is rounded to one of eight compass points, so the drift holds a
 * direction for the tens of seconds the sine takes to cross a sector and then
 * changes by a whole eighth of a turn — and that change is held back to the next
 * downbeat. The result is a current through the frame that turns 45° at once, on
 * the beat, a few times a minute.
 *
 * It keeps the rule the rest of this feature holds to: the drift still decides
 * which way, the music only decides when. A run with no lock quantises nothing
 * and gets the continuous sine back exactly as before.
 */
const HEADING_POINTS = 8;
/** Bars the boundary is taken on. One: a direction change is a downbeat event,
 *  and waiting for a phrase would put most of them a bar or more after the sine
 *  actually crossed. */
const HEADING_BARS = 1;
/**
 * Fraction of a bar the turn takes, and the reason this is a glide rather than
 * a cut.
 *
 * An eighth of a turn arriving between two frames is a step in a direction that
 * every panning layer is integrating, which reads as the whole stack being
 * kicked. Over 0.6 of a bar the peak angular rate is `1.5 × (τ/8) / (0.6 × bar)`
 * — at 120BPM about 1 radian a second, which is under the rate the fold already
 * turns at on a preset that runs one.
 */
const HEADING_GLIDE = 0.6;

const TILE_MAX = 0.38;
/** Channel value below which tiling is simply off, so it is absent as often
 *  as it is present rather than always faintly on. */
const TILE_GATE = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A slow, non-repeating wander in [-1, 1].
 *
 * Three incommensurate sines rather than a random walk: it is continuous, it
 * cannot drift off to an extreme and stay there, and it is a pure function of
 * the drift phase — so changing the rate mid-run bends the wander instead of
 * jumping it.
 *
 * The rates are deliberately low and the faster ones carry very little of the
 * amplitude. What bounds the *speed* of the drift is the sum of rate × depth,
 * not any one term: at these values a channel needs the better part of a minute
 * to cross its range, which is the difference between a piece that is slowly
 * becoming something else and one that keeps having things happen to it.
 */
class Channel {
  private readonly rates: number[];
  private readonly phases: number[];

  constructor(rng: Rng) {
    this.rates = [rng.range(0.006, 0.014), rng.range(0.017, 0.033), rng.range(0.04, 0.075)];
    this.phases = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
  }

  /** The slowest of the three, which carries most of the amplitude and is
   *  therefore the period a viewer would name if asked. */
  get slowest(): number {
    return this.rates[0];
  }

  at(phase: number): number {
    // Amplitudes sum to 1, so the value is bounded by [-1, 1] without a clamp.
    return (
      Math.sin(phase * this.rates[0] * TAU + this.phases[0]) * 0.62 +
      Math.sin(phase * this.rates[1] * TAU + this.phases[1]) * 0.27 +
      Math.sin(phase * this.rates[2] * TAU + this.phases[2]) * 0.11
    );
  }
}

const CHANNELS = [
  "fold",
  "tile",
  "spin",
  "twist",
  "bulge",
  "feedback",
  "zoom",
  "pan",
  "rotate",
  "heading",
] as const;

type ChannelName = (typeof CHANNELS)[number];
type ChannelValues = Record<ChannelName, number>;

function zeroValues(): ChannelValues {
  return Object.fromEntries(CHANNELS.map((name) => [name, 0])) as ChannelValues;
}

/** A shared direction for the Ken Burns move, and how tightly layers hold it. */
export interface DriftBias {
  angle: number;
  /** 0 leaves each layer's direction independent, 1 pins them all to `angle`. */
  coherence: number;
}

/**
 * Wanders the composition's own parameters, slowly and continuously.
 *
 * The distinction from the effect cycler is what each one moves. The cycler
 * brings *additional* effects in and out over a piece that is otherwise holding
 * still; this moves the settings the piece is already made of — how deep the
 * fold is, how many wedges, which way the tube turns, how far a layer zooms and
 * which way it drifts. So a mode built on it never sits at one appearance long
 * enough to be read as a still, without ever cutting between appearances
 * either: every channel is a slow continuous curve.
 *
 * Like the cycler it is inert at 0 and forks its stream lazily, so a preset
 * that does not ask for it replays exactly as it did before this existed.
 */
export class Wander {
  private stream: Rng | null = null;
  private channels: Record<ChannelName, Channel> | null = null;
  private values: ChannelValues = zeroValues();
  private phase = 0;
  private amount = 0;
  /** Live count, mid-glide between two rungs of the ladder. */
  private segments = 0;
  private segmentIndex = 0;
  private segmentTarget = 0;
  /** Which way along the ladder the next step goes. */
  private stepDirection = 1;
  private armed = true;
  /** The quantised heading in turns, the one it is turning away from, and how
   *  far through the turn it is. See `HEADING_POINTS`. */
  private heading = 0;
  private headingFrom = 0;
  private headingBlend = 1;
  /** The bar boundary the last turn was taken on, and the sector the drift is
   *  waiting to move to. */
  private headingMark = -1;
  private headingWanted = 0;

  constructor(private readonly forkStream: () => Rng) {}

  /** Advance the drift. `dtClock` is composition seconds, so the speed control
   *  carries the wander with it like everything else.
   *
   *  `tempo`, when a lock is held, puts the drift's own period in tempo — see
   *  `tempoRate`, and note that the snap has to happen here rather than at the
   *  call site because the rate the config carries is a multiplier over
   *  per-channel rates only this object knows. */
  update(dtClock: number, amount: number, rate: number, tempo?: TempoLock): void {
    this.amount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    if (this.amount <= 0) return;

    const channels = this.ensureChannels();
    const dt = Math.max(0, dtClock);
    this.phase += dt * Math.max(0, this.tempoRate(rate, tempo));
    for (const name of CHANNELS) this.values[name] = channels[name].at(this.phase);
    this.stepSegments(dt);
    this.steerHeading(dt, tempo);
  }

  /**
   * The drift's direction, quantised and held to the downbeat. See
   * `HEADING_POINTS`.
   *
   * Two separate things, and they have to be separate: the sine is rounded to a
   * sector *continuously*, so the composition always knows which way it wants to
   * go, and the move to a new sector is *deferred* to the next boundary. A turn
   * therefore lands on a downbeat without the boundary ever being what decides
   * that a turn should happen — the boundary that fires is simply the first one
   * after the drift changed its mind, which is why this can be a once-a-bar test
   * and still not put a turn on every bar.
   */
  private steerHeading(dt: number, tempo?: TempoLock): void {
    const sector = Math.round(this.values.heading * HEADING_POINTS) / HEADING_POINTS;
    const mark = tempo?.mark(HEADING_BARS) ?? -1;

    if (mark < 0) {
      // No lock: the continuous sine, exactly as it was before this existed.
      // Kept up to date rather than frozen so that a lock arriving mid-run finds
      // the heading where the drift left it and turns from there.
      this.heading = this.values.heading;
      this.headingFrom = this.heading;
      this.headingWanted = sector;
      this.headingMark = -1;
      this.headingBlend = 1;
      return;
    }

    if (this.headingMark < 0) {
      // First frame under a lock. Snap to the sector rather than gliding to it:
      // there is nothing on screen yet that came from the old value, and a
      // six-second `TempoLock` engagement has already hidden the difference.
      this.headingMark = mark;
      this.headingWanted = sector;
      this.headingFrom = sector;
      this.heading = sector;
      this.headingBlend = 1;
    } else if (mark !== this.headingMark) {
      this.headingMark = mark;
      if (sector !== this.headingWanted) {
        this.headingFrom = this.heading;
        this.headingWanted = sector;
        this.headingBlend = 0;
      }
    }

    const bar = tempo?.barSeconds ?? 0;
    const glide = bar > 0 ? bar * HEADING_GLIDE : 1;
    this.headingBlend = clamp(this.headingBlend + dt / glide, 0, 1);
    const t = this.headingBlend;
    this.heading =
      this.headingFrom + (this.headingWanted - this.headingFrom) * (t * t * (3 - 2 * t));
  }

  /**
   * The drift's rate, put in tempo — §5 of `docs/visualizer-audio-reach.md`
   * asks for a wander period of eight or sixteen bars.
   *
   * Snapped here rather than at the call site, and that is the whole reason this
   * method exists: `rate` is a multiplier over per-channel rates drawn from the
   * seed, so the period a viewer actually sees is `rate * slowest`, a number
   * only this object holds. Snapping the multiplier alone would have been
   * snapping the wrong quantity — arithmetic that typechecks and locks nothing.
   *
   * The three components keep their ratios, so the drift stays the sum of three
   * incommensurate sines that never repeats; only its overall pace moves, and by
   * at most the gap between two adjacent musical durations.
   */
  private tempoRate(rate: number, tempo?: TempoLock): number {
    if (!tempo?.active || !(rate > 0)) return rate;
    const channels = this.channels;
    if (!channels) return rate;
    const slowest = channels[CHANNELS[0]].slowest;
    if (!(slowest > 0)) return rate;
    return tempo.rate(rate * slowest) / slowest;
  }

  reset(): void {
    this.phase = 0;
    this.values = zeroValues();
    this.segments = 0;
    this.armed = true;
    this.heading = 0;
    this.headingFrom = 0;
    this.headingWanted = 0;
    this.headingBlend = 1;
    this.headingMark = -1;
  }

  /** Mutates `post` toward wherever the drift currently is. */
  applyPost(post: PostParams): void {
    const a = this.amount;
    if (a <= 0) return;
    const v = this.values;

    // The fold breathes: mostly deep, opening now and then far enough to show
    // the panels as panels before closing back over them.
    post.kaleido += (this.foldTarget - post.kaleido) * a;
    // Not blended toward the preset's count the way the amounts are: a
    // non-integer number of wedges leaves a seam where the last one fails to
    // close, so this is the one value that has to arrive whole.
    post.kaleidoSegments = clamp(this.segments, 2, 16);
    // Crosses zero, so the tube slows to a stop and turns back rather than
    // grinding one way for the whole run.
    post.kaleidoSpin += (v.spin * SPIN_MAX - post.kaleidoSpin) * a;

    // Smoothstepped past the gate rather than ramped straight off it: tiling is
    // a scale, so a linear ramp out of zero is a zoom that starts at full speed.
    const gated = clamp((v.tile - TILE_GATE) / (1 - TILE_GATE), 0, 1);
    post.tile = Math.max(post.tile, a * gated * gated * (3 - 2 * gated) * TILE_MAX);
    post.twist = clamp(post.twist + a * v.twist * 0.28, -1, 1);
    post.bulge = clamp(post.bulge + a * v.bulge * 0.2, -1, 1);
    // The trails turn with the tube — off the same channel, so the smear and
    // the symmetry are never rotating against each other. Kept small: this is
    // an offset applied to every feedback tap, so it compounds down the trail
    // and a value that looks modest here reads as a hard spiral on screen.
    post.feedbackRotate += a * v.spin * 0.0015;
    // Kept under the ceiling the cycler's smear uses, and for the same reason:
    // the post chain keeps trails with max(), so high retention over light
    // comic pages bleaches the frame and stays bleached.
    post.feedbackAmount = clamp(post.feedbackAmount * (1 + a * v.feedback * 0.18), 0, 0.8);
  }

  /**
   * Last word on the frame's trail, after everything else has had its say.
   *
   * `feedbackRotate` is an angle applied to every tap of the feedback chain, so
   * what it produces on screen is an arc, and the speed that arc opens at has
   * no relation to anything else in the frame — it is per *frame*, where the
   * fold's rotation is per second, and the cycler's smear pulse adds its own
   * from an unrelated draw halfway through a swell. Against a running
   * kaleidoscope that is an angle unfolding at one speed inside a symmetry
   * turning at another, which is read as a jolt however smoothly each of them
   * arrived on its own.
   *
   * So the trail is held to the fold: it may sweep, but never faster than the
   * thing it is smearing turns. `clockDt` is what makes that a comparison of
   * rates rather than of unlike units — and incidentally makes the trail
   * frame-rate independent, which on its own it is not.
   */
  settle(post: PostParams, clockDt: number): void {
    if (this.amount <= 0 || post.kaleido <= TRAIL_GOVERNED_FOLD) return;
    const foldStep = Math.abs(post.kaleidoSpin) * Math.max(0, clockDt);
    const ceiling = TRAIL_FLOOR + TRAIL_FOLLOW * foldStep;
    post.feedbackRotate = clamp(post.feedbackRotate, -ceiling, ceiling);
  }

  /**
   * The config a layer being born right now should be built from. Returns the
   * caller's object untouched when the drift is off, so nothing allocates and
   * nothing changes for a preset that does not use it.
   */
  spawnConfig(config: VizConfig): VizConfig {
    if (this.amount <= 0) return config;
    const v = this.values;
    // Shallow by design: the scene only reads the config, and post/weights are
    // not among the fields the drift touches.
    return {
      ...config,
      // Lifetime rides the same channel as the zoom, in the same direction, so
      // a layer given a deeper move is also given longer to make it. Off its
      // own channel the two would eventually line up the wrong way — the
      // deepest zoom on the shortest life — and that one layer would be the
      // fastest thing in the piece by a distance.
      layerLifetime: config.layerLifetime * this.span(v.zoom, 0.85, 1.35),
      // Zoom wanders in depth rather than in absolute value, so 1 (no move)
      // stays no move however far the drift swings.
      zoomAmount: clamp(1 + (config.zoomAmount - 1) * this.span(v.zoom, 0.45, 1.5), 1, 2.5),
      panAmount: clamp(config.panAmount * this.span(v.pan, 0.4, 1.8), 0, 0.45),
      rotateAmount: clamp(config.rotateAmount * this.span(v.rotate, 0.2, 2), 0, 0.35),
    };
  }

  /**
   * Where layers should drift, for scenes that will take the hint. Successive
   * layers moving roughly together — with the shared heading itself turning and
   * reversing — reads as a current through the frame, where independently
   * random directions per layer average out to no motion at all.
   */
  bias(): DriftBias | undefined {
    if (this.amount <= 0) return undefined;
    return {
      // The quantised heading rather than the raw channel — see `steerHeading`.
      // Identical to `values.heading` whenever there is no lock.
      angle: this.heading * TAU,
      coherence: this.amount * (0.3 + 0.5 * (0.5 + 0.5 * this.values.pan)),
    };
  }

  /** Where the fold wants to be, before it is blended against the preset's. */
  private get foldTarget(): number {
    const t = 0.5 + 0.5 * this.values.fold;
    // Biased toward the top of the range: the openings are punctuation, not
    // half the run.
    const shaped = 1 - (1 - t) ** 1.6;
    return FOLD_FLOOR + (1 - FOLD_FLOOR) * shaped;
  }

  private get rng(): Rng {
    return (this.stream ??= this.forkStream());
  }

  private ensureChannels(): Record<ChannelName, Channel> {
    if (!this.channels) {
      const rng = this.rng;
      this.channels = Object.fromEntries(
        CHANNELS.map((name) => [name, new Channel(rng)])
      ) as Record<ChannelName, Channel>;
    }
    return this.channels;
  }

  /**
   * Steps the fold count up and down the ladder, but only while the mirror is
   * shallow. A change in wedge count is a geometric jump wherever it lands, and
   * the brief non-integer counts the glide passes through leave a visible seam
   * — both are invisible at a fold of 0.5 and unmissable at 1.
   */
  private stepSegments(dtClock: number): void {
    const rng = this.rng;
    if (this.segments === 0) {
      this.segmentIndex = rng.int(SEGMENT_LADDER.length);
      this.segments = this.segmentTarget = SEGMENT_LADDER[this.segmentIndex];
    }

    const fold = this.foldTarget;
    if (fold > REARM_FOLD) {
      // One change per opening: without the hysteresis a long shallow stretch
      // would keep re-rolling the moment each glide finished.
      this.armed = true;
    } else if (this.armed && fold < REROLL_FOLD && this.segments === this.segmentTarget) {
      this.armed = false;
      // Walks the ladder rather than jumping around it, so a run of steps in
      // one direction reads as the tube opening out or closing down. The
      // direction only flips occasionally, and at either end.
      if (rng.bool(0.3)) this.stepDirection = -this.stepDirection;
      const stride = rng.bool(0.75) ? 1 : 2;
      let next = this.segmentIndex + this.stepDirection * stride;
      if (next < 0 || next >= SEGMENT_LADDER.length) {
        this.stepDirection = -this.stepDirection;
        next = this.segmentIndex + this.stepDirection * stride;
      }
      this.segmentIndex = clamp(next, 0, SEGMENT_LADDER.length - 1);
      this.segmentTarget = SEGMENT_LADDER[this.segmentIndex];
    }

    const delta = this.segmentTarget - this.segments;
    // Snapped once it is within a hundredth of a wedge, both because the count
    // has to land on a whole number to close and because the re-roll above
    // waits on the two being equal.
    if (Math.abs(delta) < 0.01) this.segments = this.segmentTarget;
    else this.segments += delta * (1 - Math.exp(-SEGMENT_EASE * dtClock));
  }

  /**
   * A channel mapped to a multiplier wandering between `low` and `high`, which
   * collapses to 1 — the value as authored — when the drift is off.
   */
  private span(channel: number, low: number, high: number): number {
    const t = 0.5 + 0.5 * channel;
    return 1 + this.amount * (low + (high - low) * t - 1);
  }
}
