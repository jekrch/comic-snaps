import type { AudioFrame } from "./AudioReactor";
import { LOCK_THRESHOLD } from "./AudioReactor";
import type { SafetyGovernor } from "./safety";
import type { PostParams } from "./types";

/**
 * What the music does to the composition — the binding layer of
 * `docs/visualizer-audio-plan.md` §4, restructured along
 * `docs/visualizer-audio-reach.md` §4.2 and §4.3.
 *
 * Held apart from the director for the same reason `Wander` and `EffectCycler`
 * are: it is one more pass over the parameters the config authored, and the
 * order it runs in matters more than what it contains.
 *
 * ## Why this was rewritten
 *
 * The previous arrangement measured well and did almost nothing, and the reason
 * was arithmetic rather than taste. Every channel here is a one-pole filter, so
 * its attenuation at a given rate is calculable: at 120 BPM the band envelope
 * passed about half the beat, the swell envelope about a sixth of that, and the
 * six-tap cascade underneath it another twentieth. The geometry bindings, on the
 * last tap, were receiving roughly half a percent of the beat. They were not
 * responding weakly; they were not responding.
 *
 * The instinct that produced that — v1 read as a flinch, so everything was
 * slowed down — was right about the problem and wrong about the mechanism. In a
 * chain of one-poles, *rate and depth are the same knob*, so slowing the
 * response also emptied it, and no setting of `reactivity` could recover one
 * without the other.
 *
 * ## Two ideas replace it
 *
 * **Match the timescale of the parameter to the timescale of the event.** Jerk
 * is not caused by responding on the beat; it is caused by responding on the
 * beat with a parameter that moves the *picture*, because geometric velocity is
 * what the eye reads as a flinch. So there is a hierarchy, and the previous
 * version had it exactly inverted:
 *
 * - **Beat rate**, 1–4Hz → colour, tone, print artefacts, and the *compounding*
 *   trail terms. None of these have on-screen velocity. A hue step cannot read
 *   as motion however fast it arrives, and a trail zoom applied a thousandth at
 *   a time accumulates into a large visible change without anything on screen
 *   ever moving quickly.
 * - **Bar rate**, ~0.5Hz → the geometry. Frame scale, the spatial rates, the
 *   depth of whatever distortion the preset is running. Slow enough that a much
 *   larger amplitude still has a lower peak velocity than the old one did.
 * - **Phrase**, ~0.05Hz → the amplitude of both of the above, so the piece is
 *   never quite as responsive as it was thirty seconds ago.
 *
 * **Synthesise the motion; do not filter it.** Rather than smoothing an energy
 * signal until it is safe — which is what cost the amplitude — the shapes below
 * are *generated* from the reactor's phase-locked grid and only their amplitude
 * is taken from energy. A raised cosine over a bar is continuous in value and in
 * derivative by construction, carries its full depth at bar rate, and, because
 * `beatPhase` predicts rather than reports, can peak *just before* the beat
 * rather than chasing it. That is the same anticipation the fade lead in
 * `Director.beatIndex` already relies on, and it is what makes a slow medium
 * read as locked to fast music.
 *
 * The energy channels are still here. They carry the response on material the
 * beat tracker will not lock to, and the two paths crossfade on `confidence`.
 */

// --- the synthesised grid ---------------------------------------------------

/**
 * Real seconds for the synthesised path to take over from the energy path when
 * the lock is gained, and to hand it back when the lock is lost.
 *
 * Long, because this is a crossfade between two ways of moving rather than a
 * switch between two values, and a lock that flickers around the threshold must
 * not show as the composition changing its mind.
 */
const LOCK_FADE = 1.5;
/**
 * Real seconds of smoothing over the generated shapes.
 *
 * Not there to shape anything — the shapes are already smooth — but to absorb
 * the phase-locked loop's own corrections. `AudioReactor.lockPhase` nudges the
 * grid by up to 12% of the phase error on every onset, which is a small step in
 * the phase and therefore a small step in anything read from it. At 50ms this
 * costs the bar shape 1% of its amplitude and the beat shape about 13%, which is
 * the right place to spend it.
 */
const SHAPE_SMOOTH = 0.05;

/** Beats to a bar. Nothing here finds the downbeat — four is the overwhelmingly
 *  common answer, and being wrong costs a gesture landing on the wrong beat of
 *  the bar rather than out of tempo. See §3.4 of the reach document. */
const BEATS_PER_BAR = 4;
/** Bars to a phrase, and a second period that shares no factor with it. Two
 *  raised cosines at 8 and 5 bars sum to something that does not repeat for
 *  forty — which is the cheapest way to have a slow channel that nobody can
 *  ever see as a cycle. */
const BARS_PER_PHRASE = 8;
const BARS_PER_PHRASE_ALT = 5;

