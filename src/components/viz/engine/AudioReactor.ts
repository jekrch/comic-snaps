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
  /** Per-band, normalised and envelope-followed. All 0..1. */
  low: number;
  lowMid: number;
  mid: number;
  high: number;
  /** Rectified spectral flux, scaled for display against its own history. */
  flux: number;
  /** The adaptive threshold `flux` is tested against, in the same units — so
   *  the meter can draw one against the other. */
  fluxThreshold: number;
  /** An onset fired on this frame, past the refractory period. */
  onset: boolean;
  /** How far over threshold it was, 0..1. Zero on frames with no onset. */
  onsetStrength: number;
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
  /** Nothing is playing. Every binding falls back to the authored config. */
  silent: boolean;
}

function emptyFrame(): AudioFrame {
  return {
    level: 0,
    low: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    flux: 0,
    fluxThreshold: 0,
    onset: false,
    onsetStrength: 0,
    onsetCount: 0,
    beatPhase: 0,
    beatCount: 0,
    nextBeatIn: 0,
    bpm: 0,
    confidence: 0,
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

/** Flux is summed below this. Above it there is mostly hiss, and on the
 *  microphone path a great deal of it. */
const FLUX_MAX_HZ = 10000;
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

const DEFAULT_PERIOD = 0.5;

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
  private fluxBins = 0;

  private readonly scalers = Array.from({ length: BAND_COUNT }, () => new BandScaler());
  private readonly levelScaler = new BandScaler();
  private readonly bands = new Array<number>(BAND_COUNT).fill(0);

  private fluxHistory: number[] = [];
  private fluxCapacity = 60;
  private fluxScale = 0.01;
  private medianCountdown = 0;
  private threshold = 0;
  /** Slowly-decaying peak flux, for onset *strength*. See `ONSET_CEILING_FALL`. */
  private onsetCeiling = 0;
  private sinceOnset = REFRACTORY;

  private onsetTimes: number[] = [];
  private elapsed = 0;
  private period = DEFAULT_PERIOD;
  private phase = 0;
  private beats = 0;
  private confidence = 0;
  /** Where the histogram says confidence should settle. Integrated toward on
   *  every frame by `trackTempo`, not here — see the note there. */
  private target = 0;

  private quietFor = 0;
  private loudFor = 0;

  private readonly current = emptyFrame();

  private state: AudioStatus = "off";
  private activeSource: AudioSource | null = null;
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
   * a stranger's microphone, and a link must not be able to send one.
   */
  async start(source: AudioSource): Promise<void> {
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
      stream = source === "mic" ? await captureMic() : await captureDisplay();
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
    this.fluxBins = Math.min(bins, Math.ceil(FLUX_MAX_HZ / perBin));

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
    this.fluxHistory = [];
    this.medianCountdown = 0;
    this.threshold = 0;
    this.onsetCeiling = 0;
    this.sinceOnset = REFRACTORY;
    this.onsetTimes = [];
    this.elapsed = 0;
    this.period = DEFAULT_PERIOD;
    this.phase = 0;
    this.beats = 0;
    this.confidence = 0;
    this.target = 0;
    this.quietFor = 0;
    this.loudFor = 0;
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

    const analyser = this.analyser;
    if (!analyser || this.state !== "listening") return frame;

    const step = Math.min(Math.max(dt, 1 / 240), 0.1);
    this.elapsed += step;
    analyser.getByteFrequencyData(this.spectrum);

    this.readBands(step);
    this.readFlux(step);
    this.trackTempo(step);

    frame.low = this.bands[0];
    frame.lowMid = this.bands[1];
    frame.mid = this.bands[2];
    frame.high = this.bands[3];
    frame.beatPhase = this.phase;
    frame.beatCount = this.beats;
    frame.nextBeatIn = (1 - this.phase) * this.period;
    frame.bpm = this.confidence > 0 ? 60 / this.period : 0;
    frame.confidence = this.confidence;

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
  }

  private readFlux(dt: number): void {
    /*
     * Spectral flux: the positive part of the change in every bin since the
     * last frame. Rectified because an onset is energy *arriving* — a decay is
     * not an event, and counting it would put a second trigger on the tail of
     * every note.
     */
    let flux = 0;
    for (let i = 1; i < this.fluxBins; i++) {
      const delta = this.spectrum[i] - this.previous[i];
      if (delta > 0) flux += delta;
    }
    flux /= Math.max(1, this.fluxBins * 255);

    this.fluxCapacity = Math.max(8, Math.round(FLUX_WINDOW / dt));
    this.fluxHistory.push(flux);
    while (this.fluxHistory.length > this.fluxCapacity) this.fluxHistory.shift();

    /*
     * The threshold is a median rather than a mean, because the peaks are what
     * is being detected and a mean is dragged upward by exactly the events it
     * is meant to be measured against. One loud snare would raise a mean enough
     * to hide the next one.
     */
    if (--this.medianCountdown <= 0) {
      this.medianCountdown = MEDIAN_EVERY;
      const sorted = [...this.fluxHistory].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1] ?? 0;
      this.threshold = Math.max(median * ONSET_SENSITIVITY, ONSET_FLOOR);
      // Only for the meter: flux is a small number whose useful range depends
      // on the material, and a bar that never leaves the first pixel tells the
      // person tuning this nothing.
      const peak = sorted[sorted.length - 1] ?? 0;
      this.fluxScale += (Math.max(peak, ONSET_FLOOR * 2) - this.fluxScale) * 0.25;
    }

    this.current.flux = clamp01(flux / Math.max(1e-5, this.fluxScale));
    this.current.fluxThreshold = clamp01(this.threshold / Math.max(1e-5, this.fluxScale));

    this.onsetCeiling *= Math.exp(-dt / ONSET_CEILING_FALL);
    this.sinceOnset += dt;
    if (this.current.silent) return;
    if (flux <= this.threshold || this.sinceOnset < REFRACTORY) return;

    this.sinceOnset = 0;
    this.current.onset = true;
    this.current.onsetCount++;
    if (flux > this.onsetCeiling) this.onsetCeiling = flux;
    // Against the recent peak, not the detection threshold — see
    // `ONSET_CEILING_FALL` for why the obvious denominator is the wrong one.
    this.current.onsetStrength = clamp01(
      flux / Math.max(ONSET_FLOOR * 2, this.onsetCeiling)
    );
    this.onsetTimes.push(this.elapsed);
    while (this.onsetTimes.length > 0 && this.elapsed - this.onsetTimes[0] > IOI_WINDOW) {
      this.onsetTimes.shift();
    }
    this.lockPhase();
    this.estimateTempo();
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
    }
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
function captureMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
  });
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
    return error.message || error.name;
  }
  return error instanceof Error ? error.message : "Capture failed.";
}
