#!/usr/bin/env bun
/**
 * The motion bench — what the *frame* does about the music, offline and repeatable.
 *
 *   bun scripts/audio-motion.mjs
 *   bun scripts/audio-motion.mjs --pattern four --fps 30
 *   bun scripts/audio-motion.mjs --json before.json
 *
 * ## Why this exists, next to two instruments that already do half of it
 *
 * `scripts/audio-tempo.mjs` measures the analysis and stops at `AudioFrame`. The
 * tuning panel's trace measures the delivered post chain but needs a browser, a
 * capture, a person and a minute of real music, so it cannot be run twice on the
 * same input and cannot be run at all from a terminal. `audio-attribution.mjs`
 * post-processes that trace and asks whether the frame followed *this* music
 * rather than the fact of music, which is the right question and a different one
 * from the question here.
 *
 * The gap is the one the whole "it feels like jelly" complaint lives in. Both
 * existing instruments are happy with a channel that swings a long way, at a
 * plausible rate, in time with the music — and a slow sine at beat rate satisfies
 * every one of those and reads as a wobble. What separates a wobble from a beat is
 * not amplitude, rate or even correlation. It is *shape*: whether the motion is
 * concentrated at one instant of the beat or spread evenly over it, and whether
 * there is any stillness between the movements to make them read as events.
 *
 * So this drives `AudioReactor`, `AudioBinding` and `SafetyGovernor` together —
 * the shipping objects, no reimplementation — over material whose beat grid is
 * known exactly, and reports four numbers per delivered parameter.
 *
 * | column  | what it means                                                     |
 * |---------|-------------------------------------------------------------------|
 * | `depth` | peak-to-trough of the audio deviation, as a share of the value the |
 * |         | preset authored. The "is anything happening" question, and the one |
 * |         | the trace already answers.                                        |
 * | `rest`  | share of frames the parameter is *not moving* — speed under a tenth |
 * |         | of its own peak. A channel with no rest in it is a level, not a     |
 * |         | rhythm, and this is the number a continuous oscillation fails.      |
 * | `crest` | peak speed over mean speed, both in units per second. How *bursty* |
 * |         | the motion is. A pure sine scores 1.6 whatever its frequency; a    |
 * |         | shape that arrives and then holds scores 4 and up. This is the     |
 * |         | jelly detector, and it is deliberately blind to amplitude.         |
 * | `sync`  | how concentrated that speed is at particular instants of the *true* |
 * |         | beat, 0..1 — one minus the normalised entropy of the speed over    |
 * |         | beat phase. 0 is motion spread evenly through the beat, which is    |
 * |         | what a signal derived from an energy envelope gives. 1 is every     |
 * |         | movement inside one sixteenth of the beat.                          |
 * | `at`    | *which* sixteenth carries the most of it, in beats after the        |
 * |         | downbeat. Only meaningful when `sync` is high. A channel that syncs |
 * |         | hard at 0.5 is locked to the off-beat, which is a different bug     |
 * |         | from not being locked at all.                                       |
 * | `bsync` | the same concentration taken over the *bar*. The hierarchy puts the |
 * |         | geometry on a bar-length gesture on purpose, and such a gesture     |
 * |         | scores near zero against the beat because three beats in four carry |
 * |         | none of it. Read `sync` for the fast row, `bsync` for the bar row.  |
 * | `bat`   | which sixteenth of the *bar* carries the most of it.                |
 * | `1·2·3·4` | how the movement divides across the four beats of the bar, as     |
 * |         | percentages, binned by the beat each movement *arrives at*. The     |
 * |         | column that answers "does this move on one and three" — which        |
 * |         | `bsync` cannot, being a single-peak measure. See `ARRIVAL_LEAD`.    |
 * | `per`   | the dominant period of the deviation, in beats. 1, 2 and 4 are the |
 * |         | music; 1.7 is a filter's own time constant wearing the music's     |
 * |         | clothes.                                                          |
 *
 * `sync` and `at` are measured against the beat grid the *material* was
 * synthesised on rather than the one the reactor found, which makes them an
 * end-to-end figure: detection error, binding lead and filter lag all land in
 * them, and a channel that leads the beat by design shows up as `at` just under 1
 * rather than as a failure.
 *
 * ## What it deliberately does not do
 *
 * It does not run `Director`, so no layer churn, no wander, no cycler and no
 * preset drift — every authored value is a constant, and the deviation this
 * reports is the audio pass and nothing else. That is the same isolation
 * `audioTrace` gets by measuring either side of `applyPost`, and it is what makes
 * `depth` comparable between the two.
 *
 * It also cannot say whether the result is *good*. A high `crest` at `sync` 0.9 is
 * a composition that moves on the beat, which is necessary and not sufficient;
 * whether it is beautiful is a question for the person watching. What this can do
 * is stop the argument being had from memory.
 */

