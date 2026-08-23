#!/usr/bin/env bun
/**
 * The colour-fidelity bench — how much of a run the art is its own colour.
 *
 *   bun scripts/color-fidelity.mjs
 *   bun scripts/color-fidelity.mjs --fidelity 0 --minutes 30
 *   bun scripts/color-fidelity.mjs --json after.json
 *   bun scripts/color-fidelity.mjs --against before.json
 *
 * ## Why this exists
 *
 * The panels are the material, and a page's printed palette is a large part of
 * what there is to look at. Every other bench here asks whether the frame is
 * *moving* well; none of them asked whether it was still the colour of the page
 * that went in — and when the question was finally put, the answer was "almost
 * never", for reasons no single parameter owned. A hardcoded hue LFO in the
 * director, an unbounded bar walk in the audio binding, and a pool of
 * palette-restating effects on top of both: three sources that could not see
 * each other, summing to a frame whose *resting state* was a rotation.
 *
 * So this drives the shipping `EffectCycler` alongside the director's own
 * excursion and the binding's walk — the real constants, imported, not copies —
 * over hours of composition clock, and reports the numbers the complaint is
 * about:
 *
 * | column     | what it means                                                  |
 * |------------|----------------------------------------------------------------|
 * | `true`     | share of the run inside `--near` degrees of the page's own hue, |
 * |            | with no palette restatement running. The headline.              |
 * | `hue p50`  | median rotation away from the printed colour, in degrees.       |
 * | `hue p95`  | the tail of the same, with the largest excursion beside it —    |
 * |            | how far the piece still goes when it does depart.               |
 * | `restated` | share of the run with solarize, posterize, sheen or neon above  |
 * |            | the point where a viewer would call the colour changed.         |
 *
 * The audio walk is driven at a steady 120bpm with full confidence, which is
 * the worst case rather than the average one: a fidelity claim should survive
 * the material that stresses it. Pass `--audio 0` for the silent run.
 *
 * It is not a substitute for looking at the thing. It is the instrument that
 * says whether a change moved the number it was aimed at, and by how much.
 */

import { writeFileSync, readFileSync } from "node:fs";

import { EffectCycler } from "../src/components/viz/engine/EffectCycler.ts";
import { HUE_SWING, HUE_WINDOW_HZ, HUE_WINDOW_GATE, LFO_HZ } from "../src/components/viz/engine/Director.ts";
import { HUE_PER_BAR, HUE_RANGE } from "../src/components/viz/engine/audioBind.ts";
import { SafetyGovernor } from "../src/components/viz/engine/safety.ts";
import { Rng } from "../src/components/viz/engine/rng.ts";
import { DEFAULT_CONFIG, DEFAULT_POST } from "../src/components/viz/vizConfig.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const text = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const MINUTES = flag("minutes", 30);
const FPS = flag("fps", 30);
const PSYCH = flag("psych", 0.45);
const INTERVAL = flag("interval", DEFAULT_CONFIG.cycleInterval);
const SEEDS = flag("seeds", 4);
const FIDELITY = flag("fidelity", DEFAULT_CONFIG.colorFidelity);
/** 1 to drive the bar walk, 0 for a run nobody gave a listener to. */
const AUDIO = flag("audio", 1);
/** Degrees of rotation under which a page still reads as its own colour. */
const NEAR = flag("near", 12);
/** Where a palette restatement stops being a shading and starts being a change. */
const RESTATED = flag("restated", 0.15);
/** 120bpm in four. */
const BAR_SECONDS = 2;

/** The treatments that restate the page's palette rather than shade it. */
const RESTATERS = ["solarize", "posterize", "sheen", "neon"];

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** Signed distance from a whole turn, in degrees: the rotation a viewer sees. */
function degrees(turns) {
  return Math.abs((((turns % 1) + 1.5) % 1) - 0.5) * 360;
}

