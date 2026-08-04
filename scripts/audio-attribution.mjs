#!/usr/bin/env bun
/**
 * The shift test — §1 of `docs/visualizer-audio-attribution.md`.
 *
 *   bun scripts/audio-attribution.mjs trace.csv [shiftSeconds]
 *
 * Reads a trace recorded by the tuning panel's `● trace` button and asks the one
 * question the reach readout cannot: does what the frame did depend on *when*
 * the music did it?
 *
 * ## Why this is the measurement that was missing
 *
 * Every previous round of this feature was settled by measuring the audio
 * contribution on its own — its range, its peak rate, its amplitude spectrum.
 * All three can look healthy while the composition is still not attributable,
 * because a channel that responds to *music* is not the same as one that responds
 * to *this music*: a signal derived from a three-second average of a two-second
 * average carries plenty of amplitude and almost no timing.
 *
 * So each delivered column is correlated against the analysis that produced it,
 * twice: once as recorded, and once with the reference slid by a few seconds.
 * A column that scores the same both ways is not following the music. It is
 * following the fact that music is playing, which is a much weaker claim and is
 * exactly what a viewer means when they say it does not feel controlled.
 *
 * A small lag window is searched either side of both positions, because the
 * bindings deliberately lead and lag the grid by up to a few hundred
 * milliseconds — the beat pulse peaks *before* the beat, the bar shapes are
 * spread across the layer stack, and a fixed zero-lag correlation would score
 * that design as a failure.
 *
 * ## What it cannot tell you
 *
 * The budget — the share of on-screen motion with a musical cause — is not in
 * here, because the trace records the audio *deviation* and not the authored
 * value it was added to. That number is in the tuning panel, on the `audio share`
 * line above the reach rows.
 */

import { readFileSync } from "node:fs";

/** Seconds the reference is slid by for the null. Long enough to break every
 *  phase relationship in the piece, short enough that it is still the same
 *  music with the same dynamics — which is what makes it a fair null rather
 *  than a comparison against different material. */
const DEFAULT_SHIFT = 4;
/** Seconds either side of each position the best correlation is taken over.
 *  The bindings lead and lag on purpose; this is what stops that reading as
 *  absence. */
const LAG_WINDOW = 0.35;

/** Analysis columns a delivered channel could plausibly be following. The best
 *  of them is taken per column, because the rows of the hierarchy are driven by
 *  different features and scoring the geometry against a hi-hat would say
 *  nothing. */
const REFERENCES = ["level", "low", "high", "fluxLow", "fluxMid", "onsetStrength"];

const [, , path, shiftArg] = process.argv;
if (!path) {
  console.error("usage: bun scripts/audio-attribution.mjs <trace.csv> [shiftSeconds]");
  process.exit(1);
}
const shift = Number(shiftArg ?? DEFAULT_SHIFT);

const text = readFileSync(path, "utf8").trim();
const lines = text.split(/\r?\n/);
const header = lines[0].split(",");
const rows = lines.slice(1).map((line) => line.split(",").map(Number));
if (rows.length < 100) {
  console.error(`only ${rows.length} frames — record at least a minute.`);
  process.exit(1);
}

const column = (name) => {
  const index = header.indexOf(name);
  return index < 0 ? null : rows.map((row) => row[index] ?? 0);
};

const time = column("t");
const dt = (time[time.length - 1] - time[0]) / (time.length - 1);
const frames = (seconds) => Math.round(seconds / dt);

/** Pearson correlation of `a` against `b` slid by `lag` frames. */
function correlate(a, b, lag) {
  const from = Math.max(0, -lag);
  const to = Math.min(a.length, b.length - lag);
  const n = to - from;
  if (n < 60) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = from; i < to; i++) {
    sa += a[i];
    sb += b[i + lag];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = from; i < to; i++) {
    const x = a[i] - ma;
    const y = b[i + lag] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da <= 1e-12 || db <= 1e-12) return 0;
  return num / Math.sqrt(da * db);
}

