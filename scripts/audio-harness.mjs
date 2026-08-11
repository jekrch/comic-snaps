#!/usr/bin/env bun
/**
 * The shared half of the audio benches: Web Audio stubs, material, and the WAV I/O.
 *
 * Extracted from `audio-tempo.mjs` when `audio-motion.mjs` needed exactly the same
 * harness to ask a different question. Nothing here changed in the move — the
 * analyser stub is still the spec to the letter, the drum machine still lays hits
 * on a known grid, and `PATTERNS` is still the material every measurement written
 * into `AudioReactor` and `tempogram.ts` was taken against. Copying it instead
 * would have made those figures unreproducible the first time the copy drifted.
 *
 * What deliberately stayed behind in `audio-tempo.mjs` is the *driver*. The two
 * benches pace the engine differently on purpose: the tempo bench runs the reactor
 * alone and asks where the beats are, and the motion bench runs the reactor, the
 * binding and the post chain together and asks what the frame did about them.
 */

import { readFileSync, writeFileSync } from "node:fs";

export const RATE = 48000;

/* -------------------------------------------------------------------------- */
/* FFT                                                                        */
/* -------------------------------------------------------------------------- */

/** Iterative radix-2 Cooley-Tukey, twiddles and bit-reversal precomputed once.
 *  In-place on two Float64Arrays, which is all the analyser stub needs. */
function planFft(n) {
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n) | 0;
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

/* -------------------------------------------------------------------------- */
/* Web Audio stubs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `AnalyserNode.getByteFrequencyData` to the letter of the spec, because the
 * reactor's whole front end is tuned against the exact bytes it produces.
 *
 * Blackman window, FFT, magnitude over `fftSize`, a one-pole smoother across
 * calls at `smoothingTimeConstant`, decibels, then the linear map from
 * [`minDecibels`, `maxDecibels`] onto 0..255. The byte quantisation matters and
 * is not a rounding detail: `ONSET_FLOOR` is 0.0035 of a normalised band sum, so
 * whole onsets live or die inside one step of this scale.
 *
 * Smoothing runs per *call*, which is per simulated frame — the same as
 * production, where the reactor asks once per drawn frame. A harness that read
 * the spectrum at a fixed rate would smooth differently from the thing it is
 * measuring.
 */
class AnalyserStub {
  constructor(samples) {
    this.samples = samples;
    /** Sample index the window ends at. The driver moves this. */
    this.position = 0;
    this.smoothingTimeConstant = 0.8;
    this.minDecibels = -100;
    this.maxDecibels = -30;
    this._fftSize = 2048;
    this._configure();
  }

  set fftSize(value) {
    this._fftSize = value;
    this._configure();
  }

  get fftSize() {
    return this._fftSize;
  }

  get frequencyBinCount() {
    return this._fftSize >> 1;
  }

  _configure() {
    const n = this._fftSize;
    this.fft = planFft(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.smoothed = new Float64Array(n >> 1);
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Blackman, the window the spec names.
      this.window[i] =
        0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
    }
  }

  getByteFrequencyData(out) {
    const n = this._fftSize;
    const bins = n >> 1;
    const start = this.position - n;
    for (let i = 0; i < n; i++) {
      const at = start + i;
      const sample = at >= 0 && at < this.samples.length ? this.samples[at] : 0;
      this.re[i] = sample * this.window[i];
      this.im[i] = 0;
    }
    this.fft(this.re, this.im);
    const tau = this.smoothingTimeConstant;
    const span = 255 / (this.maxDecibels - this.minDecibels);
    for (let k = 0; k < bins; k++) {
      const magnitude = Math.hypot(this.re[k], this.im[k]) / n;
      this.smoothed[k] = tau * this.smoothed[k] + (1 - tau) * magnitude;
      const db = 20 * Math.log10(this.smoothed[k] || 1e-30);
      const byte = Math.round((db - this.minDecibels) * span);
      out[k] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
    }
  }
}

/**
 * Enough of the platform for `AudioReactor.start("mic")` to succeed.
 *
 * The context's `currentTime` is writable and the driver owns it, which is what
 * makes a run deterministic — and, since the clock the onset timeline is measured
 * on is now this one, is also what lets `--fps` and `--jitter` mean anything.
 */
export function installStubs(samples) {
  const analyser = new AnalyserStub(samples);
  const context = {
    sampleRate: RATE,
    currentTime: 0,
    state: "running",
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    resume: async () => {},
    close: async () => {},
  };
  const track = { addEventListener() {}, stop() {}, kind: "audio" };
  const stream = {
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    getTracks: () => [track],
    removeTrack() {},
  };
  globalThis.window = { AudioContext: function () { return context; } };
  globalThis.navigator = { mediaDevices: { getUserMedia: async () => stream } };
  return { context, analyser };
}