function run(seed, out) {
  const safety = new SafetyGovernor();
  const stream = new Rng(seed);
  const cycler = new EffectCycler(() => stream.fork(), safety);

  const dt = 1 / FPS;
  const frames = Math.round(MINUTES * 60 * FPS);
  // The binding's bar walk, in the shape the binding walks it.
  let hue = 0;
  let direction = 1;
  let lastBar = -1;

  for (let f = 0; f < frames; f++) {
    const time = f * dt;
    const base = DEFAULT_POST.hueShift;
    const post = { ...DEFAULT_POST };

    // The director's windowed excursion.
    const open = Math.max(0, (Math.sin(time * HUE_WINDOW_HZ * 2 * Math.PI) - HUE_WINDOW_GATE) / (1 - HUE_WINDOW_GATE));
    post.hueShift = base + Math.sin(time * LFO_HZ[0] * 2 * Math.PI) * HUE_SWING * open * open;

    // The binding's walk.
    if (AUDIO > 0) {
      const bar = Math.floor(time / BAR_SECONDS);
      if (bar !== lastBar) {
        lastBar = bar;
        hue += HUE_PER_BAR * direction;
        if (Math.abs(hue) >= HUE_RANGE) {
          hue = Math.sign(hue) * HUE_RANGE;
          direction = -direction;
        }
      }
      post.hueShift += hue;
    }

    // The pool, then the governor over the sum of all three — `Director.holdColour`.
    cycler.apply(post, time, PSYCH, INTERVAL);
    post.hueShift = base + (post.hueShift - base) * (1 - Math.min(1, Math.max(0, FIDELITY)));

    const away = degrees(post.hueShift);
    out.hues.push(away);

    let restated = false;
    for (const id of RESTATERS) {
      if (post[id] >= RESTATED) {
        out.uptime[id]++;
        restated = true;
      }
    }
    if (restated) out.restatedFrames++;
    if (!restated && away <= NEAR) out.trueFrames++;
    out.frames++;
  }
}

const totals = {
  hues: [],
  uptime: Object.fromEntries(RESTATERS.map((id) => [id, 0])),
  restatedFrames: 0,
  trueFrames: 0,
  frames: 0,
};
for (let s = 0; s < SEEDS; s++) run((0x9e3779b9 + s * 2654435761) >>> 0, totals);

totals.hues.sort((a, b) => a - b);
const pct = (n) => (100 * n) / totals.frames;
const report = {
  minutes: MINUTES * SEEDS,
  psychedelia: PSYCH,
  fidelity: FIDELITY,
  audio: AUDIO,
  true: pct(totals.trueFrames),
  huep50: quantile(totals.hues, 0.5),
  huep95: quantile(totals.hues, 0.95),
  huemax: totals.hues[totals.hues.length - 1] ?? 0,
  restated: pct(totals.restatedFrames),
  uptime: Object.fromEntries(RESTATERS.map((id) => [id, pct(totals.uptime[id])])),
};

const f1 = (n) => n.toFixed(1);
console.log(`\n  ${f1(report.minutes)} minutes, psychedelia ${PSYCH}, fidelity ${FIDELITY}, audio ${AUDIO ? "on" : "off"}\n`);
console.log(`  true colour (within ${NEAR}deg, nothing restating)   ${f1(report.true)}%`);
console.log(`  hue rotation p50 / p95 / max                 ${f1(report.huep50)}deg / ${f1(report.huep95)}deg / ${f1(report.huemax)}deg`);
console.log(`  palette restated (>= ${RESTATED})                 ${f1(report.restated)}%`);
for (const id of RESTATERS) console.log(`    ${id.padEnd(10)}                             ${f1(report.uptime[id])}%`);

const against = text("against");
if (against) {
  const was = JSON.parse(readFileSync(against, "utf8"));
  console.log(`\n  against ${against}`);
  console.log(`  true colour   ${f1(was.true)}% -> ${f1(report.true)}%`);
  console.log(`  hue p50       ${f1(was.huep50)}deg -> ${f1(report.huep50)}deg`);
  console.log(`  hue p95       ${f1(was.huep95)}deg -> ${f1(report.huep95)}deg`);
  console.log(`  restated      ${f1(was.restated)}% -> ${f1(report.restated)}%`);
}

const out = text("json");
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log("");