/**
 * The beat pulse, as a position and two widths in fractions of a beat.
 *
 * Peaks just *before* the beat rather than on it. This is anticipation, and it
 * is the difference between a composition that follows the music and one that
 * arrives with it: the rise is the longer half, so the frame is already at its
 * maximum as the beat lands and is on its way out by the time the next one is
 * approaching. Reversing the two — fast attack on the beat, slow decay after —
 * is the classic sidechain pump, and it is exactly the discontinuity in the
 * derivative that v1 read as a flinch.
 *
 * Rise plus fall is under 1, so there is a rest between pulses rather than a
 * continuous oscillation. A channel with no rest in it reads as a level.
 */
const BEAT_PEAK = 0.96;
const BEAT_RISE = 0.5;
const BEAT_FALL = 0.28;

/** The bar breath. The same shape an octave and a half slower, filling nearly
 *  the whole bar — this one is meant to be continuous, because it is carrying
 *  the geometry and geometry that stops moving reads as a stall. */
const BAR_PEAK = 0.97;
const BAR_RISE = 0.62;
const BAR_FALL = 0.36;

/**
 * How much of the shapes' amplitude is present regardless of energy, 0..1.
 *
 * Not zero, and this is the answer to the complaint that started the rewrite. If
 * amplitude came only from energy then a quiet, steady, perfectly locked passage
 * would produce no motion at all — which is the failure the DC removal walked
 * into from the other direction. A grid the reactor is confident about is itself
 * a reason to move; energy decides how much more.
 */
const SHAPE_FLOOR = 0.45;
/**
 * Real seconds the amplitude takes to follow the energy, and the constant that
 * makes the whole scheme work.
 *
 * The amplitude is derived from the swell, and the swell has a 0.3s attack — so
 * without this it carries plenty of beat-rate content of its own, and a smooth
 * bar shape multiplied by a signal that steps on every kick is not a smooth
 * signal. Measured before it was added: 375%/s peak on the flight gain and
 * 23%/s on the frame scale, both from the amplitude edge rather than from the
 * shape, and both worse than the version this replaced.
 *
 * At two seconds the amplitude passes about 1% of the beat and all of a chorus
 * arriving, which is the split the hierarchy asks for: energy decides how far
 * the piece travels, the grid decides when.
 */
const AMPLITUDE_TAU = 2;
/** How far apart in the bar successive layers read the breath. See `spread`. */
const SPREAD_BARS = 0.085;
/** Layers before the spread wraps. Six was the old tap count and reads well —
 *  far enough that the stack is legibly a wave, near enough that the two ends
 *  of it are still the same gesture. */
const SPREAD_SLOTS = 6;

// --- the energy channels ----------------------------------------------------
// Still the whole response on material with no beat in it, and the source of
// the amplitude on material that has one.

/** Real seconds. The swell is no longer asked to *be* the motion, only to say
 *  how far it should travel, so these can stay slow without costing anything. */
const SWELL_ATTACK = 0.3;
const SWELL_RELEASE = 0.95;
/**
 * The baseline the swell's excursion is measured against, real seconds — and it
 * is now removed in full.
 *
 * Only 55% of it used to be, and that compromise was the visible symptom of two
 * mechanisms doing one job badly. A subtraction of a running mean is a
 * high-pass, which is the right operation for an *event* channel, where "louder
 * than a moment ago" is the whole content, and the wrong one for a *level*,
 * because a steady groove has a steady mean and subtracting all of it leaves
 * nothing exactly where the music is most regular. Asked to be both, the swell
 * was mediocre at each and the mix was where the two failures balanced.
 *
 * It is now purely the event channel — removed in full, so a rest reads as zero
 * — and the level it used to half-carry comes from `AudioFrame.loudness`, which
 * is a ratio and therefore does not go dead on steady material. See `dynamics`.
 */
const SWELL_BASELINE = 6;
/**
 * The transfer curve the excursion goes through, in place of a gain and a
 * clamp — §4.4 of the reach document.
 *
 * The pair it replaces was a square wave. At a gain of 3.6 everything above the
 * baseline saturated: measured at 0.01–0.10 between beats and 0.94 on the kick,
 * whatever size that kick was. That is the same failure the plan's §13 found and
 * fixed in `onsetStrength`, one level downstream, and it survived here untouched
 * — a light hit and a heavy one arrived identical, so the channel had two states
 * and a channel with two states is not a channel.
 *
 * `SWELL_GATE` is a soft downward expansion at the bottom, so what is left of a
 * rest is pushed toward zero rather than amplified along with everything else,
 * and the curve leaves zero with zero slope rather than with the full gain.
 * Above `SWELL_KNEE` it asymptotes rather than clamping, so a heavier hit is
 * always a bigger number than a lighter one however hard either is hit.
 */
const SWELL_GATE = 0.012;
const SWELL_GAIN = 11;
const SWELL_KNEE = 0.55;

/** Air and melody, each on a time constant of its own and neither on the
 *  beat's. Nothing here should peak when anything else does. */
const SHIMMER_TAU = 0.5;
const TIDE_TAU = 1.7;

// --- the depth multiplier ---------------------------------------------------

