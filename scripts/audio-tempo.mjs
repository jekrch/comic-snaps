#!/usr/bin/env bun
/**
 * The tempo bench — what the BPM detector actually does, offline and repeatable.
 *
 *   bun scripts/audio-tempo.mjs --synth
 *   bun scripts/audio-tempo.mjs --synth --fps 30
 *   bun scripts/audio-tempo.mjs tracks/*.wav
 *   bun scripts/audio-tempo.mjs tracks/*.wav --json before.json
 *
 * ## Why this exists
 *
 * Every tuning decision in `AudioReactor` was settled by listening, or by a
 * measurement taken once by hand and written into a comment. The comments say so:
 * "measured on synthetic 128BPM material", "built and measured, it moves the
 * phase where it should be and costs the tempo", "measured, the backbeat landed a
 * mean of 0.17 bars from where the bar said". Every one of those numbers is real
 * and none of them can be reproduced, which means no change to the tracker can be
 * shown to be an improvement — and the file's history is largely a record of
 * changes that were built, measured once, and backed out.
 *
 * So this runs the real detector over material with a known tempo and prints the
 * numbers that matter. Nothing is reimplemented: `AudioReactor` is imported and
 * driven exactly as the engine drives it, through a stubbed `AnalyserNode` that
 * reproduces `getByteFrequencyData` to the letter of the spec. The flux bands,
 * the adaptive thresholds, the refractory, the histogram, the phase-locked loop
 * and every constant behind them are the shipping ones. A result here is a result
 * about the thing that runs.
 *
 * ## Why it simulates frame pacing
 *
 * The engine pulls the analysis once per *drawn* frame, so the analysis hop is
 * the frame time — 16.7ms on an idle desktop, 33ms behind the mobile cap, 40-50ms
 * whenever the post chain is loaded. That is not a detail of the harness, it is
 * the single largest influence on the tracker, and it is invisible to any test
 * that runs the analysis at a fixed rate. `--fps` and `--jitter` reproduce it, so
 * "does this hold up on a phone" is a measurement rather than a hope.
 *
 * ## What it reports, and why these
 *
 * | column   | what it means                                                    |
 * |----------|------------------------------------------------------------------|
 * | `bpm`    | median detected BPM while locked. Median, so one relock transient |
 * |          | does not move it.                                                |
 * | `class`  | which simple multiple of the truth that is. `1x` is right; `2x`   |
 * |          | and `0.5x` are the octave error, and they are the failure a       |
 * |          | viewer actually sees — a grid at double time is not a near miss.  |
 * | `err`    | error *within* that class, in percent. Separated from `class`     |
 * |          | because they are different faults: 2x is a wrong decision, 3% is  |
 * |          | a grid that will visibly drift against the music over a minute.   |
 * | `lock`   | share of frames past `LOCK_THRESHOLD`. A detector that is right   |
 * |          | 5% of the time is not running.                                   |
 * | `t.lock` | seconds to the first lock. The viewer is watching during these.   |
 * | `align`  | mean distance from a detected onset to the nearest sixteenth of   |
 * |          | the predicted beat, in beats. The one number here that needs no   |
 * |          | ground truth at all: it asks whether the grid sits where the      |
 * |          | transients are. 0 is perfect, 0.125 is what random scores, so     |
 * |          | anything near 0.125 means the tempo may be right and the phase    |
 * |          | is noise.                                                        |
 * | `jumps`  | relocks — frames where the period moved more than 3% while        |
 * |          | locked. Each one costs six seconds of `TempoLock` re-engaging,    |
 * |          | so a run with ten of them is never in tempo whatever `bpm` says.  |
 *
 * ## Material
 *
 * `--synth` needs no files and generates the patterns the tracker is known to
 * find hard, which is the cheap regression guard. Real audio is WAV only —
 * decoding MP3 in a script is a project of its own. Ground truth comes from the
 * filename: anything matching `128bpm` or `bpm128`. A file without one is still
 * analysed and reports everything that needs no truth.
 *
 * The reference tracks live in `.claude/songs`, named for their tempo, and are what
 * every figure in `tempogram.ts` was measured against. To run them:
 *
 *     for f in .claude/songs/*.mp3; do
 *       ffmpeg -v error -i "$f" -ac 1 -ar 48000 "/tmp/tempo/$(basename "$f" .mp3)bpm.wav"
 *     done
 *     bun scripts/audio-tempo.mjs /tmp/tempo/*.wav
 *
 * They are worth more than the whole synthetic set put together, and the reason is
 * in `tempogram.ts`: the detector's largest error was invisible to synthetic
 * material because every pattern here puts its transients across the whole spectrum,
 * and the fault was an onset function that could only hear the top of it.
 *
 * Synthetic material is necessary and not sufficient, and it is worth being blunt
 * about why: a click track has no octave ambiguity, no missed onsets, no room, and
 * a tempo that never moves. It cannot fail the ways real music makes the tracker
 * fail. Use it to prove a change did no harm; use real tracks to prove it helped.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { AudioReactor, LOCK_THRESHOLD } from "../src/components/viz/engine/AudioReactor.ts";
import { TAP_HOP } from "../src/components/viz/engine/audioTap.ts";
/* The stubs, the drum machine and the material, shared with `audio-motion.mjs`
 * — see the header of `audio-harness.mjs` for why the driver below is not. */