/* -------------------------------------------------------------------------- */
/* Material                                                                   */
/* -------------------------------------------------------------------------- */

/** 16-bit PCM and 32-bit float WAV, any channel count, mixed to mono. Enough
 *  for what `ffmpeg` produces and no more. */
export function readWav(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file — convert with ffmpeg");
  }
  let at = 12;
  let format = null;
  let data = null;
  while (at + 8 <= buffer.length) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      format = {
        code: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    at = body + size + (size & 1);
  }
  if (!format || !data) throw new Error("no fmt/data chunk");

  const { channels, bits, code } = format;
  const bytes = bits >> 3;
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytes;
      if (code === 3 && bits === 32) sum += data.readFloatLE(at);
      else if (bits === 16) sum += data.readInt16LE(at) / 32768;
      else if (bits === 32) sum += data.readInt32LE(at) / 2147483648;
      else if (bits === 8) sum += (data[at] - 128) / 128;
      else throw new Error(`unsupported ${bits}-bit format ${code}`);
    }
    mono[i] = sum / channels;
  }
  return { samples: mono, rate: format.rate };
}

/**
 * A drum machine, in sixteenths.
 *
 * Three voices, each shaped to land in one of the reactor's own flux bands so
 * that the low/mid/high split, the downbeat cue and the backbeat detector all
 * see what they were written for. Nothing here is trying to sound good; it is
 * trying to be a transient at a known instant.
 *
 * ## Every envelope is tapered to zero, and that is not a nicety
 *
 * The first version of this ran each voice's exponential decay for a fixed length
 * and stopped. A decay stopped early is a step, a step is broadband, and the
 * detector — correctly — called it an onset: the kick's envelope ended 180ms after
 * the hit, so *every beat* carried a second transient at 0.38 of a beat, which
 * then blocked the real hi-hat behind `REFRACTORY` and put the whole onset stream
 * on a grid that did not exist. The bench read 160BPM against a true 128 and the
 * fault was entirely here.
 *
 * Worth stating plainly because it is the failure mode of a synthetic bench in
 * general: material built to be easy is easy to build wrong, and a detector that
 * reports exactly what it was given looks broken instead. The squared taper below
 * reaches zero with zero slope, so there is no step anywhere.
 */
export function synthesise(bpm, seconds, pattern, bed = 0, hitJitter = 0) {
  const samples = new Float32Array(Math.ceil(seconds * RATE));
  const sixteenth = 60 / bpm / 4;
  const steps = Math.floor(seconds / sixteenth);
  // Deterministic noise: a run must be comparable with the one before it.
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x3fffffff - 1) * 0.5;
  };

  const hit = (at, voice) => {
    const start = Math.floor(at * RATE);
    if (voice === "bass") {
      /*
       * A plucked low note, 220ms — and the reason this voice exists.
       *
       * The flux band the downbeat, the phase loop and now the tempo histogram all
       * read is [20,200)Hz, and in real music that band is not a kick channel. It
       * carries the bass line, whose onsets are melodic: they land where the part
       * lands, not where the beat is. A bench whose low band contains only kicks
       * cannot see any of the trouble that causes, and will happily approve a change
       * that makes the tracker depend on it.
       */
      const note = 55 * 2 ** (((start * 7) % 5) / 12);
      for (let i = 0; i < RATE * 0.22; i++) {
        const t = i / RATE;
        const taper = (1 - i / (RATE * 0.22)) ** 2;
        if (start + i < samples.length) {
          samples[start + i] += Math.sin(2 * Math.PI * note * t) * Math.exp(-t * 8) * taper * 0.9;
        }
      }
      return;
    }
    const shape = voice === "kick" ? 0.18 : voice === "snare" ? 0.12 : 0.035;
    const length = Math.floor(RATE * shape);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const t = i / RATE;
      // Zero at the end and zero slope with it, so the envelope cannot be a step.
      const taper = (1 - i / length) ** 2;
      let value;
      if (voice === "kick") {
        // 55Hz with a fast pitch drop — squarely inside the low band's [20,200).
        value = Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 40)) * t) * Math.exp(-t * 22);
      } else if (voice === "snare") {
        // Noise plus a 190Hz body — the mid band the backbeat detector reads.
        value = (noise() * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 34);
      } else {
        // Bright noise, high-passed by differencing — the top band.
        const raw = noise();
        value = (raw - last) * Math.exp(-t * 120) * 0.5;
        last = raw;
      }
      if (start + i < samples.length) samples[start + i] += value * taper;
    }
  };

  /*
   * A steady pad under the kit, for the patterns that would otherwise be mostly
   * silence.
   *
   * `SILENCE_LEVEL` gates the whole analysis at a broadband level of 0.02 held for
   * half a second, and a bare kick every 1.2 seconds is below it for most of its
   * cycle: measured, the sparse pattern ran 56% silent and the detector saw 7 of
   * its 25 kicks. That is the reactor working as designed — it is refusing to
   * find beats in a room — but it means a bare pattern measures the silence gate
   * instead of the tempo tracker, which is not what these patterns are for.
   *
   * Steady on purpose, and with no vibrato: `visualizer-audio-reach.md` records 275
   * false onsets in 55 seconds from a drone with a half-octave glide in it, so a
   * moving pad here would be manufacturing onsets rather than suppressing silence.
   * Two held sines have almost no spectral flux after their first frame.
   */
  if (bed > 0) {
    for (let i = 0; i < samples.length; i++) {
      const t = i / RATE;
      samples[i] +=
        (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t) * 0.7) * bed;
    }
  }

  for (let step = 0; step < steps; step++) {
    const beat = step >> 2;
    const sub = step & 3;
    for (const [voice, when] of pattern) {
      if (!when(step, beat, sub)) continue;
      // Off the grid by up to `hitJitter`, which is how the unbeat patterns stop
      // being periodic at all — a "random" pattern still quantised to sixteenths
      // has a sixteenth in it for the tracker to find, and would pass a test it
      // should fail.
      const at = step * sixteenth + (hitJitter > 0 ? (noise() / 0.5) * hitJitter : 0);
      hit(Math.max(0, at), voice);
    }
  }

  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] /= peak * 1.05;
  return samples;
}