/**
 * How the music's own dynamics reach the composition — §3.2 of the reach
 * document, and the answer to a verse and a chorus looking identical.
 *
 * Every other channel here takes its *shape* from bands the reactor normalised
 * against their own recent range, which is what lets this feature work on any
 * source at any distance from any speaker and is also what deletes the loudest
 * thing music does. `AudioFrame.loudness` is the one figure that escapes that
 * normalisation, and this is where it is spent: not on shape, only on how far
 * the shapes are allowed to travel.
 *
 * Slow, for the reason `AMPLITUDE_TAU` is slow. A depth multiplier with
 * beat-rate content in it multiplies two signals that both step on the kick, and
 * the product of those is the flinch the whole hierarchy exists to avoid — the
 * split only holds if the two are separated in frequency.
 */
const DYNAMICS_TAU = 3;
/**
 * How much of the ratio is passed through, as an exponent rather than a slope.
 *
 * A power law because the quantity is a ratio and its neutral is 1: an exponent
 * treats a halving and a doubling as the same size of event in opposite
 * directions, where a linear slope makes the quiet side of the music a much
 * smaller gesture than the loud side by construction.
 *
 * Well under 1, because the change is meant to read as the piece opening up
 * rather than as a different preset arriving. A 5dB lift into a chorus — about
 * as much as popular music usually offers — is a ratio of 1.8 and arrives here
 * as 1.3.
 */
const DYNAMICS_EXPONENT = 0.45;
const DYNAMICS_MIN = 0.45;
const DYNAMICS_MAX = 1.35;

/**
 * Real seconds of swell history kept for the per-layer spread on the *energy*
 * path, and how far apart successive layers read it.
 *
 * A ring buffer rather than the cascade of one-poles this replaces. The cascade
 * was introduced to stop the flat layers moving as one sheet and it did that,
 * but a chain of low-pass filters is not a delay line: by the fifth tap it was
 * passing 3% of the beat. A delay has the same amplitude at every tap, which is
 * the only property the spread ever wanted.
 */
const HISTORY = 64;
const SPREAD_SECONDS = 0.075;

// --- the accent -------------------------------------------------------------

/** Minimum real seconds between accents. Unchanged: what made accents invisible
 *  was never their rarity, it was that they were spent on a 1% frame scale. */
const ACCENT_MIN_GAP = 6;
/** How far over the recent average an onset must be to earn one. */
const ACCENT_RATIO = 1.75;
/** Short but deliberately not instant — at zero it moved the whole frame by
 *  more than a percent between two frames, which is a snap rather than a hit. */
const ACCENT_ATTACK = 0.07;
const ACCENT_RELEASE = 0.6;
/** How fast the running average of onset strength follows, per onset. */
const ACCENT_MEMORY = 0.12;

// --- depths, fast row -------------------------------------------------------
// Colour, tone, and the trail terms that compound. Everything here may run at
// beat rate because none of it can move the picture: a hue step has no velocity,
// and a trail zoom is applied a thousandth at a time to a buffer that
// accumulates it over hundreds of frames.

/**
 * Trail zoom added at full beat pulse.
 *
 * Still the smallest number here and still the one doing the most work, because
 * it compounds through the feedback buffer every frame rather than being applied
 * once. Against a default `feedbackScale` deviation of 0.006 this more than
 * doubles the trail's stride on the beat — which is a large visible change with
 * no on-screen velocity anywhere, and is exactly what the fast row is for.
 */
const PUMP_SCALE = 0.012;
/** Trail rotation, off the accent — a turn is a gesture, and a permanent one is
 *  just a spin. */
const PUMP_ROTATE = 0.004;
/** Colour opening on the beat, over the slower opening on the melody. */
const CHROMA_BEAT = 0.45;
const CHROMA_TIDE = 0.5;
/** Turns of hue on the beat pulse. Tiny, and free: hue is the one channel where
 *  a fast change cannot read as motion. */
const HUE_BEAT = 0.004;
/** Texture crackling on the air. */
const GRAIN_DEPTH = 1.2;
/** Turns of hue per bar. Over a few minutes this is the colour of the piece
 *  walking with the music, not a light show. */
const HUE_PER_BAR = 0.016;

// --- depths, bar row --------------------------------------------------------
// The geometry, at a quarter of the rate the old bindings ran at and several
// times their depth. The trade is deliberate and it is the whole thesis: peak
// velocity, not amplitude, is what has to be budgeted.

/**
 * Scale of the whole flat composition at full breath.
 *
 * Only ever upward, so a full-bleed layer never pulls its own edge into frame.
 * Nearly half again the old figure — and at a quarter of the rate, so peak
 * velocity works out around 7%/s against the 11%/s the previous version was
 * measured at and considered smooth.
 */
const PULSE_BAR = 0.055;
/** And the accent on top, undelayed and on every layer at once. Being rare, it
 *  is allowed to be the one thing that moves together. */
const PULSE_ACCENT = 0.011;
/** Gain on the spatial rates. These move the composition rather than process it,
 *  and being integrated they bend rather than jump — which is what lets them
 *  carry twice what they did. */
