import type { Rng } from "./rng";
import type { SafetyGovernor } from "./safety";
import type { TempoLock } from "./tempoLock";
import type { PostParams } from "./types";

/**
 * One effect the cycler can bring in and out.
 *
 * `apply` mutates the frame's post params rather than returning a delta, so
 * two overlapping pulses can decide for themselves how they combine — the
 * distortions take the larger of the two, the additive ones accumulate.
 */
interface PsychEffect {
  id: string;
  /** Relative chance of being drawn. */
  weight: number;
  /**
   * Multiplier on this effect's attack and release. The floor in `clampRamp`
   * is a photosensitivity limit and sits well below what reads as calm, so the
   * effects that move the frame *bodily* rather than merely deform it — the
   * reparameterisations especially — buy themselves a longer swell here.
   */
  ramp?: number;
  /**
   * Effects sharing a tag never run at once. Reserved for the pairs that do not
   * compose: two maps that each redefine what the frame's radius means produce
   * a frame that reads as neither, at twice the apparent speed.
   */
  exclusive?: string;
  /**
   * Effects this one is *worth more with* than without — the opposite end of
   * the same judgement `exclusive` makes.
   *
   * Some pairs here are a third thing rather than two things: a melt under a
   * slick is a lava lamp, a lit drawing under caustics is a sign seen from
   * underwater, and dispersion — which by construction does nothing on its own —
   * is only ever the glass some other warp is being seen through. Left to the
   * weighted draw those meetings happen at the square of their weights, which
   * on a pool of this size is a few times an hour.
   *
   * A companion arrives on the *same envelope* as the pulse that brought it, so
   * the pair is one gesture with two parts rather than two schedules that
   * happen to overlap — which is the distinction §6 of the effects backlog
   * turns on, and the reason it costs no concurrency: see `Pulse.mate`.
   */
  partners?: readonly string[];
  /** Per-pulse parameters, drawn once at onset so a pulse holds its own shape
   *  for its whole life instead of shimmering between values every frame. */
  init(rng: Rng): number[];
  /** `k` is the envelope, already scaled by the pulse's peak. */
  apply(post: PostParams, k: number, time: number, args: number[]): void;
}

/**
 * The bar boundaries a pulse may begin on, longest first — §16 of
 * `docs/visualizer-audio-attribution.md`.
 *
 * An effect arriving is one of the two or three largest visible changes this
 * engine makes, and until now it happened on a timer with no relationship to the
 * music whatsoever. `TempoLock` already put its *length* in tempo, which is the
 * half of the problem nobody can see: a swell that takes exactly four bars but
 * begins on an arbitrary sixteenth still peaks nowhere, and a viewer has nothing
 * to attribute.
 *
 * The rung is chosen so that waiting for it costs at most a quarter of the gap
 * the cycler asked for — see `boundaryBars`. At the default interval and any
 * ordinary tempo that selects one bar, so effects land on downbeats; a preset
 * with a very long interval gets two or four, which is a phrase rather than a
 * bar and reads as the piece changing section.
 */
const BOUNDARY_LADDER = [8, 4, 2, 1] as const;
/** Share of the gap the wait for a boundary may take. */
const BOUNDARY_SHARE = 0.25;

/** Most concurrent pulses, at psychedelia 1. */
const MAX_CONCURRENT = 3;

/** Chance a pulse brings one of its companions in with it — see `partners`. */
const PARTNER_CHANCE = 0.5;

/**
 * Chance a pulse is a *bed* rather than a gust.
 *
 * The pool has one pacing and it is the same pacing every time: swell over a
 * few seconds, hold for ten or so, leave. Thirty pulses of that in a row is a
 * cadence a viewer learns, and a piece whose changes are all the same length
 * has no phrasing — everything is punctuation and nothing is a sentence.
 *
 * So a quarter of them instead arrive at half the depth over twice the ramp and
 * stay for the better part of a minute. That is not a smaller version of a
 * gust; it is a different reading of the same effect — something the piece *is*
 * for a while, with the ordinary pulses landing on top of it — and it is the
 * cheapest variety available here, because it needs no new effect at all.
 */
const BED_CHANCE = 0.26;
/** How much longer a bed's ramps and hold run, and how much shallower it sits. */
const BED_RAMP = 2.1;
const BED_HOLD = 2.6;
const BED_DEPTH = 0.5;

/**
 * Fold depth over which a kaleido pulse may no longer bring its own wedge count
 * — see the effect itself.
 *
 * `Wander.REROLL_FOLD` is the same judgement about the same discontinuity, and
 * this sits under it deliberately: the drift changes the count on a *glide*, and
 * can afford to start one wherever the fold is shallow enough to hide it, where
 * this is a step between two frames and has to be sure there was nothing on
 * screen to step away from.
 */
const SEGMENT_CLAIM = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A slow oscillation for the effects that breathe rather than just arrive. */
function osc(time: number, rate: number, phase = 0): number {
  return Math.sin(time * rate * Math.PI * 2 + phase);
}

/**
 * The pool. Weights are deliberately uneven: the coordinate warps read as the
 * piece moving, so they can run often, while the ones that restate the whole
 * palette (solarize, posterize, halftone) are rarer punctuation.
 */