import { writeFileSync } from "node:fs";

import { AudioReactor } from "../src/components/viz/engine/AudioReactor.ts";
import { AudioBinding } from "../src/components/viz/engine/audioBind.ts";
import { SafetyGovernor } from "../src/components/viz/engine/safety.ts";
import { TAP_HOP } from "../src/components/viz/engine/audioTap.ts";
import { DEFAULT_CONFIG, DEFAULT_POST } from "../src/components/viz/vizConfig.ts";
import {
  DEFAULT_BED,
  PATTERNS,
  RATE,
  installStubs,
  mean,
  synthesise,
} from "./audio-harness.mjs";

/**
 * The post chain the measurement runs against.
 *
 * `DEFAULT_POST` authors every distortion at zero, and the geometry row is applied
 * *multiplicatively* — deliberately, so that the music may deepen a fold the piece
 * is already running and may never introduce one it is not. Measured against the
 * defaults, therefore, the entire geometry row reads exactly 0 and the bench would
 * report the binding as inert while saying nothing about it.
 *
 * So these are the values a preset that uses those effects would author. Middling
 * rather than extreme: what is being measured is the *shape* of the response, and
 * a fold at 0.9 has almost no headroom left for `applyPost` to spend in it, which
 * would be measuring the saturation instead.
 */
const AUTHORED = {
  ...DEFAULT_POST,
  kaleido: 0.35,
  bulge: 0.25,
  twist: 0.2,
  warp: 0.3,
  ripple: 0.2,
  disperse: 0.15,
  bloom: 0.3,
};

/** The parameters worth reading, grouped the way `audioTrace` groups them: what
 *  the hierarchy puts on the fast row, on the bar row, and in the geometry. */
const POST_ROWS = [
  ["fast", ["feedbackScale", "hueShift", "chroma", "misreg", "krackle"]],
  ["bar", ["feedbackAmount", "bloom", "vignette", "bleed"]],
  ["geom", ["bulge", "twist", "warp", "kaleido"]],
];

/**
 * The three gains and the walk, which do not live in `PostParams` at all.
 *
 * They are most of what a viewer actually sees — the whole flat stack's scale, the
 * spatial flight and turn rates, and the frame's own beat-locked offset — so a
 * readout of the post chain alone would miss the majority of the delivered motion.
 * Each is reported against its own neutral: 1 for the gains, 0 for the walk.
 */
const GAIN_KEYS = ["frameScale", "layer1", "flight", "spin", "strideX"];

/** Internal channels, for telling a binding that is not delivering from one that
 *  is not being fed. `grid` near 0 means every row below it is reading the energy
 *  path, and no amount of tuning the rows will make that rhythmic. */
const CHANNEL_KEYS = ["grid", "amplitude", "fast", "swell", "beatPulse", "barBreath", "stride"];

/** Denominator floor for `depth`, matching `audioTrace.REACH_FLOOR`: a parameter
 *  authored at 0 reports a large relative reach rather than a division by zero,
 *  and it is large by construction. */
const REACH_FLOOR = 1e-4;