import {
  DEFAULT_BED,
  PATTERNS,
  RATE,
  countHits,
  installStubs,
  mean,
  median,
  readWav,
  synthesise,
  writeWav,
} from "./audio-harness.mjs";

/** Simple multiples of the truth a detected tempo is sorted into. Everything a
 *  beat tracker plausibly locks to instead of the beat: the octaves either side,
 *  the triplet relations, and the dotted one. */
const CLASSES = [1, 2, 0.5, 3, 1 / 3, 1.5, 2 / 3, 4, 0.25];

/* -------------------------------------------------------------------------- */
/* Driver                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Run the real reactor over `samples`, pacing it the way the engine does.
 *
 * `fps` and `jitter` are the whole reason this is not a fixed-hop loop: the
 * analysis hop in production *is* the frame time, and the tracker's accuracy
 * depends on it. A frame is scheduled every `1/fps` and then moved by up to
 * `jitter` of that interval, so a run can be given the pacing of an idle desktop,
 * a phone behind the 30fps cap, or a loaded post chain.
 */
async function run(samples, { fps, jitter, seed = 7 }) {
  const { context, analyser } = installStubs(samples);
  const reactor = new AudioReactor();
  await reactor.start("mic");
  if (reactor.status !== "listening") throw new Error(`reactor did not start: ${reactor.status}`);

  let random = seed;
  const next = () => {
    random = (random * 1103515245 + 12345) & 0x7fffffff;
    return random / 0x7fffffff;
  };

  /*
   * The fixed-hop path, fed exactly as `audioTap`'s worklet feeds it in the browser.
   *
   * Without this the tempogram would receive nothing here and the bench would be
   * measuring only the half of the tracker that reads the render frame — which is the
   * mistake this file's header warns about, made inside the file itself.
   */
  let hopAt = 0;
  const feedHops = (until) => {
    while (hopAt + TAP_HOP <= Math.min(until, samples.length)) {
      reactor.pushHop(samples.subarray(hopAt, hopAt + TAP_HOP));
      hopAt += TAP_HOP;
    }
  };

  const duration = samples.length / RATE;
  const nominal = 1 / fps;
  const bpms = [];
  const distances = [];
  const onsetTimes = [];
  const gridPhases = [];
  let time = 0;
  let previous = 0;
  let frames = 0;
  let lockedFrames = 0;
  let firstLock = null;
  let jumps = 0;
  let lastBpm = 0;
  let onsets = 0;
  let silentFrames = 0;
  /*
   * The tempogram's own reading, sampled every frame rather than read once at the
   * end — and that distinction cost an afternoon. The end-of-run value is a single
   * sample of an estimator that can be bimodal: on `121bpm.wav` it finished on 120.6
   * and this column reported the detector as correct, while the median across the
   * run was 160.6 and it had spent half the track an octave-and-a-third out.
   */
  const combBpms = [];
  const combTrust = [];

  while (time < duration) {
    const step = nominal * (1 + (next() * 2 - 1) * jitter);
    time += step;
    if (time >= duration) break;
    // What the engine hands over: the real delta, clamped to its own MAX_DT of
    // a twentieth. The reactor is expected to notice when this is a lie.
    const dt = Math.min(time - previous, 1 / 20);
    previous = time;
    context.currentTime = time;
    analyser.position = Math.floor(time * RATE);
    // Every hop that has elapsed since the last frame, in order — the audio thread
    // does not skip blocks when the renderer runs late.
    feedHops(Math.floor(time * RATE));

    const frame = reactor.sample(dt);
    frames++;
    if (reactor.combBpm > 0) {
      combBpms.push(reactor.combBpm);
      combTrust.push(reactor.combTrusted ? 1 : 0);
    }
    if (frame.silent) silentFrames++;
    if (frame.onset) onsetTimes.push(time);
    if (frame.confidence >= LOCK_THRESHOLD) {
      if (firstLock === null) firstLock = time;
      lockedFrames++;
      if (frame.bpm > 0) {
        bpms.push(frame.bpm);
        if (lastBpm > 0 && Math.abs(frame.bpm - lastBpm) / lastBpm > 0.03) jumps++;
        lastBpm = frame.bpm;
      }
    }
    if (frame.onset) {
      onsets++;
      if (frame.locked) {
        /*
         * Distance from the onset to the nearest *sixteenth* of the predicted
         * beat, in beats. Needs no ground truth at all: it asks whether the grid
         * sits where the transients are.
         *
         * To the sixteenth and not to the beat, which the first version measured
         * and which cannot answer the question. Half the onsets in any pattern
         * with eighth-note hats in it are half a beat from a beat *by
         * construction*, so a perfectly locked grid scored 0.25 — exactly what
         * random scores — and the column was unable to distinguish a correct
         * tracker from a coin flip. Against the subdivision grid, quantised
         * material scores 0 however it is subdivided, a phase error shows up as
         * itself, and random scores 0.125.
         */
        const sixteenths = frame.beatPhase * 4;
        distances.push(Math.abs(sixteenths - Math.round(sixteenths)) / 4);
        gridPhases.push(frame.beatPhase);
      }
    }
  }

  // Read before stopping: `stop()` tears the tempogram down with everything else,
  // so anything sampled off the reactor has to be taken while it is still alive.
  const combCrest = reactor.combZ;
  const combBpm = median(combBpms);
  const combConfidence = reactor.combConfidence;
  const combTrusted = mean(combTrust);
  reactor.stop();
  return {
    bpm: median(bpms),
    lock: frames > 0 ? lockedFrames / frames : 0,
    firstLock,
    align: mean(distances),
    jumps,
    combBpm,
    combConfidence,
    combCrest,
    combTrusted,
    onsets,
    onsetTimes,
    gridPhases,
    silent: frames > 0 ? silentFrames / frames : 0,
    frames,
    duration,
  };
}

