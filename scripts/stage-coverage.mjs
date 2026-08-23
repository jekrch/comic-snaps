#!/usr/bin/env bun
/**
 * The stage coverage bench — does a full-bleed scene ever show nothing?
 *
 *   bun scripts/stage-coverage.mjs
 *   bun scripts/stage-coverage.mjs --scene vault --minutes 40
 *   bun scripts/stage-coverage.mjs --json
 *
 * ## What it measures, and why that is the only number here
 *
 * The spatial scenes all declare `sequential` residency: two slots that take
 * turns owning one surface, with each tenancy opening exactly as its
 * predecessor's fade begins. That arrangement is the whole reason a corridor is
 * papered with *one* page rather than two superimposed — and it is also the only
 * thing holding the frame up, because the surface is full-bleed and a slot
 * showing nothing is a black screen rather than a gap in a composition.
 *
 * So the invariant is a single number: the slots' opacities, summed, divided by
 * the peak the preset authored. One means the surface is exactly covered. Below
 * one is a wall dimming or going out; above one is two comic pages on top of
 * each other, at light the additive levelling did not solve for.
 *
 * That sum is arithmetic on lifetimes and fades that no one can hold in their
 * head. It was wrong for a long time and looked fine for the first eighty
 * seconds of every run, which is longer than anyone watches before deciding a
 * build is good: one section cue from the music re-phased the two slots, and a
 * minute later the corridor went dark for the better part of another one. This
 * is that failure made visible in two seconds from a terminal.
 *
 * ## What it drives
 *
 * The shipping `Stage`, the shipping `SafetyGovernor` and the real preset
 * overrides — no reimplementation, because a reimplementation is what let the
 * bug live. The only stand-ins are the panels (nothing here looks at pixels) and
 * the director, which is reduced to the two things it does to residency: hand
 * the stage a panel when a slot expires, and call `retire` on a section cue.
 *
 * Cues are the interesting axis, so the run sweeps them: none, one, a pair
 * inside a single dissolve, cues landing exactly on the handovers, and cues
 * every frame. The last is not a realistic soundtrack. It is the cheapest proof
 * that no arrival of cues, however dense, can empty the surface.
 */

import { Stage } from "../src/components/viz/engine/Stage.ts";
import { SafetyGovernor } from "../src/components/viz/engine/safety.ts";
import { Rng } from "../src/components/viz/engine/rng.ts";
import { DEFAULT_CONFIG, deviceCaps } from "../src/components/viz/vizConfig.ts";
import { VIZ_PRESETS } from "../src/components/viz/vizPresets.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MINUTES = Number(flag("minutes", 40));
const FPS = Number(flag("fps", 60));
const ONLY = flag("scene", null);
const AS_JSON = args.includes("--json");

/** Below this the surface reads as out rather than dim. */
const DARK = 0.15;
/** How far off exactly-covered still counts as level, allowing for the frame
 *  the clock lands on rather than the instant the schedule wanted. */
const SLACK = 0.02;

/** A panel is only an id and an aspect here — nothing on this path decodes. */
function panel(n) {
  return {
    id: `panel-${n}`,
    title: `p${n}`,
    slug: `p${n}`,
    issue: n,
    year: 2000,
    artist: "",
    image: "",
    notes: null,
    tags: [],
    postedBy: "",
    addedAt: "",
    width: 700,
    height: 1000,
    phash: "",
    ahash: "",
    dhash: "",
    dominantColors: null,
    colorfulness: null,
    blur: null,
    blurStart: null,
  };
}

/** The config a preset actually runs at: the defaults under its overrides. */
function configFor(preset) {
  return { ...DEFAULT_CONFIG, ...preset.overrides, post: { ...DEFAULT_CONFIG.post } };
}

/**
 * One run. `cues` is a function of the composition clock: the frames a section
 * cue lands on, which is the only thing the director does to a stage besides
 * feeding it panels.
 */
function run(preset, cues) {
  const config = configFor(preset);
  const caps = deviceCaps(null);
  const stage = new Stage(caps);
  const safety = new SafetyGovernor();
  const rng = new Rng(1);
  stage.sync(config.stageKind, config, () => new Rng(rng.next() * 2 ** 32));

  const dt = 1 / FPS;
  const frames = Math.round(MINUTES * 60 * FPS);
  let taken = 0;
  let next = 0;
  let min = Infinity;
  let minAt = 0;
  let max = 0;
  let dark = 0;
  let darkest = 0;

  for (let f = 0; f < frames; f++) {
    const time = f * dt;
    if (cues(time, dt)) {
      stage.retire(time);
      taken++;
    }
    const frame = stage.update(time, time, time * 0.05, time * 0.1, config, [1, 1, 1], safety, () =>
      panel(next++)
    );
    const covered =
      frame.slots.reduce((sum, slot) => sum + slot.opacity, 0) / config.stageOpacity;

    // The opening fade is the formation arriving over black, which is the one
    // moment the surface is *meant* to be uncovered.
    if (time < config.layerLifetime * config.crossfade) continue;
    if (covered < min) {
      min = covered;
      minAt = time;
    }
    if (covered > max) max = covered;
    if (covered < DARK) {
      dark += dt;
      darkest = Math.max(darkest, dark);
    } else {
      dark = 0;
    }
  }
  return { min, minAt, max, darkest, taken };
}

/** Cue schedules, worst last. */
function schedules(config) {
  const life = config.layerLifetime;
  const fade = life * config.crossfade * 0.5;
  // A handover begins one fade before a tenancy ends, and tenancies open every
  // `life - fade`, so these are the instants both slots are on the surface.
  const handover = (t) => t % (life - fade) < 0.02 && t > life - fade;
  const once = (at) => (t, dt) => t >= at && t - dt < at;
  return [
    ["no cues", () => false],
    ["one cue", once(life * 2.5)],
    ["a cue on every handover", handover],
    ["a pair inside one dissolve", (t, dt) => once(life)(t, dt) || once(life + 4)(t, dt)],
    ["a cue every 9s", (t, dt) => t > life && t % 9 < dt],
    ["a cue every frame", (t) => t > life],
  ];
}

const presets = VIZ_PRESETS.filter(
  (p) => p.overrides?.stageKind && (!ONLY || p.id === ONLY)
);

const report = [];
let failed = false;
for (const preset of presets) {
  const config = configFor(preset);
  for (const [label, cues] of schedules(config)) {
    const r = run(preset, cues);
    const ok = r.min > 1 - SLACK && r.max < 1 + SLACK;
    if (!ok) failed = true;
    report.push({ preset: preset.id, cues: label, ok, ...r });
    if (!AS_JSON) {
      console.log(
        `${ok ? "ok  " : "FAIL"} ${preset.id.padEnd(8)} ${label.padEnd(28)}` +
          ` covered ${r.min.toFixed(3)}–${r.max.toFixed(3)}` +
          `  worst @${r.minAt.toFixed(0)}s  dark ${r.darkest.toFixed(1)}s` +
          `  cues ${r.taken}`
      );
    }
  }
}
if (AS_JSON) console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