/** Best absolute correlation over a window of lags around `centre` seconds. */
function best(a, b, centre) {
  const middle = frames(centre);
  const span = frames(LAG_WINDOW);
  let peak = 0;
  for (let lag = middle - span; lag <= middle + span; lag++) {
    const value = Math.abs(correlate(a, b, lag));
    if (value > peak) peak = value;
  }
  return peak;
}

const references = REFERENCES.map((name) => [name, column(name)]).filter(([, values]) => values);
if (references.length === 0) {
  console.error("no analysis columns in this trace — is it a viz audio trace?");
  process.exit(1);
}

const delivered = header.filter((name) => name.startsWith("d_"));
const results = [];
for (const name of delivered) {
  const values = column(name);
  // A parameter the preset never ran is not evidence about anything.
  const range = Math.max(...values) - Math.min(...values);
  if (range < 1e-6) continue;

  let aligned = 0;
  let shifted = 0;
  let via = "";
  for (const [label, reference] of references) {
    const score = best(values, reference, 0);
    if (score > aligned) {
      aligned = score;
      via = label;
      // The null is taken against the *same* reference, in both directions, so a
      // column that happens to correlate with the music four seconds later is
      // not scored as though it had been following it.
      shifted = Math.max(best(values, reference, shift), best(values, reference, -shift));
    }
  }
  results.push({ name: name.slice(2), aligned, shifted, gain: aligned - shifted, via });
}

results.sort((a, b) => b.gain - a.gain);

const pad = (text, width) => String(text).padEnd(width);
const num = (value) => value.toFixed(3).padStart(6);

console.log(`\n${rows.length} frames, ${time[time.length - 1].toFixed(0)}s, ${(1 / dt).toFixed(0)}fps`);
console.log(`null is the same reference slid ±${shift}s, best lag within ±${LAG_WINDOW}s of each\n`);
console.log(`${pad("parameter", 16)}${pad("aligned", 9)}${pad("shifted", 9)}${pad("gain", 9)}via`);
console.log("-".repeat(56));
for (const row of results) {
  console.log(
    `${pad(row.name, 16)}${num(row.aligned)}   ${num(row.shifted)}   ${num(row.gain)}   ${row.via}`
  );
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
console.log("-".repeat(56));
console.log(
  `${pad("mean", 16)}${num(mean(results.map((r) => r.aligned)))}   ` +
    `${num(mean(results.map((r) => r.shifted)))}   ` +
    `${num(mean(results.map((r) => r.gain)))}`
);

/*
 * And the structural counts, which are the other half of the story: the gain
 * above measures how tightly the continuous channels track, and says nothing
 * about whether the rare gestures ever fired. A run with a good mean gain and no
 * arrivals in three minutes is a composition breathing accurately and never
 * arriving anywhere.
 */
const spikes = (name) => {
  const values = column(name);
  if (!values) return null;
  let count = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > 0 && values[i - 1] === 0) count++;
  return count;
};
const spread = (name) => {
  const values = column(name);
  if (!values) return null;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};
const share = (name) => {
  const values = column(name);
  return values ? mean(values.map((v) => (v > 0.5 ? 1 : 0))) : null;
};

const report = (label, value, unit = "") =>
  value === null ? null : console.log(`${pad(label, 24)}${typeof value === "number" ? value.toFixed(value >= 10 ? 0 : 3) : value}${unit}`);

console.log("\nstructure");
console.log("-".repeat(56));
const lockedShare = share("locked");
report("locked", lockedShare === null ? null : lockedShare * 100, "% of frames");
report("sections", spikes("ch_section"));
report("arrivals (drops)", spikes("ch_arrival"));
report("backbeats", spikes("backbeat"));
report("accents", spikes("ch_accent"));
// The spread of the bar latch is the direct measure of §3.2: at zero, every bar
// travelled exactly as far as every other one, which is the defect the whole
// document is about.
report("bar-to-bar spread", spread("ch_barGain"));
report("mean handover", mean(column("ch_handover") ?? [0]));
console.log("");