/**
 * How far ahead of its beat the binding's motion runs, in bars — the shift the
 * per-beat column is taken under.
 *
 * Every gesture on the synthesised path deliberately *leads*: `pulseShape` peaks
 * `1 - BEAT_PEAK` before the beat and rises for `BEAT_RISE` ahead of that, and the
 * walk is launched `STRIDE_GLIDE` early so that it is settled when the beat lands.
 * That is the whole reason the composition arrives *with* the music rather than
 * after it — and it means the movement belonging to beat one happens during beat
 * four.
 *
 * Binned raw, therefore, this column inverts the answer. Measured on a vocabulary
 * whose masks accent one and three by construction, the walk reported `3 48 2 47` —
 * beats two and four, the exact opposite of what it was doing. The gestures were
 * correct; the instrument was reading the run-up instead of the landing.
 *
 * One figure for every channel, taken from the beat pulse — `0.34` of a beat, which
 * is `0.085` of a bar. The walk's own lead is 0.38 of a beat, close enough that a
 * single shift does not misattribute either.
 */
const ARRIVAL_LEAD = (0.3 + 0.04) / 4;

/** Seconds at the head of the run excluded from every statistic.
 *
 *  The reactor's adaptive floors, the tempo histogram and `LOCK_FADE` all need a
 *  few seconds before anything downstream means what it will mean, and a run that
 *  averages the acquisition in reports the binding as less rhythmic than it is on
 *  every frame a viewer is watching after the first ten. Long enough to cover
 *  `AMPLITUDE_TAU`, `SWELL_BASELINE` and the six seconds `TempoLock` takes. */
const SETTLE = 12;

/** Candidate periods for the dominant-period search, in beats. Duple and triple
 *  relations to the beat plus the bar and the phrase, and a handful of values
 *  between them that no musical structure would produce — the off-grid entries
 *  are the point, since a channel whose best fit is 1.7 beats is following a
 *  filter rather than the music. */
const PERIODS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 1.7, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 12, 16,
];

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/**
 * One channel's delivered signal, reduced to the six figures in the header.
 *
 * `values` is the deviation from the authored value, `times` the real seconds each
 * was sampled at, and `beat` the true beat length the material was synthesised on.
 */
function concentration(speeds, phases) {
  const BINS = 16;
  const histogram = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < speeds.length; i++) {
    histogram[Math.min(BINS - 1, Math.floor(phases[i] * BINS))] += speeds[i];
    total += speeds[i];
  }
  let entropy = 0;
  let topBin = 0;
  for (let i = 0; i < BINS; i++) {
    if (histogram[i] > histogram[topBin]) topBin = i;
    const p = total > 0 ? histogram[i] / total : 0;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return {
    value: total > 0 ? 1 - entropy / Math.log(BINS) : 0,
    at: (topBin + 0.5) / BINS,
  };
}

