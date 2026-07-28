import type { Rng } from "./rng";
import type { SafetyGovernor } from "./safety";
import type { PostParams } from "./types";

/**
 * One effect the cycler can bring in and out.
 *
 * `apply` mutates the frame's post params rather than returning a delta, so
 * two overlapping pulses can decide for themselves how they combine — the
 * distortions take the larger of the two, the additive ones accumulate.
 */
interface PsychEffect {
  id: string;
  /** Relative chance of being drawn. */
  weight: number;
  /** Per-pulse parameters, drawn once at onset so a pulse holds its own shape
   *  for its whole life instead of shimmering between values every frame. */
  init(rng: Rng): number[];
  /** `k` is the envelope, already scaled by the pulse's peak. */
  apply(post: PostParams, k: number, time: number, args: number[]): void;
}

/** Most concurrent pulses, at psychedelia 1. */
const MAX_CONCURRENT = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A slow oscillation for the effects that breathe rather than just arrive. */
function osc(time: number, rate: number, phase = 0): number {
  return Math.sin(time * rate * Math.PI * 2 + phase);
}

/**
 * The pool. Weights are deliberately uneven: the coordinate warps read as the
 * piece moving, so they can run often, while the ones that restate the whole
 * palette (solarize, posterize, halftone) are rarer punctuation.
 */
const EFFECTS: PsychEffect[] = [
  // --- geometric ------------------------------------------------------------
  {
    id: "kaleido",
    weight: 1,
    init: (rng) => [rng.pick([4, 5, 6, 8, 10, 12])],
    apply: (post, k, _time, [segments]) => {
      const amount = k * 0.92;
      if (amount <= post.kaleido) return;
      post.kaleido = amount;
      post.kaleidoSegments = segments;
    },
  },
  {
    id: "tile",
    weight: 0.6,
    init: (rng) => [rng.range(0.3, 0.85)],
    apply: (post, k, _time, [depth]) => {
      post.tile = Math.max(post.tile, k * depth);
    },
  },
  // --- undulating -----------------------------------------------------------
  {
    id: "warp",
    weight: 1.1,
    init: (rng) => [rng.range(1.2, 5), rng.range(0.15, 0.7)],
    apply: (post, k, _time, [scale, speed]) => {
      const amount = k * 0.75;
      if (amount <= post.warp) return;
      post.warp = amount;
      post.warpScale = scale;
      post.warpSpeed = speed;
    },
  },
  {
    id: "ripple",
    weight: 0.9,
    init: (rng) => [rng.range(8, 40)],
    apply: (post, k, _time, [freq]) => {
      const amount = k * 0.8;
      if (amount <= post.ripple) return;
      post.ripple = amount;
      post.rippleFreq = freq;
    },
  },
  {
    id: "twist",
    weight: 0.8,
    init: (rng) => [rng.bool() ? 1 : -1, rng.range(0.03, 0.11)],
    apply: (post, k, time, [direction, rate]) => {
      // Unwinds and rewinds rather than holding a fixed shear, so the frame
      // never settles into a still.
      const swell = 0.5 + 0.5 * osc(time, rate);
      post.twist = clamp(post.twist + k * direction * swell, -1, 1);
    },
  },
  {
    id: "bulge",
    weight: 0.7,
    init: (rng) => [rng.range(0.04, 0.12), rng.range(0, Math.PI * 2)],
    apply: (post, k, time, [rate, phase]) => {
      post.bulge = clamp(post.bulge + k * 0.6 * osc(time, rate, phase), -1, 1);
    },
  },
  // --- surreal --------------------------------------------------------------
  {
    id: "solarize",
    weight: 0.7,
    init: (rng) => [rng.range(0.5, 0.9)],
    apply: (post, k, _time, [peak]) => {
      post.solarize = Math.min(1, Math.max(post.solarize, k * peak));
    },
  },
  {
    id: "hue-sweep",
    weight: 0.9,
    init: (rng) => [rng.bool() ? 1 : -1, rng.range(0.02, 0.07)],
    apply: (post, k, time, [direction, rate]) => {
      post.hueShift += k * direction * osc(time, rate) * 0.9;
    },
  },
  {
    id: "chroma-bloom",
    weight: 0.7,
    init: (rng) => [rng.range(0.4, 0.9)],
    apply: (post, k, _time, [depth]) => {
      post.chroma = Math.min(1.5, post.chroma + k * depth);
    },
  },
  {
    id: "posterize",
    weight: 0.6,
    init: (rng) => [rng.range(0.35, 0.85)],
    apply: (post, k, _time, [depth]) => {
      post.posterize = Math.min(1, Math.max(post.posterize, k * depth));
    },
  },
  {
    id: "halftone",
    weight: 0.5,
    init: (rng) => [rng.range(0.6, 1.8)],
    apply: (post, k, _time, [scale]) => {
      const amount = k * 0.8;
      if (amount <= post.halftone) return;
      post.halftone = amount;
      post.halftoneScale = scale;
    },
  },
  {
    id: "smear",
    weight: 0.8,
    init: (rng) => [rng.range(-0.006, 0.006), rng.range(0.004, 0.016)],
    apply: (post, k, _time, [spin, grow]) => {
      // Additive on top of whatever the preset already runs: a piece that is
      // already smearing goes further rather than snapping to a fixed value.
      // The ceiling is well under the config's: the post chain keeps trails
      // with max() rather than mix(), so retention near 1 has no decay and a
      // wall of light comic panels bleaches the frame to white and stays there.
      post.feedbackAmount = Math.min(0.82, post.feedbackAmount + k * 0.25);
      post.feedbackScale += k * grow;
      post.feedbackRotate += k * spin;
    },
  },
];