/**
 * The patterns, and each one is here because it is a case the tracker is known
 * to find hard rather than because it is a genre.
 */
export const DEFAULT_BED = 0.06;

export const PATTERNS = {
  /** The easy case, and the one every comment in `AudioReactor` was tuned on:
   *  kick on every beat, hats on eighths, snare on the backbeat. */
  four: {
    bpm: 128,
    voices: [
      ["kick", (_s, _b, sub) => sub === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 4 === 1],
      ["hat", (_s, _b, sub) => sub === 0 || sub === 2],
    ],
  },
  /**
   * The case a real 100BPM track reported and this bench could not see: a full kit
   * at a tempo whose subdivisions land where the tempo prior is strongest.
   *
   * `four` is the same arrangement at 128, and it passes — because at 128 the
   * spurious readings `FOLD`'s three-family produces from duple material fall
   * outside the tracked range or far from `TEMPO_CENTRE`. At 100 they land squarely
   * on it: an eighth is 0.3s, and 0.3 x 4/3 is 0.4s, which is 150BPM; a beat is
   * 0.6s, and 0.6 x 2/3 is the same 0.4s. Two half-weight votes for a tempo nothing
   * is playing, in the region the prior likes best.
   *
   * Sixteenths on the hats rather than eighths, since a 16th at 100BPM is 150ms and
   * clears `REFRACTORY` easily — which is what a real hi-hat pattern at this tempo
   * gives the detector, and it is a third stream of intervals for the fold to
   * misread.
   */
  dense100: {
    bpm: 100,
    voices: [
      ["kick", (_s, _b, sub) => sub === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 4 === 1],
      ["hat", () => true],
    ],
  },
  /** Kick on one and three and nothing else — the pattern whose inter-onset
   *  intervals are two beats long. At 100BPM that is 1.2s, past `MAX_PERIOD`,
   *  and the fold used to discard every one of them. */
  sparse: {
    bpm: 100,
    voices: [["kick", (_s, beat, sub) => sub === 0 && beat % 2 === 0]],
  },
  /** Half-time: one kick a bar, one snare on the third beat. Four seconds of
   *  music per two onsets at 60BPM, which is what `MIN_ONSETS` has to survive. */
  halftime: {
    bpm: 84,
    voices: [
      ["kick", (_s, beat, sub) => sub === 0 && beat % 4 === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 4 === 2],
    ],
  },
  /** Triplets over a straight kick — subdivisions that relate to the beat by
   *  three, which a fold built on powers of two cannot credit. */
  triplet: {
    bpm: 112,
    voices: [
      ["kick", (_s, _b, sub) => sub === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 4 === 1],
      // Two hats per beat spaced 1/3 and 2/3 through it, from the sixteenth
      // grid's nearest neighbours — a triplet feel rather than exact triplets,
      // which is what a swung pattern gives the detector anyway.
      ["hat", (_s, _b, sub) => sub === 1 || sub === 3],
    ],
  },
  /**
   * A held pad and nothing else — no transient anywhere, and no tempo to find.
   *
   * The false-positive half of the bench, and the reason it is here rather than
   * assumed: `visualizer-audio-reach.md` records a version of this detector
   * taking a *confident* lock on a signal with no attack in it, from 275 false
   * onsets in 55 seconds. Any change to how confidence is computed has to be
   * shown not to reintroduce that, and "it looked fine on a drum pattern" cannot
   * show it. `lock%` must stay near zero.
   */
  pad: {
    bpm: 120,
    unbeat: true,
    bed: 0.5,
    voices: [],
  },
  /**
   * Real transients at irregular times, each thrown up to 80ms off the grid.
   *
   * **This pattern does not test what its name says, and the `-` in the truth
   * column is wrong.** Each voice fires on a fixed stride of sixteenths — 7, 5 and
   * 3 — so the material contains three exact periodicities, and at 120BPM the
   * snare's five-sixteenth stride is 625ms, which is 96BPM and sits squarely inside
   * the tracked range. A detector reporting 96 here has found a real period, not
   * invented one, and the 80ms of jitter is ±13% of that stride: enough to blur the
   * peak, not enough to remove it.
   *
   * Left as it is rather than repaired, because every measurement in `AudioReactor`
   * and `tempogram.ts` that cites this bench was taken against this material and
   * changing it would silently invalidate all of them. Read the row as "does the
   * detector find the snare stride", and read `pad` for the false-lock question this
   * one was meant to answer — that one has no transient in it at all and is the
   * honest test.
   */
  random: {
    bpm: 120,
    unbeat: true,
    hitJitter: 0.08,
    voices: [
      ["kick", (step) => step % 7 === 0],
      ["snare", (step) => step % 5 === 2],
      ["hat", (step) => step % 3 === 1],
    ],
  },
  /**
   * A full arrangement at 120: kit plus a syncopated bass line.
   *
   * The realistic case, and the one every other pattern here is missing. The bass
   * plays eighths with two of every four displaced, so the low band carries onsets
   * that are neither the beat nor a duple subdivision of it — which is what a bass
   * player does and what the tempo histogram now has to survive.
   */
  band120: {
    bpm: 120,
    voices: [
      ["kick", (_s, beat, sub) => sub === 0 && beat % 2 === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 2 === 1],
      ["hat", (_s, _b, sub) => sub === 0 || sub === 2],
      ["bass", (step) => step % 4 === 0 || step % 8 === 3 || step % 16 === 6],
    ],
  },
  /** Fast, where `REFRACTORY` starts eating subdivisions: a sixteenth at 172BPM
   *  is 87ms and the refractory is 100. */
  fast: {
    bpm: 172,
    voices: [
      ["kick", (_s, _b, sub) => sub === 0],
      ["snare", (_s, beat, sub) => sub === 0 && beat % 4 === 1],
      ["hat", () => true],
    ],
  },
};

