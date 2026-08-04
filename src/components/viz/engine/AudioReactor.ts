/**
 * Live audio analysis — bands, onsets, and a phase-locked beat grid.
 *
 * Phase 0 of `docs/visualizer-audio-plan.md`: this produces features and binds
 * nothing. The engine pulls a frame per drawn frame and the tuning panel draws
 * the meters; the composition does not read any of it yet. That separation is
 * deliberate — feature extraction is the only part of this feature with a
 * verifiable right answer, and tuning bindings on top of a detector that is not
 * locking wastes the work twice.
 *
 * Two properties the rest of the engine depends on:
 *
 * - **Inert until asked.** Constructing this object opens nothing. No
 *   `AudioContext`, no permission prompt, no device access happens before
 *   `start()`, which is only ever reached from an explicit gesture. A run that
 *   never asks is byte-for-byte the run it was before this file existed.
 * - **Real seconds, not clock seconds.** Every time constant here is wall
 *   clock. A viewer watching at 2× is still hearing the music at 1×, so none of
 *   this may follow the speed control the way the composition does.
 *
 * It also draws from no rng, so a seeded run stays reproducible from its seed
 * for as long as nothing is bound — and once things are bound, the seed still
 * reproduces the *configuration*. The music is not in the seed.
 */

/** Where the audio is coming from. Never serialised into a URL or a config —
 *  see the note on `start()`. */
export type AudioSource = "mic" | "display";

/** One capturable input, as offered to the picker. */
export interface AudioInput {
  deviceId: string;
  label: string;
}

export type AudioStatus =
  | "off"
  | "requesting"
  | "listening"
  /** The user said no, or dismissed the prompt. */
  | "denied"
  /** Display capture was granted, but without an audio track. */
  | "silent-share"
  /** No Web Audio, or no `mediaDevices`. */
  | "unsupported"
  | "error";

/**
 * One frame of features. Mutated in place and handed out by reference, the way
 * `VizPhases` already is: a frame is consumed within the tick that produced it,
 * and a per-frame allocation on the hot path buys nothing.
 */
export interface AudioFrame {
  /** Broadband, normalised against recent history. */
  level: number;
  /**
   * How loud the last fifth of a second is against the last twenty-five, as an
   * amplitude ratio. 1 is "as loud as this run has been"; a chorus reads above
   * it and a breakdown below.
   *
   * The one figure here that is deliberately *not* range-normalised, and see
   * `trackLoudness` for why everything else is and this must not be.
   */
  loudness: number;
  /** Per-band, normalised and envelope-followed. All 0..1. */
  low: number;
  lowMid: number;
  mid: number;
  high: number;
  /**
   * Rectified spectral flux in three bands, each scaled for display against its
   * own history, with the adaptive threshold each is tested against beside it.
   *
   * Three rather than one because a single sum over the spectrum is dominated by
   * whichever region covers the most bins — a hat spread over three hundred of
   * them and a kick occupying seven arrive at wildly different sizes, and one
   * median threshold can only ever be tuned for whichever of them is bigger.
   * Split, a kick, a snare and a hat are three independent event streams.
   */
  fluxLow: number;
  fluxMid: number;
  fluxHigh: number;
  fluxLowThreshold: number;
  fluxMidThreshold: number;
  fluxHighThreshold: number;
  /** The loudest of the three against its own threshold, for anything that
   *  wants one number. */
  flux: number;
  fluxThreshold: number;
  /** An onset fired on this frame, past the refractory period. */
  onset: boolean;
  /** How far over threshold it was, 0..1. Zero on frames with no onset. */
  onsetStrength: number;
  /**
   * The same three streams the flux bands already detect independently, kept
   * independent all the way out — §3.3 of `docs/visualizer-audio-attribution.md`.
   *
   * `onset` above is the *maximum* over these, and until this existed it was the
   * only thing that left this object. Three separate detectors were being run,
   * with their own medians, their own decaying peaks and their own refractory
   * periods, and then averaged into one boolean one function call before use —
   * so a kick, a snare and a hat arrived at the composition as the same event and
   * nothing downstream could tell which had happened.
   *
   * Note that these are *not* subject to the global refractory `onset` is: that
   * exists so the tempo histogram does not read a kick and the snare on top of it
   * as a triplet, which is a property of the histogram rather than of the music.
   * A binding that wants the kick and the snare separately wants both.
   */
  onsetLow: boolean;
  onsetMid: boolean;
  onsetHigh: boolean;
  strengthLow: number;
  strengthMid: number;
  strengthHigh: number;
  /**
   * A mid-band onset landing on beat two or four, 0 on every other frame — the
   * backbeat, and the most legible pattern in nearly all popular music.
   *
   * Every ingredient of this has existed since phase 0: the bar loop knows where
   * beat one is, and `flux[1]` knows when the snare hit. There was simply no path
   * between the two facts. See `BACKBEAT_WINDOW`.
   */
  backbeat: number;
  /** How consistently backbeats have been landing where the bar says they
   *  should, 0..1. A binding gates on this the way tempo-locked ones gate on
   *  `confidence` — material in 3, or with no snare, never raises it. */
  backbeatConfidence: number;
  /** Monotonic count of onsets. A reader running on its own rAF — the tuning
   *  panel's meters — can miss the single frame `onset` is true on, but it
   *  cannot miss a number changing. */
  onsetCount: number;
  /** Continuous position between beats, 0..1. Free-runs when unlocked. */
  beatPhase: number;
  /** Monotonic. This is what replaces the fixed grid in phase 1. */
  beatCount: number;
  /** Real seconds until the next predicted beat. What the fade lead reads. */
  nextBeatIn: number;
  bpm: number;
  /** How much to believe `bpm`, `beatPhase` and `beatCount`, 0..1. */
  confidence: number;
  /**
   * Position through the bar, 0 at the downbeat — phase-locked to the beat grid
   * and slid, never stepped, toward whichever beat the downbeat detector picks.
   *
   * Published here rather than derived downstream from `beatCount % 4` because
   * only this object knows where beat one is, and a consumer computing its own
   * bar position lands on whatever beat the lock happened to start on.
   */
  barPhase: number;
  /** Monotonic count of bars, incrementing on the downbeat. */
  barCount: number;
  /** How far the strongest of the four beat positions leads the others, 0..1.
   *  At 0 the bar is still a valid four-beat cycle, just not aligned. */
  downbeatConfidence: number;
  /**
   * How transient-like the material is, 0..1 — a second confidence, and
   * deliberately independent of the first.
   *
   * `confidence` asks whether the tempo histogram has a peak in it, and answers
   * 0 for ambient, drone and anything without a percussive attack. Those have
   * perfectly good dynamics and no beat, so gating everything on `confidence`
   * gives them nothing. Tempo-locked bindings gate on `confidence`; energy
   * bindings gate on this; nothing gates on both.
   */
  clarity: number;
  /**
   * Whether the grid is worth following, with hysteresis — §3.7 of the
   * attribution document.
   *
   * Published rather than left to each consumer to derive, because three of them
   * were testing `confidence >= LOCK_THRESHOLD` independently and a single
   * threshold is the wrong shape for this decision. Material that hovers near it
   * — which is most real music through a room, as opposed to the synthetic
   * patterns every round of this feature has been tuned against — spends its time
   * crossing back and forth, and every crossing costs a 1.5s crossfade in the
   * binding and a 6s one in the tempo lock. The run then gets neither path
   * cleanly. Two thresholds cost two constants and remove the failure entirely.
   */
  locked: boolean;
  /**
   * How much busier the last half-bar is than the bars before it, 0..1 — a fill,
   * and the only *anticipatory* feature in the whole analysis.
   *
   * Everything else here reports what the music just did. A fill says what it is
   * about to do, which is what lets the composition arrive with a downbeat rather
   * than after it. Weighted toward the end of the bar, because a burst of onsets
   * at the top of one is a busy bar and a burst at the end of one is a run-up.
   */
  fill: number;
  /** The low band has been absent long enough to count as a breakdown. */
  inBreak: boolean;
  /**
   * The low band returning after a break of at least `BREAK_MIN`, 0 on every
   * other frame — the drop.
   *
   * The one moment a viewer scores the whole feature on, and the reason it is
   * detected here rather than from the section row's dynamics: that row compares
   * a 3s average against a 22s one and cannot resolve a drop to better than a few
   * seconds. This resolves it to a frame.
   */
  drop: number;
  /** Nothing is playing. Every binding falls back to the authored config. */
  silent: boolean;
}

function emptyFrame(): AudioFrame {
  return {
    level: 0,
    loudness: 1,
    low: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    fluxLow: 0,
    fluxMid: 0,
    fluxHigh: 0,
    fluxLowThreshold: 0,
    fluxMidThreshold: 0,
    fluxHighThreshold: 0,
    flux: 0,
    fluxThreshold: 0,
    onset: false,
    onsetStrength: 0,
    onsetLow: false,
    onsetMid: false,
    onsetHigh: false,
    strengthLow: 0,
    strengthMid: 0,
    strengthHigh: 0,
    backbeat: 0,
    backbeatConfidence: 0,
    onsetCount: 0,
    beatPhase: 0,
    beatCount: 0,
    nextBeatIn: 0,
    bpm: 0,
    confidence: 0,
    barPhase: 0,
    barCount: 0,
    downbeatConfidence: 0,
    clarity: 0,
    locked: false,
    fill: 0,
    inBreak: false,
    drop: 0,
    silent: true,
  };
}

// --- analysis constants -----------------------------------------------------

/** 2048 at 48kHz is a 43ms window and ~23Hz bins: fine enough to separate a
 *  kick from a bassline, short enough to still see a transient. */