interface Pulse {
  effect: number;
  /** Clock seconds. */
  start: number;
  attack: number;
  hold: number;
  release: number;
  /** Ceiling of the envelope, 0..1. */
  peak: number;
  args: number[];
}

function duration(pulse: Pulse): number {
  return pulse.attack + pulse.hold + pulse.release;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function envelope(pulse: Pulse, time: number): number {
  const age = time - pulse.start;
  if (age <= 0) return 0;
  if (age < pulse.attack) return smooth(age / pulse.attack) * pulse.peak;
  const held = pulse.attack + pulse.hold;
  if (age < held) return pulse.peak;
  const out = (age - held) / pulse.release;
  if (out >= 1) return 0;
  return smooth(1 - out) * pulse.peak;
}

/**
 * Brings psychedelic effects in and out at random, one or a few at a time.
 *
 * The point is that no single frame is the piece: an effect swells over
 * several seconds, holds long enough to stop reading as a transition, and
 * recedes, and what is running when is never quite the same twice. Every
 * choice comes from a seeded stream, so a run is still reproducible from its
 * URL.
 *
 * Its rng is forked lazily, on the first pulse it actually schedules. A preset
 * that leaves psychedelia at 0 therefore never draws from the director's
 * stream at all, and replays frame-for-frame as it did before this existed.
 */
export class EffectCycler {
  private stream: Rng | null = null;
  private readonly active: Pulse[] = [];
  private nextOnset = -1;

  constructor(
    private readonly forkStream: () => Rng,
    private readonly safety: SafetyGovernor
  ) {}

  /** Mutates `post` in place with whatever is currently running. */
  apply(post: PostParams, time: number, intensity: number, interval: number): void {
    const amount = clamp(intensity, 0, 1);

    for (let i = this.active.length - 1; i >= 0; i--) {
      if (time - this.active[i].start >= duration(this.active[i])) this.active.splice(i, 1);
    }

    if (amount <= 0) {
      // Turned off mid-run: stop scheduling, but let what is already running
      // ride out its release. Dropping the pulses here would be a step change
      // in whole-frame luminance, which is the one thing nothing may do.
      this.nextOnset = -1;
    } else {
      // Open on something rather than a wait, but not on everything at once.
      if (this.nextOnset < 0) this.nextOnset = time + this.gap(amount, interval) * 0.35;

      const concurrent = 1 + Math.round(amount * (MAX_CONCURRENT - 1));
      while (time >= this.nextOnset) {
        // A slot that is already full drops its turn instead of queueing it,
        // so a busy stretch stays busy rather than building a backlog that
        // all lands at once when the stack clears.
        if (this.active.length < concurrent) this.begin(time, amount);
        this.nextOnset += this.gap(amount, interval);
      }
    }

    for (const pulse of this.active) {
      const k = envelope(pulse, time);
      if (k > 0) EFFECTS[pulse.effect].apply(post, k, time, pulse.args);
    }
  }

  reset(): void {
    this.active.length = 0;
    this.nextOnset = -1;
  }

  private get rng(): Rng {
    return (this.stream ??= this.forkStream());
  }

  private begin(time: number, amount: number): void {
    const rng = this.rng;
    // Weight out anything already running: two pulses of the same effect would
    // just be one louder pulse.
    const running = new Set(this.active.map((pulse) => pulse.effect));
    const effect = rng.weightedIndex(
      EFFECTS.map((entry, index) => (running.has(index) ? 0 : entry.weight))
    );

    this.active.push({
      effect,
      start: time,
      // The ramps are the safety-critical part; the governor floors them.
      attack: this.safety.clampRamp(rng.range(2.5, 7)),
      release: this.safety.clampRamp(rng.range(3, 9)),
      // More psychedelia holds longer as well as stacking deeper, so a high
      // setting reads as a state the piece is in rather than a flicker.
      hold: rng.range(5, 18) * (0.6 + amount * 0.8),
      peak: amount * rng.range(0.55, 1),
      args: EFFECTS[effect].init(rng),
    });
  }

  private gap(amount: number, interval: number): number {
    const base = Math.max(2, interval) * (1.35 - amount * 0.7);
    return base * this.rng.range(0.65, 1.45);
  }
}