const EFFECTS: PsychEffect[] = [
  // --- geometric ------------------------------------------------------------
  {
    id: "kaleido",
    weight: 1,
    // A mandala in oil. The fold restates the same wedge several times over, so
    // a treatment that varies with tone rather than with position is the one
    // that gives each copy of it something of its own.
    partners: ["sheen"],
    init: (rng) => [rng.pick([4, 5, 6, 8, 10, 12])],
    apply: (post, k, _time, [segments]) => {
      const amount = k * 0.92;
      // The fold the frame is already running, read before it is replaced: what
      // decides whether the count may move is the *incumbent* symmetry, not the
      // one this pulse is about to install.
      const incumbent = post.kaleido;
      if (amount <= incumbent) return;
      post.kaleido = amount;
      /*
       * The wedge count is only claimed when this pulse is *introducing* the
       * fold, never when it is deepening one the frame is already running.
       *
       * The depth is a blend and arrives over the pulse's ramp; the count is an
       * integer and arrives between two frames. On a mode with no fold of its
       * own that is invisible — there is no symmetry on screen yet to be seen
       * changing. On a mode built around one it is the worst event in the
       * engine: the envelope crosses the preset's own depth somewhere on the way
       * up, six wedges become twelve on that frame, and the whole thing happens
       * again in reverse on the way down. Two hard geometric cuts per pulse,
       * landing wherever the envelope happened to cross rather than on anything
       * audible — and the section cue makes them more frequent, not less.
       *
       * The threshold is `Wander`'s judgement, which had this right all along
       * and solved it for the drift alone: a change of wedge count is invisible
       * at a shallow fold and unmissable at a deep one. Above it the pulse still
       * swells the mirror the preset chose; it just does not rebuild it.
       */
      if (incumbent <= SEGMENT_CLAIM) post.kaleidoSegments = segments;
    },
  },
  {
    id: "tile",
    weight: 0.6,
    init: (rng) => [rng.range(0.3, 0.85)],
    apply: (post, k, _time, [depth]) => {
      post.tile = Math.max(post.tile, k * depth);
    },
  },
  {
    // The kaleidoscope compounded: four mirrors at four scales rather than one.
    id: "fold",
    weight: 0.7,
    ramp: 2,
    init: (rng) => [
      rng.range(0.42, 0.82),
      rng.range(0.18, 0.55),
      rng.range(1.1, 1.32),
      (rng.bool() ? 1 : -1) * rng.range(0.012, 0.05),
    ],
    apply: (post, k, _time, [ox, oy, scale, spin]) => {
      const amount = k * 0.85;
      if (amount <= post.fold) return;
      post.fold = amount;
      post.foldOffsetX = ox;
      post.foldOffsetY = oy;
      post.foldScale = scale;
      // Set at full rate from the first frame rather than ramped with the
      // amplitude: at k near zero it is invisible, and by the time it is
      // visible the structure is already turning at speed instead of
      // accelerating into it.
      post.foldSpin = spin;
    },
  },
  {
    id: "lattice",
    weight: 0.55,
    ramp: 2,
    init: (rng) => [rng.range(2, 5.5), rng.range(0.6, 0.9)],
    apply: (post, k, _time, [scale, peak]) => {
      const amount = k * peak;
      if (amount <= post.lattice) return;
      post.lattice = amount;
      post.latticeScale = scale;
    },
  },
  // --- reparameterisation ---------------------------------------------------
  // The two that redefine the frame's radius. Mutually exclusive, and the
  // slowest ramps in the pool: these are the only effects here that move the
  // viewer rather than the picture.
  {
    id: "droste",
    weight: 0.5,
    // Travel, and the colour that travel makes. The regress is the strongest
    // sense of movement in the pool and the wake draws entirely on movement, so
    // between them the corridor arrives already coloured by its own flight.
    partners: ["wake"],
    ramp: 2.5,
    exclusive: "reparam",
    init: (rng) => [
      rng.range(1.3, 2.4),
      rng.pick([0, 0, 1, -1]),
      rng.range(0.05, 0.11),
      // The director scales this by the period, so it is repeats per second
      // rather than log-radii: at this range one copy arrives every fifteen
      // seconds at the fastest and closer to two minutes at the slowest.
      (rng.bool() ? 1 : -1) * rng.range(0.015, 0.035),
    ],
    apply: (post, k, _time, [period, twist, inner, spin]) => {
      const amount = k * 0.85;
      if (amount <= post.droste) return;
      post.droste = amount;
      post.drostePeriod = period;
      post.drosteTwist = twist;
      post.drosteInner = inner;
      post.drosteSpin = spin;
    },
  },
  {
    id: "tunnel",
    weight: 0.4,
    partners: ["wake"],
    ramp: 2.5,
    exclusive: "reparam",
    init: (rng) => [
      rng.range(0.18, 0.5),
      (rng.bool() ? 1 : -1) * rng.range(0.025, 0.07),
      rng.range(0.55, 0.85),
    ],
    apply: (post, k, _time, [depth, spin, peak]) => {
      const amount = k * peak;
      if (amount <= post.tunnel) return;
      post.tunnel = amount;
      post.tunnelDepth = depth;
      post.tunnelSpin = spin;
    },
  },
  {
    // The escape-time set. Rarer and slower to arrive than either map above,
    // because it is the largest single change in the pool: the frame stops being
    // a picture that has been bent and becomes a picture drawn along a figure of
    // its own. The seed is drawn well inside the cardioid rather than out at its
    // filigree end — a pulse is a visit, and a visit wants the legible member of
    // the family, not the one that takes the whole ramp to resolve.
    id: "julia",
    weight: 0.35,
    ramp: 3,
    exclusive: "reparam",
    init: (rng) => [
      rng.range(0.15, 0.9),
      rng.range(0.45, 0.8),
      rng.range(0.2, 0.8),
      rng.range(0.5, 1.1),
      (rng.bool() ? 1 : -1) * rng.range(0.01, 0.03),
      // Always forward, and always some: a visit that did not travel would be a
      // still shape swelling in and out of a frame that is otherwise moving.
      rng.range(0.03, 0.07),
    ],
    apply: (post, k, _time, [zoom, shape, trap, spread, spin, flight]) => {
      const amount = k * 0.8;
      if (amount <= post.julia) return;
      post.julia = amount;
      post.juliaZoom = zoom;
      post.juliaShape = shape;
      post.juliaTrap = trap;
      post.juliaSpread = spread;
      // Both at full value from the first frame, on the fold's reasoning: they
      // are invisible while the blend is near zero, and by the time they can be
      // seen the figure should already be moving rather than accelerating.
      post.juliaSpin = spin;
      post.juliaFlight = flight;
      // The defaults, restated. A pulse lands over whatever preset is running,
      // and both of these are guards rather than decorations — without them a
      // visit brings soft over-blown patches and a figure that ignores the page.
      post.juliaAnchor = Math.max(post.juliaAnchor, 0.3);
      post.juliaBind = Math.max(post.juliaBind, 0.5);
    },
  },
  // --- undulating -----------------------------------------------------------
  {
    id: "warp",
    // Dispersion has nothing to act on by itself and everything to add to a
    // frame that is already bending — see its own entry.
    partners: ["disperse"],
    weight: 1.1,
    init: (rng) => [rng.range(1.2, 5), rng.range(0.15, 0.7)],
    apply: (post, k, _time, [scale, speed]) => {
      const amount = k * 0.75;
      if (amount <= post.warp) return;
      post.warp = amount;
      post.warpScale = scale;
      post.warpSpeed = speed;
    },
  },
  {
    id: "ripple",
    // Dispersion has nothing to act on by itself and everything to add to a
    // frame that is already bending — see its own entry.
    partners: ["disperse"],
    weight: 0.9,
    init: (rng) => [rng.range(8, 40)],
    apply: (post, k, _time, [freq]) => {
      const amount = k * 0.8;
      if (amount <= post.ripple) return;
      post.ripple = amount;
      post.rippleFreq = freq;
    },
  },
  {
    id: "twist",
    weight: 0.8,
    init: (rng) => [rng.bool() ? 1 : -1, rng.range(0.03, 0.11)],
    apply: (post, k, time, [direction, rate]) => {
      // Unwinds and rewinds rather than holding a fixed shear, so the frame
      // never settles into a still.
      const swell = 0.5 + 0.5 * osc(time, rate);
      post.twist = clamp(post.twist + k * direction * swell, -1, 1);
    },
  },
  {
    id: "bulge",
    weight: 0.7,
    init: (rng) => [rng.range(0.04, 0.12), rng.range(0, Math.PI * 2)],
    apply: (post, k, time, [rate, phase]) => {
      post.bulge = clamp(post.bulge + k * 0.6 * osc(time, rate, phase), -1, 1);
    },
  },
  {
    id: "quasi",
    // Dispersion has nothing to act on by itself and everything to add to a
    // frame that is already bending — see its own entry.
    partners: ["disperse"],
    weight: 0.8,
    ramp: 1.5,
    init: (rng) => [rng.range(7, 26), rng.range(0.5, 0.9)],
    apply: (post, k, _time, [freq, peak]) => {
      const amount = k * peak;
      if (amount <= post.quasi) return;
      post.quasi = amount;
      post.quasiFreq = freq;
    },
  },
  {
    id: "turbulence",
    // Dispersion has nothing to act on by itself and everything to add to a
    // frame that is already bending — see its own entry.
    partners: ["disperse"],
    weight: 0.6,
    ramp: 1.5,
    init: (rng) => [rng.range(1.4, 4), rng.range(0.06, 0.18), rng.range(0.45, 0.8)],
    apply: (post, k, _time, [scale, speed, peak]) => {
      const amount = k * peak;
      if (amount <= post.turbulence) return;
      post.turbulence = amount;
      post.turbulenceScale = scale;
      post.turbulenceSpeed = speed;
    },
  },
  {
    /*
     * The picture running under its own weight — and the only entry in this pool
     * whose field is the comic rather than a formula.
     *
     * Every other displacement here is a figure the frame is bent *through*: the
     * warp's sines, the quasicrystal, the fBm, and even the two simulations,
     * which are seeded from the frame and then run on schedules of their own. A
     * panel arriving under any of them is repainted and not redrawn. Under this
     * one the page's own masses decide where the frame goes, so a handover
     * changes the deformation itself — which is the thing a viewer can see
     * without being told, and the reason this carries a weight near the top of
     * the group despite being the youngest entry in it.
     */
    id: "melt",
    weight: 0.65,
    // Long. It moves the frame bodily rather than deforming it in place, which
    // is the reparameterisations' argument for their ramps, and it is reading a
    // field that changes only when the panel does — so an arrival that outruns
    // the page it is reading has nothing to be about.
    ramp: 2,
    partners: ["sheen", "caustics"],
    init: (rng) => [
      // Down the frame four times in five, because that is the one everybody
      // means by melting and the only heading that reads as weight rather than
      // as wind. The fifth is across it, which is the same map and a completely
      // different picture: a current running through the page.
      rng.bool(0.8)
        ? (rng.bool() ? 1 : -1) * (Math.PI / 2) + rng.range(-0.3, 0.3)
        : rng.range(-0.3, 0.3),
      // Features from about a fortieth of the frame to a sixth of it. The reach
      // scales with the level, so this is a choice of grain and not of violence:
      // the low end is a churn over the whole page and the high end is three or
      // four slow tongues of it, and scripts/melt-jacobian.py puts both ends at
      // 99.9% of the frame readable. The top is where it is because 8.5 is the
      // first level that measurably is not.
      rng.range(5.5, 8),
      rng.range(0.5, 0.85),
    ],
    apply: (post, k, _time, [angle, level, peak]) => {
      const amount = k * peak;
      if (amount <= post.melt) return;
      post.melt = amount;
      post.meltAngle = angle;
      post.meltLevel = level;
    },
  },
  // --- fields ---------------------------------------------------------------
  // The two displacements read out of a simulated buffer. Both take the longest
  // ramps in the pool, and for once that is not only a pacing decision: the
  // buffer starts flat and has to organise, so a pulse that arrived quickly
  // would arrive before there was anything in the field to see.
  {
    id: "flow",
    weight: 0.45,
    ramp: 2.5,
    init: (rng) => [rng.range(1.6, 4.2), rng.range(0.955, 0.988), rng.range(0.5, 0.85)],
    apply: (post, k, _time, [scale, decay, peak]) => {
      const amount = k * peak;
      if (amount <= post.flow) return;
      post.flow = amount;
      post.flowScale = scale;
      post.flowDecay = decay;
    },
  },
  {
    id: "react",
    weight: 0.4,
    ramp: 2.5,
    init: (rng) => [
      // The mitosis window. Narrow, and the draw stays inside it: outside these
      // bounds Gray-Scott either dies back to a flat field or floods it, and both
      // are a displacement map that does not move.
      rng.range(0.03, 0.045),
      rng.range(0.057, 0.065),
      rng.range(1.1, 2.4),
      rng.range(0.45, 0.8),
    ],
    apply: (post, k, _time, [feed, kill, scale, peak]) => {
      const amount = k * peak;
      if (amount <= post.react) return;
      post.react = amount;
      post.reactFeed = feed;
      post.reactKill = kill;
      post.reactScale = scale;
    },
  },
  {
    // The loudest structural effect in the pool: the frame stops being a picture
    // and becomes a cut through the run. Hence the longest ramp of anything here.
    id: "slit-scan",
    weight: 0.35,
    ramp: 3,
    // Shares the ring with the wake, and shares its subject: both are the frame
    // at more than one moment. Composed, the wake would be separating the plates
    // of a picture that is already several seconds deep, which is two statements
    // about time made at once and reads as neither.
    exclusive: "time",
    init: (rng) => [
      rng.range(0, 1),
      // Luminance only sometimes. It is the strangest of the three readings and
      // the least legible, so it is punctuation within punctuation.
      rng.bool(0.4) ? rng.range(0.2, 0.65) : 0,
      rng.range(0.25, 0.8),
      rng.range(0.45, 0.8),
    ],
    apply: (post, k, _time, [axis, luma, depth, peak]) => {
      const amount = k * peak;
      if (amount <= post.slit) return;
      post.slit = amount;
      post.slitAxis = axis;
      post.slitLuma = luma;
      post.slitDepth = depth;
    },
  },
  {
    /*
     * The colour plates lagging behind the frame's own movement.
     *
     * The one entry in this pool that costs the drawing nothing. Every map here
     * trades legibility for structure at some depth — that is what a map is —
     * and this one has no depth at which the panel stops being the panel:
     * wherever the frame is still, all three plates read the same instant and
     * the picture is untouched to the pixel. All of the colour is manufactured
     * by motion, so what it looks like is decided by the composition rather than
     * by this pulse, and a page swinging through a fold burns while a slow
     * dissolve barely fringes.
     *
     * Which makes it the right thing to reach for often, and the reason its
     * weight sits with the geometric group's rather than with the rest of the
     * time-and-optics entries.
     */
    id: "wake",
    weight: 0.7,
    ramp: 2,
    exclusive: "time",
    partners: ["smear", "blur"],
    init: (rng) => [
      rng.range(0.1, 0.45),
      // The ends and the middle are three different effects rather than a
      // continuum with a null in it — see PostParams.wakeLead — so the draw is a
      // pick between them rather than a range across them.
      rng.pick([0, 0.5, 1]),
      rng.range(0.55, 0.9),
    ],
    apply: (post, k, _time, [spread, lead, peak]) => {
      const amount = k * peak;
      if (amount <= post.wake) return;
      post.wake = amount;
      post.wakeSpread = spread;
      post.wakeLead = lead;
    },
  },

  // --- print ----------------------------------------------------------------
  // The calmest group in the pool. None of these moves the frame at all — they
  // change what it was printed on and how badly — so they can run at any depth
  // without competing with whatever else is deforming the picture.
  {
    id: "misregister",
    weight: 0.6,
    ramp: 1.5,
    init: (rng) => [rng.range(0.003, 0.014), rng.range(0.55, 0.95)],
    apply: (post, k, _time, [spread, peak]) => {
      const amount = k * peak;
      if (amount <= post.misreg) return;
      post.misreg = amount;
      post.misregSpread = spread;
    },
  },
  {
    id: "moire",
    weight: 0.5,
    ramp: 2,
    init: (rng) => [rng.range(0.03, 0.17), rng.range(0.7, 1.7), rng.range(0.6, 0.95)],
    apply: (post, k, _time, [spread, scale, peak]) => {
      const amount = k * peak;
      if (amount <= post.moire) return;
      post.moire = amount;
      post.moireSpread = spread;
      // The interference is between two screens, so there has to be a screen.
      // Brought up with the effect rather than left to the preset, or this is a
      // no-op on every mode that does not already halftone — and the scale is
      // only set when this is the pulse that raised it.
      if (post.halftone < amount * 0.8) {
        post.halftone = amount * 0.8;
        post.halftoneScale = scale;
      }
    },
  },
  {
    id: "benday",
    weight: 0.45,
    ramp: 1.5,
    init: (rng) => [rng.range(0.5, 1), rng.range(0.8, 1.8)],
    apply: (post, k, _time, [peak, scale]) => {
      const amount = k * peak;
      if (amount <= post.benday) return;
      post.benday = amount;
      // Same reason as the moire: a flowing screen needs a screen to flow.
      if (post.halftone < amount * 0.75) {
        post.halftone = amount * 0.75;
        post.halftoneScale = scale;
      }
    },
  },
  {
    id: "krackle",
    weight: 0.45,
    // Both are the page's own drawing turned into light — one out of its
    // highlights, one out of its lines.
    partners: ["neon"],
    ramp: 1.5,
    init: (rng) => [rng.range(12, 46), rng.range(0.45, 0.78), rng.range(0.5, 0.9)],
    apply: (post, k, _time, [scale, knee, peak]) => {
      const amount = k * peak;
      if (amount <= post.krackle) return;
      post.krackle = amount;
      post.krackleScale = scale;
      post.krackleThreshold = knee;
    },
  },
  {
    // Bleed and stock together: they are one idea — the paper taking the ink
    // badly — and separating them would spend two slots on half of it each.
    id: "newsprint",
    weight: 0.4,
    ramp: 2,
    init: (rng) => [rng.range(0.8, 3), rng.range(0.4, 0.8), rng.range(0.35, 0.75)],
    apply: (post, k, _time, [radius, bleedPeak, paperPeak]) => {
      const bleed = k * bleedPeak;
      if (bleed > post.bleed) {
        post.bleed = bleed;
        post.bleedRadius = radius;
      }
      post.paper = Math.max(post.paper, k * paperPeak);
    },
  },

  // --- optics ---------------------------------------------------------------
  {
    // Additive, and deliberately so: dispersion has nothing to act on by
    // itself, so it is at its best stacked onto whatever warp is already
    // running rather than competing for a slot with it.
    id: "disperse",
    weight: 0.7,
    init: (rng) => [rng.range(0.12, 0.35)],
    apply: (post, k, _time, [depth]) => {
      post.disperse = Math.min(0.55, post.disperse + k * depth);
    },
  },
  {
    id: "blur",
    weight: 0.5,
    ramp: 1.5,
    init: (rng) => [rng.range(0.2, 0.5), rng.range(0, 1)],
    apply: (post, k, _time, [depth, spin]) => {
      const amount = k * depth;
      if (amount <= post.blur) return;
      post.blur = amount;
      post.blurSpin = spin;
    },
  },
  {
    // Safe to pulse at any depth despite moving light around, because it does not
    // move any *net* light: the spread is debited from the highlight it came out
    // of. That is the property that lets this exist beside a max() feedback path
    // at all — see PostParams.bloom.
    id: "bloom",
    weight: 0.5,
    ramp: 2,
    init: (rng) => [rng.range(0.5, 0.85), rng.range(0.012, 0.042), rng.range(0.3, 0.6)],
    apply: (post, k, _time, [knee, radius, peak]) => {
      const amount = k * peak;
      if (amount <= post.bloom) return;
      post.bloom = amount;
      post.bloomThreshold = knee;
      post.bloomRadius = radius;
    },
  },
  {
    /*
     * The page under moving water, with the light gathered into a net.
     *
     * Multiplicative and never above one — the ridges are the frame as it was
     * drawn and everything between them is shadowed — so this is the rare
     * addition here that has no washout argument to make at all: it can only
     * take light away. A caustic is read by its contrast rather than by the
     * brightness of the surface it lands on, so nothing is lost by building it
     * downward.
     *
     * The other half of why it belongs in a pool with this brief: shading is the
     * one treatment that cannot cost legibility. It does not move an edge, quantise
     * a tone or claim a coordinate; every line stays where the artist put it and
     * the light merely travels over it.
     */
    id: "caustics",
    weight: 0.6,
    ramp: 2,
    partners: ["neon", "sheen"],
    init: (rng) => [
      rng.range(2.2, 6),
      // Low, and lower than it looks: the net is where two layers coincide, so
      // what a viewer follows moves several times faster than either layer.
      rng.range(0.02, 0.07),
      rng.range(0.45, 0.85),
    ],
    apply: (post, k, _time, [scale, speed, peak]) => {
      const amount = k * peak;
      if (amount <= post.caustics) return;
      post.caustics = amount;
      post.causticsScale = scale;
      post.causticsSpeed = speed;
    },
  },
  // --- surreal --------------------------------------------------------------
  {
    id: "solarize",
    weight: 0.7,
    init: (rng) => [rng.range(0.5, 0.9)],
    apply: (post, k, _time, [peak]) => {
      post.solarize = Math.min(1, Math.max(post.solarize, k * peak));
    },
  },
  {
    /*
     * The drawing lit up — the frame's own linework found and given emission.
     *
     * The most literal thing in the pool. Everything else treats a panel as a
     * surface to bend, screen or tone; this reads the ink back out of it and
     * makes the ink the figure, so the shape on screen is a shape somebody drew
     * and a handover replaces it outright. Nothing else here can say that: the
     * folds and the fractal draw the same figure whatever page is under them.
     */
    id: "neon",
    weight: 0.6,
    ramp: 1.5,
    partners: ["caustics", "bloom"],
    init: (rng) => [
      rng.range(0, 1),
      // Rarely the whole spectrum. A single colour over a whole drawing reads as
      // a sign, which is the effect at its most legible; the full ring is
      // gorgeous and busy, and it wants to be the exception.
      rng.bool(0.3) ? rng.range(0.6, 1) : rng.range(0.05, 0.35),
      // Pixels. The low end is the linework alone; the high end walks off it
      // onto the boundaries between a panel's masses and lights those instead,
      // which is the same effect drawn at the scale of the composition.
      rng.range(0.9, 3.4),
      // The lowest ceiling of anything here. Past about three-quarters the ink
      // stops being ink and the frame is a wireframe of itself — which is a
      // different effect, and not one that keeps a panel readable.
      rng.range(0.35, 0.7),
    ],
    apply: (post, k, _time, [hue, spread, width, peak]) => {
      const amount = k * peak;
      if (amount <= post.neon) return;
      post.neon = amount;
      post.neonHue = hue;
      post.neonSpread = spread;
      post.neonWidth = width;
    },
  },
  {
    /*
     * Oil on water: a thin-film sheen keyed to the frame's own tone.
     *
     * Adds chroma that sums to no luminance at all, so the picture keeps every
     * value it had — the bloom's guarantee, arrived at from the other side — and
     * it is windowed to the mid-tones so the ink and the paper are untouched.
     * Between them those two properties mean a page can be turned to petrol and
     * still be read, which is why this carries the highest weight of the three
     * colour entries added with it.
     */
    id: "sheen",
    weight: 0.75,
    ramp: 1.5,
    partners: ["melt", "wake", "caustics"],
    init: (rng) => [
      // Two is a duotone rolling through the greys and six is a slick with
      // visible fringes; both are the same effect at different tempers, and the
      // draw covers the range because a run wants both.
      rng.range(2, 6.5),
      rng.range(0.008, 0.035),
      rng.range(0.5, 0.9),
    ],
    apply: (post, k, _time, [bands, drift, peak]) => {
      const amount = k * peak;
      if (amount <= post.sheen) return;
      post.sheen = amount;
      post.sheenBands = bands;
      post.sheenDrift = drift;
    },
  },
  {
    id: "hue-sweep",
    weight: 0.9,
    init: (rng) => [rng.bool() ? 1 : -1, rng.range(0.02, 0.07)],
    apply: (post, k, time, [direction, rate]) => {
      post.hueShift += k * direction * osc(time, rate) * 0.9;
    },
  },
  {
    id: "chroma-bloom",
    weight: 0.7,
    init: (rng) => [rng.range(0.4, 0.9)],
    apply: (post, k, _time, [depth]) => {
      post.chroma = Math.min(1.5, post.chroma + k * depth);
    },
  },
  {
    id: "posterize",
    weight: 0.6,
    init: (rng) => [rng.range(0.35, 0.85)],
    apply: (post, k, _time, [depth]) => {
      post.posterize = Math.min(1, Math.max(post.posterize, k * depth));
    },
  },
  {
    id: "halftone",
    // The lowest weight in the pool, and lower than the two effects that bring
    // a screen in as a side effect: a bare dot screen restates every tone in
    // the frame and says nothing the moire and the benday do not say with
    // something moving on top of it, so it is the rarest punctuation here.
    weight: 0.22,
    init: (rng) => [rng.range(0.6, 1.8)],
    apply: (post, k, _time, [scale]) => {
      const amount = k * 0.8;
      if (amount <= post.halftone) return;
      post.halftone = amount;
      post.halftoneScale = scale;
    },
  },
  {
    id: "smear",
    weight: 0.8,
    exclusive: "trail",
    // The trail holds where the frame has been and the wake colours it by how
    // fast it went.
    partners: ["wake"],
    init: (rng) => [rng.range(-0.006, 0.006), rng.range(0.004, 0.016)],
    apply: (post, k, _time, [spin, grow]) => {
      // Additive on top of whatever the preset already runs: a piece that is
      // already smearing goes further rather than snapping to a fixed value.
      // The ceiling is well under the config's: the post chain keeps trails
      // with max() rather than mix(), so retention near 1 has no decay and a
      // wall of light comic panels bleaches the frame to white and stays there.
      post.feedbackAmount = Math.min(0.82, post.feedbackAmount + k * 0.25);
      post.feedbackScale += k * grow;
      post.feedbackRotate += k * spin;
    },
  },
  {
    // The trail read as a corridor rather than as a receding spiral. Tagged
    // against the smear: both reparameterise the same trail, and the smear's
    // growing scale is precisely what the corridor's wrap is there to replace, so
    // running them together is one trail being asked to recede and to come back
    // at the same time.
    id: "corridor",
    weight: 0.4,
    ramp: 2.5,
    exclusive: "trail",
    init: (rng) => [rng.range(1.1, 2.2), rng.range(0.05, 0.1), rng.range(0.5, 0.9)],
    apply: (post, k, _time, [period, inner, peak]) => {
      const amount = k * peak;
      if (amount <= post.feedbackDroste) return;
      post.feedbackDroste = amount;
      // The stride is shared with the frame's own regress by design, so it is
      // only set here when nothing else is using it: a running Droste has already
      // chosen one, and the agreement is the point.
      if (post.droste <= 0) {
        post.drostePeriod = period;
        post.drosteInner = inner;
      }
      // A corridor built out of a trail that is not there is nothing at all, so
      // the retention comes up with it — under the same ceiling the smear uses,
      // for the same washout reason.
      post.feedbackAmount = Math.max(post.feedbackAmount, Math.min(0.7, amount * 0.7));
    },
  },
];

