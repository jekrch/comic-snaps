import type { AudioFrame } from "./AudioReactor";
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
 *
 * ## Two knobs over it
 *
 * Because the rows are separated in frequency, the control surface can be too.
 * `reactivity` is depth — how far the composition travels — and `attack` is
 * where on the hierarchy that travel is spent: at 1 the fast row runs on the
 * beat's shape and the accent fires, at 0 it runs on the bar's and nothing in
 * the piece changes faster than a bar. Neither end is quieter than the other,
 * which is the property the single knob could not have had. See `FAST_BREATH`.
 *
 * The third row is here too, as `section` — a cue rather than a channel, raised
 * when the music's own level moves and spent by the director on the discrete
 * gestures no parameter can express. See `SECTION_BASELINE`.
 *
 * ## What the attribution round added, and why
 *
 * The arrangement above measures well and, per
 * `docs/visualizer-audio-attribution.md`, was still not *attributable*: once the
 * grid locked, every bar produced the same raised cosine at an amplitude that was
 * a two-second average of a three-second average, so nothing on screen depended
 * on what the music actually played in that bar. It was a metronome with a volume
 * knob, and a viewer cannot point at a metronome and say *that happened because of
 * that*.
 *
 * Four things answer it, and none of them raises peak velocity:
 *
 * - **The bar's amplitude is latched from the bar that just played** rather than
 *   filtered over several. A loud bar is followed by a bigger one. The value
 *   steps once per bar and glides over the next, so its contribution to velocity
 *   is a full range divided by a bar. See `BAR_SWING`.
 * - **The bar's *shape* is chosen from a vocabulary**, by what the previous bar
 *   contained. Variety with a cause: bars differ because the music did. See
 *   `GESTURES`.
 * - **The three onset streams are bound separately.** Kick to the weight, snare
 *   to the lateral, hat to the texture — all on the fast row, none on the
 *   geometry, so the hierarchy is unchanged. See `HIT_ATTACK`.
 * - **A fill winds the composition up and a drop is arrived on.** The only
 *   anticipatory channel in the feature, and the only cue that resolves a
 *   structural moment to the frame it happens on. See `WIND_TAU` and
 *   `ARRIVAL_GAP`.
 *
 * And one thing that is not a channel at all: `autonomy`, the share of the
 * composition's *own* motion the director should give back while the music is
 * carrying the frame. Attribution is a ratio, and it is the only term here that
 * moves the denominator. See `HANDOVER`.
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
 * The bar gestures — §3.4 of `docs/visualizer-audio-attribution.md`.
 *
 * One shape repeated every bar forever is the defect that document names: the
 * bar row carries the geometry, the geometry is most of what a viewer sees, and
 * a periodic function of phase times a slow scalar has nothing in it anybody
 * could attribute to the music. These are five, chosen at each downbeat by what
 * the *previous* bar actually contained — see `chooseGesture`, and note that the
 * choice is deterministic rather than drawn from the rng, because variety
 * without a cause is noise and the whole point is that the cause is audible.
 *
 * Every member is built out of `pulseShape`, so continuity in value and
 * derivative is a property of the family rather than of any one entry, and the
 * peak slope of each is arithmetic: `gain × lobes × π / (2 × width)` per bar. The
 * steepest of them is `late`, at 4.7/bar against the breath's 4.36 — so the whole
 * vocabulary fits inside the velocity budget the single shape already spent, and
 * what varies is only which way the bar leans.
 *
 * **`rise + fall` must stay under 1 in every entry**, and that is a correctness
 * condition rather than a style note: past it the window laps itself, the far end
 * of the rise is folded to the other side of the peak and read as zero, and the
 * shape steps by a third of its range between two frames. `late` was written with
 * 0.8 and 0.34 the first time and measured 43.8%/s on the frame scale against the
 * 9.5%/s the row is budgeted at — the same failure §10 of the reach document
 * found in `pulseShape` itself, reintroduced one level up by the first shape that
 * wanted a long rise. See `pulseShape`, which has the arithmetic.
 *
 * `base` is a floor held through the bar rather than a second shape. It is what
 * makes `hold` read as weight — the bar never quite lets go — without needing a
 * wider window, which is the only other way to get there and costs slope.
 */
interface Gesture {
  peak: number;
  rise: number;
  fall: number;
  gain: number;
  /** Repeats of the shape per bar. Two is a bar pushing twice. */
  lobes: number;
  /** Held under the shape for the whole bar. */
  base: number;
}

const GESTURES = {
  /** The original, and still the answer for an ordinary bar. */
  breath: { peak: BAR_PEAK, rise: BAR_RISE, fall: BAR_FALL, gain: 1, lobes: 1, base: 0 },
  /** Two half-bar pushes, each lighter — a busy bar answered by a busy shape. */
  push: { peak: 0.96, rise: 0.6, fall: 0.34, gain: 0.5, lobes: 2, base: 0 },
  /** Weight: shallower, but it never returns to nothing. */
  hold: { peak: 0.94, rise: 0.62, fall: 0.36, gain: 0.7, lobes: 1, base: 0.3 },
  /** The run-up. A long rise arriving at the very end of the bar, so the frame
   *  is at its maximum as the next downbeat lands — and a short fall, so it is
   *  out of the way before the bar it was anticipating gets going. */
  late: { peak: 0.995, rise: 0.68, fall: 0.3, gain: 0.9, lobes: 1, base: 0 },
  /** A bar with almost nothing in it gets a bar with almost nothing in it. This
   *  is the member that makes the others mean something. */
  still: { peak: BAR_PEAK, rise: BAR_RISE, fall: BAR_FALL, gain: 0.38, lobes: 1, base: 0 },
} as const satisfies Record<string, Gesture>;

type GestureName = keyof typeof GESTURES;

/**
 * Fraction of a bar the composition takes to move from one gesture to the next.
 *
 * A gesture change at the downbeat is a step, because two shapes do not agree on
 * their value at phase 0 — and a step through `SHAPE_SMOOTH` is a 50ms transient,
 * which is exactly the discontinuity §10 of the reach document found to be the
 * largest single source of jerk in the previous rewrite. So the two shapes are
 * *mixed* over the bar instead. Both are continuous functions of the same phase,
 * so the mix is continuous; what it adds to the slope is at most the difference
 * between the two divided by the blend length, which at 0.45 of a bar is about
 * 2/bar against a shape family that already runs at 4.4.
 */