/**
 * How many hits a pattern lays down, so the onset report can say what share of
 * them the detector actually saw.
 *
 * Simultaneous voices count once, because the global `REFRACTORY` merges them into
 * one onset by design — counting a coincident kick and hat as two would make a
 * correct detector look like it was missing half the material.
 */
export function countHits(spec, seconds) {
  const sixteenth = 60 / spec.bpm / 4;
  let count = 0;
  for (let step = 0; step < Math.floor(seconds / sixteenth); step++) {
    const beat = step >> 2;
    const sub = step & 3;
    if (spec.voices.some(([, when]) => when(step, beat, sub))) count++;
  }
  return count;
}

/**
 * 16-bit mono PCM, so the synthesised patterns can be handed to something other
 * than this script.
 *
 * The point is comparability: a rival tracker measured on its own material proves
 * nothing, and "we should maybe use a library" is only answerable if both are fed
 * the same bytes. It also means the patterns can be listened to, which is how the
 * envelope-truncation bug in the first version of the synth should have been
 * caught.
 */
export function writeWav(path, samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    body.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  writeFileSync(path, Buffer.concat([header, body]));
}



export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Which simple multiple of the truth the detection is, and the error left over
 *  once that is divided out. The two faults are reported apart because they are
 *  different faults — see the table in the header. */