/**
 * The inter-onset intervals the histogram is actually being built from, as a
 * tally — the first thing to look at when a result makes no sense.
 *
 * It separates the two explanations that otherwise look identical from the
 * outside: a detector that cannot find a tempo, and a detector being fed an onset
 * stream that does not contain one. A synthesised kick with a pitch sweep in it
 * produces flux for the length of the sweep and fires twice; so does a real one
 * through a room. Either way the intervals show it and the BPM column does not.
 */
function reportOnsets(name, times, truth, expected, silent) {
  const intervals = [];
  for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
  if (intervals.length === 0) {
    console.log(`    ${name}: no onsets (${(silent * 100).toFixed(0)}% of frames silent)\n`);
    return;
  }
  const tally = new Map();
  for (const interval of intervals) {
    const key = (Math.round((interval * 1000) / 10) * 10) | 0;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(
    `    ${name}: ${times.length} onsets` +
      (expected ? ` of ${expected} hits` : "") +
      `, ${(silent * 100).toFixed(0)}% silent, median IOI ${(median(intervals) * 1000).toFixed(
        0
      )}ms — ` +
      rows.map(([ms, n]) => `${ms}×${n}`).join(" ")
  );
  if (!truth) return;
  /*
   * Where in the beat the onsets land, against the true grid — which the synth
   * puts a hit on at t=0, so the phase is absolute and not relative to anything
   * the detector decided. Sixteenths, because that is the resolution every
   * pattern here is written on.
   *
   * This is the measurement that separates "the tempo is wrong" from "the
   * material is not where I think it is". A synthesised pattern should show two
   * or three spikes and nothing between them; smear means the voice is not a
   * transient, and a spike in the wrong place means the harness is lying.
   */
  const period = 60 / truth;
  const slots = new Array(16).fill(0);
  for (const at of times) {
    const phase = (at / period) % 1;
    slots[Math.floor(phase * 16) % 16]++;
  }
  const peak = Math.max(...slots);
  console.log(
    `      beat phase (16ths): ` +
      slots.map((n) => (n === 0 ? "." : n === peak ? "#" : "+")).join("") +
      `  ${slots.map((n, i) => (n > 0 ? `${i}:${n}` : null)).filter(Boolean).join(" ")}`
  );
}

/** Which simple multiple of the truth the detection is, and the error left over
 *  once that is divided out. The two faults are reported apart because they are
 *  different faults — see the table in the header. */
function classify(detected, truth) {
  if (!(detected > 0) || !(truth > 0)) return { klass: null, error: null };
  let best = CLASSES[0];
  let bestError = Infinity;
  for (const factor of CLASSES) {
    const error = Math.abs(Math.log(detected / (truth * factor)));
    if (error < bestError) {
      bestError = error;
      best = factor;
    }
  }
  return { klass: best, error: (detected / (truth * best) - 1) * 100 };
}

/** Ground truth from the filename: `track-128bpm.wav` or `bpm128-track.wav`. */
function truthFrom(path) {
  const match = /(?:(\d+(?:\.\d+)?)\s*bpm|bpm[-_ ]?(\d+(?:\.\d+)?))/i.exec(basename(path));
  if (!match) return null;
  return Number(match[1] ?? match[2]);
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const options = {
  fps: 60,
  jitter: 0,
  seconds: 45,
  json: null,
  synth: false,
  onsets: false,
  write: null,
};
const files = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--synth") options.synth = true;
  else if (arg === "--onsets") options.onsets = true;
  else if (arg === "--fps") options.fps = Number(argv[++i]);
  else if (arg === "--jitter") options.jitter = Number(argv[++i]);
  else if (arg === "--seconds") options.seconds = Number(argv[++i]);
  else if (arg === "--json") options.json = argv[++i];
  else if (arg === "--write") options.write = argv[++i];
  else if (arg === "--help" || arg === "-h") {
    console.log(
      "usage: bun scripts/audio-tempo.mjs [--synth] [files.wav...] " +
        "[--fps 60] [--jitter 0] [--seconds 45] [--json out.json]"
    );
    process.exit(0);
  } else files.push(arg);
}
if (!options.synth && files.length === 0) options.synth = true;

const jobs = [];
if (options.synth) {
  for (const [name, spec] of Object.entries(PATTERNS)) {
    jobs.push({
      name,
      // `unbeat` patterns have no tempo to be right about, so they are not
      // graded — only their lock share is read.
      truth: spec.unbeat ? null : spec.bpm,
      samples: synthesise(
        spec.bpm,
        options.seconds,
        spec.voices,
        spec.bed ?? DEFAULT_BED,
        spec.hitJitter ?? 0
      ),
      hits: countHits(spec, options.seconds),
    });
    if (options.write) {
      mkdirSync(options.write, { recursive: true });
      writeWav(`${options.write}/${name}-${spec.bpm}bpm.wav`, jobs[jobs.length - 1].samples);
    }
  }
}
for (const path of files) {
  const { samples, rate } = readWav(path);
  if (rate !== RATE) {
    console.error(
      `${basename(path)}: ${rate}Hz — resample to ${RATE} ` +
        `(ffmpeg -i in -ac 1 -ar ${RATE} out.wav)`
    );
    continue;
  }
  jobs.push({ name: basename(path), truth: truthFrom(path), samples });
}

console.log(
  `\n  ${options.fps}fps` +
    (options.jitter ? ` ±${Math.round(options.jitter * 100)}% jitter` : "") +
    `  ·  hop ${(1000 / options.fps).toFixed(1)}ms\n`
);
const head = ["material","truth","bpm","class","err%","lock%","align","jumps","comb","cErr%","crest","own%"];
const widths = [18, 6, 7, 6, 6, 6, 6, 6, 7, 7, 6, 6];
console.log(head.map((h, i) => h.padEnd(widths[i])).join(""));
console.log(widths.map((w) => "-".repeat(w - 1).padEnd(w)).join(""));

const results = [];
for (const job of jobs) {
  const result = await run(job.samples, options);
  const { klass, error } = classify(result.bpm, job.truth);
  results.push({ name: job.name, truth: job.truth, ...result, class: klass, error });
  const cells = [
    job.name.slice(0, widths[0] - 1),
    job.truth ? job.truth.toFixed(0) : "-",
    result.bpm ? result.bpm.toFixed(1) : "-",
    klass === null ? "-" : `${+klass.toFixed(2)}x`,
    error === null ? "-" : error.toFixed(1),
    (result.lock * 100).toFixed(0),
    result.align ? result.align.toFixed(3) : "-",
    String(result.jumps),
    result.combBpm ? result.combBpm.toFixed(1) : "-",
    result.combBpm && job.truth ? (((result.combBpm / job.truth) - 1) * 100).toFixed(1) : "-",
    result.combCrest.toFixed(1),
    (result.combTrusted * 100).toFixed(0),
  ];
  console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(""));
  if (options.onsets) {
    reportOnsets(job.name, result.onsetTimes, job.truth, job.hits, result.silent);
    /*
     * The same onsets against the *detector's* grid rather than the true one, and
     * the row that found the phase bias in §15 of the attribution document.
     *
     * The pair is the whole diagnostic: the row above says where the music put its
     * hits, this one says where the tracker thinks they are, and any constant
     * offset between them is a grid that is locked to the right tempo in the wrong
     * place. On `four` the music sits on slots 0 and 8 and the detector reads 4 and
     * 12 — a quarter beat out, every beat, on the commonest pattern in popular
     * music.
     */
    if (result.gridPhases.length > 0) {
      const slots = new Array(16).fill(0);
      for (const phase of result.gridPhases) slots[Math.floor(phase * 16) % 16]++;
      const peak = Math.max(...slots);
      console.log(
        "      vs DETECTOR grid : " +
          slots.map((n) => (n === 0 ? "." : n === peak ? "#" : "+")).join("") +
          "  " + slots.map((n, i) => (n > 0 ? `${i}:${n}` : null)).filter(Boolean).join(" ")
      );
    }
  }
}

const graded = results.filter((r) => r.truth);
const right = graded.filter((r) => r.class === 1);
console.log(
  `\n  ${right.length}/${graded.length} at the right tempo class` +
    (right.length > 0
      ? `, mean |err| ${mean(right.map((r) => Math.abs(r.error))).toFixed(2)}%`
      : "") +
    `\n  mean lock ${(mean(results.map((r) => r.lock)) * 100).toFixed(0)}%` +
    `  ·  mean align ${mean(results.filter((r) => r.align).map((r) => r.align)).toFixed(3)}` +
    `  ·  ${results.reduce((sum, r) => sum + r.jumps, 0)} jumps\n`
);
const wrong = graded.filter((r) => r.class !== 1);
if (wrong.length > 0) {
  console.log(
    `  wrong class: ${wrong
      .map((r) => `${r.name} ${r.class === null ? "no lock" : `${+r.class.toFixed(2)}x`}`)
      .join(", ")}\n`
  );
}

if (options.json) {
  writeFileSync(options.json, `${JSON.stringify({ options, results }, null, 2)}\n`);
  console.log(`  wrote ${options.json}\n`);
}