const GESTURE_BLEND = 0.45;
/**
 * Onsets per bar in the top band over which a bar counts as busy, and low-band
 * share over which it counts as weighty. Both are read off the bar that just
 * ended — see `chooseGesture`.
 *
 * Nine rather than five, which was the first guess and was wrong for a reason
 * worth keeping: eight top-band onsets to the bar is a hi-hat on eighths, which
 * is not a busy bar, it is the single most ordinary drum pattern there is.
 * Measured against a generator playing exactly that, five put 83% of the run's
 * bars on the busy shape and never once selected the default. The threshold has
 * to sit above the ordinary case or the vocabulary has one member.
 */
const BUSY_HITS = 9;
const WEIGHTY_SHARE = 0.55;
/** How far under its own recent average a bar has to be to count as empty. */
const STILL_RATIO = 0.45;
/** How much fill the bar has to have carried for the next one to lean late. */
const LATE_FILL = 0.3;

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
/**
 * How far the bar that just played may move the bar that follows it, ± — §3.2 of
 * `docs/visualizer-audio-attribution.md`, and the cheapest attributable thing in
 * the feature.
 *
 * The constant above is correct and is also why consecutive bars were identical:
 * at two seconds the amplitude passes about 1% of the beat, which is the split
 * the hierarchy asks for, and it passes almost as little of the *bar*. So the
 * energy a bar contained could not reach the bar after it, and the geometry ran
 * on a figure that had not changed materially in ten seconds.
 *
 * This is the term that restores it, and the reason it costs nothing is that it
 * is latched once per bar and glided over the next: a full swing divided by a bar
 * is well under the 9.5%/s the geometry already runs at. Measured against the
 * bar's own recent average rather than absolutely, so what it expresses is "this
 * bar was bigger than the last few" — which is a thing music does constantly and
 * which every filter in the chain above was removing.
 */
const BAR_SWING = 0.4;
/** How fast the reference the latch is measured against follows, per bar. Four
 *  bars of memory: long enough that a chorus reads as louder than the verse, short
 *  enough that the whole thing does not become a second dynamics channel. */
const BAR_MEMORY = 0.3;
/** Fraction of a bar the latched value takes to arrive. Under half, so it is
 *  established well before the bar's own peak and the two do not fight. */
const BAR_GLIDE = 0.4;
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

// --- the tonal channel ------------------------------------------------------

/**
 * What drives the composition when there are no transients to drive it — the
 * capability §3.5 of the reach document says `clarity` is for.
 *
 * The swell is an event channel: its baseline is removed in full, so on a drone,
 * a pad, a bowed string or an organ chord it reads exactly zero, and every
 * energy binding downstream reads zero with it. That is correct for a channel
 * whose content is "louder than a moment ago" and it is why the feature has
 * always given up on this material. But such music is not static — it has slow
 * swells, and those are perfectly legible; they are simply an order of magnitude
 * slower than a kick.
 *
 * So there is a second envelope on a much longer baseline, which on percussive
 * material is nearly zero (transients come and go far faster than eighteen
 * seconds) and on tonal material is the whole shape of the piece. The two
 * crossfade on `clarity`, so nothing is ever driven by both.
 *
 * Only ever a *level*, and slow enough that it cannot flinch: the fastest thing
 * this can do is a full swing over several seconds, which is the bar row's
 * timescale rather than the beat row's, so it feeds the same places the breath
 * does and none of the places the pulse does.
 */
const TONAL_BASELINE = 18;
const TONAL_TAU = 2.5;
const TONAL_GAIN = 5;
/** Below this much clarity the material is treated as tonal. Deliberately low:
 *  the cost of running the tonal channel on percussive material is that it
 *  contributes almost nothing, and the cost of the reverse is that ambient gets
 *  nothing at all — so the crossfade is biased toward the transient path. */
const TONAL_CLARITY = 0.4;

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

// --- the three hits ---------------------------------------------------------

/**
 * Kick, snare and hat as three channels rather than one — §3.3 of
 * `docs/visualizer-audio-attribution.md`.
 *
 * The reactor has always run three independent detectors and then handed out
 * their maximum, so everything a listener would name as *what the drums are
 * doing* was measured and averaged away one function call before use. These are
 * the three arriving separately, and each goes somewhere the others do not: the
 * kick to the weight, the snare to the lateral, the hat to the texture.
 *
 * All three are on the **fast row** and none of them touches geometry, which is
 * what keeps three beat-rate event channels inside the architecture rather than
 * three times the chance of the flinch it exists to prevent. They are scaled by
 * `sharp` at the point they fire, so the `attack` axis reroutes them exactly as
 * it does everything else on that row — turning it down does not leave three
 * unreachable channels running underneath.
 *
 * Releases descend with frequency, because that is what the sounds do: a kick
 * rings, a snare cracks, a hat is gone. Attacks are all the accent's, which is
 * short and deliberately not instant.
 */
const HIT_ATTACK = 0.05;
const HIT_RELEASE_LOW = 0.34;
const HIT_RELEASE_MID = 0.26;
const HIT_RELEASE_HIGH = 0.18;
/** The backbeat's own envelope. Longer than the snare hit it is made of: what
 *  this expresses is the *pattern* rather than the transient, and a channel that
 *  is gone before the eye reaches it may as well not have fired. */
const BACKBEAT_RELEASE = 0.4;

// --- the wind-up and the arrival --------------------------------------------

/**
 * The fill, as a channel — the only anticipatory thing in the feature.
 *
 * Every other channel here reports what the music just did, which puts the
 * composition permanently a beat behind the one moment it could be ahead of. A
 * fill is the run-up to a downbeat, the reactor resolves it half a bar early, and
 * what this does with it is *wind up*: the amplitude rises across the fill so the
 * frame is already travelling when the bar lands.
 *
 * Short, because an anticipation that arrives late is worse than none, and small,
 * because it is a lean on top of the amplitude rather than a second amplitude.
 */
const WIND_TAU = 0.22;
const WIND_AMPLITUDE = 0.35;
/** How far the trail's stride opens across a fill. On the fast row's argument:
 *  a compounding term with no on-screen velocity of its own. */
const WIND_SCALE = 0.01;
/** How much of the wind-up reaches the slew-limited drive, so the trail
 *  lengthening across a fill is governed like everything else that can brighten
 *  the frame. */
const WIND_LUMA = 0.55;