const FFT_SIZE = 2048;
/**
 * Deliberately low. The node's own filter is symmetric, and §3.3 of the plan
 * needs an asymmetric one — fast attack, slow release — which is done here
 * instead. Leaving this high would add latency to the attack, which is the one
 * place in the chain latency is actually visible.
 */
const SMOOTHING = 0.2;

/** Hz. Kick and bass; body; melody and vocal presence; hats and air. */
const BAND_EDGES: readonly [number, number][] = [
  [20, 160],
  [160, 800],
  [800, 4000],
  [4000, 16000],
];
const BAND_COUNT = BAND_EDGES.length;

/**
 * Time constants for the adaptive floor and ceiling, in real seconds.
 *
 * Asymmetric in both directions: the ceiling jumps to a new peak instantly and
 * sags over a few seconds, the floor drops instantly and creeps back over
 * rather longer. So a sudden loud passage is immediately in range, and a long
 * loud passage does not gradually lift the floor until the quiet parts read as
 * silence.
 */
const CEILING_FALL = 3;
const FLOOR_RISE = 8;
/** Below this much range between floor and ceiling, refuse to normalise —
 *  otherwise the adaptive scale faithfully amplifies room tone to full scale
 *  and the composition dances to a refrigerator. */
const MIN_SPAN = 0.045;
/** Absolute broadband level under which nothing is playing at all. */
const SILENCE_LEVEL = 0.02;
/** How long it has to stay there before the run stops following it, and how
 *  long a return to sound takes to be believed. Asymmetric on purpose: dropping
 *  out is worth being sure about, coming back is not. */
const SILENCE_HOLD = 0.5;

/** Envelope follower, real seconds. Attack speed is what reads as
 *  "responsive"; release slowness is what stops the frame juddering. */
const ATTACK = 0.03;
const RELEASE = 0.25;

/**
 * The two averages relative loudness is the ratio of, in real seconds.
 *
 * The long one is the reference: twenty-five seconds means a chorus is measured
 * against the verse before it and the one before that, and it also means a piece
 * that never changes level reads 1 throughout — which is correct. This is a
 * *relative* loudness and its whole content is what the music just did.
 *
 * The short one is a passage rather than a moment, and that is a departure from
 * §3.2 of the reach document, which asks for a fifth of a second. At that length
 * the ratio is an event detector: a crash with a 1.4s tail dominates a 0.2s
 * window completely, so the figure swung by ±0.4 once every four bars and the
 * depth multiplier taken from it pumped on a period a viewer could count. What
 * this is for is the difference between a verse and a chorus, and a verse is
 * seconds long.
 */
const LOUD_SHORT = 1.2;
const LOUD_LONG = 25;
/** Real seconds before the ratio is believed in full. The long average is
 *  seeded from the short one when sound first arrives, so it starts at parity
 *  rather than at zero, and this fades the difference in over the first few
 *  seconds while the reference is still mostly the moment it was seeded in. */
const LOUD_SETTLE = 6;
/** How far the ratio may travel. Past these it is a source being switched, a
 *  track ending or a microphone being picked up, none of which is a dynamic. */
const LOUD_MIN = 0.35;
const LOUD_MAX = 2.5;

/**
 * The three bands flux is measured in, and the reason there are three.
 *
 * A single sum over the spectrum is dominated by whichever region covers the
 * most bins: a hat spread across three hundred of them and a kick occupying
 * seven produce fluxes that differ by two orders of magnitude, so one median
 * threshold can only ever be tuned for the larger. Split — and each divided by
 * its own bin count — a kick, a snare and a hat become three comparable event
 * streams, and the threshold that suits one suits all three.
 *
 * Note what is deliberately *not* done here. §3.1 of the reach document also
 * asks for per-bin whitening, dividing each bin by its own running maximum
 * before differencing. That is the right move on a linear spectrum and a no-op
 * on this one: `getByteFrequencyData` is already logarithmic, so a bin rising
 * 10dB contributes the same delta whether it sits at -80dBFS or -40. The
 * imbalance whitening exists to fix is the *linear* one, and it was fixed
 * before the data arrived. What is left is the bin-count imbalance above, which
 * whitening would not have touched.
 */
const FLUX_EDGES: readonly [number, number][] = [
  [20, 200],
  [200, 2000],
  [2000, 10000],
];
const FLUX_BANDS = FLUX_EDGES.length;
/** Half-width of the maximum filter as a fraction of the bin's own frequency,
 *  and the cap on it in bins. See `maxFiltered` — 2.5% is a little over a
 *  vibrato's usual depth, which is what it has to cover. */
const FLUX_BANDWIDTH = 0.03;
const FLUX_MAX_RADIUS = 12;
/** Seconds of flux history the adaptive threshold is taken from. */
const FLUX_WINDOW = 1;
/**
 * Frames between recomputes of the median.
 *
 * The threshold tracks a second of history, so it has nothing to say that
 * changes within four frames — and a sort per frame on a phone that is already
 * giving up resolution is exactly the cost this feature must not add.
 */
const MEDIAN_EVERY = 4;
/**
 * How far the ceiling that onset *strength* is measured against decays, real
 * seconds.
 *
 * Strength cannot be taken from the detection threshold, which is what this
 * originally did. The threshold is a median over a second of flux, and a second
 * of flux is mostly frames with no onset in them — so the median is tiny, every
 * real hit clears it by two orders of magnitude, and every onset reported 1.0.
 * Measured: 79 of 79. Nothing downstream could tell a crash from a closed
 * hi-hat, which made the accent channel impossible and gave the whole feature a
 * single flat dynamic.
 *
 * Against a slowly-decaying peak instead, strength means "how big was this hit
 * compared with the biggest hits lately" — which is the question worth asking,
 * and the same adaptive move made everywhere else here. Eight seconds is long
 * enough to hold a chorus crash over the verse that follows it.
 */
const ONSET_CEILING_FALL = 8;
/** How far over the median counts as an event. */
const ONSET_SENSITIVITY = 1.7;
/** And an absolute floor under that, so a passage of near-zero flux cannot
 *  make its own noise into a beat. */
const ONSET_FLOOR = 0.0035;
/**
 * Minimum real seconds between onsets.
 *
 * The cheapest defence against double-triggering on one transient, and — not
 * incidentally — the first of the three photosensitivity defences (§5 of the
 * plan). It caps event rate at 10Hz before anything downstream sees it. That is
 * still inside the danger band on its own, which is why the safety governor
 * stays authoritative over anything that reaches the frame.
 */
const REFRACTORY = 0.1;

/** The tempo range considered, in seconds per beat: 60–180 BPM. */
const MIN_PERIOD = 60 / 180;
const MAX_PERIOD = 60 / 60;
/** Seconds of onsets the tempo histogram is built from. */
const IOI_WINDOW = 8;
/** ~10ms per bin across the range, which is finer than the jitter. */
const IOI_BINS = 64;
/** Onsets needed in the window before any tempo is claimed at all. */
const MIN_ONSETS = 6;
/** Weak coupling: one spurious onset in a quiet passage should bend the grid
 *  slightly, not derail it. */
const PLL_PHASE_GAIN = 0.12;
const PLL_PERIOD_GAIN = 0.04;
/** How far the histogram has to disagree with the running period before the
 *  lock is abandoned and re-taken rather than nudged. */
const RELOCK_RATIO = 0.15;
/** Seconds over which confidence follows the histogram, so it neither flickers
 *  nor holds a lock through a whole quiet passage. */
const CONFIDENCE_TAU = 1.5;
/** Where the histogram's peak ratio saturates. Below this it is noise. */
const PEAK_FLOOR = 0.12;
const PEAK_CEILING = 0.45;

/**
 * Confidence above which the beat grid is worth following — the threshold §4.1
 * of the plan hands the composition's fixed grid back below.
 *
 * Measured rather than guessed, against synthetic material at 90/120/128/150
 * BPM. A steady pulse reaches 100% within about eight seconds and a jittery one
 * holds 80–98%; onsets at random intervals peak at 37% and settle near 28%, and
 * a pad with no transient in it never leaves 0%. Anywhere in the gap would do;
 * this sits nearer the noise so that a difficult track is followed rather than
 * abandoned, since the cost of a wrong lock is a grid slightly off the music
 * and the cost of no lock is the feature not running.
 */
export const LOCK_THRESHOLD = 0.55;
/**
 * Confidence the lock is *held* to once taken — §3.7 of
 * `docs/visualizer-audio-attribution.md`.
 *
 * A single threshold with a long crossfade either side of it is the worst
 * arrangement available for material that sits near it, and every measurement
 * behind the figure above was taken on synthetic patterns that do not. A real
 * track through a room dips whenever the drummer leaves a bar out, and each dip
 * cost a 1.5s fade out of the synthesised path, a 6s one out of the tempo lock,
 * and the same again coming back — so a track that crossed once every twenty
 * seconds spent most of its length in a smear that is neither path.
 *
 * Well below the take threshold, because the two decisions are genuinely
 * different: taking a lock on weak evidence puts the composition on a grid that
 * may be wrong, where holding one already taken merely rides out a passage the
 * detector cannot see through. The grid free-runs perfectly well across a bar
 * with nothing in it; that is what a phase-locked loop is for.
 */
export const LOCK_RELEASE = 0.3;

const DEFAULT_PERIOD = 0.5;


/**
 * The fill, and what it is measured on.
 *
 * A fill is a burst of activity *before a downbeat*, so this is a fast average of
 * the upper two flux bands against a slow one, weighted by how near the bar's end
 * the moment is. A burst at the top of a bar is a busy bar; the same burst at the
 * end of one is a run-up, and only the second is worth anticipating.
 *
 * On flux *energy* rather than on a count of onsets, which is what this measured
 * first and is worth recording as a dead end. Onset counting is defeated by the
 * global refractory: it caps the merged stream at 10Hz, so a half-bar window at
 * 128BPM holds about five events and gaining or losing one swings the figure by a
 * fifth. Measured over a run with a sixteenth-note fill in every eighth bar, the
 * ratio averaged 1.62 through the fills and 1.00 elsewhere — but ordinary bars
 * *peaked* at 2.25, above anything the fills reached, so no threshold separates
 * them. The energy in the same bands is continuous, is not rate-limited, and
 * carries the same information without being counted.
 */