const FLIGHT_DEPTH = 0.9;
const SPIN_DEPTH = 0.55;
/** How far a distortion the preset already asked for is deepened. */
const GEOMETRY_DEPTH = 0.5;
/** Multiplier added to the trail's depth at full breath. Luminance-affecting,
 *  so it runs off the slew-limited drive rather than the raw channel. */
const TRAIL_DEPTH = 0.4;
const BLOOM_DEPTH = 0.4;
/** Additive, and small: the vignette is the frame's own edge and a viewer reads
 *  a change in it as the picture breathing rather than as an effect. */
const VIGNETTE_DEPTH = 0.1;

// --- depths, phrase row -----------------------------------------------------

/** How far the phrase channel moves the amplitude of everything above it, ±.
 *  The piece is never quite as responsive as it was a minute ago, and there is
 *  no period a viewer can find in it. */
const PHRASE_SWING = 0.28;

// --- the print lift ---------------------------------------------------------

/**
 * The one place the music is allowed to introduce an effect the preset did not
 * ask for, and the argument for the exception.
 *
 * The rule everywhere else is that zero means off and audio may only deepen what
 * the composition already runs — which is right, and protects every preset from
 * having a fold switched on by a kick drum. But the fast row of the hierarchy
 * above needs somewhere to go, and on a default preset the only always-live
 * parameters in the whole of `PostParams` are the trail terms, `chroma`, `grain`
 * and `vignette`. Everything else the fast row wants — `misreg`, `bleed`,
 * `krackle` — is 0 in `DEFAULT_POST`, so a strictly multiplicative binding is
 * multiplying by zero exactly as §12 of the plan found the first time.
 *
 * The press artefacts are a different class from the folds, and that is what
 * makes the exception defensible rather than a hole in the rule. They cannot
 * flash, they cannot restructure the frame, they do not move the picture, and a
 * comic visualiser answering music with a press drifting out of register is the
 * most on-theme response available to it. What the rule was protecting — the
 * composition's own geometry — is untouched.
 *
 * It is still a knob, and still one the config carries, so a preset that wants
 * none of it can say so.
 */
const MISREG_LIFT = 1;
const BLEED_LIFT = 0.5;
const KRACKLE_LIFT = 0.45;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Frame-rate independent one-pole coefficient for a time constant. */
function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}

/**
 * The swell's excursion above its baseline, expanded into 0..1 — a soft knee in
 * place of a gain and a clamp. See `SWELL_GATE`.
 *
 * Three regions, and each is answering a specific failure of the pair it
 * replaces. Below the gate a smoothstep pulls the residue of a rest toward zero,
 * so the channel's floor is silence rather than whatever the baseline filter
 * happened to leave; between the gate and the knee the response is linear, which
 * is where nearly every hit lands and where the dynamics have to survive; above
 * the knee it bends toward 1 without ever reaching it, so the loudest hit in a
 * passage is still measurably louder than the second loudest.
 */
function expand(excursion: number): number {
  if (excursion <= 0) return 0;
  const t = Math.min(1, excursion / SWELL_GATE);
  const gated = excursion * t * t * (3 - 2 * t) * SWELL_GAIN;
  if (gated <= SWELL_KNEE) return gated;
  return SWELL_KNEE + (1 - SWELL_KNEE) * Math.tanh((gated - SWELL_KNEE) / (1 - SWELL_KNEE));
}

/**
 * Every channel, for the trace in `audioTrace.ts`.
 *
 * Exposed because the whole argument of `docs/visualizer-audio-reach.md` §1 is
 * about what happens to a signal *between* the channels and the frame, and that
 * cannot be read from either end alone: the analysis meters show what arrives
 * and the reach readout shows what is delivered, and where those two disagree
 * the answer is always in here.
 */
export interface AudioChannels {
  grid: number;
  dynamics: number;
  amplitude: number;
  beatPulse: number;
  barBreath: number;
  phrase: number;
  fast: number;
  swell: number;
  shimmer: number;
  tide: number;
  accent: number;
  luma: number;
  hue: number;
  barPhase: number;
}

/**
 * An asymmetric raised cosine over a wrapped phase — the shape everything on the
 * synthesised path is made of.
 *
 * Continuous in value *and* in derivative at every point, including the two
 * where it meets zero, because a raised cosine is flat at both ends of its
 * window. That is the property that lets it run at beat rate without reading as
 * a flinch, and it is what no amount of filtering an energy signal can produce:
 * a filtered transient is smooth where the filter reached and has a corner where
 * the transient arrived.
 *
 * `rise` and `fall` are fractions of the cycle either side of `peak`. Their sum
 * must be under 1 or the pulse laps itself.
 */