/**
 * Minimum real seconds between arrivals — the drop's rate limit, and it is a
 * property of the mechanism rather than a taste setting.
 *
 * What an arrival spends is the largest gesture the engine has, and the floor
 * under how often that can happen must not be a function of how excitable the
 * material is. Shorter than `SECTION_GAP` because a drop is a rarer and much
 * better-evidenced event than a 3dB move in a running average, and because a
 * track that genuinely drops twice inside twenty seconds should be answered
 * twice.
 */
const ARRIVAL_GAP = 15;
/** How much of the accent budget a drop may take. Full: this is the one moment
 *  in a track where every channel arriving at once is the correct answer. */
const ARRIVAL_ACCENT = 1;

// --- the handover -----------------------------------------------------------

/**
 * How far the composition's *own* motion stands down while the music is carrying
 * it — §3.1 of `docs/visualizer-audio-attribution.md`, and the only term here
 * that moves the denominator.
 *
 * Attribution is a ratio. The wander, the cycler, the layer churn and the spatial
 * flight all keep their authored amplitude while the music plays, so whatever the
 * audio contributes is a minority share of the motion on screen, and the eye
 * attributes causation to whatever dominates. This is the composition yielding
 * the margin: as the musical drive rises, the autonomous rates come down, total
 * motion stays about where it was, and its *source* becomes musical.
 *
 * It is also the one proposal in that document that costs *negative* velocity —
 * it can only ever remove motion — which is why it is first and why it is allowed
 * to be this large.
 *
 * The margin, not the composition: at full drive 60% of the authored wander is
 * still running. A piece that stopped being itself the moment a beat was detected
 * would be a worse failure than the one this fixes.
 */
const HANDOVER = 0.4;
/** Real seconds the handover follows the drive. Slow: what it retunes are the
 *  rates of channels that are integrated, so a value that moved quickly would
 *  bend the drift audibly — and there is nothing in the music this needs to keep
 *  up with. */
const HANDOVER_TAU = 1.2;

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

/**
 * What each of the three hits is worth, and where it goes.
 *
 * The kick joins the trail pump, which is the fast row's own argument in
 * miniature: a term applied a hundredth at a time to a buffer that accumulates it
 * over hundreds of frames is a large visible change with no on-screen velocity
 * anywhere. The hat crackles the texture. The snare goes to the *press*, and
 * separately the backbeat does — a plate slipping sideways on two and four is
 * both the most on-theme answer this engine has and incapable of flashing.
 *
 * Note what is absent: none of them reaches geometry, opacity or anything the
 * governor limits. Three event channels at beat rate is exactly the arrangement
 * the hierarchy was built to make safe, and it is only safe while they stay on
 * the row that cannot move the picture.
 */
const KICK_SCALE = 0.008;
const SNARE_SLIP = 0.55;
const BACKBEAT_SLIP = 0.75;
const HAT_GRAIN = 0.9;
const HAT_CHROMA = 0.25;

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

// --- the attack axis --------------------------------------------------------

/**
 * What `attack` does to the fast row, and why turning it down is not turning the
 * feature down — §6 of the reach document.
 *
 * `reactivity` conflates depth with sharpness, because in the architecture this
 * replaced they were the same knob: every channel was a one-pole filter, so the
 * only way to soften the response was to slow it, and slowing it emptied it.
 * The two rows here are already separated in frequency, so the split is finally
 * expressible — and it is a *reroute* rather than a gain, which is the whole
 * point. At `attack` 0 the fast row still moves as far as it did; it moves on
 * the bar's shape instead of the beat's, so the colour and the press breathe
 * once a bar rather than pumping four times in it.
 *
 * Under 1 because the breath is the wider shape of the two — it fills nearly the
 * whole bar where the pulse rests between beats — so at equal peak it reads as
 * more present, not less. This is the value that makes the two ends of the axis
 * sound like the same depth.
 */
const FAST_BREATH = 0.8;
/**
 * How much of the *energy* fast row survives at `attack` 0.
 *
 * Not zero, for the reason §10 found the first time the fast row was gated on
 * anything: unlocked material has no generated shape to fall back to, so a fast
 * row that closed completely would take the trail pump away from everything the
 * tracker cannot lock to — which is most of what this feature has to survive.
 * The swell is not a twitch to begin with, at a 0.95s release, so what is left
 * here is a level rather than an edge.
 */
const FAST_ENERGY_FLOOR = 0.3;
/** Below this much attack the accent does not fire at all — including its
 *  request to the governor, which is a budget worth not spending on a channel
 *  whose output is about to be multiplied by zero. */
const ACCENT_OPEN = 0.02;

// --- the section row --------------------------------------------------------

/**
 * The third timescale, and the row §2 listed and nothing has ever driven.
 *
 * Beat and bar are both *continuous* channels: they move parameters. A section
 * is not a level at all — it is an event, and a rare one, whose whole content is
 * "the music has just changed". So it is published as a cue rather than as a
 * channel, and what consumes it does something discrete: the effect cycler
 * brings its next pulse forward, and the composition turns its pages over.
 *
 * Measured on `dynamics` rather than on any band, because `dynamics` is derived
 * from the one figure in the chain that is not range-normalised — a verse and a
 * chorus are the same 0..1 in every band and differ only there. It is also
 * already smoothed over three seconds, so what this compares is two averages of
 * a quantity that cannot flicker.
 */
const SECTION_BASELINE = 22;
/**
 * How far the run's dynamics must have departed from that baseline to count as
 * a section, in the multiplier's own units.
 *
 * 0.13 against a range of 0.45–1.35 is about a 3dB move in the music, which is
 * the smallest change a listener would describe as the track doing something.
 * Both directions: a breakdown arriving is exactly as legible as a chorus, and
 * a cue that only fired upward would answer half of every song.
 */
const SECTION_THRESHOLD = 0.13;
/**
 * Minimum real seconds between cues.
 *
 * Long, and it is the safety of this row rather than a taste setting. What a cue
 * triggers is the largest gesture in the engine — every layer on screen crossing
 * over at once — and the floor under how fast that can happen has to be a
 * property of the mechanism, not of how excitable the material is. A track that
 * changes every eight bars gets a page turn every second one.
 */