const FILL_FAST_BARS = 0.2;
const FILL_SLOW_BARS = 2.5;
const FILL_RATIO = 1.25;
const FILL_CEILING = 2.1;
/** Where in the bar a fill starts counting, and where it counts in full. */
const FILL_FROM = 0.45;
const FILL_TO = 0.72;
/** Real seconds the fill follows its own measurement. Short — this is the one
 *  channel that has to be able to rise inside half a bar, since arriving late
 *  with an anticipation is worse than not having one. */
const FILL_TAU = 0.18;

/**
 * The breakdown and the drop, in the low band's own normalised units.
 *
 * Deliberately on `bands[0]` rather than on broadband level: what a listener
 * hears as a break is the bottom going away, and a breakdown with a pad still
 * playing over it barely moves the broadband figure at all. Held in both
 * directions on the silence gate's argument — a bar with no kick in it is not a
 * breakdown, and a single kick does not end one.
 */
const LOW_PRESENT = 0.3;
/**
 * How long the low end must be gone, and how long the break must have lasted for
 * its end to be a drop — both in *bars*, with a floor in seconds for the
 * unlocked case.
 *
 * Bars rather than seconds, and that is not a refinement: fixed at 0.55s this
 * fired between the kicks. A kick on one and three at 128BPM leaves a 0.94s gap
 * and the low band's envelope release is 0.25s, so the detector called a
 * breakdown in the second half of every bar — measured, `inBreak` true for 10% of
 * a run with no breakdown anywhere in it. A break is "the bottom has been gone
 * for more than a bar", which is a musical duration, and at a bar and a tenth it
 * clears a kick on the downbeat alone with room to spare.
 *
 * The drop's minimum is two bars for the same reason it was ever a number: one
 * bar without a kick is a rest in the arrangement, and two is a section.
 */
const BREAK_HOLD_BARS = 1.1;
const BREAK_MIN_BARS = 2;
const BREAK_HOLD = 0.55;
const BREAK_MIN = 1.6;

/** Beats to a bar. Four is the overwhelmingly common answer and the only one
 *  anything here tries to find. */
export const BEATS_PER_BAR = 4;
/**
 * Bars of memory in the downbeat accumulators, and how far the winner must lead
 * the field before its lead is believed at all.
 *
 * Eight bars because the cue is statistical rather than per-event: any single
 * bar can have its loudest transient anywhere, and what identifies beat one is
 * that it is loudest *usually*.
 */
const DOWNBEAT_MEMORY = 8;
const DOWNBEAT_MARGIN = 0.06;
/** How much of the top band joins the kick in the cue. See `creditBeat`. */
const DOWNBEAT_AIR = 0.6;
/** Beats of evidence before the lead means anything. Four accumulators holding
 *  two credits each have a largest one by accident, and without this the
 *  detector announces a confident downbeat in its first bar and then spends the
 *  next twenty seconds walking away from it. */
const DOWNBEAT_EVIDENCE = BEATS_PER_BAR * 3;
/**
 * Real seconds for the bar phase to slide onto the detected downbeat.
 *
 * Slid, never stepped, and this is the whole reason the bar has a loop of its
 * own rather than being computed as `beatCount % 4` at the point of use. A
 * detector that changes its mind — which it does once or twice early in a track
 * and then not again — would otherwise move every bar-length gesture in the
 * composition to a different part of the bar between one frame and the next. At
 * six seconds the correction is spread over three bars at 120BPM and is below
 * the rate at which anything on the bar row moves anyway.
 */
const BAR_LOCK_TAU = 6;

/**
 * The backbeat, found the same way the downbeat is: statistically, per residue.
 *
 * The obvious implementation — test whether a mid-band onset lands near bar
 * phase 0.25 or 0.75 — was built first and does not work, for two reasons that
 * only measurement finds:
 *
 * - It depends on the bar being aligned to the *quarter*, and the bar's
 *   alignment comes from `creditBeat`, whose documented weakness is exactly the
 *   commonest pattern in popular music: a kick on one and three weights those two
 *   residues equally, `downbeatConfidence` stays at 0, and the bar loop then
 *   free-runs from whichever beat the lock happened to open on. Measured on
 *   synthetic 128BPM material with kick on 1/3 and snare on 2/4: 161 mid-band
 *   onsets, every one of them correctly placed, and *zero* backbeats credited.
 * - Even with the bar aligned, the snare arrives about 100ms after the grid says
 *   the beat did — the phase-locked loop is driven by the merged onset stream,
 *   which on most material is dominated by the hats, and a hi-hat's flux rises
 *   sooner than a snare's. Any window tight enough to be meaningful rejects it.
 *
 * Accumulating mid-band peaks per residue instead answers both at once. It needs
 * no bar alignment, because it *finds* the pair of beats the snare is on; it
 * needs no timing window, because the statistics are the timing test; and it
 * inherits `creditBeat`'s argument that what identifies a position in the bar is
 * that it is loudest *usually*.
 *
 * The residues come in pairs — whichever beat wins and the one opposite it —
 * since a backbeat is a two-beat pattern and a bar with a snare on two has one
 * on four.
 */
const BACKBEAT_MEMORY = 8;
const BACKBEAT_MARGIN = 0.04;
/** Beats of evidence before the lead means anything, on `DOWNBEAT_EVIDENCE`'s
 *  argument: four accumulators holding two credits each have a largest one by
 *  accident. */
const BACKBEAT_EVIDENCE = BEATS_PER_BAR * 3;

/**
 * Where the flux crest — peak over median — is taken to mean percussive.
 *
 * The quantity `clarity` is built from, and it is a ratio, so the mapping is
 * logarithmic. A drone's flux is nearly constant and sits near 1; a kit runs an
 * order of magnitude above its own median. Nothing here needs the boundary to be
 * sharp: what it is for is knowing which of two ways to drive the composition,
 * and the crossfade between them is what makes a wrong answer cheap.
 */
const CLARITY_FLOOR = 2.2;
const CLARITY_CEILING = 11;
/** Real seconds clarity follows the crest. Long: this is a property of the
 *  material, not of the bar, and a value that moved would be a third channel
 *  nobody asked for. */
const CLARITY_TAU = 4;

/** Frame-rate independent one-pole coefficient for a time constant. */
function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A band's raw energy mapped into 0..1 against its *own* recent range.
 *
 * This is the load-bearing part of the whole feature, and the reasons are worth
 * keeping next to the code. Recordings differ in level by more than any binding
 * varies over its whole range, so fixed thresholds tuned on a modern master are
 * wrong on a 1960s transfer. On the microphone path the listener's distance
 * from the speaker is an arbitrary gain nothing here can know about. And bands
 * are not comparable to each other — nearly every recording has far more energy
 * below 200Hz than above 8kHz, so without this, `high` would read as "quieter
 * than the bass" rather than as "bright for this track", which is what makes
 * hats usable as a channel at all.
 */
class BandScaler {
  private ceiling = 0;
  private floor = 1;
  private envelope = 0;

  normalise(raw: number, dt: number): number {
    if (raw > this.ceiling) this.ceiling = raw;
    else this.ceiling += (raw - this.ceiling) * coefficient(dt, CEILING_FALL);
    if (raw < this.floor) this.floor = raw;
    else this.floor += (raw - this.floor) * coefficient(dt, FLOOR_RISE);

    const span = this.ceiling - this.floor;
    const target = span < MIN_SPAN ? 0 : clamp01((raw - this.floor) / span);

    const tau = target > this.envelope ? ATTACK : RELEASE;
    this.envelope += (target - this.envelope) * coefficient(dt, tau);
    return this.envelope;
  }

  reset(): void {
    this.ceiling = 0;
    this.floor = 1;
    this.envelope = 0;
  }
}

/**
 * One band's flux, its adaptive threshold, and its own onset stream.
 *
 * Three of these run side by side. Each keeps its own median, its own decaying
 * peak for strength, and its own refractory period, so a kick, a snare and a hat
 * are detected independently rather than summed into one signal in which the
 * largest of them is the only one that can ever clear a threshold.
 */
class FluxBand {
  private history: number[] = [];
  private countdown = 0;
  private ceiling = 0;
  private since = REFRACTORY;
  /** In flux units, for the meter to draw against `value`. */
  threshold = 0;
  scale = 0.01;
  /** Peak over median across the window — how transient-like this band is. */
  crest = 1;
  /** Raw flux this frame, and whether it was an event. */
  value = 0;
  fired = false;
  strength = 0;

  update(flux: number, dt: number, silent: boolean): void {
    this.value = flux;
    this.fired = false;
    this.strength = 0;

    const capacity = Math.max(8, Math.round(FLUX_WINDOW / dt));
    this.history.push(flux);
    while (this.history.length > capacity) this.history.shift();

    /*
     * A median rather than a mean, because the peaks are what is being detected
     * and a mean is dragged upward by exactly the events it is meant to be
     * measured against — one loud snare would raise it enough to hide the next.
     */
    if (--this.countdown <= 0) {
      this.countdown = MEDIAN_EVERY;
      const sorted = [...this.history].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1] ?? 0;
      const peak = sorted[sorted.length - 1] ?? 0;
      this.threshold = Math.max(median * ONSET_SENSITIVITY, ONSET_FLOOR);
      this.crest = peak / Math.max(median, ONSET_FLOOR * 0.25);
      // Only for the meter: flux is a small number whose useful range depends
      // on the material, and a bar that never leaves the first pixel tells the
      // person tuning this nothing.
      this.scale += (Math.max(peak, ONSET_FLOOR * 2) - this.scale) * 0.25;
    }