function pulseShape(phase: number, peak: number, rise: number, fall: number): number {
  /*
   * Signed distance to the peak, wrapped into (-rise, 1 - rise] — so a peak at
   * 0.96 is 0.04 behind a phase of 0, not 0.96 ahead of it.
   *
   * Wrapped against the window rather than to the nearest representative, which
   * is the obvious thing and is wrong here. `d -= Math.round(d)` lands in
   * [-0.5, 0.5], and this window is *asymmetric* — a rise of 0.62 reaches back
   * further than that, so the far end of it was being folded to the other side
   * of the peak and read as zero. The shape then stepped by a tenth of its
   * range once per bar. Measured: 360%/s on the flight gain, out of a shape
   * whose own slope never exceeds 130%/s, and the single largest source of jerk
   * in the rewritten binding.
   */
  let d = (phase - peak) % 1;
  if (d < 0) d += 1;
  if (d > 1 - rise) d -= 1;
  if (d < 0) return 0.5 * (1 + Math.cos((Math.PI * d) / rise));
  return d >= fall ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / fall));
}

/** A plain raised cosine over a wrapped phase, 0..1, peaking at 0.5. */
function swellShape(phase: number): number {
  return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
}

export class AudioBinding {
  // --- the synthesised path -------------------------------------------------
  /** How far the grid is in charge, 0..1. Crossfades against the energy path. */
  private grid = 0;
  /** The generated shapes, after `SHAPE_SMOOTH`. */
  private beatPulse = 0;
  private barBreath = 0;
  private phrase = 0.5;
  /** Bar position of the most recent frame, so the per-layer spread can be
   *  taken as an offset into the same shape rather than as a filter. */
  private barPhase = 0;
  /** Amplitude the shapes are travelling at, 0..1. Deliberately slow — see
   *  `AMPLITUDE_TAU`. */
  private amplitude = 0;
  /** The beat-rate channel the fast row reads, crossfaded against the swell on
   *  the lock. */
  private fast = 0;

  // --- the energy path ------------------------------------------------------
  private swell = 0;
  private baseline = 0;
  /** The depth multiplier the run's own dynamics buy, around 1. See
   *  `DYNAMICS_TAU`. */
  private dynamics = 1;
  private shimmer = 0;
  private tide = 0;
  /** Ring buffer of the swell, for the per-layer spread when unlocked. */
  private readonly history = new Float32Array(HISTORY);
  private write = 0;
  private frameDt = 1 / 60;

  private accent = 0;
  /** What the accent is heading for; `accent` follows it with an attack. */
  private accentPeak = 0;
  private sinceAccent = ACCENT_MIN_GAP;
  private onsetAverage = 0;
  /** Whether the safety governor allowed the current accent to reach the
   *  highlights. See `KRACKLE_LIFT`. */
  private accentFlash = false;

  /** The luminance-affecting drive, after the governor's rate limit. */
  private luma = 0;
  private hue = 0;
  private lastBar = -1;
  /** How far the print family may be lifted from zero, 0..1. */
  private lift = 0;

  /** Filled by `channels`. Mutated in place and handed out by reference, the
   *  same convention as `AudioFrame`: a reader consumes it within the frame that
   *  produced it, and a per-frame allocation on the hot path buys nothing. */
  private readonly exported: AudioChannels = {
    grid: 0,
    dynamics: 1,
    amplitude: 0,
    beatPulse: 0,
    barBreath: 0,
    phrase: 0,
    fast: 0,
    swell: 0,
    shimmer: 0,
    tide: 0,
    accent: 0,
    luma: 0,
    hue: 0,
    barPhase: 0,
  };

  /** Read-only, and only by the trace. Nothing in the composition may bind to
   *  these directly — the whole point of the three rows is that a channel
   *  reaches a parameter whose timescale matches it, and an accessor that hands
   *  out every channel at once is an invitation to skip that. */
  get channels(): AudioChannels {
    const out = this.exported;
    out.grid = this.grid;
    out.dynamics = this.dynamics;
    out.amplitude = this.amplitude;
    out.beatPulse = this.beatPulse;
    out.barBreath = this.barBreath;
    out.phrase = this.phrase;
    out.fast = this.fast;
    out.swell = this.swell;
    out.shimmer = this.shimmer;
    out.tide = this.tide;
    out.accent = this.accent;
    out.luma = this.luma;
    out.hue = this.hue;
    out.barPhase = this.barPhase;
    return out;
  }

  /**
   * The breath as one layer of the flat composition sees it, ≥ 1.
   *
   * Each layer reads the same shape at its own offset, so a change passes
   * through the stack as a wave over about half a bar rather than scaling every
   * layer on the same frame. On the synthesised path that offset costs nothing
   * at all — it is an argument to `pulseShape`, and every layer gets the full
   * amplitude — where the cascade this replaces paid for the spread by
   * destroying the signal it was spreading.
   *
   * The accent is added undelayed and to every layer at once.
   */
  pulse(shardId: number): number {
    return 1 + PULSE_BAR * this.spread(shardId) + PULSE_ACCENT * this.accent;
  }

  /** Gain on the spatial flight and turn rates. Read at different offsets, so
   *  the two do not surge on the same frame. */
  get flight(): number {
    return 1 + FLIGHT_DEPTH * this.spread(0);
  }

  get spin(): number {
    return 1 + SPIN_DEPTH * this.spread(3);
  }