const SECTION_GAP = 20;

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
  /** How far the beat row is open, from `attack`. */
  sharp: number;
  /** The section cue, on the one frame it fires and 0 on every other. A spike
   *  in the trace rather than a channel — see `SECTION_BASELINE`. */
  section: number;
  /** The drop cue, on the one frame it fires. See `ARRIVAL_GAP`. */
  arrival: number;
  /** How far the bar that just played moved this one, around 1. */
  barGain: number;
  /** The wind-up across a fill. */
  wind: number;
  /** The three hits, and the backbeat over them. */
  hitLow: number;
  hitMid: number;
  hitHigh: number;
  backbeat: number;
  /** How much of the composition's own motion is standing down, 0..1 — the
   *  complement of what the director multiplies its autonomous rates by. */
  handover: number;
  fast: number;
  swell: number;
  tonal: number;
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

/**
 * One bar gesture evaluated at a bar phase. See `GESTURES`.
 *
 * `lobes` multiplies the phase before wrapping, so a two-lobe gesture is the same
 * shape happening twice — which keeps the family a single function and keeps the
 * slope arithmetic in the note above honest.
 */
function gestureAt(gesture: Gesture, phase: number): number {
  const local = wrap01(phase * gesture.lobes);
  return (
    gesture.base +
    gesture.gain * pulseShape(local, gesture.peak, gesture.rise, gesture.fall)
  );
}

/**
 * Which gesture the coming bar runs, from what the bar that just ended contained
 * — §3.4 of `docs/visualizer-audio-attribution.md`.
 *
 * Deterministic, and that is the requirement rather than a simplification. A
 * choice drawn from the rng would give exactly the same *variety* and none of the
 * attribution: what makes a changing shape read as musical is that the change has
 * an audible cause, and a viewer who cannot hear why the bar leaned differently
 * is watching a random number generator with extra steps.
 *
 * Ordered by how much each condition is worth seeing. An empty bar is the most
 * legible thing on the list and comes first; a run-up is the next, because it is
 * the only one that is about the bar *ahead*; then the two textures.
 */