interface Pulse {
  effect: number;
  /** Clock seconds. */
  start: number;
  attack: number;
  hold: number;
  release: number;
  /** Ceiling of the envelope, 0..1. */
  peak: number;
  args: number[];
  /**
   * A companion riding this pulse's envelope — see `partners`.
   *
   * Carried inside the pulse rather than pushed as a second one, and that is
   * the whole argument for it costing no concurrency: the cap is on how many
   * *schedules* are moving the frame at once, which is §6's constraint, and a
   * companion sharing every corner of this envelope is not a second schedule.
   * It arrives when this arrives, peaks when this peaks and is gone when this
   * is gone. Two pulses that merely overlapped would be the thing the cap
   * exists to limit; this is one gesture with two voices in it.
   */
  mate?: { effect: number; peak: number; args: number[] };
}

function duration(pulse: Pulse): number {
  return pulse.attack + pulse.hold + pulse.release;
}

/**
 * The largest rung whose wait fits inside `BOUNDARY_SHARE` of the gap.
 *
 * Falls back to a single bar rather than to nothing, because the floor under the
 * gap is already two seconds and a bar is usually shorter than that: at the point
 * where even one bar is a quarter of the interval the cycler is firing so often
 * that a bar of quantisation is the least of what is happening.
 */
function boundaryBars(gap: number, bar: number): number {
  if (!(bar > 0)) return 1;
  const bars = (gap * BOUNDARY_SHARE) / bar;
  for (const rung of BOUNDARY_LADDER) if (rung <= bars) return rung;
  return 1;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The envelope's own shape, 0..1, before either voice's depth is applied.
 *
 * Split out from the depth because a pulse can carry a companion, and the two
 * are the same gesture at two weights: one shape, multiplied twice.
 */
function shape(pulse: Pulse, time: number): number {
  const age = time - pulse.start;
  if (age <= 0) return 0;
  if (age < pulse.attack) return smooth(age / pulse.attack);
  const held = pulse.attack + pulse.hold;
  if (age < held) return 1;
  const out = (age - held) / pulse.release;
  if (out >= 1) return 0;
  return smooth(1 - out);
}

/**
 * Brings psychedelic effects in and out at random, one or a few at a time.
 *
 * The point is that no single frame is the piece: an effect swells over
 * several seconds, holds long enough to stop reading as a transition, and
 * recedes, and what is running when is never quite the same twice. Every
 * choice comes from a seeded stream, so a run is still reproducible from its
 * URL.
 *
 * Its rng is forked lazily, on the first pulse it actually schedules. A preset
 * that leaves psychedelia at 0 therefore never draws from the director's
 * stream at all, and replays frame-for-frame as it did before this existed.
 */
export class EffectCycler {
  private stream: Rng | null = null;
  private readonly active: Pulse[] = [];
  private nextOnset = -1;
  /** A pulse asked for out of turn — see `cue`. */
  private cued = false;

  constructor(
    private readonly forkStream: () => Rng,
    private readonly safety: SafetyGovernor
  ) {}

  /**
   * Bring the next pulse forward: the music has just changed section, so
   * something in the piece should change with it.
   *
   * The section row of `docs/visualizer-audio-reach.md` §4.3, and the one place
   * anything outside the seed reaches the cycler. What arrives is still the
   * cycler's own weighted draw with its own ramps — the music decides *when*,
   * never *what*, which is the same division the director already keeps between
   * the beat grid and panel selection.
   *
   * Seeded replay is unaffected for the runs that have to have it: a cue is only
   * ever raised by a run that was given a listener, and a run that never listens
   * draws exactly the sequence it drew before this existed.
   */
  cue(): void {
    this.cued = true;
  }

  /** Mutates `post` in place with whatever is currently running. */
  apply(
    post: PostParams,
    time: number,
    intensity: number,
    interval: number,
    tempo?: TempoLock
  ): void {
    const amount = clamp(intensity, 0, 1);

    for (let i = this.active.length - 1; i >= 0; i--) {
      if (time - this.active[i].start >= duration(this.active[i])) this.active.splice(i, 1);
    }

    if (amount <= 0) {
      // Turned off mid-run: stop scheduling, but let what is already running
      // ride out its release. Dropping the pulses here would be a step change
      // in whole-frame luminance, which is the one thing nothing may do.
      this.nextOnset = -1;
    } else {
      // Open on something rather than a wait, but not on everything at once.
      if (this.nextOnset < 0) this.nextOnset = time + this.gap(amount, interval) * 0.35;

      const concurrent = 1 + Math.round(amount * (MAX_CONCURRENT - 1));
      while (time >= this.nextOnset) {
        // A slot that is already full drops its turn instead of queueing it,
        // so a busy stretch stays busy rather than building a backlog that
        // all lands at once when the stack clears.
        if (this.active.length < concurrent) this.begin(time, amount, tempo);
        this.nextOnset = this.schedule(time, this.nextOnset, amount, interval, tempo);
      }
      /*
       * And the cue, under the same slot rule and the same interval — a section
       * change moves the next pulse to now rather than adding one, so a piece
       * answering the music runs no busier than the same piece ignoring it. A
       * cue that arrives with every slot full is dropped, on the reasoning
       * above: the composition is already in the middle of changing.
       */
      if (this.cued && this.active.length < concurrent) {
        this.begin(time, amount, tempo);
        this.nextOnset = this.schedule(time, time, amount, interval, tempo);
      }
    }
    this.cued = false;

    for (const pulse of this.active) {
      const k = shape(pulse, time);
      if (k <= 0) continue;
      EFFECTS[pulse.effect].apply(post, k * pulse.peak, time, pulse.args);
      if (pulse.mate) EFFECTS[pulse.mate.effect].apply(post, k * pulse.mate.peak, time, pulse.mate.args);
    }
  }

  reset(): void {
    this.active.length = 0;
    this.nextOnset = -1;
    this.cued = false;
  }

  private get rng(): Rng {
    return (this.stream ??= this.forkStream());
  }

  /**
   * When the pulse after this one should begin — the composition's own cadence,
   * then quantised to the grid.
   *
   * Measured from the later of the last onset and now, which is both the honest
   * behaviour when a run has fallen behind and the property that keeps the loop
   * above terminating: the delay handed to the aligner is then always a positive
   * one, so the boundary it returns is always in the future. A cycler that had
   * stalled used to replay the gaps it missed into a single frame; the slot rule
   * dropped most of them anyway.
   */
  private schedule(
    now: number,
    from: number,
    amount: number,
    interval: number,
    tempo?: TempoLock
  ): number {
    const gap = this.gap(amount, interval);
    const wanted = Math.max(now, from) + gap;
    if (!tempo?.active) return wanted;
    return now + tempo.alignedDelay(wanted - now, boundaryBars(gap, tempo.barSeconds));
  }

  /**
   * Whether an effect may start now: not already running — two pulses of the
   * same effect would just be one louder pulse — and not tagged against
   * anything that is.
   *
   * `also` is an effect being started in the same breath as this one, which is
   * not in `active` yet and still has to be excluded against.
   */
  private available(index: number, also = -1): boolean {
    if (index === also) return false;
    const tag = EFFECTS[index].exclusive;
    if (also >= 0 && tag && EFFECTS[also].exclusive === tag) return false;
    for (const pulse of this.active) {
      for (const voice of pulse.mate ? [pulse.effect, pulse.mate.effect] : [pulse.effect]) {
        if (voice === index) return false;
        if (tag && EFFECTS[voice].exclusive === tag) return false;
      }
    }
    return true;
  }

  private begin(time: number, amount: number, tempo?: TempoLock): void {
    const rng = this.rng;
    const effect = rng.weightedIndex(
      EFFECTS.map((entry, index) => (this.available(index) ? entry.weight : 0))
    );

    /*
     * The companion, drawn before the envelope rather than after it.
     *
     * The pair shares one envelope — that is what makes it a gesture with two
     * parts rather than two things that happened to overlap — so the longer of
     * the two ramps has to win. Decided the other way round, a warp's four
     * second attack would be handing the slowest entry in the pool the fastest
     * arrival in it, which is the one thing the per-effect `ramp` exists to
     * prevent.
     *
     * The chance grows with psychedelia rather than being flat. A pair is the
     * pool speaking in a compound sentence, and a preset that asked for one
     * effect at a time is asking for simple ones.
     */
    let partner = -1;
    const options = EFFECTS[effect].partners;
    if (options && rng.bool(PARTNER_CHANCE * (0.35 + 0.65 * amount))) {
      const wanted = rng.pick(options);
      const index = EFFECTS.findIndex((entry) => entry.id === wanted);
      if (index >= 0 && this.available(index, effect)) partner = index;
    }

    const bed = rng.bool(BED_CHANCE);
    const ramp =
      Math.max(EFFECTS[effect].ramp ?? 1, partner >= 0 ? EFFECTS[partner].ramp ?? 1 : 1) *
      (bed ? BED_RAMP : 1);
    /*
     * Every segment of the envelope in tempo, so a pulse that begins on a
     * downbeat also *peaks* on one and is gone on one.
     *
     * This is the half of §16 that the onset alignment on its own does not buy.
     * A four-second attack starting on the bar arrives three-quarters of the way
     * through the second one, which is the same absence of coincidence the free
     * onset had, moved four seconds later — and the attack is where the eye is,
     * because that is when the effect is doing something it was not doing
     * before. Snapped through `TempoLock.duration`, the segments are musical
     * multiples of the bar and the sum of two of them is another, so all three
     * of a pulse's corners land on the grid.
     *
     * Snapped before the governor rather than after: `clampRamp` is a safety
     * floor and must have the last word, and the snap can only ever move a
     * length by half the gap between adjacent divisions, which never takes a
     * legal ramp below the floor by more than that.
     */
    const musical = (seconds: number): number =>
      tempo?.active ? tempo.duration(seconds) : seconds;
    // The ramps are the safety-critical part; the governor floors them.
    const attack = this.safety.clampRamp(musical(rng.range(2.5, 7) * ramp));
    const release = this.safety.clampRamp(musical(rng.range(3, 9) * ramp));
    // More psychedelia holds longer as well as stacking deeper, so a high
    // setting reads as a state the piece is in rather than a flicker. A bed
    // takes that much further and gives up half its depth to pay for it.
    const hold = musical(rng.range(5, 18) * (0.6 + amount * 0.8) * (bed ? BED_HOLD : 1));
    const depth = amount * (bed ? BED_DEPTH : 1);

    this.active.push({
      effect,
      start: time,
      attack,
      release,
      hold,
      peak: depth * rng.range(0.55, 1),
      args: EFFECTS[effect].init(rng),
      // Drawn a shade under the pulse carrying it: the companion is the second
      // voice, and a dispersion or a slick at the same weight as the thing it is
      // dressing has stopped dressing it.
      mate:
        partner >= 0
          ? {
              effect: partner,
              peak: depth * rng.range(0.4, 0.8),
              args: EFFECTS[partner].init(rng),
            }
          : undefined,
    });
  }

  private gap(amount: number, interval: number): number {
    const base = Math.max(2, interval) * (1.35 - amount * 0.7);
    return base * this.rng.range(0.65, 1.45);
  }
}