  /**
   * Whether `applyPost` would do anything. The early return it guards is what
   * makes a run that is not listening an exact identity on the post chain.
   *
   * `hue` and `grid` are in here for a reason that is not about cost: the hue
   * walk is *accumulated*, so a frame on which this reads false would hand back
   * the whole of it at once and hand it straight back the frame after. Both
   * shapes rest at zero for a few tens of milliseconds every cycle, and on a
   * locked but very quiet passage every other term can rest with them — so
   * without these two the colour would pop once a bar on exactly the material
   * least able to hide it.
   */
  get active(): boolean {
    return (
      this.grid > 0.002 ||
      this.hue !== 0 ||
      this.fast > 0.002 ||
      this.swell > 0.002 ||
      this.luma > 0.002 ||
      this.accent > 0.002 ||
      this.tide > 0.002 ||
      this.shimmer > 0.002
    );
  }

  /**
   * The bar breath at one layer's offset, blended against the energy path.
   *
   * Both halves are already scaled by `grid` and `1 - grid` respectively, so
   * this is a crossfade rather than a sum: a run that is locked reads the
   * generated breath, a run that is not reads the delayed swell, and a lock
   * arriving or leaving moves between them over `LOCK_FADE`.
   */
  private spread(slot: number): number {
    const offset = (Math.abs(slot) % SPREAD_SLOTS) * SPREAD_BARS;
    let phase = (this.barPhase - offset) % 1;
    if (phase < 0) phase += 1;
    const shaped =
      pulseShape(phase, BAR_PEAK, BAR_RISE, BAR_FALL) * this.amplitude * this.grid;
    return shaped + this.delayed(slot) * (1 - this.grid);
  }

  /** The swell as it was `slot` steps of `SPREAD_SECONDS` ago. A delay, so every
   *  slot carries the same amplitude as the source. */
  private delayed(slot: number): number {
    const lag = Math.min(
      HISTORY - 1,
      Math.round(((Math.abs(slot) % SPREAD_SLOTS) * SPREAD_SECONDS) / this.frameDt)
    );
    return this.history[(this.write - lag + HISTORY) % HISTORY];
  }