function chooseGesture(
  energy: number,
  reference: number,
  fill: number,
  hats: number,
  lowShare: number
): GestureName {
  if (energy < reference * STILL_RATIO) return "still";
  if (fill >= LATE_FILL) return "late";
  if (hats >= BUSY_HITS) return "push";
  if (lowShare >= WEIGHTY_SHARE) return "hold";
  return "breath";
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
  /** Amplitude the shapes are travelling at, 0..1 — the slow energy term, and
   *  the bar's own latch and the wind-up over the top of it. See `BAR_SWING`. */
  private amplitudeBase = 0;
  private amplitude = 0;
  /** The beat-rate channel the fast row reads, crossfaded against the swell on
   *  the lock. */
  private fast = 0;
  /** How far the beat and accent channels are open, 0..1 — the `attack` axis.
   *  Taken straight from the config rather than filtered: it is a control, and
   *  a slider being dragged is not a signal. */
  private sharp = 1;

  // --- the bar's own size and shape -----------------------------------------
  /** Which gesture this bar runs and which the last one did, and how far the
   *  composition has moved between them. See `GESTURE_BLEND`. */
  private gesture: GestureName = "breath";
  private previousGesture: GestureName = "breath";
  private gestureBlend = 1;
  /** The bar accumulators, and what the last completed bar came to. Peak swell,
   *  top-band hits, low-band share and the fill it carried — everything
   *  `chooseGesture` and the latch are decided from. */
  private barEnergy = 0;
  private barHats = 0;
  private barLowFlux = 0;
  private barAllFlux = 0;
  private barFill = 0;
  /** The latched size of the last bar, the reference it is measured against, and
   *  the multiplier gliding toward it. See `BAR_SWING`. */
  private barLatch = 0;
  private barReference = 0;
  private barGain = 1;
  private barMark = -1;

  // --- the section row ------------------------------------------------------
  /** The cue for this frame, 0 on nearly all of them. Cleared at the top of
   *  every `update`, so a consumer reads it within the frame that raised it. */
  private sectionCue = 0;
  /** The long average `dynamics` is compared against, and time since the last
   *  cue. See `SECTION_BASELINE`. */
  private sectionBase = 1;
  private sinceSection = 0;
  /** The drop cue and its own gap. See `ARRIVAL_GAP`. */
  private arrivalCue = 0;
  private sinceArrival = ARRIVAL_GAP;

  // --- the hits and the wind-up ---------------------------------------------
  private hitLow = 0;
  private hitMid = 0;
  private hitHigh = 0;
  private backbeat = 0;
  private wind = 0;
  /** How far the composition's own motion has stood down, 0..1. */
  private handover = 0;

  // --- the energy path ------------------------------------------------------
  private swell = 0;
  private baseline = 0;
  /** The tonal channel and its long baseline. See `TONAL_BASELINE`. */
  private tonal = 0;
  private tonalBase = 0;
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
    sharp: 1,
    section: 0,
    arrival: 0,
    barGain: 1,
    wind: 0,
    hitLow: 0,
    hitMid: 0,
    hitHigh: 0,
    backbeat: 0,
    handover: 0,
    fast: 0,
    swell: 0,
    tonal: 0,
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
    out.sharp = this.sharp;
    out.section = this.sectionCue;
    out.arrival = this.arrivalCue;
    out.barGain = this.barGain;
    out.wind = this.wind;
    out.hitLow = this.hitLow;
    out.hitMid = this.hitMid;
    out.hitHigh = this.hitHigh;
    out.backbeat = this.backbeat;
    out.handover = this.handover;
    out.fast = this.fast;
    out.swell = this.swell;
    out.tonal = this.tonal;
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

  /**
   * How large a section change the music just made, 0..1, on the one frame it
   * made it — the section row of the hierarchy, and the only channel here that
   * is an event rather than a level.
   *
   * Read once per frame by the director, which is the only thing that can spend
   * it: what a section is worth is a *discrete* move, and there is no parameter
   * in `PostParams` whose timescale is a minute. See `SECTION_BASELINE`.
   */
  get section(): number {
    return this.sectionCue;
  }

  /**
   * A drop, on the one frame it lands — §3.5 of
   * `docs/visualizer-audio-attribution.md`.
   *
   * The same kind of thing as `section` and deliberately a second channel rather
   * than a larger value on the first. A section is "the music has moved to a
   * different level", measured over twenty seconds and resolved to within a few;
   * an arrival is "the bottom just came back", resolved to a frame. The gestures
   * they are worth are the same ones, and the difference that matters to the
   * director is that this one can be *hit* — the beat grid predicts, so a
   * crossfade fired here lands on the downbeat rather than after it.
   */
  get arrival(): number {
    return this.arrivalCue;
  }

  /**
   * What the composition should multiply its *own* rates by while the music is
   * carrying the frame, 0.6..1 — §3.1 of the attribution document.
   *
   * Not a channel and not something `applyPost` can spend, because what it
   * governs does not live in `PostParams`: the drift's rate, the cycler's
   * interval, the stage's authored flight. The director reads it and hands the
   * margin over.
   *
   * Every other number in this file answers "how far should the music move the
   * composition". This one answers "how much should the composition be moving on
   * its own while it does" — and since attribution is a ratio, it is the only one
   * that can move the denominator.
   */
  get autonomy(): number {
    return 1 - HANDOVER * this.handover;
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
      this.shimmer > 0.002 ||
      this.hitLow > 0.002 ||
      this.hitMid > 0.002 ||
      this.hitHigh > 0.002 ||
      this.backbeat > 0.002 ||
      this.wind > 0.002
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
    return this.onGrid(slot) + this.delayed(slot) * (1 - this.grid);
  }

  /**
   * The locked half of `spread` on its own: the generated bar shape at a slot's
   * offset, already weighted by how far the grid is believed.
   *
   * For the consumers that would rather not move at all than move off the grid.
   * The energy fallback is the right answer for anything that reads as breathing
   * — scale, travel, a swelling warp — because a delayed envelope with no phase
   * in it still looks like a response to loudness. It is the wrong answer for
   * anything that *restructures* the frame, where the same envelope reads as the
   * picture rearranging itself near the music but never with it.
   */
  private onGrid(slot: number): number {
    const offset = (Math.abs(slot) % SPREAD_SLOTS) * SPREAD_BARS;
    let phase = (this.barPhase - offset) % 1;
    if (phase < 0) phase += 1;
    return this.barShape(phase) * this.amplitude * this.grid;
  }

  /**
   * The bar's shape at a phase — this bar's gesture mixed against the last one's.
   *
   * Mixed rather than switched, and the blend is over most of a bar. Two gestures
   * do not agree on their value at phase 0, so changing at the downbeat is a
   * step, and a step through `SHAPE_SMOOTH` is a 50ms transient — which is
   * precisely the discontinuity §10 of the reach document identified as the
   * largest single source of jerk in the version before this one. A mix of two
   * continuous functions of the same phase is continuous, and what it adds to the
   * slope is bounded by their difference over the blend length.
   */
  private barShape(phase: number): number {
    const next = gestureAt(GESTURES[this.gesture], phase);
    if (this.gestureBlend >= 1) return next;
    const previous = gestureAt(GESTURES[this.previousGesture], phase);
    return previous + (next - previous) * this.gestureBlend;
  }

  /**
   * The bar as a unit of its own: what it contained, and what the next one does
   * about it — §§3.2 and 3.4 of `docs/visualizer-audio-attribution.md`.
   *
   * Everything here happens once a bar, and everything it produces is glided over
   * the bar that follows. That is what makes the whole of it free in the currency
   * the reach document established: a value latched once per bar and arriving
   * over four tenths of one contributes its full range divided by most of a bar
   * to peak velocity, which at any tempo the reactor will track is under what the
   * geometry already runs at.
   *
   * The accumulators run whether or not the grid is locked, because a lock that
   * arrives mid-track should find a bar's worth of evidence waiting rather than
   * spend its first bar deciding it was empty.
   */
  private trackBar(frame: AudioFrame, dt: number): void {
    // The bar's own tally. Peak swell for its size, top-band onsets for how busy
    // it was, and the low band's share of the flux for how weighty.
    if (this.swell > this.barEnergy) this.barEnergy = this.swell;
    if (frame.onsetHigh) this.barHats++;
    if (frame.fill > this.barFill) this.barFill = frame.fill;
    this.barLowFlux += frame.fluxLow * dt;
    this.barAllFlux += (frame.fluxLow + frame.fluxMid + frame.fluxHigh) * dt;

    // The gesture blend advances on the bar's own clock, so it is the same
    // fraction of a bar at every tempo. `bpm` is 0 until a tempo is claimed,
    // which is also when nothing below can have run yet.
    const barSeconds = frame.bpm > 0 ? (60 / frame.bpm) * 4 : 2;
    this.gestureBlend = Math.min(
      1,
      this.gestureBlend + coefficient(dt, barSeconds * GESTURE_BLEND) * (1 - this.gestureBlend)
    );
    // The latched multiplier glides toward its target over part of the bar,
    // rather than stepping at the downbeat with the gesture.
    const wantedGain = this.barTarget();
    this.barGain += (wantedGain - this.barGain) * coefficient(dt, barSeconds * BAR_GLIDE);

    if (frame.barCount === this.barMark) return;
    const first = this.barMark < 0;
    this.barMark = frame.barCount;

    /*
     * A bar boundary. The tally closes, the reference it is measured against
     * follows it, and the coming bar's shape is chosen from what the last one
     * turned out to contain.
     *
     * The reference is seeded rather than approached on the first bar, for the
     * reason `trackLoudness` seeds its own: a reference that starts at zero makes
     * the opening bar of every run the loudest thing that has ever happened.
     */
    this.barLatch = this.barEnergy;
    this.barReference = first
      ? this.barLatch
      : this.barReference + (this.barLatch - this.barReference) * BAR_MEMORY;

    const lowShare = this.barAllFlux > 0 ? this.barLowFlux / this.barAllFlux : 0;
    const chosen = chooseGesture(
      this.barLatch,
      this.barReference,
      this.barFill,
      this.barHats,
      lowShare
    );
    if (chosen !== this.gesture) {
      this.previousGesture = this.gesture;
      this.gesture = chosen;
      this.gestureBlend = 0;
    }

    this.barEnergy = 0;
    this.barHats = 0;
    this.barLowFlux = 0;
    this.barAllFlux = 0;
    this.barFill = 0;
  }

  /**
   * How far the last bar moves this one, around 1 — the latch of §3.2.
   *
   * Relative to the bars around it rather than absolute, which is the whole
   * content of the measurement: "this bar was bigger than the last few" is a
   * thing music does constantly and is exactly what every filter above removes.
   * Bounded, because a bar that swings the amplitude by more than this stops
   * reading as the same composition responding and starts reading as two.
   */
  private barTarget(): number {
    if (this.barReference <= 0.02) return 1;
    const departure = (this.barLatch - this.barReference) / this.barReference;
    return 1 + BAR_SWING * Math.max(-1, Math.min(1, departure));
  }

  /**
   * One hit channel advanced by a frame — an exponential decay with a short
   * attack onto whatever arrived.
   *
   * The attack is `HIT_ATTACK` rather than instant for the accent's reason: a
   * channel that reaches its peak between two frames is a step, and a step in
   * anything the eye can see is a snap however small it is. Fifty milliseconds
   * costs the impulse nothing anybody can perceive as latency and takes the
   * corner off it.
   */
  private decayHit(value: number, arriving: number, release: number, dt: number): number {
    const decayed = value * Math.exp(-dt / release);
    const target = Math.max(decayed, arriving);
    return decayed + (target - decayed) * clamp01(dt / HIT_ATTACK);
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
    attack: number,
    lift: number,
    dt: number,
    safety: SafetyGovernor
  ): void {
    const depth = clamp01(reactivity);
    this.sharp = clamp01(attack);
    this.lift = clamp01(lift);
    this.sectionCue = 0;
    this.arrivalCue = 0;
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

    /*
     * The section, off the same figure — two averages of it, twenty seconds
     * apart, and a cue when they disagree by more than a track's own noise. See
     * `SECTION_BASELINE`.
     *
     * The baseline follows whether or not a cue fires, so a track that arrives
     * at a new level and stays there raises one cue rather than holding the
     * condition true for the next twenty seconds; and the gap is measured from
     * the last cue rather than from the last crossing, so a passage that wanders
     * either side of the threshold still costs one gesture.
     */
    this.sinceSection += dt;
    if (live) {
      const departure = this.dynamics - this.sectionBase;
      if (Math.abs(departure) >= SECTION_THRESHOLD && this.sinceSection >= SECTION_GAP) {
        this.sinceSection = 0;
        // Scaled so that a change of twice the threshold is the whole of it: a
        // consumer that only wants the large ones has something to test.
        this.sectionCue = clamp01(Math.abs(departure) / (2 * SECTION_THRESHOLD)) * depth;
        // Taken to the new level rather than left to converge over the baseline's
        // own time constant, which would leave the departure standing and spend
        // the next cue on the same change.
        this.sectionBase = this.dynamics;
      } else {
        this.sectionBase += (this.dynamics - this.sectionBase) * coefficient(dt, SECTION_BASELINE);
      }
    } else {
      this.sectionBase = this.dynamics;
    }

    // --- the energy path ----------------------------------------------------
    // Bass carries the weight; broadband keeps it from dropping out through a
    // bar with no kick in it.
    const raw = live ? clamp01(frame.low * 0.65 + frame.level * 0.45) : 0;
    this.baseline += (raw - this.baseline) * clamp01(dt / SWELL_BASELINE);
    // Clamped after the multiplier, not before: `travel` can exceed 1 on a loud
    // passage at full reactivity, and everything downstream of the swell is a
    // depth in 0..1.
    const event = clamp01(expand(raw - this.baseline) * travel);

    /*
     * The tonal channel, on its own far longer baseline. See `TONAL_BASELINE`.
     * On percussive material this is near zero and `clarity` is near one, so the
     * crossfade below hands everything to the event channel and nothing here
     * reaches the frame; on a drone the two swap places.
     */
    this.tonalBase += (raw - this.tonalBase) * clamp01(dt / TONAL_BASELINE);
    const tonalTarget = clamp01((raw - this.tonalBase) * TONAL_GAIN) * travel;
    this.tonal += (tonalTarget - this.tonal) * clamp01(dt / TONAL_TAU);

    const clarity = live ? clamp01(frame.clarity / TONAL_CLARITY) : 1;
    const target = event * clarity + this.tonal * (1 - clarity);
    const swellTau = target > this.swell ? SWELL_ATTACK : SWELL_RELEASE;
    this.swell += (target - this.swell) * clamp01(dt / swellTau);

    this.write = (this.write + 1) % HISTORY;
    this.history[this.write] = this.swell;

    this.shimmer +=
      ((live ? frame.high : 0) * travel - this.shimmer) * clamp01(dt / SHIMMER_TAU);
    this.tide += ((live ? frame.mid : 0) * travel - this.tide) * clamp01(dt / TIDE_TAU);

    /*
     * The three hits — §3.3. Each is an impulse envelope over its own band's
     * onset, scaled at the point it fires by depth and by `sharp`, so the
     * `attack` axis reroutes them with the rest of the fast row rather than
     * leaving three channels running underneath it.
     *
     * Peaks are taken with `max` rather than replaced: two hits inside one
     * release is a louder passage, not a quieter second hit.
     */
    this.hitLow = this.decayHit(
      this.hitLow,
      live && frame.onsetLow ? frame.strengthLow * travel * this.sharp : 0,
      HIT_RELEASE_LOW,
      dt
    );
    this.hitMid = this.decayHit(
      this.hitMid,
      live && frame.onsetMid ? frame.strengthMid * travel * this.sharp : 0,
      HIT_RELEASE_MID,
      dt
    );
    this.hitHigh = this.decayHit(
      this.hitHigh,
      live && frame.onsetHigh ? frame.strengthHigh * travel * this.sharp : 0,
      HIT_RELEASE_HIGH,
      dt
    );
    /*
     * And the backbeat over the top of the snare, weighted by how consistently
     * the pattern has actually been landing. Material in 3, or with no snare in
     * it, never raises the reactor's confidence and therefore never reaches this
     * — which is the honest answer rather than a fallback worth building.
     */
    this.backbeat = this.decayHit(
      this.backbeat,
      live && frame.backbeat > 0
        ? frame.backbeat * frame.backbeatConfidence * travel * this.sharp
        : 0,
      BACKBEAT_RELEASE,
      dt
    );

    /*
     * The wind-up. The reactor's fill rises across the last half of a bar, so
     * this is the one channel in the feature that is ahead of the music rather
     * than behind it, and the composition is already travelling when the downbeat
     * it was predicting arrives.
     */
    const windTarget = live ? frame.fill * this.grid * travel : 0;
    this.wind += (windTarget - this.wind) * clamp01(dt / WIND_TAU);

    /*
     * The arrival. Rate-limited here rather than in the reactor because what a
     * gap protects is the *gesture*, not the detection — the reactor should go on
     * reporting drops it sees, and the floor under how often the composition
     * turns itself over has to be a property of this side.
     */
    this.sinceArrival += dt;
    if (live && frame.drop > 0 && this.sinceArrival >= ARRIVAL_GAP) {
      this.sinceArrival = 0;
      this.arrivalCue = clamp01(frame.drop) * depth;
    }

    // --- the synthesised path -----------------------------------------------
    /*
     * The gate is on `confidence` alone, not on energy: a grid the reactor
     * believes in is what makes generated motion legitimate, and a quiet locked
     * passage should still breathe. Faded rather than switched, over a time
     * constant long enough that a confidence hovering at the threshold reads as
     * nothing at all rather than as the composition changing its mind.
     */
    // `frame.locked` rather than a threshold tested here: the decision now has
    // hysteresis and belongs to the reactor, which is the only place that can
    // hold it consistently for the three consumers that used to derive it
    // independently. See `LOCK_RELEASE`.
    const locked = live && frame.locked ? 1 : 0;
    this.grid += (locked - this.grid) * coefficient(dt, LOCK_FADE);

    if (live) {
      this.trackBar(frame, dt);
      /*
       * The bar comes off the reactor rather than being derived here from
       * `beatCount % 4`. Only the reactor knows where beat one is, and a bar
       * position computed downstream starts on whatever beat the lock happened
       * to open on — which is what put every bar-length gesture in the
       * composition on an arbitrary quarter of the bar.
       */
      this.barPhase = frame.barPhase;
      const position = frame.barCount + frame.barPhase;
      const beat = pulseShape(frame.beatPhase, BEAT_PEAK, BEAT_RISE, BEAT_FALL);
      const bar = this.barShape(this.barPhase);
      // Two incommensurate periods, averaged: neither is visible as itself and
      // the sum does not come back for forty bars.
      const slow =
        0.5 *
        (swellShape(wrap01(position / BARS_PER_PHRASE)) +
          swellShape(wrap01(position / BARS_PER_PHRASE_ALT)));
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
    this.amplitudeBase += (wanted - this.amplitudeBase) * coefficient(dt, AMPLITUDE_TAU);
    /*
     * And the two terms this filter deliberately cannot pass, applied over it
     * rather than through it — §§3.2 and 3.5.
     *
     * The constant above is right and is also why every bar was the same size:
     * two seconds passes about 1% of the beat, which is what the hierarchy asks
     * for, and nearly as little of the bar. So the bar's own energy could not
     * reach the bar after it, and the run's whole geometry moved on a figure that
     * had not changed materially in ten seconds.
     *
     * `barGain` is latched once a bar and glides over the next; `wind` rises
     * across the last half of one. Both are outside the filter because that is
     * the only place they can be, and both are bounded and slow enough on their
     * own terms that being outside it costs no velocity — which is the whole
     * argument for them.
     */
    this.amplitude = clamp01(
      this.amplitudeBase * this.barGain * (1 + WIND_AMPLITUDE * this.wind)
    );

    /*
     * The fast channel, crossfaded on the lock exactly as `spread` is: the
     * generated beat pulse where the grid is believed, the swell where it is
     * not. Without the second half the whole fast row would go silent on
     * material the tracker cannot lock to — which is most of the material this
     * feature has to survive, and which used to have a trail pump.
     *
     * And crossfaded a second time, on `attack`, between the two generated
     * shapes: the pulse at 1 and the breath at 0. That is the axis §6 asks for,
     * and it is a *reroute* rather than a gain — at either end the colour, the
     * press and the trail pump travel about as far, and what changes is whether
     * they do it four times a bar or once. Turning this down cannot make the
     * feature quieter, which is the failure the single knob had.
     */
    const shaped = this.beatPulse * this.sharp + this.barBreath * FAST_BREATH * (1 - this.sharp);
    const energy = FAST_ENERGY_FLOOR + (1 - FAST_ENERGY_FLOOR) * this.sharp;
    this.fast =
      shaped * this.amplitude * this.grid + this.swell * energy * (1 - this.grid);

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
      /*
       * Closed entirely below `ACCENT_OPEN`, rather than scaled to nothing. The
       * accent is the sharpest thing in the feature — a 0.07s attack, against a
       * bar row measured in seconds — so it is the one channel `attack` does
       * switch off rather than reroute: there is no slow shape a hit can be
       * expressed as, and a crash spread over a bar is not a crash.
       */
      if (
        this.sharp > ACCENT_OPEN &&
        this.sinceAccent >= ACCENT_MIN_GAP &&
        frame.onsetStrength > this.onsetAverage * ACCENT_RATIO
      ) {
        this.sinceAccent = 0;
        this.accentPeak = clamp01(frame.onsetStrength) * depth * this.sharp;
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
    /*
     * And the drop takes an accent on its own budget, outside the running average
     * and outside `ACCENT_MIN_GAP`.
     *
     * The average is what makes an accent mean "this hit stood out from the hits
     * around it", and a drop is precisely the case where there have been no hits
     * around it to stand out from — the low band has been gone for a bar or more,
     * so the thing the gate is measuring against is silence. It keeps `sharp`'s
     * switch, on §14's rule: there is no slow shape a hit can be expressed as,
     * and a viewer who has asked for no beat-rate detail has asked for this too.
     */
    if (this.arrivalCue > 0 && this.sharp > ACCENT_OPEN) {
      this.sinceAccent = 0;
      this.accentPeak = Math.max(
        this.accentPeak,
        this.arrivalCue * ARRIVAL_ACCENT * this.sharp
      );
      this.accentFlash = this.lift > 0 && safety.requestFlash();
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
      Math.max(
        this.swell * (1 - this.grid),
        this.barBreath * this.amplitude * this.grid,
        // The wind-up lengthens the trail across a fill, which is a luminance
        // move like any other and goes through the one limiter like any other.
        this.wind * WIND_LUMA
      ),
      dt
    );

    /*
     * The handover — §3.1, and the only term here the composition reads about
     * itself rather than about the music.
     *
     * Taken from whichever path is carrying the frame, so it works on material
     * the tracker will not lock to as well: on the grid it is the amplitude the
     * shapes are travelling at, off it the swell. Followed slowly, because what
     * it retunes are the rates of integrated channels — a value that moved
     * quickly would bend the drift visibly, and there is nothing in the music
     * this has to keep up with.
     */
    const carrying = clamp01(this.amplitude * this.grid + this.swell * (1 - this.grid));
    this.handover += (carrying - this.handover) * coefficient(dt, HANDOVER_TAU);

    if (live && frame.confidence > 0) {
      const bar = frame.barCount;
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
    /*
     * The trail's stride: the beat's shape, the kick that actually landed, and
     * the wind-up across a fill. All three compound through the feedback buffer
     * rather than being applied once, which is what lets a term this small be a
     * large visible change with no on-screen velocity anywhere.
     */
    post.feedbackScale +=
      PUMP_SCALE * this.fast + KICK_SCALE * this.hitLow + WIND_SCALE * this.wind;
    /*
     * The trail's turn, faded out against the fold — the fast row's "this cannot
     * move the picture" argument is true of a trail and false of a *mirrored*
     * one.
     *
     * `feedbackRotate` is an angle applied to every tap of the feedback chain,
     * so it compounds down the trail into an arc, and under a kaleidoscope that
     * arc is drawn in every wedge at once. At full accent this is 0.004 a frame
     * against a fold turning at 0.02 a second — the trail sweeps an order faster
     * than the symmetry it is smearing, which `Wander.settle` calls a jolt
     * however smoothly it arrived, and which that governor only catches on
     * presets running the parameter drift. Folded presets that do not run it —
     * `fractal`, `mirror-mask` — were getting the whole of it.
     *
     * Faded rather than gated, so an unfolded frame keeps the gesture at full
     * size and a deep mirror keeps a tenth of it: the pump is a *turn*, and what
     * a turn is worth is exactly how much of the frame is not already defined by
     * one.
     */
    post.feedbackRotate += PUMP_ROTATE * this.accent * (1 - clamp01(post.kaleido));
    post.hueShift += this.hue + this.tide * 0.03 + HUE_BEAT * this.fast;

    // Always-on treatments, so multiplicative: a preset that turned one off
    // stays off.
    post.chroma *= 1 + CHROMA_BEAT * this.fast + CHROMA_TIDE * this.tide + HAT_CHROMA * this.hitHigh;
    // The hat crackles the texture. Grain is the one always-live parameter in the
    // press family and the only place a top-band *event* can go without either
    // moving the picture or waiting on `audioLift`.
    post.grain *= 1 + GRAIN_DEPTH * this.shimmer + HAT_GRAIN * this.hitHigh;

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
      /*
       * The plates slip on the beat's shape, on the snare that actually landed,
       * and again on the backbeat when the bar has one.
       *
       * The snare is the right place for a *lateral* artefact and the backbeat is
       * the right place for the largest of them: a press drifting sideways on two
       * and four is the most on-theme answer this engine has to popular music, it
       * cannot flash, and it does not move the picture. All three terms are
       * impulses over a level, so none of them carries the DC the press gate
       * below exists to keep out.
       */
      post.misreg = clamp01(
        post.misreg +
          MISREG_LIFT * press * this.fast +
          // The larger of the two, not their sum. A backbeat *is* a mid-band
          // onset, so both channels fire on the same hit, and adding them counts
          // one snare twice — measured, 537%/s on the plate against the 243%/s
          // the row was already running at. What the backbeat means is that this
          // particular snare is worth more, which is a stronger reading of one
          // event rather than a second event.
          press * Math.max(SNARE_SLIP * this.hitMid, BACKBEAT_SLIP * this.backbeat)
      );
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
    post.disperse *= geometry;

    /*
     * The fold, which is the one member of that list that does not scale — and
     * multiplying it was a defect rather than a matter of degree.
     *
     * Every other distortion above is an open scale with a neutral point at
     * zero, so a gain of 1.5 is half again as much of it. `kaleido` is a *blend*
     * — the shader runs `mix(uv, folded, kaleido)` — so 1 is the whole mirror and
     * there is nothing past it. A preset that authored 0.9 was being handed 1.35
     * on every bar, and a mix factor over 1 does not deepen anything: it
     * extrapolates along the chord from the pixel to its own reflection, which
     * leaves the frame neither folded nor unfolded, non-injective near the
     * seams, and swinging through that state once a bar. That is what a
     * kaleidoscope preset under music was doing, and it is why it read as
     * spastic rather than as deep.
     *
     * Spent in the headroom instead. The deviation the multiply asked for is
     * scaled by how much room is left above the authored fold, so it agrees with
     * the old arithmetic wherever the old arithmetic was sane — a fold of 0.26
     * still swells to about 0.36 — and saturates smoothly instead of clipping
     * where it was not. The bound is arithmetic rather than a clamp: the added
     * term is at most `0.5 * k * (1 - k)`, which peaks at an eighth, so this can
     * never reach 1 and there is no corner in the trajectory for a governor to
     * have to smooth.
     *
     * On the grid rather than on `spread`, and that is the other half of the
     * complaint. `spread` crossfades to the energy path where the tracker has no
     * lock, and the energy path is a delayed envelope with no phase in it — so
     * an unlocked run was restructuring the frame *near* the music without ever
     * landing on it, which is a worse reading than not moving at all. Same
     * judgement the press family already makes: where there is no beat, the
     * honest answer is to leave the mirror where the composition put it.
     */
    const fold = clamp01(post.kaleido);
    post.kaleido = fold + fold * GEOMETRY_DEPTH * this.onGrid(4) * (1 - fold);
  }

  reset(): void {
    this.grid = 0;
    this.beatPulse = 0;
    this.barBreath = 0;
    this.phrase = 0.5;
    this.barPhase = 0;
    this.amplitudeBase = 0;
    this.amplitude = 0;
    this.fast = 0;
    this.sharp = 1;
    this.gesture = "breath";
    this.previousGesture = "breath";
    this.gestureBlend = 1;
    this.barEnergy = 0;
    this.barHats = 0;
    this.barLowFlux = 0;
    this.barAllFlux = 0;
    this.barFill = 0;
    this.barLatch = 0;
    this.barReference = 0;
    this.barGain = 1;
    this.barMark = -1;
    this.sectionCue = 0;
    this.sectionBase = 1;
    this.sinceSection = 0;
    this.arrivalCue = 0;
    this.sinceArrival = ARRIVAL_GAP;
    this.hitLow = 0;
    this.hitMid = 0;
    this.hitHigh = 0;
    this.backbeat = 0;
    this.wind = 0;
    this.handover = 0;
    this.swell = 0;
    this.baseline = 0;
    this.tonal = 0;
    this.tonalBase = 0;
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