    this.ceiling *= Math.exp(-dt / ONSET_CEILING_FALL);
    this.since += dt;
    if (silent || flux <= this.threshold || this.since < REFRACTORY) return;

    this.since = 0;
    this.fired = true;
    if (flux > this.ceiling) this.ceiling = flux;
    // Against the recent peak, not the detection threshold — see
    // `ONSET_CEILING_FALL` for why the obvious denominator is the wrong one.
    this.strength = clamp01(flux / Math.max(ONSET_FLOOR * 2, this.ceiling));
  }

  /** 0..1 against the band's own display scale. */
  get shown(): number {
    return clamp01(this.value / Math.max(1e-5, this.scale));
  }

  get shownThreshold(): number {
    return clamp01(this.threshold / Math.max(1e-5, this.scale));
  }

  reset(): void {
    this.history = [];
    this.countdown = 0;
    this.ceiling = 0;
    this.since = REFRACTORY;
    this.threshold = 0;
    this.scale = 0.01;
    this.crest = 1;
    this.value = 0;
    this.fired = false;
    this.strength = 0;
  }
}

export class AudioReactor {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  // Explicitly backed by an `ArrayBuffer` rather than the default
  // `ArrayBufferLike`: `getByteFrequencyData` will not accept a view that might
  // be over shared memory.
  private spectrum: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private previous: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** Inclusive bin index ranges per band, resolved once the sample rate is
   *  known. Empty until `start()` has succeeded. */
  private bandBins: [number, number][] = [];
  private fluxBins: [number, number][] = [];

  private readonly scalers = Array.from({ length: BAND_COUNT }, () => new BandScaler());
  private readonly levelScaler = new BandScaler();
  private readonly bands = new Array<number>(BAND_COUNT).fill(0);

  private readonly flux = Array.from({ length: FLUX_BANDS }, () => new FluxBand());
  /** The global refractory across all three bands. A kick and its snare share a
   *  transient often enough that three streams would otherwise report one hit
   *  as three, which the tempo histogram would read as a triplet. */
  private sinceOnset = REFRACTORY;
  private clarity = 0;
  /** How much the published grid runs ahead of the analysed one, real seconds.
   *  See `setLatency`. */
  private latency = 0;
  /** The lock, with hysteresis. See `LOCK_RELEASE`. */
  private locked = false;
  /** Backbeat evidence: mid-band weight per residue, which of them the snare is
   *  on, and how far that pair leads the other. See `BACKBEAT_MEMORY`. */
  private readonly snareWeight = new Float32Array(BEATS_PER_BAR);
  private snarePeak = 0;
  private snareSlot = 1;
  private backbeatCredit = 0;
  private snareCredited = 0;
  private lastBackbeatBeat = -1;
  /** The fill's own follower, and the two structural timers. */
  private fill = 0;
  private fillFast = 0;
  private fillSlow = 0;
  private lowGoneFor = 0;
  private lowHeldFor = 0;
  private breakLength = 0;

  private onsetTimes: number[] = [];
  private elapsed = 0;
  private period = DEFAULT_PERIOD;
  private phase = 0;
  private beats = 0;
  private confidence = 0;

  /** The bar loop: its own phase, its own count, and the four accumulators that
   *  decide which beat of the four it should start on. See `creditBeat`. */
  private barPhase = 0;
  private bars = 0;
  private readonly beatWeight = new Float32Array(BEATS_PER_BAR);
  /** Peak low-band flux since the last beat — what gets credited. */
  private beatPeak = 0;
  /** Which residue of `beats` the detector currently calls beat one. */
  private downbeat = 0;
  private downbeatConfidence = 0;
  private credited = 0;
  /** Where the histogram says confidence should settle. Integrated toward on
   *  every frame by `trackTempo`, not here — see the note there. */
  private target = 0;

  private quietFor = 0;
  private loudFor = 0;
  /** The two running levels behind `AudioFrame.loudness`, and how much
   *  non-silent material the long one has actually heard. */
  private shortLevel = 0;
  private longLevel = 0;
  private heard = 0;
  /** Decibels the analyser's byte range spans, read off the node rather than
   *  assumed — `AudioFrame.loudness` is the only figure here in absolute units
   *  and it is the only one that needs to know. */
  private dbSpan = 70;

  private readonly current = emptyFrame();

  private state: AudioStatus = "off";
  private activeSource: AudioSource | null = null;
  private activeDevice: string | null = null;
  private failure: string | null = null;
  /** Fired on every status change, so the panel can re-render without polling
   *  for a value that changes twice a session. */
  onStatus: (() => void) | null = null;

  get status(): AudioStatus {
    return this.state;
  }

  get source(): AudioSource | null {
    return this.activeSource;
  }

  /** The input `mic` was opened on, or null for the system default and for
   *  every display capture. */
  get device(): string | null {
    return this.activeDevice;
  }

  get error(): string | null {
    return this.failure;
  }

  /** The most recent frame. Read-only to everything but `sample`. */
  get frame(): AudioFrame {
    return this.current;
  }

  get active(): boolean {
    return this.state === "listening";
  }

  /**
   * How far ahead of the analysis the published grid should run, real seconds —
   * §3.7 of `docs/visualizer-audio-attribution.md`.
   *
   * There is latency between the speaker and this object that nothing here can
   * measure: the capture device's buffer, the browser's own, and on the display
   * path whatever the tab's output stage adds. The analysis latency is already
   * absorbed for free, because the grid *predicts* rather than reports — but a
   * prediction is only free if it is aimed where the viewer hears the beat rather
   * than where the analyser saw it, and that offset is a property of the machine.
   *
   * So it is one number, set from the config, applied to every published phase at
   * the last moment. Nothing upstream of the publication sees it: the detector,
   * the histogram and the phase-locked loop all continue to run on what actually
   * arrived, because their job is to be right about the signal rather than about
   * the room.
   *
   * Positive moves the composition earlier against the music, which is the
   * direction every source of latency in the chain pushes.
   */
  setLatency(seconds: number): void {
    this.latency = Number.isFinite(seconds) ? Math.min(0.5, Math.max(-0.2, seconds)) : 0;
  }

  private setStatus(status: AudioStatus, failure: string | null = null): void {
    this.state = status;
    this.failure = failure;
    this.onStatus?.();
  }

  /**
   * Open a capture and begin analysing.
   *
   * Only ever called from an explicit gesture. The microphone prompt is the
   * most alarming thing the browser can put in front of someone, on a page that
   * is a comic gallery — so it is never requested on load, never from a shared
   * link, and the chosen source is deliberately absent from both `VizConfig`
   * and the `vizcfg` URL codec. A pasted configuration must not be able to open
   * a stranger's microphone, and a link must not be able to send one. `device`
   * is held to the same rule for the same reason, and because an id minted for
   * this origin means nothing anywhere else.
   *
   * `device` names an input on the `mic` path — a microphone, or equally a
   * loopback device carrying what the machine is playing, which is the one way
   * of hearing a tab that does not put a capture bar over the run. Omitted, the
   * system default is opened. It is ignored on the display path, where the
   * browser's own picker chooses.
   */
  async start(source: AudioSource, device?: string): Promise<void> {
    if (this.state === "requesting") return;
    this.stop();

    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || !navigator.mediaDevices) {
      this.setStatus("unsupported", "This browser has no Web Audio capture.");
      return;
    }

