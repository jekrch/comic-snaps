/**
 * Tempo from the periodicity of a continuous onset function — the estimator that
 * replaces the inter-onset histogram, and the reason it had to be replaced.
 *
 * ## Why the histogram cannot do this
 *
 * `AudioReactor.estimateTempo` measures the gaps between *thresholded* onsets and
 * votes on their simple multiples. That works when the onsets it is given are beats
 * and subdivisions of beats, which is what synthetic drum patterns are and what real
 * music is not. Reported from a 125BPM track, with the histogram reading the low
 * band, which is the cleanest stream available:
 *
 *     low 42 · 150@1.00  114@0.93  172@0.56
 *
 * Forty-two onsets in an eight-second window is 5.25 a second against a beat of
 * 2.08 — the low band on that track is carrying a bass line, and the gaps between
 * bass notes are not the beat or any simple fraction of it. The histogram's winner
 * was 150 and its evidence genuinely said 150. There is no tie-break, prior or
 * hysteresis that repairs that, because the arithmetic upstream of it is already
 * wrong: **every spurious gap contributes votes at all of its multiples**, so extra
 * events do not weaken a histogram, they populate it.
 *
 * ## What this does instead
 *
 * Four pieces, in order, each of which is here because removing it costs a measured
 * amount on `scripts/audio-tempo.mjs`. The bench now runs the four reference tracks
 * in `.claude/songs` alongside the synthetic patterns, and the numbers quoted
 * throughout this file are from that run.
 *
 * 1. **A log-frequency onset function** (`ODF_BANDS`). Twenty-four bands from 30Hz
 *    to 16kHz, each contributing its own rectified change in level, averaged. This
 *    is the single largest correction in the file's history — see the section below.
 * 2. **A comb filter over its autocorrelation.** Scoring `ACF(τ) + ACF(2τ)/3 +
 *    ACF(3τ)/9` rather than `ACF(τ)` alone. The ACF of anything periodic peaks at
 *    every multiple of its period, so an unweighted argmax drifts toward the slow
 *    end; at the true τ all three terms land on peaks together.
 * 3. **A Fourier tempogram over the same window**, added to the comb — see
 *    `FOURIER_MIX`. The two estimators are wrong in opposite directions, which is
 *    the whole reason the second one is worth its FFT.
 * 4. **A log-normal prior** for the octave, an accumulator so the answer is taken
 *    over half a minute rather than eight seconds, and parabolic interpolation
 *    across the winning lag, because 10.7ms of lag resolution is 2.8BPM at 125 and
 *    that would be a visible drift.
 *
 * ## The onset function was reading the top octave and almost nothing else
 *
 * The first version of this summed rectified change over all 512 linear FFT bins.
 * At 48kHz that gives 12–24kHz — one octave, containing nothing but cymbal wash and
 * noise — 256 of the 512 terms, and the four octaves below 1.5kHz twenty-nine
 * between them. The result was an onset function that tracked the hi-hats and was
 * nearly blind to the kick, and it is measurable as exactly that: the estimate from
 * the full spectrum and the estimate from a 3.2kHz-and-up band agreed on every piece
 * of material tried, to within a few percent of frames.
 *
 * That is why the reference tracks failed the way they did. On `121bpm.wav` the
 * kick band reads 121 and the bands above it read 161 — the track has a 3-sixteenth
 * syncopation in the mids and highs, so the only band carrying the beat is the one
 * the old weighting had thrown away. It scored 7% of frames at the right tempo.
 * With the bands spaced logarithmically it scores 89%.
 *
 * Levels are in dB against a decaying peak, floored `FLOOR_DB` below it, which is
 * what stops a near-silent band from contributing its own noise at full weight
 * once the log has stretched it out.
 *
 * ## Two estimators, biased opposite ways
 *
 * Autocorrelation and the magnitude spectrum of the same onset function disagree
 * about everything except the answer, and that is a usable property rather than a
 * curiosity. The ACF of a pulse train peaks at every *multiple of the period*, so
 * its errors are slow: it likes 2τ and 3τ. The magnitude spectrum peaks at every
 * *multiple of the frequency*, so its errors are fast: it likes τ/2 and τ/3. Only
 * the true tempo is a peak in both.
 *
 * Both measured on the bench, and both directions were live failures: the 126BPM
 * reference read 84 (the ACF preferring a lag half again too long) and the 121BPM
 * one read 161 (a lag three-quarters too short). Summing the two z-scored curves
 * fixed the second outright and most of the first, without touching the prior —
 * which matters, because the alternative on offer was a prior narrow enough to
 * force the answer, and a prior that tight reports 125BPM for music that is not.
 *
 * ## Cost
 *
 * The autocorrelation is the only part worth counting: lags to 3× the slowest
 * period over a 750-sample buffer is about 170k multiply-adds, run four times a
 * second, so well under a millisecond. The added Fourier tempogram is one
 * 2048-point FFT at the same rate. The onset function is one 1024-point FFT per
 * hop, ~94 a second, and is *cheaper* than the version it replaces — twenty-four
 * logarithms per hop rather than five hundred and twelve. Nothing here is
 * per-frame.
 */