function measure(values, times, beat, authored) {
  const span = Math.max(...values) - Math.min(...values);
  const floor = Math.min(...values);
  const depth = span / Math.max(REACH_FLOOR, Math.abs(authored));

  void floor;

  /*
   * Speed, and the two figures taken from it.
   *
   * The peak is the 99th percentile rather than the maximum: one frame of a
   * simulated 12fps run can straddle a whole transient, and a crest factor decided
   * by a single sample is a measurement of the frame pacing.
   */
  const speeds = [];
  const phases = [];
  const barPhases = [];
  for (let i = 1; i < values.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt <= 0) continue;
    speeds.push(Math.abs(values[i] - values[i - 1]) / dt);
    // The midpoint of the interval the movement happened over, in beat phase.
    const at = (times[i] + times[i - 1]) / 2;
    phases.push((at / beat) % 1);
    barPhases.push((at / (beat * 4)) % 1);
  }
  const sorted = [...speeds].sort((a, b) => a - b);
  const peak = quantile(sorted, 0.99);
  const average = mean(speeds);
  const crest = average > 0 ? peak / average : 0;

  /*
   * Rest: the share of frames the parameter is not moving, taken as speed under a
   * tenth of its own peak.
   *
   * Measured on the speed rather than on the value, which is what this first did
   * and got wrong for every signed channel in the readout. "The bottom tenth of
   * the channel's own range" is the *most negative* excursion when a channel swings
   * either side of zero, so the walk — which is a displacement, and at rest when it
   * is anywhere and holding — reported 1% rest while being still for two thirds of
   * every beat. Stillness is a property of the derivative, and asking the
   * derivative directly also makes the column mean the same thing for a gain around
   * 1, a blend in 0..1 and an offset around 0.
   */
  const rest = peak > 0 ? speeds.filter((v) => v <= peak * 0.1).length / speeds.length : 1;

  /*
   * How concentrated that speed is at particular instants of the beat.
   *
   * A histogram of the speed over beat phase, reduced to one number by its
   * normalised entropy: 0 when the movement is spread evenly through the beat, 1
   * when all of it happens inside one sixteenth of one.
   *
   * Entropy rather than the circular resultant this first computed, and the reason
   * is a false negative that would have hidden half the answer. A resultant is the
   * first Fourier coefficient, so it assumes the movement happens *once* per beat —
   * but the speed of any symmetric shape has two lobes, a rise and a fall, roughly
   * antipodal, and they cancel. Measured on the beat pulse, which is a raised
   * cosine locked to the grid and about as on-the-beat as a channel can be: 0.21,
   * indistinguishable from an energy envelope with no phase in it at all. Entropy
   * makes no assumption about how many times per beat something happens, only about
   * whether it happens at consistent moments, which is the question.
   */
  const beatConcentration = concentration(speeds, phases);
  const sync = beatConcentration.value;
  const at = beatConcentration.at;
  /*
   * And the same figure over the bar, because the hierarchy deliberately puts the
   * geometry there — a gesture that arrives once every four beats is *correct* and
   * scores near zero against the beat, since three of its four beats carry no
   * event at all. Read `sync` for the fast row and `bsync` for the bar row; a
   * channel that is low on both is following neither.
   */
  const bar = concentration(speeds, barPhases);
  /*
   * And the same speed split into the four beats of the bar — §21.
   *
   * `bsync` says movement is concentrated somewhere and `bat` says which single
   * sixteenth is largest; neither answers "does this move on one and three", which
   * is a question about a *pattern* across beats rather than about a peak. Four
   * numbers do answer it, and they are readable at a glance: `70 2 25 3` is one and
   * three, `40 20 25 15` is everything.
   *
   * Binned by the beat each movement is *arriving at* rather than the beat it
   * happens during — see `ARRIVAL_LEAD`, without which this column reads every
   * anticipatory gesture in the engine one beat early and says the opposite of the
   * truth.
   */
  const perBeat = [0, 0, 0, 0];
  let beatTotal = 0;
  for (let i = 0; i < speeds.length; i++) {
    const at = (barPhases[i] + ARRIVAL_LEAD) % 1;
    perBeat[Math.min(3, Math.floor(at * 4))] += speeds[i];
    beatTotal += speeds[i];
  }
  const beats = perBeat.map((v) => (beatTotal > 0 ? v / beatTotal : 0));

  /*
   * The dominant period, by direct evaluation at each candidate rather than an
   * FFT. There are nineteen candidates and they are not on a linear grid — the
   * question is which *musical* period fits best, and a spectrum would have to be
   * interpolated onto them anyway.
   */
  const centred = values.map((v) => v - mean(values));
  let bestPeriod = 0;
  let bestPower = -1;
  for (const period of PERIODS) {
    const seconds = period * beat;
    let pre = 0;
    let pim = 0;
    for (let i = 0; i < centred.length; i++) {
      const angle = (-2 * Math.PI * times[i]) / seconds;
      pre += centred[i] * Math.cos(angle);
      pim += centred[i] * Math.sin(angle);
    }
    const power = Math.hypot(pre, pim);
    if (power > bestPower) {
      bestPower = power;
      bestPeriod = period;
    }
  }

  return {
    depth,
    rest,
    crest,
    sync,
    at,
    bsync: bar.value,
    bat: bar.at,
    beats,
    period: bestPeriod,
    peak,
  };
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Run the reactor and the binding over `samples`, pacing them the way the engine
 * does — see the same note in `audio-tempo.mjs`, which this loop mirrors
 * deliberately so that a result here is comparable with a result there.
 */