    this.setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = source === "mic" ? await captureMic(device) : await captureDisplay();
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.setStatus(denied ? "denied" : "error", describe(error));
      return;
    }

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      this.setStatus(
        "silent-share",
        "That share had no audio. Tick “share tab audio” in the picker."
      );
      return;
    }

    const context = new Ctor();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    // Connected to the analyser and to nothing else. Routing a microphone to
    // the destination would put the room through the speakers it is listening
    // to, which is a feedback loop rather than a monitor.
    const node = context.createMediaStreamSource(stream);
    node.connect(analyser);

    this.context = context;
    this.analyser = analyser;
    this.stream = stream;
    this.node = node;
    this.activeSource = source;
    // What was asked for rather than what arrived: `exact` below means the two
    // cannot differ, and the track's own `deviceId` is absent on the display
    // path anyway.
    this.activeDevice = source === "mic" ? (device ?? null) : null;

    const bins = analyser.frequencyBinCount;
    this.spectrum = new Uint8Array(bins);
    this.previous = new Uint8Array(bins);
    // A bin's centre frequency is `index * sampleRate / fftSize`, so the whole
    // mapping falls out of the rate the context actually opened at — which is
    // the device's, not a number worth assuming.
    const perBin = context.sampleRate / FFT_SIZE;
    this.bandBins = BAND_EDGES.map(([low, high]) => [
      Math.max(1, Math.floor(low / perBin)),
      Math.min(bins - 1, Math.ceil(high / perBin)),
    ]);
    this.fluxBins = FLUX_EDGES.map(([low, high]) => [
      Math.max(1, Math.floor(low / perBin)),
      Math.min(bins - 1, Math.ceil(high / perBin)),
    ]);
    // Whatever the node's own range is, so `trackLoudness` can turn a byte
    // difference back into decibels. The defaults are -100 and -30 and nothing
    // here changes them, but reading is free and assuming is a silent error.
    this.dbSpan = Math.max(1, analyser.maxDecibels - analyser.minDecibels);

    // The stream ending underneath us is a real event on the display path: the
    // user stops the share from the browser's own bar, not from anything here.
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => this.stop());
    });

    // Autoplay policy suspends a context created outside a gesture. This one is
    // inside one, but resuming is free and the failure is silent otherwise.
    if (context.state === "suspended") await context.resume().catch(() => undefined);

    this.resetAnalysis();
    this.setStatus("listening");
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.analyser = null;
    this.context = null;
    this.activeSource = null;
    this.activeDevice = null;
    this.resetAnalysis();
    Object.assign(this.current, emptyFrame());
    if (this.state !== "off") this.setStatus("off");
  }

  dispose(): void {
    this.onStatus = null;
    this.stop();
  }

  private resetAnalysis(): void {
    this.scalers.forEach((scaler) => scaler.reset());
    this.levelScaler.reset();
    this.flux.forEach((band) => band.reset());
    this.sinceOnset = REFRACTORY;
    this.clarity = 0;
    this.locked = false;
    this.snareWeight.fill(0);
    this.snarePeak = 0;
    this.snareSlot = 1;
    this.backbeatCredit = 0;
    this.snareCredited = 0;
    this.lastBackbeatBeat = -1;
    this.fill = 0;
    this.fillFast = 0;
    this.fillSlow = 0;
    this.lowGoneFor = 0;
    this.lowHeldFor = 0;
    this.breakLength = 0;
    this.barPhase = 0;
    this.bars = 0;
    this.beatWeight.fill(0);
    this.beatPeak = 0;
    this.downbeat = 0;
    this.downbeatConfidence = 0;
    this.credited = 0;
    this.onsetTimes = [];
    this.elapsed = 0;
    this.period = DEFAULT_PERIOD;
    this.phase = 0;
    this.beats = 0;
    this.confidence = 0;
    this.target = 0;
    this.quietFor = 0;
    this.loudFor = 0;
    this.shortLevel = 0;
    this.longLevel = 0;
    this.heard = 0;
    this.current.loudness = 1;
  }

  /**
   * Advance the analysis by one frame and return the features.
   *
   * Pulled by the engine once per *drawn* frame rather than pushed on a timer
   * of its own. The engine already paces itself — `shouldDraw` skips frames to
   * hold the device's cap — and a reactor on `setInterval` would keep producing
   * features on frames the composition never sees, on a clock nothing else in
   * the run shares.
   *
   * `dt` is real seconds. The caller passes the engine's unscaled frame delta,
   * not the composition clock's.
   */
  sample(dt: number): AudioFrame {
    const frame = this.current;
    frame.onset = false;
    frame.onsetStrength = 0;
    frame.onsetLow = false;
    frame.onsetMid = false;
    frame.onsetHigh = false;
    frame.strengthLow = 0;
    frame.strengthMid = 0;
    frame.strengthHigh = 0;
    frame.backbeat = 0;
    frame.drop = 0;

    const analyser = this.analyser;
    if (!analyser || this.state !== "listening") return frame;

    const step = Math.min(Math.max(dt, 1 / 240), 0.1);
    this.elapsed += step;
    analyser.getByteFrequencyData(this.spectrum);

    this.readBands(step);
    this.readFlux(step);
    this.trackTempo(step);
    this.readStructure(step);

    frame.low = this.bands[0];
    frame.lowMid = this.bands[1];
    frame.mid = this.bands[2];
    frame.high = this.bands[3];

    /*
     * The grid, moved forward by whatever the machine's own latency is. Applied
     * once, here, to the *published* phases only — see `setLatency`.
     *
     * The carry is what makes the counts stay consistent with the phases they
     * are published beside: a compensation that pushes the phase past a whole
     * beat has pushed the composition into the next one, and a `beatCount` left
     * behind would put every discrete gesture a beat away from the continuous
     * ones. Monotonic for any fixed latency; dragging the slider can step it,
     * which is a tuning control moving rather than a signal.
     */
    const beatLead = this.latency / this.period;
    const shiftedBeat = this.phase + beatLead;
    const beatCarry = Math.floor(shiftedBeat);
    frame.beatPhase = shiftedBeat - beatCarry;
    frame.beatCount = this.beats + beatCarry;
    frame.nextBeatIn = (1 - frame.beatPhase) * this.period;

    const barLead = this.latency / (this.period * BEATS_PER_BAR);
    const shiftedBar = this.barPhase + barLead;
    const barCarry = Math.floor(shiftedBar);
    frame.barPhase = shiftedBar - barCarry;
    frame.barCount = this.bars + barCarry;

    frame.bpm = this.confidence > 0 ? 60 / this.period : 0;
    frame.confidence = this.confidence;
    frame.downbeatConfidence = this.downbeatConfidence;
    frame.backbeatConfidence = clamp01(this.backbeatCredit);
    // Hysteresis, and the reason it is decided here rather than by each consumer
    // testing the threshold for itself. See `LOCK_RELEASE`.
    this.locked = this.locked
      ? this.confidence >= LOCK_RELEASE && !frame.silent
      : this.confidence >= LOCK_THRESHOLD && !frame.silent;
    frame.locked = this.locked;

    // The spectrum becomes the next frame's reference only after the flux has
    // been taken off it.
    this.previous.set(this.spectrum);
    return frame;
  }

  private readBands(dt: number): void {
    let broadband = 0;
    for (let band = 0; band < BAND_COUNT; band++) {
      const [from, to] = this.bandBins[band];
      let sum = 0;
      for (let i = from; i <= to; i++) sum += this.spectrum[i];
      const raw = sum / Math.max(1, (to - from + 1) * 255);
      broadband += raw;
      this.bands[band] = this.scalers[band].normalise(raw, dt);
    }
    broadband /= BAND_COUNT;

    /*
     * The silence gate, and it runs on the *raw* broadband level rather than on
     * anything normalised — the whole failure it exists to catch is adaptive
     * normalisation doing its job on a signal that is only room tone.
     *
     * Held in both directions so that neither a rest in the music nor a cough
     * in the room flips it, and asymmetrically so dropping out takes longer to
     * believe than coming back.
     */
    if (broadband < SILENCE_LEVEL) {
      this.quietFor += dt;
      this.loudFor = 0;
    } else {
      this.loudFor += dt;
      this.quietFor = 0;
    }
    if (this.quietFor > SILENCE_HOLD) this.current.silent = true;
    else if (this.loudFor > SILENCE_HOLD * 0.4) this.current.silent = false;

    this.current.level = this.current.silent ? 0 : this.levelScaler.normalise(broadband, dt);
    this.trackLoudness(broadband, dt);
  }

  /**
   * Relative loudness — the one measurement here that is deliberately not
   * range-normalised, and the reason it has to exist.
   *
   * `BandScaler` maps every band into 0..1 against its own recent range. That is
   * load-bearing and it is why the detector works at all across a 1960s transfer
   * and a modern master, and across the listener's distance from the speaker.
   * It also means a quiet verse and a loud chorus both arrive as 0..1 — so the
   * single most legible thing music does is deleted in the first stage of the
   * analysis, and nothing downstream can put it back.
   *
   * A *ratio* rather than a subtraction of a running mean, which is what the
   * binding layer did instead and why it was only ever half-committed to it. A
   * subtraction is a high-pass: it is the right operation for an event channel,
   * where "louder than a moment ago" is the whole content, and the wrong one for
   * a level, because a steady groove has a steady mean and subtracting all of it
   * leaves nothing exactly where the music is most regular. A ratio holds at 1
   * through that groove and still reads 1.4 when the chorus arrives.
   *
   * Averaged and differenced in *decibels*, then converted to an amplitude
   * ratio at the end, because that is the scale the numbers arrive on:
   * `getByteFrequencyData` reports `255 * (dB - min) / (max - min)`, so a bin at
   * twice the amplitude is about twenty-two byte units higher rather than twice
   * the value. A ratio taken directly on those bytes is a ratio of decibels,
   * which is not a ratio of anything — it reads a doubling in level as about
   * 1.2 and a source with a different noise floor as a different piece of music.
   */
  private trackLoudness(broadband: number, dt: number): void {
    /*
     * The reference does not learn through a gap between tracks. A long average
     * left running through one sags toward silence, which would report the
     * pause as the quietest thing ever played and the next track's first bar as
     * a chorus — the same failure the silence gate exists to prevent one level
     * up, for the same reason.
     */
    if (this.current.silent) {
      this.current.loudness = 1;
      return;
    }
    // Both seeded at the level itself on the first frame of sound rather than
    // from wherever the filters had crept to during the silence before it. Seed
    // the long one from a short average that is only a fraction risen and the
    // reference is set below the music for the next twenty-five seconds — which
    // reads as a run that opens on a permanent chorus.
    if (this.heard <= 0) {
      this.shortLevel = broadband;
      this.longLevel = broadband;
    }
    this.shortLevel += (broadband - this.shortLevel) * coefficient(dt, LOUD_SHORT);
    this.longLevel += (broadband - this.longLevel) * coefficient(dt, LOUD_LONG);
    this.heard = Math.min(LOUD_SETTLE, this.heard + dt);

    const ratio = Math.pow(10, ((this.shortLevel - this.longLevel) * this.dbSpan) / 20);
    // Raised to the settle fraction rather than interpolated toward 1: the
    // quantity is a ratio, so its neutral is 1 and its identity fade is an
    // exponent.
    const eased = Math.pow(ratio, this.heard / LOUD_SETTLE);
    this.current.loudness = Math.min(LOUD_MAX, Math.max(LOUD_MIN, eased));
  }

  private readFlux(dt: number): void {
    const frame = this.current;
    this.sinceOnset += dt;

    /*
     * Spectral flux per band: the positive part of the change in every bin since
     * the last frame, rectified because an onset is energy *arriving* — a decay
     * is not an event, and counting it would put a second trigger on the tail of
     * every note. Divided by the band's own bin count so the three are
     * comparable; see `FLUX_EDGES`.
     */
    for (let band = 0; band < FLUX_BANDS; band++) {
      const [from, to] = this.fluxBins[band];
      let sum = 0;
      for (let i = from; i <= to; i++) {
        const delta = this.spectrum[i] - this.maxFiltered(i, from, to);
        if (delta > 0) sum += delta;
      }
      this.flux[band].update(sum / Math.max(1, (to - from + 1) * 255), dt, frame.silent);
    }

    /*
     * The three streams, published as three — §3.3 of the attribution document.
     *
     * Outside the global refractory below on purpose. That gate exists so the
     * tempo histogram does not read a kick and the snare landing on top of it as
     * a triplet, which is a property of the histogram; a binding that wants the
     * kick and the snare separately wants both of them, on the frames they
     * actually happened.
     */
    frame.onsetLow = this.flux[0].fired;
    frame.onsetMid = this.flux[1].fired;
    frame.onsetHigh = this.flux[2].fired;
    frame.strengthLow = this.flux[0].strength;
    frame.strengthMid = this.flux[1].strength;
    frame.strengthHigh = this.flux[2].strength;
    this.readBackbeat(frame);

    frame.fluxLow = this.flux[0].shown;
    frame.fluxMid = this.flux[1].shown;
    frame.fluxHigh = this.flux[2].shown;
    frame.fluxLowThreshold = this.flux[0].shownThreshold;
    frame.fluxMidThreshold = this.flux[1].shownThreshold;
    frame.fluxHighThreshold = this.flux[2].shownThreshold;

    // The loudest band against its own scale, so anything wanting one number
    // gets the one that is currently saying something.
    let loudest = 0;
    for (let band = 1; band < FLUX_BANDS; band++) {
      if (this.flux[band].shown > this.flux[loudest].shown) loudest = band;
    }
    frame.flux = this.flux[loudest].shown;
    frame.fluxThreshold = this.flux[loudest].shownThreshold;

    /*
     * Clarity, from the crest of whichever band is most peaked. A ratio of peak
     * to median, so it says how transient-like the material is without any
     * reference to how loud it is — a quiet kit scores high and a loud drone
     * scores low, which is the distinction the whole quantity exists to make.
     */
    let crest = 1;
    for (const band of this.flux) crest = Math.max(crest, band.crest);
    const target = frame.silent
      ? 0
      : clamp01(
          Math.log2(crest / CLARITY_FLOOR) / Math.log2(CLARITY_CEILING / CLARITY_FLOOR)
        );
    this.clarity += (target - this.clarity) * coefficient(dt, CLARITY_TAU);
    frame.clarity = this.clarity;

    /*
     * What the downbeat is found from, tracked whether or not it crossed a
     * threshold. Mostly the low band — §3.4 asks for low-band peak energy and
     * the kick is the cue — with a share of the top band mixed in, because the
     * low band alone cannot break the commonest tie in popular music: a kick on
     * one *and* three weights those two residues almost equally, and what
     * separates them is usually a cymbal on the downbeat.
     */
    const cue = this.flux[0].value + this.flux[2].value * DOWNBEAT_AIR;
    if (cue > this.beatPeak) this.beatPeak = cue;

    if (frame.silent || this.sinceOnset < REFRACTORY) return;
    let strength = 0;
    for (const band of this.flux) if (band.fired) strength = Math.max(strength, band.strength);
    if (strength <= 0) return;

    this.sinceOnset = 0;
    frame.onset = true;
    frame.onsetCount++;
    frame.onsetStrength = strength;
    this.onsetTimes.push(this.elapsed);
    while (this.onsetTimes.length > 0 && this.elapsed - this.onsetTimes[0] > IOI_WINDOW) {
      this.onsetTimes.shift();
    }
    this.lockPhase();
    this.estimateTempo();
  }

  /**
   * The backbeat: a mid-band onset landing where the bar says beats two and four
   * are — §3.3 of `docs/visualizer-audio-attribution.md`.
   *
   * Everything this needs has existed since phase 0 and there was simply no path
   * between the two facts. The bar loop knows where beat one is, `flux[1]` knows
   * when the snare hit, and the composition was being handed the maximum over all
   * three bands with the identity thrown away.
   *
   * Credited per beat rather than per hit, on `creditBeat`'s argument: any single
   * bar can have a mid-band transient anywhere, and what makes it a backbeat is
   * that it lands there *usually*. So the confidence rises over a few bars of
   * evidence and decays on beats that pass without one, and material in 3, or
   * with no snare in it, never raises it at all — which is the honest answer and
   * is what the gate downstream is for.
   *
   * One credit per beat, because a snare with a ghost note beside it is one
   * backbeat and would otherwise be two.
   */
  private readBackbeat(frame: AudioFrame): void {
    // Tracked whether or not it clears anything, exactly as the downbeat's cue
    // is: the evidence is the peak per beat, not the events that crossed a
    // threshold.
    if (this.flux[1].value > this.snarePeak) this.snarePeak = this.flux[1].value;

    if (!this.locked || this.backbeatCredit <= 0) return;
    if (!this.flux[1].fired || this.beats === this.lastBackbeatBeat) return;
    // The pair: whichever residue the snare is on and the one opposite it.
    const slot = ((this.beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    const opposite = (this.snareSlot + BEATS_PER_BAR / 2) % BEATS_PER_BAR;
    if (slot !== this.snareSlot && slot !== opposite) return;

    this.lastBackbeatBeat = this.beats;
    frame.backbeat = this.flux[1].strength;
  }

  /**
   * Fold the beat that just ended into the mid-band accumulators, and re-read
   * which pair of residues the snare is on. See `BACKBEAT_MEMORY`.
   *
   * The same shape as `creditBeat` and for the same reasons, with one difference:
   * what is scored is a *pair* rather than a single residue, because a backbeat
   * is a two-beat pattern. So the two opposing sums are compared rather than the
   * four individual ones, which also makes the answer immune to the half-bar
   * ambiguity that `creditBeat` cannot resolve — a snare on two and four scores
   * the same pair whichever of the two the bar happens to think is beat one.
   */
  private creditSnare(): void {
    const slot = ((this.beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    const decay = Math.exp(-1 / (BACKBEAT_MEMORY * BEATS_PER_BAR));
    for (let i = 0; i < BEATS_PER_BAR; i++) this.snareWeight[i] *= decay;
    const previous = (slot + BEATS_PER_BAR - 1) % BEATS_PER_BAR;
    this.snareWeight[previous] += this.snarePeak;
    this.snarePeak = 0;
    this.snareCredited = Math.min(BACKBEAT_EVIDENCE, this.snareCredited + 1);

    const even = this.snareWeight[0] + this.snareWeight[2];
    const odd = this.snareWeight[1] + this.snareWeight[3];
    const total = even + odd;
    if (total <= 0) return;

    const lead = Math.abs(even - odd) / total;
    this.backbeatCredit =
      clamp01((lead - BACKBEAT_MARGIN) / (0.35 - BACKBEAT_MARGIN)) *
      (this.snareCredited / BACKBEAT_EVIDENCE);
    if (this.backbeatCredit > 0) {
      // The stronger pair, and within it the stronger member — which one that is
      // does not matter to the test above and is only the label.
      const pair = even > odd ? [0, 2] : [1, 3];
      this.snareSlot = this.snareWeight[pair[0]] >= this.snareWeight[pair[1]] ? pair[0] : pair[1];
    }
  }

  /**
   * The fill, the breakdown and the drop — §3.5 of the attribution document, and
   * the three features that fire on the moments a viewer scores the whole thing
   * on.
   *
   * All three are *fast*, and that is the point of them. The section row already
   * in the binding compares a 3s average of the run's dynamics against a 22s one,
   * which is the right instrument for "the track has moved to a different level"
   * and cannot resolve a drop closer than a few seconds — by which time the
   * moment the gesture was for is over. These resolve to a frame.
   */
  private readStructure(dt: number): void {
    const frame = this.current;

    if (frame.silent) {
      this.fill = 0;
      this.lowGoneFor = 0;
      this.lowHeldFor = 0;
      this.breakLength = 0;
      frame.inBreak = false;
      return;
    }

    /*
     * The break, held in both directions on the silence gate's own argument: a
     * bar with no kick in it is not a breakdown and a single kick does not end
     * one. `breakLength` keeps running through the return so the drop below can
     * ask how long the thing it is ending actually lasted.
     */
    const present = this.bands[0] > LOW_PRESENT;
    if (present) {
      this.lowHeldFor += dt;
      this.lowGoneFor = 0;
    } else {
      this.lowGoneFor += dt;
      this.lowHeldFor = 0;
    }

    // In bars where there is a bar, in seconds where there is not. See
    // `BREAK_HOLD_BARS` — fixed seconds put the detector inside the gap between
    // two kicks, which is a bar-length quantity at every tempo.
    const barSeconds = this.period * BEATS_PER_BAR;
    const hold = Math.max(BREAK_HOLD, barSeconds * BREAK_HOLD_BARS);
    const minimum = Math.max(BREAK_MIN, barSeconds * BREAK_MIN_BARS);

    const wasInBreak = frame.inBreak;
    if (this.lowGoneFor > hold) {
      frame.inBreak = true;
      // The whole absence, not the part of it past the hold — otherwise the two
      // constants add and the minimum means three bars rather than the two it
      // says.
      this.breakLength = this.lowGoneFor;
    } else if (wasInBreak && this.lowHeldFor > 0) {
      frame.inBreak = false;
      // A break long enough to have been a section rather than a rest, ending on
      // the bottom coming back: the drop. Its strength is how much arrived,
      // measured against the band's own recent range like everything else here.
      if (this.breakLength >= minimum) frame.drop = clamp01(this.bands[0]);
      this.breakLength = 0;
    } else if (!frame.inBreak) {
      this.breakLength = 0;
    }

    /*
     * The fill: onset density over the last half bar against the two bars before
     * it, weighted by how near the bar's end this moment is.
     *
     * The weighting is what makes it an anticipation rather than a busyness
     * meter. A burst of onsets at the top of a bar is a busy bar; the same burst
     * at the end of one is a run-up to the downbeat, and only the second is worth
     * the composition winding up for.
     */
    // The two averages, kept whether or not there is a lock: a lock arriving
    // mid-track should find a settled reference rather than spend three bars
    // building one.
    const bar = this.period * BEATS_PER_BAR;
    const activity = this.flux[1].value + this.flux[2].value;
    this.fillFast += (activity - this.fillFast) * coefficient(dt, bar * FILL_FAST_BARS);
    this.fillSlow += (activity - this.fillSlow) * coefficient(dt, bar * FILL_SLOW_BARS);

    if (!this.locked) {
      this.fill += (0 - this.fill) * coefficient(dt, FILL_TAU);
      frame.fill = this.fill;
      return;
    }

    // No reference is not a fill — it is a passage that has just started, and
    // reading it as one would put an anticipation on the first bar of every track.
    const ratio = this.fillSlow > 1e-4 ? this.fillFast / this.fillSlow : 0;
    const density = clamp01((ratio - FILL_RATIO) / (FILL_CEILING - FILL_RATIO));
    const where = clamp01((this.barPhase - FILL_FROM) / (FILL_TO - FILL_FROM));
    const target = density * where * where * (3 - 2 * where);
    this.fill += (target - this.fill) * coefficient(dt, FILL_TAU);
    frame.fill = this.fill;
  }

  /**
   * The previous frame's spectrum through a maximum filter over a *proportional*
   * neighbourhood — the SuperFlux trick, and most of what breaks onset detection
   * on anything with pitch in it.
   *
   * A vibrato or a glide moves energy from one bin to its neighbours, which a
   * plain difference reads as those neighbours gaining energy and therefore as
   * an onset — several times a second, on a held note, on every string and wind
   * instrument and most vocals. Comparing against the neighbourhood's maximum
   * rather than against the bin itself makes that motion invisible, while a real
   * attack, which raises the whole neighbourhood at once, survives intact.
   *
   * The width has to grow with frequency and this is the part that is easy to
   * get wrong: pitch modulation is a constant *fraction* of the frequency, so a
   * 3% vibrato moves the fundamental at 440Hz by half a bin and its twelfth
   * harmonic by nearly seven. A fixed three-bin window — which is what the
   * literature's figure means on the log-spaced filterbank it assumes, and what
   * this first did on a linear FFT — covers the fundamental and none of the
   * harmonics.
   *
   * Measured on a held tone with 3% vibrato and a half-octave glide, over 55
   * seconds: 275 false onsets at a fixed three bins, 56 at a proportional width.
   * A five-fold improvement and not a fix — that material still reaches a
   * confident tempo lock on a signal with no attack anywhere in it, and widening
   * further does not help, so the remaining source is something other than bins
   * being swept. `clarity` is what carries the honest answer there: it reads
   * 0.59 on this and 1.00 on a kit, and it is the gate the energy bindings use
   * for exactly that reason.
   *
   * Capped, because the cost is linear in the radius and the top of the range
   * would otherwise scan a hundred bins to learn nothing. Verified not to cost
   * anything on percussive material: a kit gives the same 459 onsets, the same
   * 98% lock and the same 120.7 BPM at every width tried.
   */
  private maxFiltered(index: number, from: number, to: number): number {
    const radius = Math.min(
      FLUX_MAX_RADIUS,
      Math.max(1, Math.round(index * FLUX_BANDWIDTH))
    );
    const lo = Math.max(from, index - radius);
    const hi = Math.min(to, index + radius);
    let peak = 0;
    for (let i = lo; i <= hi; i++) {
      const value = this.previous[i];
      if (value > peak) peak = value;
    }
    return peak;
  }

  /**
   * Nudge the running grid toward the onset that just arrived — a weakly
   * coupled phase-locked loop rather than a snap.
   *
   * `phase` is 0 at a beat, so its distance to the nearest whole beat is the
   * error. Positive means the beat fired before the onset did and the period is
   * running short; negative means the onset arrived first and it is running
   * long. Both are corrected a little each time, so a lock builds over several
   * beats and one spurious onset in a quiet passage bends the grid slightly
   * instead of derailing it.
   */
  private lockPhase(): void {
    let error = this.phase;
    if (error > 0.5) error -= 1;
    /*
     * A known bias, left in place deliberately — see §15 of
     * `docs/visualizer-audio-attribution.md`.
     *
     * An onset exactly between two beats has an error of ±0.5 and no way to say
     * which. The wrap above resolves that tie the same way every time, so a
     * subdivision that lands there by construction — a hi-hat on eighths, which
     * is most popular music — pushes the phase one direction on every second
     * onset. Measured on synthetic 128BPM material with eighth hats: the period
     * is exact to a tenth of a BPM and the *phase* settles about a quarter of a
     * beat early, which puts every bar-phase-dependent binding a sixteenth out.
     *
     * The obvious fix is to weight each correction by how near a beat the onset
     * was, so the ambiguous case contributes nothing. Built and measured, it
     * moves the phase where it should be and costs the tempo: weighting both
     * terms reads 119.2 BPM against a true 128, because a drifted period puts
     * every onset far from a beat and the weight then discards the evidence that
     * would pull it back; weighting the phase alone reads 121.3, because the
     * unweighted period gain then takes the same tie-break bias in the other
     * term. What the loop has today is a stable equilibrium in which the two
     * biases cancel and the tempo is right.
     *
     * So this stays as it is until there is real material to tune it against.
     * Trading an exact tempo for a correct phase is not obviously the right
     * trade, and it is certainly not one to make against a generator.
     */
    this.phase -= error * PLL_PHASE_GAIN;
    if (this.phase < 0) this.phase += 1;
    this.period = clampPeriod(this.period * (1 + error * PLL_PERIOD_GAIN));
  }

  /**
   * The tempo histogram: every interval between consecutive onsets in the
   * window, folded into the plausible range and smeared across its neighbours.
   *
   * Folded by doubling and halving because a run of onsets is usually not a run
   * of *beats* — it is beats plus their subdivisions, and a quarter-second gap
   * between two sixteenths is evidence for a half-second beat rather than
   * evidence against it. Where a value has more than one representation in
   * range, every one of them is credited: octave ambiguity is real, and the
   * histogram is a better place to resolve it than the fold is.
   *
   * The smear is what tolerates a drummer. Two intervals 15ms apart are the
   * same tempo, and binned exactly they would be evidence for two.
   */
  private estimateTempo(): void {
    if (this.onsetTimes.length < MIN_ONSETS) {
      this.target = 0;
      return;
    }

    const histogram = new Float32Array(IOI_BINS);
    const width = (MAX_PERIOD - MIN_PERIOD) / IOI_BINS;
    let total = 0;

    for (let i = 1; i < this.onsetTimes.length; i++) {
      const interval = this.onsetTimes[i] - this.onsetTimes[i - 1];
      if (interval <= 0) continue;
      // More recent evidence counts for more: a tempo change mid-window should
      // move the estimate rather than be outvoted by the tempo it replaced.
      const age = this.elapsed - this.onsetTimes[i];
      const recency = Math.exp(-age / IOI_WINDOW);

      /*
       * The interval counts as one piece of evidence however many octaves of it
       * are in range, which is why `total` is outside this loop.
       *
       * Inside it, the eighth-note gap in a 120bpm track is credited to both
       * 0.5s and 1.0s, because the range spans more than an octave and there is
       * no way to tell from one interval which is the beat. Charged per
       * candidate instead, every track with subdivisions in it would score half
       * the confidence of one without — the split is inherent to tempo, not
       * evidence of an unclear tempo, and it must not read as doubt.
       */
      for (let candidate = interval; candidate <= MAX_PERIOD; candidate *= 2) {
        if (candidate < MIN_PERIOD) continue;
        const bin = Math.min(IOI_BINS - 1, Math.floor((candidate - MIN_PERIOD) / width));
        histogram[bin] += recency;
        if (bin > 0) histogram[bin - 1] += recency * 0.5;
        if (bin < IOI_BINS - 1) histogram[bin + 1] += recency * 0.5;
      }
      total += recency * 2;
    }

    if (total <= 0) {
      this.target = 0;
      return;
    }

    let peak = 0;
    let peakBin = 0;
    for (let i = 0; i < IOI_BINS; i++) {
      if (histogram[i] > peak) {
        peak = histogram[i];
        peakBin = i;
      }
    }

    const left = peakBin > 0 ? histogram[peakBin - 1] : 0;
    const right = peakBin < IOI_BINS - 1 ? histogram[peakBin + 1] : 0;

    // The peak taken with its shoulders, because the smear above deliberately
    // spread one tempo's evidence across three bins.
    const ratio = (peak + (left + right) * 0.5) / total;
    this.target = clamp01((ratio - PEAK_FLOOR) / (PEAK_CEILING - PEAK_FLOOR));

    /*
     * Interpolated across those shoulders rather than taken as the bin's own
     * centre: the bins are ~10ms apart, and a tempo landing between two of them
     * would otherwise be quantised to about 2 BPM — which over a minute is a
     * visible drift against the music.
     */
    const denominator = left - 2 * peak + right;
    const offset = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator)) : 0;
    const estimate = clampPeriod(MIN_PERIOD + (peakBin + 0.5 + offset) * width);

    // A disagreement this large is not something the loop should be nudged
    // through a beat at a time — the music changed, or the lock was on a
    // subdivision. Re-take it outright and let the loop fine-tune from there.
    if (Math.abs(estimate - this.period) / this.period > RELOCK_RATIO) {
      this.period = estimate;
    }
  }

  /** Free-run the grid between onsets, and decay the lock when they stop. */
  private trackTempo(dt: number): void {
    this.phase += dt / this.period;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.beats++;
      this.creditBeat();
    }
    this.trackBar(dt);
    // Nothing has been heard for a while: let go rather than keep a grid
    // running against music that is no longer there. Everything downstream
    // reads `confidence`, so this is the whole of the graceful fallback —
    // ambient, spoken word, a drum solo in 7 and the gap between tracks all
    // arrive here and all get the composition's own fixed grid back.
    const stale = this.elapsed - (this.onsetTimes[this.onsetTimes.length - 1] ?? -IOI_WINDOW);
    if (stale > IOI_WINDOW / 2 || this.current.silent) this.target = 0;
    /*
     * Integrated here rather than where the target is computed, and the
     * difference is not cosmetic: `estimateTempo` runs on onsets, so filtering
     * there advanced the lock four times a second on a busy track and twice on
     * a sparse one. A time constant meant to be a second and a half became
     * twenty, and a perfectly steady pulse never got past half confidence — so
     * the fallback in §4.1 would have held the fixed grid forever.
     */
    this.confidence += (this.target - this.confidence) * coefficient(dt, CONFIDENCE_TAU);
  }

  /**
   * Fold the beat that just ended into the four accumulators, and re-read which
   * of them is beat one.
   *
   * The cue is that beat one carries the heaviest low-band transient, and it is
   * statistical rather than per-event: any single bar can have its loudest hit
   * anywhere, and what identifies the downbeat is that it is loudest *usually*.
   * So each beat's peak is credited to its residue and the whole set decays over
   * eight bars.
   *
   * The known limit, and it is inherent to the cue rather than to this
   * implementation: a pattern with the kick on one and three gives those two
   * residues nearly equal weight, so the answer can be half a bar out. That is a
   * far better failure than the quarter-bar-out it replaces, and resolving it
   * needs harmonic or spectral-novelty evidence this does not have.
   */
  private creditBeat(): void {
    this.creditSnare();
    const slot = ((this.beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    const decay = Math.exp(-1 / (DOWNBEAT_MEMORY * BEATS_PER_BAR));
    for (let i = 0; i < BEATS_PER_BAR; i++) this.beatWeight[i] *= decay;
    // Credited to the beat that just *finished*, which is the one the peak
    // belonged to — `beats` has already been incremented past it.
    const previous = (slot + BEATS_PER_BAR - 1) % BEATS_PER_BAR;
    this.beatWeight[previous] += this.beatPeak;
    this.beatPeak = 0;
    this.credited = Math.min(DOWNBEAT_EVIDENCE, this.credited + 1);

    /*
     * The snare's evidence, spent on the ambiguity the kick's own cannot settle
     * — and this is the answer to the limitation the note above calls inherent.
     *
     * It is inherent to the *cue*, and the cue has since acquired a second half.
     * A kick on one and three weights those two residues equally, so the bar can
     * be a quarter out and `downbeatConfidence` never rises to say otherwise.
     * But `creditSnare` knows which *pair* of residues the snare is on, and a
     * downbeat is not one of them: excluding that pair collapses four candidates
     * to two, which is the half-bar ambiguity — the failure mode this file
     * already accepts as far better than the quarter-bar one.
     *
     * Measured on 128BPM material with kick on 1/3 and snare on 2/4: without
     * this the bar sat at an arbitrary quarter, and 43% of everything the fill
     * detector reported landed in the wrong part of the bar because of it.
     */
    const excluded = this.backbeatCredit > 0 ? this.snareSlot : -1;
    const opposite = excluded >= 0 ? (excluded + BEATS_PER_BAR / 2) % BEATS_PER_BAR : -1;

    let total = 0;
    let best = 0;
    let second = 0;
    let index = this.downbeat;
    for (let i = 0; i < BEATS_PER_BAR; i++) {
      const weight = this.beatWeight[i];
      // Still counted in the denominator: the confidence below is a share of all
      // the evidence, and one taken over half of it would read as certainty
      // bought by discarding the rest.
      total += weight;
      if (excluded >= 0 && (i === excluded || i === opposite)) continue;
      if (weight > best) {
        second = best;
        best = weight;
        index = i;
      } else if (weight > second) {
        second = weight;
      }
    }
    if (total <= 0) return;

    /*
     * How far the winner leads the runner-up, as a fraction of the total. The
     * margin rather than the winner's own share, because four equal
     * accumulators still have a largest one — what says the answer is real is
     * that it is *ahead*, not that it is on top.
     */
    const lead = (best - second) / total;
    this.downbeatConfidence =
      clamp01((lead - DOWNBEAT_MARGIN) / (0.25 - DOWNBEAT_MARGIN)) *
      (this.credited / DOWNBEAT_EVIDENCE);
    /*
     * Taken on the snare's evidence as well as on its own, and the difference is
     * the whole value of the exclusion above. `downbeatConfidence` measures how
     * sure the detector is of *which* beat, and on a kick-on-one-and-three
     * pattern it is correctly near zero forever. The bar's quarter alignment is a
     * separate and much better-evidenced question, and everything downstream that
     * cares — the fill's weighting, the bar shapes, the layer births — needs the
     * quarter and not the half.
     */
    if (this.downbeatConfidence > 0) {
      this.downbeat = index;
    } else if (excluded >= 0 && (this.downbeat === excluded || this.downbeat === opposite)) {
      /*
       * Moved only when it is on the wrong *quarter*, and left alone otherwise.
       *
       * The exclusion is evidence about which pair the downbeat is in, not about
       * which member of that pair it is — and on the material this exists for,
       * the two members are near-equal by construction, so an argmax between them
       * is a coin flip taken afresh every beat. Applied unconditionally it moved
       * the downbeat constantly, `trackBar` chased a target jumping half a bar at
       * a time, and the bar phase never settled anywhere: measured, the backbeat
       * landed a mean of 0.17 bars from where the bar said beats two and four
       * were, which is worse than the arbitrary-but-stable alignment it replaced.
       */
      this.downbeat = index;
    }
  }

  /**
   * The bar as a loop of its own, phase-locked to the beat grid and slid toward
   * the detected downbeat.
   *
   * A loop rather than `beatCount % 4` computed downstream, and the difference
   * is the only reason this is worth fifteen lines. The residue is a step
   * function: the frame the detector changes its mind, every bar-length gesture
   * in the composition would jump to a different part of its cycle — and the
   * bar row carries the geometry, so that is the whole picture lurching. Here
   * the same correction is a phase error fed through a slow filter, so the
   * composition slides onto the downbeat over a few bars and no frame ever
   * shows a discontinuity.
   */
  private trackBar(dt: number): void {
    const barPeriod = this.period * BEATS_PER_BAR;
    this.barPhase += dt / barPeriod;

    // Where the downbeat detector says the bar should be right now.
    const target = wrap01((this.beats + this.phase - this.downbeat) / BEATS_PER_BAR);
    let error = this.barPhase - target;
    error -= Math.round(error);
    this.barPhase -= error * coefficient(dt, BAR_LOCK_TAU);

    while (this.barPhase >= 1) {
      this.barPhase -= 1;
      this.bars++;
    }
    while (this.barPhase < 0) {
      this.barPhase += 1;
      this.bars--;
    }
  }
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function clampPeriod(period: number): number {
  return Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, period));
}

/**
 * All three processing defaults are hostile to this and all three are on by
 * default. `autoGainControl` is a compressor whose entire job is to flatten the
 * dynamics the feature exists to read — with it on, a loud chorus and a quiet
 * verse reach the analyser at the same level. `noiseSuppression` is tuned to
 * preserve speech and discard everything else, which for music means discarding
 * the music. `echoCancellation` will try to subtract the room, and the room is
 * where the speakers are.
 */
function captureMic(device?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      // `exact` so an input that has gone — a cable unplugged between one run
      // and the next — fails loudly here instead of quietly falling back to the
      // built-in microphone, which on a stage means the room going through the
      // detector in front of an audience.
      ...(device ? { deviceId: { exact: device } } : {}),
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
  });
}