/** FFT length for the onset function. 1024 at 48kHz is 21ms, half the analyser's
 *  window: fine enough that a hi-hat is a spike rather than a smear. */
const WINDOW = 1024;

/**
 * The tempo range, in seconds per beat — 60 to 180BPM, matching
 * `AudioReactor`'s own `MIN_PERIOD` and `MAX_PERIOD`.
 *
 * Duplicated rather than imported because the reactor imports this module, and a
 * cycle between the two would be a worse thing to own than two pairs of numbers that
 * have never needed to differ.
 */
const MIN_PERIOD = 60 / 180;
const MAX_PERIOD = 60 / 60;

/** Seconds of onset function the correlation is taken over. Long enough to hold
 *  eight bars at the fast end and four at the slow, which is what makes the estimate
 *  stable; short enough to follow a track change inside a phrase. */
const HISTORY = 8;

/**
 * The onset function's bands: twenty-four of them, logarithmically spaced.
 *
 * The count is not delicate — 16, 24 and 40 land within a few percent of each other
 * on every piece of material on the bench. What matters is only that the spacing is
 * logarithmic rather than linear, for the reason the header gives at length.
 */
const ODF_BANDS = 24;
const ODF_LOW = 30;
const ODF_HIGH = 16000;

/**
 * How far below the running peak a band's level is floored, in dB.
 *
 * Without a floor, a band with nothing in it still has a level, and the logarithm
 * stretches its noise to the same size as a real transient three bands up. Sixty dB
 * is measured rather than conventional: at 40 the floor is doing nothing and the
 * 126BPM reference scores 18% of frames at the right tempo; at 60 it scores 76%; by
 * 80 it has started clipping quiet material and drops back to 62%.
 */
const FLOOR_DB = 60;

/**
 * Decay applied to the running peak once per band per hop.
 *
 * Per *band* rather than per hop, which makes the effective rate 24 times this and
 * the half-life about three seconds — long enough that the floor does not follow a
 * single loud bar, short enough to re-scale across a track change.
 */
const PEAK_DECAY = 0.9999;

/**
 * Harmonics the comb sums, and their weights — a steep geometric falloff, measured.
 *
 * The obvious weighting is `1/k`, and it is wrong here in a way worth recording. A
 * lag of three quarters of the true period has *all* of its harmonics land on the
 * true grid whenever the material is subdivided — 3T/4, 3T/2 and 9T/4 are all
 * multiples of T/4 — so a generous harmonic sum credits it as heavily as the beat
 * itself, and the prior then picks whichever of the two is nearer its centre. On the
 * bench that read 75 against a true 100 and 63 against a true 84. With the falloff
 * steepened to 1, 1/3, 1/9 the fundamental's own correlation dominates its harmonics'
 * and both come out right, while the cases the harmonics exist for — picking T over
 * 2T, which a bare autocorrelation gets wrong — still work.
 *
 * Three rather than four so the longest lag it asks for stays well inside the history.
 */
const HARMONICS = [1, 1 / 3, 1 / 9];