  /**
   * Fold one analysed frame into the channels. Real `dt`, always: the music does
   * not follow the speed control, so neither may anything derived from it.
   *
   * A missing frame, a silent room and a reactivity of 0 are all the same case —
   * every channel falls away and every binding below becomes an identity.
   */
  update(
    frame: AudioFrame | null,
    reactivity: number,
    lift: number,
    dt: number,
    safety: SafetyGovernor
  ): void {
    const depth = clamp01(reactivity);
    this.lift = clamp01(lift);
    const live = frame !== null && !frame.silent && depth > 0;
    // Smoothed, because the ring buffer indexes by frames and a single long
    // frame must not move where every layer is reading from.
    this.frameDt += (Math.min(0.1, Math.max(1 / 240, dt)) - this.frameDt) * 0.1;

    /*
     * How far everything below is allowed to travel, before any of it is
     * shaped. The reactor's loudness is the only unnormalised thing in the
     * chain, so it is the only place a chorus can differ from a verse — every
     * band it could have been taken from was mapped into 0..1 against its own
     * recent range on purpose.
     */
    const wantedDynamics = Math.min(
      DYNAMICS_MAX,
      Math.max(DYNAMICS_MIN, Math.pow(live ? frame.loudness : 1, DYNAMICS_EXPONENT))
    );
    this.dynamics += (wantedDynamics - this.dynamics) * coefficient(dt, DYNAMICS_TAU);
    const travel = depth * this.dynamics;

    // --- the energy path ----------------------------------------------------
    // Bass carries the weight; broadband keeps it from dropping out through a
    // bar with no kick in it.
    const raw = live ? clamp01(frame.low * 0.65 + frame.level * 0.45) : 0;
    this.baseline += (raw - this.baseline) * clamp01(dt / SWELL_BASELINE);
    // Clamped after the multiplier, not before: `travel` can exceed 1 on a loud
    // passage at full reactivity, and everything downstream of the swell is a
    // depth in 0..1.
    const target = clamp01(expand(raw - this.baseline) * travel);
    const swellTau = target > this.swell ? SWELL_ATTACK : SWELL_RELEASE;
    this.swell += (target - this.swell) * clamp01(dt / swellTau);

    this.write = (this.write + 1) % HISTORY;
    this.history[this.write] = this.swell;

    this.shimmer +=
      ((live ? frame.high : 0) * travel - this.shimmer) * clamp01(dt / SHIMMER_TAU);
    this.tide += ((live ? frame.mid : 0) * travel - this.tide) * clamp01(dt / TIDE_TAU);

    // --- the synthesised path -----------------------------------------------
    /*
     * The gate is on `confidence` alone, not on energy: a grid the reactor
     * believes in is what makes generated motion legitimate, and a quiet locked
     * passage should still breathe. Faded rather than switched, over a time
     * constant long enough that a confidence hovering at the threshold reads as
     * nothing at all rather than as the composition changing its mind.
     */
    const locked = live && frame.confidence >= LOCK_THRESHOLD ? 1 : 0;
    this.grid += (locked - this.grid) * coefficient(dt, LOCK_FADE);

    if (live) {
      // Continuous, monotonic beat position. `beatPhase` is the fractional part
      // of it, so both shapes below come off one number.
      const position = frame.beatCount + frame.beatPhase;
      this.barPhase = wrap01(position / BEATS_PER_BAR);
      const beat = pulseShape(frame.beatPhase, BEAT_PEAK, BEAT_RISE, BEAT_FALL);
      const bar = pulseShape(this.barPhase, BAR_PEAK, BAR_RISE, BAR_FALL);
      // Two incommensurate periods, averaged: neither is visible as itself and
      // the sum does not come back for forty bars.
      const slow =
        0.5 *
        (swellShape(wrap01(position / (BEATS_PER_BAR * BARS_PER_PHRASE))) +
          swellShape(wrap01(position / (BEATS_PER_BAR * BARS_PER_PHRASE_ALT))));
      const smooth = coefficient(dt, SHAPE_SMOOTH);
      this.beatPulse += (beat - this.beatPulse) * smooth;
      this.barBreath += (bar - this.barBreath) * smooth;
      this.phrase += (slow - this.phrase) * coefficient(dt, LOCK_FADE);
    } else {
      const smooth = coefficient(dt, SHAPE_SMOOTH);
      this.beatPulse -= this.beatPulse * smooth;
      this.barBreath -= this.barBreath * smooth;
    }

    /*
     * How far the shapes travel. A floor, plus energy over the top, times the
     * phrase — so a locked run always breathes, a loud passage breathes harder,
     * and the whole response waxes and wanes on a period nobody can find.
     *
     * The floor carries `travel` explicitly because the swell already does: both
     * halves have to move with the dynamics or a chorus would only be able to
     * lift the part of the amplitude that the beat contributes, and the part
     * that is there simply for being locked would sit at its verse value
     * through it.
     *
     * Depth is applied here and only here on this path, which is what makes
     * `reactivity` a depth control rather than a smoothness control: turning it
     * down shortens the travel and leaves every time constant alone.
     */
    const swing = 1 - PHRASE_SWING + 2 * PHRASE_SWING * this.phrase;
    const wanted = clamp01(
      (SHAPE_FLOOR * travel + (1 - SHAPE_FLOOR) * this.swell) * swing
    );
    this.amplitude += (wanted - this.amplitude) * coefficient(dt, AMPLITUDE_TAU);

    /*
     * The fast channel, crossfaded on the lock exactly as `spread` is: the
     * generated beat pulse where the grid is believed, the swell where it is
     * not. Without the second half the whole fast row would go silent on
     * material the tracker cannot lock to — which is most of the material this
     * feature has to survive, and which used to have a trail pump.
     */
    this.fast = this.beatPulse * this.amplitude * this.grid + this.swell * (1 - this.grid);

    // --- the accent ---------------------------------------------------------
    this.accentPeak *= Math.exp(-dt / ACCENT_RELEASE);
    this.sinceAccent += dt;
    if (live && frame.onset) {
      /*
       * An accent is an onset that stands out from the onsets around it, not
       * merely one that happened — measured against a running average rather
       * than an absolute number, because on a busy track every hit clears any
       * fixed bar and on a sparse one none of them do. The gap does the rest:
       * without it a loud passage promotes every hit in it, and the channel that
       * exists to be occasional becomes the pulse the breath already is.
       */
      if (
        this.sinceAccent >= ACCENT_MIN_GAP &&
        frame.onsetStrength > this.onsetAverage * ACCENT_RATIO
      ) {
        this.sinceAccent = 0;
        this.accentPeak = clamp01(frame.onsetStrength) * depth;
        /*
         * The krackle reaches the highlights, so it is a flash request like any
         * other and the governor answers it. Asked once when the accent fires
         * rather than per frame: a refusal here means this accent stays in the
         * geometry and the trail, where it cannot brighten anything, and the
         * next one may light up instead.
         */
        this.accentFlash = this.lift > 0 && safety.requestFlash();
      }
      this.onsetAverage += (frame.onsetStrength - this.onsetAverage) * ACCENT_MEMORY;
    }
    const accentTau = this.accentPeak > this.accent ? ACCENT_ATTACK : ACCENT_RELEASE;
    this.accent += (this.accentPeak - this.accent) * clamp01(dt / accentTau);

    /*
     * One limiter over everything that can brighten the frame, and nothing
     * downstream may opt out of it — the same argument as the flash rate limit
     * and the fade floor. The bar breath is the fast half of what feeds it, and
     * at 0.5Hz a full swing takes about a second, so this sits well inside
     * `MAX_AUDIO_SLEW` and never binds in practice. That is the point: the
     * hierarchy is what keeps the frame safe, and the governor is the proof that
     * it has been followed rather than the mechanism enforcing it.
     */
    this.luma = safety.clampAudioDrive(
      Math.max(this.swell * (1 - this.grid), this.barBreath * this.amplitude * this.grid),
      dt
    );

    if (live && frame.confidence > 0) {
      const bar = Math.floor(frame.beatCount / BEATS_PER_BAR);
      if (this.lastBar < 0) this.lastBar = bar;
      if (bar !== this.lastBar) {
        // Weighted by how much the grid is believed, so an uncertain lock walks
        // the colour slowly rather than stepping it on a beat that may not be
        // there.
        this.hue = wrap01(this.hue + HUE_PER_BAR * frame.confidence * depth);
        this.lastBar = bar;
      }
    }
  }