async function run(samples, { fps, jitter, seed = 7, bpm, attack, reactivity }) {
  const { context, analyser } = installStubs(samples);
  const reactor = new AudioReactor();
  await reactor.start("mic");
  if (reactor.status !== "listening") throw new Error(`reactor did not start: ${reactor.status}`);

  const binding = new AudioBinding();
  const safety = new SafetyGovernor();

  let random = seed;
  const next = () => {
    random = (random * 1103515245 + 12345) & 0x7fffffff;
    return random / 0x7fffffff;
  };

  let hopAt = 0;
  const feedHops = (until) => {
    while (hopAt + TAP_HOP <= Math.min(until, samples.length)) {
      reactor.pushHop(samples.subarray(hopAt, hopAt + TAP_HOP));
      hopAt += TAP_HOP;
    }
  };

  const duration = samples.length / RATE;
  const nominal = 1 / fps;
  const times = [];
  const series = new Map();
  const record = (key, value) => {
    let list = series.get(key);
    if (!list) series.set(key, (list = []));
    list.push(value);
  };

  let time = 0;
  let previous = 0;
  let lockedFrames = 0;
  let frames = 0;
  /** Frames spent under each figure — §20. A run that never leaves one voice is
   *  the failure that section was opened to fix, so it is worth being able to see
   *  at a glance rather than inferring it from the rows. */
  const figures = new Map();

  while (time < duration) {
    const step = nominal * (1 + (next() * 2 - 1) * jitter);
    time += step;
    if (time >= duration) break;
    const dt = Math.min(time - previous, 1 / 20);
    previous = time;
    context.currentTime = time;
    analyser.position = Math.floor(time * RATE);
    feedHops(Math.floor(time * RATE));

    const frame = reactor.sample(dt);
    binding.update(frame, reactivity, attack, DEFAULT_CONFIG.audioLift, dt, safety);
    frames++;
    if (frame.locked) lockedFrames++;

    if (time < SETTLE) continue;

    const post = { ...AUTHORED };
    binding.applyPost(post);
    times.push(time);
    for (const [, keys] of POST_ROWS) {
      for (const key of keys) record(key, post[key]);
    }

    const stride = binding.stride;
    record("frameScale", binding.pulse(0) * stride.overscan);
    record("layer1", binding.pulse(1));
    record("flight", binding.flight);
    record("spin", binding.spin);
    record("strideX", stride.x);

    const channels = binding.channels;
    for (const key of CHANNEL_KEYS) record(key, channels[key]);
    figures.set(binding.figureName, (figures.get(binding.figureName) ?? 0) + 1);
  }

  reactor.stop();

  const beat = 60 / bpm;
  const rows = [];
  for (const [row, keys] of POST_ROWS) {
    for (const key of keys) {
      rows.push({ row, key, ...measure(series.get(key), times, beat, AUTHORED[key]) });
    }
  }
  for (const key of GAIN_KEYS) {
    // The gains sit around 1 and the walk around 0; both report against their own
    // neutral, which is what makes `depth` mean the same thing down the column.
    const neutral = key === "strideX" ? 0 : 1;
    rows.push({ row: "gain", key, ...measure(series.get(key), times, beat, neutral || 1) });
  }
  for (const key of CHANNEL_KEYS) {
    rows.push({ row: "chan", key, ...measure(series.get(key), times, beat, 1) });
  }

  const sampled = [...figures.values()].reduce((a, b) => a + b, 0);
  const voices = [...figures.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${Math.round((count / Math.max(1, sampled)) * 100)}%`);

  return { rows, voices, lock: frames > 0 ? lockedFrames / frames : 0 };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const options = {
  fps: 60,
  jitter: 0,
  seconds: 60,
  pattern: null,
  json: null,
  // The `groove` character, which is what `DEFAULT_CONFIG` ships. `--attack` and
  // `--reactivity` are here because they are the two controls a viewer actually
  // has, and a result measured only at the default says nothing about what the
  // other two characters deliver — `breathe` at attack 0.1 reroutes the whole
  // beat row onto the bar's shape and should measure as a different instrument.
  attack: DEFAULT_CONFIG.attack,
  reactivity: DEFAULT_CONFIG.reactivity,
};
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  if (flag === "--fps") options.fps = Number(argv[++i]);
  else if (flag === "--jitter") options.jitter = Number(argv[++i]);
  else if (flag === "--seconds") options.seconds = Number(argv[++i]);
  else if (flag === "--pattern") options.pattern = argv[++i];
  else if (flag === "--json") options.json = argv[++i];
  else if (flag === "--attack") options.attack = Number(argv[++i]);
  else if (flag === "--reactivity") options.reactivity = Number(argv[++i]);
  else {
    console.error(`unknown flag ${flag}`);
    process.exit(1);
  }
}

/** Which material the motion is measured on.
 *
 *  Four of the tempo bench's patterns rather than all nine: the two the tracker
 *  cannot lock to have no beat for a delivered channel to be measured against, and
 *  what is wanted here is a spread of tempi and densities that all lock, so that a
 *  difference between rows is a difference in the *binding*. */
const MATERIAL = options.pattern ? [options.pattern] : ["four", "band120", "halftime", "fast"];

const results = [];
for (const name of MATERIAL) {
  const spec = PATTERNS[name];
  if (!spec) {
    console.error(`no pattern ${name} — have ${Object.keys(PATTERNS).join(", ")}`);
    process.exit(1);
  }
  const samples = synthesise(
    spec.bpm,
    options.seconds,
    spec.voices,
    spec.bed ?? DEFAULT_BED,
    spec.hitJitter ?? 0
  );
  const result = await run(samples, {
    fps: options.fps,
    jitter: options.jitter,
    bpm: spec.bpm,
    attack: options.attack,
    reactivity: options.reactivity,
  });
  results.push({ name, bpm: spec.bpm, ...result });
}

const HEAD = ["parameter", "depth", "rest%", "crest", "bsync", "per", "1 · 2 · 3 · 4"];
const WIDTHS = [16, 8, 6, 6, 6, 5, 16];
const line = (cells) => cells.map((cell, i) => String(cell).padEnd(WIDTHS[i])).join(" ");

console.log(
  `\n  ${options.fps}fps${options.jitter ? ` ±${(options.jitter * 100).toFixed(0)}%` : ""}` +
    `  ·  ${options.seconds}s  ·  attack ${options.attack}  ·  reactivity ${options.reactivity}` +
    `  ·  first ${SETTLE}s discarded`
);

for (const result of results) {
  console.log(
    `\n  ${result.name} @ ${result.bpm}BPM  ·  locked ${(result.lock * 100).toFixed(0)}% of frames` +
      `\n  figures: ${result.voices.join("  ·  ")}\n`
  );
  console.log("  " + line(HEAD));
  console.log("  " + WIDTHS.map((w) => "-".repeat(w)).join(" "));
  let row = null;
  for (const entry of result.rows) {
    if (entry.row !== row) {
      row = entry.row;
      console.log(`  ${row}`);
    }
    console.log(
      "  " +
        line([
          `  ${entry.key}`,
          entry.depth >= 100 ? entry.depth.toFixed(0) : entry.depth.toFixed(3),
          (entry.rest * 100).toFixed(0),
          entry.crest.toFixed(2),
          entry.bsync.toFixed(2),
          entry.period,
          entry.beats.map((v) => String(Math.round(v * 100)).padStart(3)).join(" "),
        ])
    );
  }
}

/*
 * The summary, over the parameters a viewer actually looks at.
 *
 * The fast row is excluded from it on purpose: colour and the print family are
 * where the design deliberately puts the beat-rate content, so they score well and
 * would flatter the average past the point of usefulness. What the complaint is
 * about is the geometry and the gains — the motion — and those are what this line
 * reports.
 */
const motion = results.flatMap((r) => r.rows.filter((e) => e.row === "geom" || e.row === "gain"));
console.log(
  `\n  motion rows: beats ${[0, 1, 2, 3]
    .map((i) => Math.round(mean(motion.map((e) => e.beats[i])) * 100))
    .join("/")}` +
    `  ·  mean crest ${mean(motion.map((e) => e.crest)).toFixed(2)}` +
    `  ·  mean sync ${mean(motion.map((e) => e.sync)).toFixed(2)}` +
    `  ·  mean bsync ${mean(motion.map((e) => e.bsync)).toFixed(2)}` +
    `  ·  mean rest ${(mean(motion.map((e) => e.rest)) * 100).toFixed(0)}%\n`
);

if (options.json) {
  writeFileSync(options.json, JSON.stringify({ options, results }, null, 2));
  console.log(`  wrote ${options.json}\n`);
}