/**
 * How much of the Fourier tempogram is added to the comb, both in z-scores.
 *
 * Below about 0.5 the fast-side errors it exists to cancel start coming back; above
 * about 1.25 it starts winning arguments it should lose and the slow-side errors the
 * comb exists to cancel come back instead. Measured across 0.5, 0.75, 1.0, 1.25 and
 * 1.5 on all thirteen pieces of bench material, 0.75 has the best worst case: no
 * piece of material scores below 77% of frames at the right tempo, against 67% at
 * 1.0 and 46% at 1.25.
 */
const FOURIER_MIX = 0.75;

/** FFT length for the Fourier tempogram. Comfortably longer than the onset history,
 *  so the window is zero-padded and the lag-to-bin mapping is oversampled rather
 *  than quantised. */
const FOURIER_WINDOW = 2048;

/** Hops between recomputes. Four times a second: the estimate cannot usefully move
 *  faster than the history it is taken over, and this is the only expensive thing
 *  here. */
const UPDATE_EVERY = 23;

/**
 * Seconds of score curves the answer is taken over, on top of `HISTORY`.
 *
 * Not the same thing as a longer history, and worth being precise about the
 * difference: `HISTORY` sets how much audio each *estimate* sees, and lengthening it
 * past eight seconds does almost nothing — measured at 8, 12, 16 and 24 seconds, the
 * reference tracks move by two or three percent of frames. This averages the score
 * *curves* instead, so a window whose winner was the wrong one of two near-tied
 * peaks is outvoted by its neighbours rather than believed. That is worth 10 points
 * of frames on `121bpm.wav` and 6 on `126bpm.wav`, and it is what removes the
 * relocks: the shipping detector took 30 of them across the four references.
 *
 * Fifteen seconds because the curve is what is being averaged, not the audio — a
 * genuine tempo change replaces the curve underneath it within a couple of these
 * and the estimate follows without ever having been unstable.
 */
const ACCUMULATE = 15;

/** Where the prior sits and how wide it is, in octaves — the same figures and the
 *  same argument as `TEMPO_PRIOR` in `AudioReactor`. */
const CENTRE = 60 / 125;
const SPREAD = 1;

/**
 * How far above the range's own spread the winning lag has to stand, in standard
 * deviations, to mean anything — and where that saturates.
 *
 * A z-score rather than a ratio, and the ratio it replaces was not merely badly
 * scaled: comb scores are correlations and are freely *negative*, so their mean sits
 * near zero and a peak-over-mean explodes. Measured before the fix, the same quantity
 * that read 122 on one pattern read 1.4 billion on the next, and the confidence it
 * fed saturated at 1.0 for a held pad with no beat in it. Distance in standard
 * deviations has no such singularity.
 *
 * Recalibrated for the estimator above, on the reference tracks the old figures had
 * never seen. A held pad — the one piece of material here with no beat in it at all
 * — scores 2.63. The worst *correct* reading on any other material scores 3.60, and
 * the four references run 3.60 to 5.37. So the floor sits just above the pad and the
 * ceiling at the top of the reference range. The old 3-to-7 was calibrated on
 * synthetic drum patterns alone, and it put every real track below half confidence:
 * that is the whole reason the shipping detector reported 144BPM for a 103BPM track
 * while holding a correct estimate it did not trust. See `COMB_TRUST`.
 */
const PEAK_FLOOR = 2.8;
const PEAK_CEILING = 5;

function hann(n: number): Float32Array {
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return window;
}

/** Iterative radix-2 Cooley–Tukey, twiddles and bit reversal precomputed. In place
 *  on two arrays, which is all the onset function needs. */
function planFft(n: number): (re: Float64Array, im: Float64Array) => void {
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const span = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + span; j++, k += step) {
          const c = cos[k];
          const s = sin[k];
          const xr = re[j + span] * c - im[j + span] * s;
          const xi = re[j + span] * s + im[j + span] * c;
          re[j + span] = re[j] - xr;
          im[j + span] = im[j] - xi;
          re[j] += xr;
          im[j] += xi;
        }
      }
    }
  };
}