  /**
   * The audio pass over the post chain. Runs after the cycler and before
   * `Wander.settle`, so the music deepens whatever the other three passes
   * arrived at and the trail-against-symmetry governor still has the last word
   * over a channel that can move both.
   *
   * Read as three rows, and the rows are the whole design: what is on the fast
   * row cannot move the picture, what is on the bar row is slow enough to move
   * it a long way, and nothing crosses.
   */
  applyPost(post: PostParams): void {
    if (!this.active) return;

    // --- fast row: colour, tone, and the compounding trail -------------------
    // Neutral-point parameters, so additive: a deviation from neutral is the
    // only thing these can express and a multiply by neutral is a no-op.
    post.feedbackScale += PUMP_SCALE * this.fast;
    post.feedbackRotate += PUMP_ROTATE * this.accent;
    post.hueShift += this.hue + this.tide * 0.03 + HUE_BEAT * this.fast;

    // Always-on treatments, so multiplicative: a preset that turned one off
    // stays off.
    post.chroma *= 1 + CHROMA_BEAT * this.fast + CHROMA_TIDE * this.tide;
    post.grain *= 1 + GRAIN_DEPTH * this.shimmer;

    /*
     * The press, lifted from zero — the one exception to the rule above, and
     * only ever as far as the config allows. See `MISREG_LIFT`.
     *
     * Plates slipping on the beat and ink spreading over the bar: neither can
     * flash, neither moves the picture, and both are what this engine's own
     * subject would do if it were being printed badly to music. Clamped, because
     * these are blend amounts rather than open scales.
     *
     * Gated on the lock as well as on the knob, and that matters more than it
     * looks. Every other binding here has an
     * energy fallback for material the tracker cannot lock to, and the press
     * deliberately does not: the swell carries a large DC term, so a press
     * lifted from it sits permanently a quarter out of register — measured at
     * 0.22 with no beat under it — which is not a response to music, it is
     * simply a misregistered frame. What is worth having is the press slipping
     * *on the beat*, and where there is no beat the honest answer is a clean
     * plate.
     */
    const press = this.lift * this.grid;
    if (press > 0.001) {
      post.misreg = clamp01(post.misreg + MISREG_LIFT * press * this.fast);
      // On the slew-limited drive rather than the raw breath: a bleed dilates
      // the darks, so it moves frame luminance and belongs with the trail.
      post.bleed = clamp01(post.bleed + BLEED_LIFT * press * this.luma);
    }
    /*
     * The krackle is outside that gate, and deliberately: the DC argument above
     * is about the two channels that carry a *level*, and an accent is an
     * impulse with no level at all. A crash landing on a drone the tracker will
     * never lock to is still a crash, and punctuation is the one thing material
     * without a beat can still be given.
     */
    if (this.lift > 0 && this.accentFlash) {
      post.krackle = clamp01(post.krackle + KRACKLE_LIFT * this.lift * this.accent);
    }

    // --- bar row: the geometry ----------------------------------------------
    post.feedbackAmount *= 1 + TRAIL_DEPTH * this.luma;
    post.bloom *= 1 + BLOOM_DEPTH * this.luma;
    post.vignette += VIGNETTE_DEPTH * this.luma;

    /*
     * The distortions, every one of which is 0 unless a preset asked for it.
     * Multiplying is the whole point: the music may push a fold the piece is
     * already running and may never introduce one it is not. Deliberately not
     * the reparameterisations — droste, tunnel, julia — which decide what the
     * frame *is* rather than how far it is pushed, and which read as the picture
     * being replaced rather than modulated when they move.
     */
    const geometry = 1 + GEOMETRY_DEPTH * this.spread(4);
    post.bulge *= geometry;
    post.twist *= geometry;
    post.ripple *= geometry;
    post.warp *= geometry;
    post.kaleido *= geometry;
    post.disperse *= geometry;
  }

  reset(): void {
    this.grid = 0;
    this.beatPulse = 0;
    this.barBreath = 0;
    this.phrase = 0.5;
    this.barPhase = 0;
    this.amplitude = 0;
    this.fast = 0;
    this.swell = 0;
    this.baseline = 0;
    this.dynamics = 1;
    this.shimmer = 0;
    this.tide = 0;
    this.history.fill(0);
    this.write = 0;
    this.frameDt = 1 / 60;
    this.accent = 0;
    this.accentPeak = 0;
    this.sinceAccent = ACCENT_MIN_GAP;
    this.onsetAverage = 0;
    this.accentFlash = false;
    this.luma = 0;
    this.lastBar = -1;
    this.lift = 0;
  }
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