/**
 * The inputs the picker can offer.
 *
 * Names arrive only once a capture has been granted — before that the browser
 * reports a single anonymous entry, which is why the picker appears alongside
 * the first successful listen rather than on load. `default` and
 * `communications` are dropped: both are aliases for a device already in the
 * list, and the second is whatever the OS considers best for a voice call,
 * which is the wrong end of every trade-off music cares about.
 */
export async function listAudioInputs(): Promise<AudioInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices
    .filter(
      (device) =>
        device.kind === "audioinput" &&
        device.deviceId &&
        device.deviceId !== "default" &&
        device.deviceId !== "communications"
    )
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `input ${index + 1}`,
    }));
}

/**
 * Tab or system audio. Video is requested along with it because browsers
 * generally reject an audio-only display capture outright, and the track is
 * stopped the moment it arrives — nothing here wants the pixels, and leaving it
 * running would keep a capture indicator on a screen that is about to be shown
 * to an audience.
 */
async function captureDisplay(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream.removeTrack(track);
  });
  return stream;
}

function describe(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Permission refused.";
    if (error.name === "NotFoundError") return "No input device.";
    // Only reachable with an explicit device: the input chosen for this run is
    // no longer there. See the `exact` constraint in `captureMic`.
    if (error.name === "OverconstrainedError") return "That input is gone. Pick another.";
    return error.message || error.name;
  }
  return error instanceof Error ? error.message : "Capture failed.";
}