export class Tempogram {
  private readonly fft = planFft(WINDOW);
  private readonly window = hann(WINDOW);
  private readonly re = new Float64Array(WINDOW);
  private readonly im = new Float64Array(WINDOW);
  /** The window the FFT runs over, slid by one hop each time. */
  private readonly samples = new Float32Array(WINDOW);
  private primed = false;

  /** First bin of each band, plus a closing edge. See `ODF_BANDS`. */
  private readonly bandEdge: Int32Array;
  /** Last hop's level per band, in decades above the floor. */
  private readonly bandLevel = new Float32Array(ODF_BANDS);
  /** Decaying peak the floor is measured down from. See `PEAK_DECAY`. */
  private loudest = 1e-12;

  /** The onset function, as a ring. */
  private readonly odf: Float32Array;
  private readonly scratch: Float64Array;
  private readonly acf: Float64Array;
  /** Score curves, per lag: the comb, the Fourier tempogram, their sum, and the
   *  running average of that sum which the answer is actually read from. */
  private readonly comb: Float64Array;
  private readonly spectrum: Float64Array;
  private readonly score: Float64Array;
  private readonly accumulated: Float64Array;
  private accumulating = false;
  private at = 0;
  private filled = 0;
  private countdown = 0;

  private readonly fourierFft = planFft(FOURIER_WINDOW);
  private readonly fourierRe = new Float64Array(FOURIER_WINDOW);
  private readonly fourierIm = new Float64Array(FOURIER_WINDOW);
  private readonly fourierWindow: Float32Array;

  private readonly hop: number;
  /** Seconds one lag step covers — the hop, and the unit every period here is in. */
  private readonly lagSeconds: number;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly prior: Float32Array;

  /** Beats per minute, or 0 before there is an answer. */
  bpm = 0;
  /** How far the accumulated peak stands above the rest of the range, 0..1. */
  confidence = 0;
  /** The winner's distance above the range, in standard deviations — what
   *  `confidence` is derived from, exposed because it is what a tuning readout wants
   *  to show. See `PEAK_FLOOR`. */
  peakZ = 0;

  constructor(sampleRate: number, hopSize: number) {
    this.hop = hopSize;
    this.lagSeconds = hopSize / sampleRate;
    const perSecond = sampleRate / hopSize;
    const length = Math.max(64, Math.round(HISTORY * perSecond));
    this.odf = new Float32Array(length);
    this.scratch = new Float64Array(length);
    this.minLag = Math.max(2, Math.floor(MIN_PERIOD * perSecond));
    this.maxLag = Math.min(length - 2, Math.ceil(MAX_PERIOD * perSecond));
    // Lags out to the longest harmonic the comb will ask for.
    this.acf = new Float64Array(
      Math.min(length - 1, Math.ceil(this.maxLag * HARMONICS.length) + 2)
    );
    this.comb = new Float64Array(this.maxLag + 2);
    this.spectrum = new Float64Array(this.maxLag + 2);
    this.score = new Float64Array(this.maxLag + 2);
    this.accumulated = new Float64Array(this.maxLag + 2);
    this.fourierWindow = hann(Math.min(length, FOURIER_WINDOW));

    // Band edges, in bins, logarithmically spaced. Every band gets at least one
    // bin, which at the bottom of the range means the lowest few share theirs —
    // harmless, since what is being weighted is octaves rather than bins.
    const perBin = sampleRate / WINDOW;
    const bins = WINDOW >> 1;
    this.bandEdge = new Int32Array(ODF_BANDS + 1);
    for (let b = 0; b <= ODF_BANDS; b++) {
      const hz = ODF_LOW * (ODF_HIGH / ODF_LOW) ** (b / ODF_BANDS);
      this.bandEdge[b] = Math.min(bins, Math.max(1, Math.round(hz / perBin)));
    }

    // One past `maxLag`, so the interpolation either side of a peak at the top of
    // the range still has a weight to read rather than a zero that would drag it.
    this.prior = new Float32Array(this.maxLag + 2);
    for (let lag = Math.max(1, this.minLag - 1); lag <= this.maxLag + 1; lag++) {
      const octaves = Math.log2(lag / perSecond / CENTRE) / SPREAD;
      this.prior[lag] = Math.exp(-0.5 * octaves * octaves);
    }
  }

  reset(): void {
    this.samples.fill(0);
    this.bandLevel.fill(0);
    this.loudest = 1e-12;
    this.odf.fill(0);
    this.accumulated.fill(0);
    this.accumulating = false;
    this.primed = false;
    this.at = 0;
    this.filled = 0;
    this.countdown = 0;
    this.bpm = 0;
    this.confidence = 0;
    this.peakZ = 0;
  }

  /**
   * Fold in one hop of mono audio. Must be exactly the hop size the constructor was
   * given — this is fed straight from `audioTap`, whose whole job is that guarantee.
   */
  push(hop: Float32Array): void {
    if (hop.length !== this.hop) return;

    // Slide the analysis window along by one hop.
    this.samples.copyWithin(0, this.hop);
    this.samples.set(hop, WINDOW - this.hop);

    for (let i = 0; i < WINDOW; i++) {
      this.re[i] = this.samples[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft(this.re, this.im);

    /*
     * Rectified change in level, per logarithmic band, averaged — see the header
     * for why the band spacing is the most consequential line in this file.
     *
     * Nothing here thresholds anything, which is the difference from the reactor's
     * own flux: that is split into three bands so each can carry its own adaptive
     * threshold and fire its own events, and this only has to be a continuous
     * signal whose periodicity is the tempo.
     */
    const bins = WINDOW >> 1;
    let flux = 0;
    for (let b = 0; b < ODF_BANDS; b++) {
      const from = this.bandEdge[b];
      const to = Math.max(from + 1, this.bandEdge[b + 1]);
      let energy = 0;
      for (let k = from; k < to && k < bins; k++) {
        const real = this.re[k] / WINDOW;
        const imaginary = this.im[k] / WINDOW;
        energy += real * real + imaginary * imaginary;
      }
      const density = energy / Math.max(1, to - from);
      this.loudest = Math.max(this.loudest * PEAK_DECAY, density);
      const floor = this.loudest * 10 ** (-FLOOR_DB / 10);
      // Decades above the floor, which is decibels over ten — the constant is
      // arbitrary because everything downstream is z-scored, and this keeps the
      // numbers small.
      const level = Math.log10(Math.max(density, floor) / floor);
      const rise = level - this.bandLevel[b];
      this.bandLevel[b] = level;
      if (rise > 0 && this.primed) flux += rise;
    }
    this.primed = true;

    this.odf[this.at] = flux / ODF_BANDS;
    this.at = (this.at + 1) % this.odf.length;
    if (this.filled < this.odf.length) this.filled++;

    if (--this.countdown > 0) return;
    this.countdown = UPDATE_EVERY;
    if (this.filled >= this.odf.length) this.estimate();
  }

  private estimate(): void {
    const length = this.odf.length;

    // Oldest-first into a contiguous buffer, mean removed. Without the mean out, the
    // correlation is dominated by the fact that flux is positive and every lag scores
    // nearly the same.
    let mean = 0;
    for (let i = 0; i < length; i++) {
      const value = this.odf[(this.at + i) % length];
      this.scratch[i] = value;
      mean += value;
    }
    mean /= length;
    let power = 0;
    for (let i = 0; i < length; i++) {
      const value = this.scratch[i] - mean;
      this.scratch[i] = value;
      power += value * value;
    }
    if (power <= 1e-12) {
      this.confidence = 0;
      return;
    }

    // Unbiased-ish: each lag divided by the number of terms that contributed, so a
    // long lag is not penalised for having less overlap.
    for (let lag = 1; lag < this.acf.length; lag++) {
      let sum = 0;
      for (let i = lag; i < length; i++) sum += this.scratch[i] * this.scratch[i - lag];
      this.acf[lag] = sum / (length - lag);
    }
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      let score = 0;
      for (let h = 0; h < HARMONICS.length; h++) {
        const at = lag * (h + 1);
        if (at < this.acf.length) score += HARMONICS[h] * this.acf[at];
      }
      this.comb[lag] = score;
    }

    this.fourier(length);

    /*
     * The two curves in their own standard deviations before they are added: they
     * are a correlation and a magnitude, in unrelated units, and whichever happened
     * to be larger would otherwise decide everything on its own.
     *
     * Floored at zero before the prior, because the prior is a *multiplier* — a lag
     * whose combined score is negative would be made less negative by a small prior,
     * so the range's edges would be quietly promoted rather than discounted.
     */
    this.normalise(this.comb);
    this.normalise(this.spectrum);
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      const fused = this.comb[lag] + FOURIER_MIX * this.spectrum[lag];
      this.score[lag] = Math.max(0, fused) * this.prior[lag];
    }

    /*
     * Averaged into the running curve rather than read directly — see `ACCUMULATE`.
     * The first update lands whole, so an estimate exists a second after the buffer
     * fills rather than half a minute later.
     */
    const decay = this.accumulating
      ? Math.exp(-(UPDATE_EVERY * this.lagSeconds) / ACCUMULATE)
      : 0;
    this.accumulating = true;
    let best = -Infinity;
    let bestLag = 0;
    let total = 0;
    let squares = 0;
    let counted = 0;
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      const value = this.accumulated[lag] * decay + this.score[lag] * (1 - decay);
      this.accumulated[lag] = value;
      total += value;
      squares += value * value;
      counted++;
      if (value > best) {
        best = value;
        bestLag = lag;
      }
    }
    if (bestLag === 0 || counted === 0) {
      this.confidence = 0;
      return;
    }

    /*
     * Parabolic interpolation across the winning lag. The lags are one hop apart,
     * which at 10.7ms is 2.8BPM at 125 — quantising to that would put the grid a
     * beat away from the music inside a minute, which is exactly the drift the whole
     * feature exists to avoid.
     */
    const left = this.accumulated[bestLag - 1] ?? best;
    const right = this.accumulated[bestLag + 1] ?? best;
    const denominator = left - 2 * best + right;
    const offset =
      denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator)) : 0;

    const period = (bestLag + offset) * this.lagSeconds;
    this.bpm = 60 / Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, period));

    /*
     * How far the winner stands above the spread of the whole range — see
     * `PEAK_FLOOR`. Standard deviations, because the scale of a correlation depends
     * entirely on the material and nothing absolute can be said about its height.
     */
    const average = total / counted;
    const variance = Math.max(0, squares / counted - average * average);
    const deviation = Math.sqrt(variance);
    const z = deviation > 1e-12 ? (best - average) / deviation : 0;
    this.peakZ = z;
    this.confidence = Math.max(0, Math.min(1, (z - PEAK_FLOOR) / (PEAK_CEILING - PEAK_FLOOR)));
  }

  /**
   * The magnitude spectrum of the onset window, sampled at the frequency each lag
   * stands for — the second of the two estimators, and the one that is wrong fast
   * where the comb is wrong slow. See `FOURIER_MIX`.
   */
  private fourier(length: number): void {
    this.fourierRe.fill(0);
    this.fourierIm.fill(0);
    const n = Math.min(length, FOURIER_WINDOW);
    for (let i = 0; i < n; i++) this.fourierRe[i] = this.scratch[i] * this.fourierWindow[i];
    this.fourierFft(this.fourierRe, this.fourierIm);
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      // A period of `lag` samples is `FOURIER_WINDOW / lag` bins, which is rarely a
      // whole number of them — read between the two either side rather than
      // rounding, since the whole point of the padding is that this is oversampled.
      const bin = FOURIER_WINDOW / lag;
      const index = Math.floor(bin);
      const fraction = bin - index;
      const low = Math.hypot(this.fourierRe[index], this.fourierIm[index]);
      const high = Math.hypot(this.fourierRe[index + 1], this.fourierIm[index + 1]);
      this.spectrum[lag] = low + (high - low) * fraction;
    }
  }

  /** A curve into its own standard deviations, over the tracked range. */
  private normalise(curve: Float64Array): void {
    let total = 0;
    let squares = 0;
    let counted = 0;
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      total += curve[lag];
      squares += curve[lag] * curve[lag];
      counted++;
    }
    const average = total / counted;
    const deviation = Math.sqrt(Math.max(1e-18, squares / counted - average * average));
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      curve[lag] = (curve[lag] - average) / deviation;
    }
  }
}
