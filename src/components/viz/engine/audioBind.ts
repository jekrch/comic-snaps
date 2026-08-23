import type { AudioFrame } from "./AudioReactor";
import { BEATS_PER_BAR } from "./AudioReactor";
import type { SafetyGovernor } from "./safety";
import type { PostParams } from "./types";

/**
 * What the music does to the composition — the binding layer of
 * `docs/visualizer-audio-plan.md` §4, restructured along
 * `docs/visualizer-audio-reach.md` §4.2 and §4.3.
 *
 * Held apart from the director for the same reason `Wander` and `EffectCycler`
 * are: it is one more pass over the parameters the config authored, and the
 * order it runs in matters more than what it contains.
 *
 * ## Why this was rewritten
 *
 * The previous arrangement measured well and did almost nothing, and the reason
 * was arithmetic rather than taste. Every channel here is a one-pole filter, so
 * its attenuation at a given rate is calculable: at 120 BPM the band envelope
 * passed about half the beat, the swell envelope about a sixth of that, and the
 * six-tap cascade underneath it another twentieth. The geometry bindings, on the
 * last tap, were receiving roughly half a percent of the beat. They were not
 * responding weakly; they were not responding.
 *
 * The instinct that produced that — v1 read as a flinch, so everything was
 * slowed down — was right about the problem and wrong about the mechanism. In a
 * chain of one-poles, *rate and depth are the same knob*, so slowing the
 * response also emptied it, and no setting of `reactivity` could recover one
 * without the other.
 *
 * ## Two ideas replace it
 *
 * **Match the timescale of the parameter to the timescale of the event.** Jerk
 * is not caused by responding on the beat; it is caused by responding on the
 * beat with a parameter that moves the *picture*, because geometric velocity is
 * what the eye reads as a flinch. So there is a hierarchy, and the previous
 * version had it exactly inverted:
 *
 * - **Beat rate**, 1–4Hz → colour, tone, print artefacts, and the *compounding*
 *   trail terms. None of these have on-screen velocity. A hue step cannot read
 *   as motion however fast it arrives, and a trail zoom applied a thousandth at
 *   a time accumulates into a large visible change without anything on screen
 *   ever moving quickly.
 * - **Bar rate**, ~0.5Hz → the geometry. Frame scale, the spatial rates, the
 *   depth of whatever distortion the preset is running. Slow enough that a much
 *   larger amplitude still has a lower peak velocity than the old one did.
 * - **Phrase**, ~0.05Hz → the amplitude of both of the above, so the piece is
 *   never quite as responsive as it was thirty seconds ago.
 *
 * **Synthesise the motion; do not filter it.** Rather than smoothing an energy
 * signal until it is safe — which is what cost the amplitude — the shapes below
 * are *generated* from the reactor's phase-locked grid and only their amplitude
 * is taken from energy. A raised cosine over a bar is continuous in value and in
 * derivative by construction, carries its full depth at bar rate, and, because
 * `beatPhase` predicts rather than reports, can peak *just before* the beat
 * rather than chasing it. That is the same anticipation the fade lead in
 * `Director.beatIndex` already relies on, and it is what makes a slow medium
 * read as locked to fast music.
 *
 * The energy channels are still here. They carry the response on material the
 * beat tracker will not lock to, and the two paths crossfade on `confidence`.
 *
 * ## Two knobs over it
 *
 * Because the rows are separated in frequency, the control surface can be too.
 * `reactivity` is depth — how far the composition travels — and `attack` is
 * where on the hierarchy that travel is spent: at 1 the fast row runs on the
 * beat's shape and the accent fires, at 0 it runs on the bar's and nothing in
 * the piece changes faster than a bar. Neither end is quieter than the other,
 * which is the property the single knob could not have had. See `FAST_BREATH`.
 *
 * The third row is here too, as `section` — a cue rather than a channel, raised
 * when the music's own level moves and spent by the director on the discrete
 * gestures no parameter can express. See `SECTION_BASELINE`.
 *
 * ## What the attribution round added, and why
 *
 * The arrangement above measures well and, per
 * `docs/visualizer-audio-attribution.md`, was still not *attributable*: once the
 * grid locked, every bar produced the same raised cosine at an amplitude that was
 * a two-second average of a three-second average, so nothing on screen depended
 * on what the music actually played in that bar. It was a metronome with a volume
 * knob, and a viewer cannot point at a metronome and say *that happened because of
 * that*.
 *
 * Four things answer it, and none of them raises peak velocity:
 *
 * - **The bar's amplitude is latched from the bar that just played** rather than
 *   filtered over several. A loud bar is followed by a bigger one. The value
 *   steps once per bar and glides over the next, so its contribution to velocity
 *   is a full range divided by a bar. See `BAR_SWING`.
 * - **The bar's *shape* is chosen from a vocabulary**, by what the previous bar
 *   contained. Variety with a cause: bars differ because the music did. See
 *   `GESTURES`.
 * - **The three onset streams are bound separately.** Kick to the weight, snare
 *   to the lateral, hat to the texture — all on the fast row, none on the
 *   geometry, so the hierarchy is unchanged. See `HIT_ATTACK`.
 * - **A fill winds the composition up and a drop is arrived on.** The only
 *   anticipatory channel in the feature, and the only cue that resolves a
 *   structural moment to the frame it happens on. See `WIND_TAU` and
 *   `ARRIVAL_GAP`.
 *
 * And one thing that is not a channel at all: `autonomy`, the share of the
 * composition's *own* motion the director should give back while the music is
 * carrying the frame. Attribution is a ratio, and it is the only term here that
 * moves the denominator. See `HANDOVER`.
 */

// --- the synthesised grid ---------------------------------------------------

/**
 * Real seconds for the synthesised path to take over from the energy path when
 * the lock is gained, and to hand it back when the lock is lost.
 *
 * Long, because this is a crossfade between two ways of moving rather than a
 * switch between two values, and a lock that flickers around the threshold must
 * not show as the composition changing its mind.
 */
const LOCK_FADE = 1.5;
/**
 * Smoothing over the generated shapes, as a fraction of a beat.
 *
 * Not there to shape anything — the shapes are already smooth — but to absorb
 * the phase-locked loop's own corrections. `AudioReactor.lockPhase` nudges the
 * grid by up to 12% of the phase error on every onset, which is a small step in
 * the phase and therefore a small step in anything read from it.
 *
 * ## In beats rather than in seconds, and why that is not a refinement
 *
 * This was 50ms flat. What it is absorbing is a *phase* error, and a phase error
 * is a fraction of a beat by definition — so a fixed time constant is the wrong
 * unit twice over: too weak to cover the correction at 60BPM and, far worse,
 * comparable to the whole shape at the fast end. With `BEAT_FALL` at 0.2 the
 * release is 94ms at 128BPM and 70ms at 172, and a 50ms one-pole over a 70ms edge
 * does not soften it, it removes it — which would have handed §19's sharper beat
 * shape straight back to the filter and left the measurement unmoved.
 *
 * At 0.035 of a beat this is 16ms at 128BPM: still several frames at any rate the
 * engine runs, still longer than one phase nudge, and now a fixed fraction of every
 * shape it is applied to at every tempo. The floor and ceiling are for the unlocked
 * case and for the edges of the tracked range, where `bpm` is 0 or extreme.
 */
const SHAPE_SMOOTH_BEATS = 0.035;
const SHAPE_SMOOTH_MIN = 0.008;
const SHAPE_SMOOTH_MAX = 0.05;

/** Bars to a phrase, and a second period that shares no factor with it. Two
 *  raised cosines at 8 and 5 bars sum to something that does not repeat for
 *  forty — which is the cheapest way to have a slow channel that nobody can
 *  ever see as a cycle. */
const BARS_PER_PHRASE = 8;
const BARS_PER_PHRASE_ALT = 5;

/**
 * The beat pulse, as a position and two widths in fractions of a beat.
 *
 * Peaks just *before* the beat rather than on it. This is anticipation, and it
 * is the difference between a composition that follows the music and one that
 * arrives with it: the rise is the longer half, so the frame is already at its
 * maximum as the beat lands and is on its way out by the time the next one is
 * approaching. Reversing the two — fast attack on the beat, slow decay after —
 * is the classic sidechain pump, and it is exactly the discontinuity in the
 * derivative that v1 read as a flinch.
 *
 * ## The widths, and the measurement that halved them — §19
 *
 * These read 0.5 and 0.28, a duty of 78%, and the note here said that was a rest.
 * It is not much of one, and the consequence is the whole of §19's complaint. A
 * shape that occupies 78% of its cycle is a sine with a slight flat spot: its
 * motion is spread almost evenly across the beat, so there is no instant in it,
 * and *periodicity at beat rate is not the same thing as rhythm*. `audio-motion.mjs`
 * scores this directly as `sync`, the concentration of a channel's speed over beat
 * phase, and the old shape measured **0.07** on the material it locks best to —
 * against 0.24 for the beat-locked walk, which is the one channel in the file built
 * as a discrete step rather than as a curve.
 *
 * At 0.30 and 0.20 the duty is 50%: the pulse rises over the last third of the
 * beat, arrives, releases inside a fifth of one, and then there is half a beat of
 * genuine stillness before the next. That stillness is what makes the arrival read
 * as an event rather than as a level, and it is bought entirely with *shape* — the
 * amplitude is unchanged, and the peak this reaches is the one it always reached.
 *
 * The cost is slope. Peak rate is `gain × π / (2 × fall)` per beat, so this runs at
 * 7.9/beat against 5.6, an increase of 40% — spent on a row that by construction
 * cannot move the picture or flash it. §4.3 of the reach document routed the fast
 * channels to colour and the print family precisely so that sharpness would be
 * affordable somewhere, and then never spent the allowance.
 */
const BEAT_PEAK = 0.96;
const BEAT_RISE = 0.3;
const BEAT_FALL = 0.2;

/** Where the bar's own gesture peaks: a hair before the downbeat, on the beat
 *  pulse's argument. The widths live in `GESTURES` now rather than beside this,
 *  because after §19 they differ per member — the family is a vocabulary of
 *  shapes and only the arrival instant is common to all of it. */
const BAR_PEAK = 0.97;

/**
 * The bar gestures — §3.4 of `docs/visualizer-audio-attribution.md`.
 *
 * One shape repeated every bar forever is the defect that document names: the
 * bar row carries the geometry, the geometry is most of what a viewer sees, and
 * a periodic function of phase times a slow scalar has nothing in it anybody
 * could attribute to the music. These are five, chosen at each downbeat by what
 * the *previous* bar actually contained — see `chooseGesture`, and note that the
 * choice is deterministic rather than drawn from the rng, because variety
 * without a cause is noise and the whole point is that the cause is audible.
 *
 * Every member is built out of `pulseShape`, so continuity in value and
 * derivative is a property of the family rather than of any one entry, and the
 * peak slope of each is arithmetic: `gain × lobes × π / (2 × width)` per bar. The
 * steepest of them is `late`, at 4.7/bar against the breath's 4.36 — so the whole
 * vocabulary fits inside the velocity budget the single shape already spent, and
 * what varies is only which way the bar leans.
 *
 * **`rise + fall` must stay under 1 in every entry**, and that is a correctness
 * condition rather than a style note: past it the window laps itself, the far end
 * of the rise is folded to the other side of the peak and read as zero, and the
 * shape steps by a third of its range between two frames. `late` was written with
 * 0.8 and 0.34 the first time and measured 43.8%/s on the frame scale against the
 * 9.5%/s the row is budgeted at — the same failure §10 of the reach document
 * found in `pulseShape` itself, reintroduced one level up by the first shape that
 * wanted a long rise. See `pulseShape`, which has the arithmetic.
 *
 * `base` is a floor held through the bar rather than a second shape. It is what
 * makes `hold` read as weight — the bar never quite lets go — without needing a
 * wider window, which is the only other way to get there and costs slope.
 */
interface Gesture {
  peak: number;
  rise: number;
  fall: number;
  gain: number;
  /** Repeats of the shape per bar. Two is a bar pushing twice. */
  lobes: number;
  /** Held under the shape for the whole bar. */
  base: number;
}

/**
 * Every member carries a floor now, and every window is narrower — §19.
 *
 * The family as first written filled 96–98% of the bar and rested at zero, which
 * is the worst of both readings available. Filling the bar means the geometry is
 * *always* mid-gesture, so nothing in it ever coincides with a downbeat; resting at
 * zero means the one moment it does hold still is the moment the music is loudest.
 * Measured on `audio-motion.mjs`, every geometry parameter scored `bsync` **0.02** —
 * its movement spread evenly over the bar, indistinguishable from a channel with no
 * grid under it at all.
 *
 * Inverting the two fixes both at once and costs nothing in excursion:
 *
 * - **The floor replaces the rest.** `base` holds the geometry out at a quarter of
 *   its reach through the whole bar, which is what the old note about "geometry
 *   that stops moving reads as a stall" was really asking for — the frame stays
 *   deepened while the music plays, and it is the *movement* that stops rather than
 *   the depth. A constant contributes no velocity and no jerk by construction.
 * - **The window narrows onto the downbeat.** Each shape now travels over about
 *   two-thirds of the bar and holds still for the rest, so there is an instant in
 *   the geometry and the instant is the one the music is marking.
 *
 * Gains are set so that peak excursion *falls* — `breath` covers 0.75 where it
 * covered 1.0 — which is what pays for the narrower windows. Peak slope is
 * `gain × lobes × π / (2 × min(rise, fall))` per bar and comes to 4.9, 5.7, 2.6,
 * 6.4 and 1.8; the family was budgeted at 4.4–4.7, and `PULSE_BAR` is cut by 38% in
 * the same change, so the frame scale this reaches ends up slower than it was.
 *
 * **`rise + fall` must stay under 1 in every entry.** Still a correctness
 * condition rather than a style note — see `pulseShape`, which has the arithmetic
 * for what a lapped window does to the slope.
 */
const GESTURES = {
  /** The original, and still the answer for an ordinary bar. */
  breath: { peak: BAR_PEAK, rise: 0.42, fall: 0.24, gain: 0.75, lobes: 1, base: 0.25 },
  /** Two half-bar pushes, each lighter — a busy bar answered by a busy shape. */
  push: { peak: 0.96, rise: 0.36, fall: 0.22, gain: 0.4, lobes: 2, base: 0.25 },
  /** Weight: shallower, wider, and sitting on the highest floor of the five. The
   *  one member whose reading is sustain rather than arrival, so it is the one
   *  that keeps a broad window. */
  hold: { peak: 0.94, rise: 0.5, fall: 0.3, gain: 0.5, lobes: 1, base: 0.45 },
  /** The run-up. A long rise arriving at the very end of the bar, so the frame
   *  is at its maximum as the next downbeat lands — and a short fall, so it is
   *  out of the way before the bar it was anticipating gets going. */
  late: { peak: 0.995, rise: 0.5, fall: 0.2, gain: 0.82, lobes: 1, base: 0.18 },
  /** A bar with almost nothing in it gets a bar with almost nothing in it. This
   *  is the member that makes the others mean something, and the only one whose
   *  floor is low enough to read as the composition standing down. */
  still: { peak: BAR_PEAK, rise: 0.42, fall: 0.24, gain: 0.28, lobes: 1, base: 0.15 },
} as const satisfies Record<string, Gesture>;

type GestureName = keyof typeof GESTURES;

/**
 * The figures — §20, and the answer to a composition that was rhythmic on every
 * beat of every bar and therefore monotonous about it.
 *
 * §19 gave the beat row a shape that lands. What it did not give it was anywhere
 * to *not* land: every channel it reaches was reached on all four beats of every
 * bar forever, so the result was legibly on the beat and relentless about being
 * there. A drummer who plays every beat on every drum for four minutes is in time
 * and is not making music. What makes a part musical is that it changes what it is
 * doing — and the two axes it changes along are *which beats* carry the accent and
 * *what the accent moves*.
 *
 * So a figure is exactly those two things: a *pattern* of accents and a set of
 * routing gains. One is chosen every `FIGURE_BARS` from what the phrase that just
 * ended contained, blended into over a bar, and it decides how the whole beat row
 * is spent until the next one.
 *
 * ## The two rules the patterns are written under — §22
 *
 * §§20 and 21 gave the row a vocabulary and the vocabulary was still relentless,
 * because every member of it accented the *same* beats: one, or one and three, or
 * all four. Three of those are a metronome at a different rate and the fourth is a
 * metronome. Watched for a minute the composition had one rhythmic idea, stated
 * continuously, and the only thing that ever changed was how many times a bar it
 * was stated.
 *
 * Two rules replace that, and both are about where the accents are *not*:
 *
 * 1. **Never more than two beats in a row, and when there are two they are
 *    adjacent** — one-two, two-three, three-four, or four-one across the barline.
 *    A pair is a *figure* in the way a single accent and an even spread are not:
 *    it has an inside and an outside, so the second hit means something the first
 *    did not, and the four placements are four genuinely different statements
 *    rather than four densities of the same one. One-and-three, which two members
 *    used to play, is the one two-accent pattern with no such inside — it is the
 *    half-note pulse, which is to say the metronome again.
 * 2. **Then a real break.** A pattern runs over one *or more* bars, and the bars
 *    that carry no accent at all are the point of the whole section: the ordinary
 *    figure here states its pair and then holds still for six beats. What makes an
 *    arrival read as an arrival is the length of the silence before it, and this
 *    is the only place that silence can be bought.
 *
 * Only `drive` — the reserved one, reachable on a genuine lift and nowhere else —
 * repeats its pair every bar, and even it rests for half of each.
 *
 * ## What is deliberately *not* orchestrated
 *
 * The bar row. The breath, the geometry gains, the trail and the phrase swing run
 * identically under every figure including the silent one, and that is what makes
 * the silent one bearable rather than a hole: `swell` takes the beat row away and
 * leaves a composition that is still moving, still deepening on the bar, and still
 * unmistakably responding — it has simply stopped punctuating. The contrast is the
 * product here, and it only exists because something continues underneath.
 *
 * ## Chosen from the music, never drawn
 *
 * The same rule `chooseGesture` holds and for the same reason: variety without a
 * cause is noise, and a viewer who cannot hear why the composition changed its mind
 * is watching a random number generator with extra steps. `chooseFigure` reads the
 * phrase's density, weight, backbeat and energy and orders the candidates from
 * them. The one concession is that it may not pick what is already running — see
 * `REST_AFTER` and the note there, because a rule with no rotation in it produces
 * one figure forever on steady material, which is the failure this whole section
 * exists to fix.
 */
interface Figure {
  /**
   * How much of the pulse each beat carries, 0..1 — a pattern whose length is
   * `BEATS_PER_BAR` times however many bars it runs over. Index 0 is the downbeat
   * of the first bar.
   *
   * Indexed against the *absolute* bar count rather than against however many bars
   * have passed since the figure was chosen — see `cellAt`. A two-bar pattern
   * therefore always accents even bars, whichever bar it was switched on, so two
   * figures that follow each other agree about where the two-bar unit is instead
   * of each starting its own.
   */
  beats: readonly number[];
  /** Depth multiplier on the whole-frame scale pulse. */
  frame: number;
  /** Depth multiplier on the beat-locked walk. */
  walk: number;
  /** Depth multiplier on beat-rate *geometry* — the distortions a preset already
   *  runs, pushed on the beat rather than only on the bar. See `SHAPE_BEAT`. */
  shape: number;
  /** Depth multiplier on the fast row: colour, the press, the trail pump. */
  colour: number;
  /** Whether the frame pulse is spent on one layer of the stack rather than on
   *  all of them together. See `SOLO_OTHERS`. */
  solo: boolean;
  /** How much of the composition's own motion this figure stands down, 0..1 —
   *  scales the handover. A figure that is not punctuating should hand the drift
   *  back rather than leave the frame becalmed. */
  motion: number;
}

const FIGURES = {
  /**
   * One and two, every bar — the densest thing in the vocabulary, reachable by
   * evidence alone.
   *
   * It is not in `FIGURE_ROTATION`, so a phrase with nothing particular to say can
   * never land here: the composition opens up on a genuine peak and at no other
   * time. That is the whole of "stop pulsing with the beat all the time" — not a
   * smaller pulse, but a pulse that is *reserved*, so that the passage it belongs
   * to is the one place a viewer sees the frame answer in consecutive bars.
   *
   * It answered all four beats until §22 and that is exactly what the rule there
   * forbids. What it plays now is the pair on the downbeat — the strongest of the
   * four placements, because the second hit lands while the first is still the
   * newest thing that happened — followed by half a bar of nothing. Twice the
   * silence and half the accents of the old member, at the same gains, which is the
   * trade §19 already made once at beat rate and this section makes again at bar
   * rate.
   */
  drive: {
    beats: [1, 0.85, 0, 0],
    frame: 1,
    walk: 1,
    shape: 0,
    colour: 1,
    solo: false,
    motion: 1,
  },
  /**
   * Movement without pulsing: the beat goes almost entirely into the walk, and
   * the frame barely changes size at all.
   *
   * The figure for busy material, and the reasoning is that density is already
   * carrying the excitement — a frame that also pulses four times a bar over a
   * sixteenth-note hi-hat pattern is two busy things competing. A whole-frame
   * translation reads as *travel* where a scale reads as *impact*, and travel is
   * what a busy passage can absorb.
   *
   * Its pair is the one that straddles the barline — the four of the second bar
   * into the one of the first, an anacrusis — and it is written at the two ends of
   * a two-bar pattern so that the wrap *is* the pair. That leaves six beats of
   * stillness in the middle of every repeat, which on the busiest material in the
   * vocabulary is the most valuable silence the composition has: everything the
   * viewer can hear is still happening, and the picture has stopped agreeing with
   * all of it.
   *
   * The walk gain is raised with the density it lost. It steps twice per two bars
   * where it used to step twice per bar, and `STRIDE_TURN` is a turn *per step*,
   * so the square is traced over four bars rather than two — a slower, larger,
   * legibly repeating figure at a lower delivered velocity than before.
   */
  step: {
    beats: [1, 0, 0, 0, 0, 0, 0, 0.85],
    frame: 0.22,
    walk: 1.7,
    shape: 0,
    colour: 0.8,
    solo: false,
    motion: 0.9,
  },
  /**
   * One and two of every *other* bar, and the accent moves *shape* rather than
   * size.
   *
   * The sparse figure. Two arrivals and then six beats of nothing is the longest
   * silence any figure holds, which is what makes each pair an event — and it is
   * the only figure that puts beat-rate content into the geometry, which is
   * affordable precisely because it fires a quarter as often as the old vocabulary
   * did. The frame gain is over 1 for the same reason: a gesture that happens twice
   * every two bars can be larger than one that happens four times a bar without
   * costing any more motion overall.
   */
  mark: {
    beats: [1, 0.8, 0, 0, 0, 0, 0, 0],
    frame: 1.3,
    walk: 0.55,
    shape: 1,
    colour: 1,
    solo: false,
    motion: 0.8,
  },
  /**
   * One layer answers and the rest hold still.
   *
   * The stack is the one part of this composition that can express a rhythm
   * *spatially* — the same beat, arriving on part of the picture — and until now
   * `SPREAD_UNISON` deliberately pulled the whole stack into agreement whenever
   * the grid locked, for the good reason that a smeared stack has no instant in
   * it. Unison is the right default and a poor constant diet. Here the instant
   * survives, because the layer that answers answers on the beat; what changes is
   * that it is one layer rather than a sheet.
   */
  /*
   * Three and four, in the second bar of two — the one placement in the vocabulary
   * that touches neither the downbeat nor the bar before it. A pair arriving late
   * in a two-bar unit, answered by a single layer, is the least emphatic statement
   * the row can make and the only one that leaves the downbeat to the bar gesture
   * alone, which is what a soloing figure should look like.
   */
  pane: {
    beats: [0, 0, 0, 0, 0, 0, 1, 0.8],
    frame: 1.15,
    walk: 0.5,
    shape: 0,
    colour: 0.7,
    solo: true,
    motion: 0.75,
  },
  /**
   * No beat row at all. The bar breathes, the colour tides, the composition
   * drifts, and nothing punctuates.
   *
   * The most important member of the six and the one that is hardest to justify
   * from a table of measurements, because everything this document has ever
   * measured goes *down* while it runs. What it buys is the only currency rhythm
   * actually trades in, which is contrast: four bars of stillness is what makes
   * the figure after it land, and a composition that punctuates continuously has
   * nothing to punctuate against. `REST_AFTER` guarantees it recurs.
   *
   * `motion` is low, so the handover reverses and the piece's own drift comes back
   * up underneath — the frame is not becalmed, it is doing something else.
   */
  swell: {
    beats: [0, 0, 0, 0],
    frame: 0,
    walk: 0,
    shape: 0,
    colour: 0.35,
    solo: false,
    motion: 0.35,
  },
} as const satisfies Record<string, Figure>;

type FigureName = keyof typeof FIGURES;

/**
 * The figures a phrase with nothing particular to say rotates through — §21, and
 * the list is short on purpose.
 *
 * `drive` is deliberately absent. It is the only member that accents in every bar,
 * and while it sat in this rotation it was reached about a fifth of the time on
 * material that never asked for it, which — with `step` and `pane` also accenting
 * four beats at the time — put the composition on every beat of every bar for two
 * thirds of a run. Reserving it to the evidence is what makes an open passage mean
 * something when it arrives.
 *
 * What remains is three two-bar figures and a silent one: a pair on the downbeat, a
 * pair across the barline, a pair late in the second bar, and nothing at all. Every
 * one of them accents two of every eight beats, so the ordinary state of the piece
 * is a *placement* changing every phrase at a constant, low density — which is the
 * axis §22 wanted the vocabulary to vary along, and the one it had no way to vary
 * along while every member accented the one.
 */
const FIGURE_ROTATION: readonly FigureName[] = ["mark", "step", "pane", "swell"];

/**
 * Bars a figure runs for.
 *
 * Eight, which is a phrase in nearly all popular music and the same length
 * `BARS_PER_PHRASE` already uses for the slow amplitude swing. Long enough that a
 * viewer hears the figure as a section rather than as a change, short enough that
 * a track gets four or five of them a minute. At 120BPM it is sixteen seconds.
 *
 * A section cue or a drop can end one early — see `figureCue`. That is the whole
 * of what makes the row feel arranged rather than clocked: the figures change on
 * the phrase, *and* they change when the music does.
 */
const FIGURE_BARS = 8;
/** Fraction of a bar the composition takes to move between two figures. Long,
 *  because what crossfades here are routing gains rather than a shape, and a
 *  channel arriving in under a bar reads as a switch being thrown. */
const FIGURE_BLEND = 0.85;
/**
 * Figure changes without a rest before `swell` is forced.
 *
 * The one piece of rotation in an otherwise evidence-driven choice, and it earns
 * its arbitrariness. Every other figure is preferred by some property of the
 * music; nothing in a steady, loud, confident track ever *asks* for the
 * composition to stop punctuating, and a track like that is exactly the one where
 * unbroken punctuation becomes wallpaper fastest. So the rest is scheduled rather
 * than deserved — at two, a phrase of stillness arrives about every twenty-four
 * bars, which is three quarters of a minute at 120BPM.
 *
 * Lowered from three by §22, and the number was never the reason the rest was rare.
 * Measured on the bench, `swell` held **0% of frames** on three of the four
 * patterns: the schedule was gated on `fill`, the gate was reading a phrase-wide
 * maximum, and over eight bars of any real material something clears it. See
 * `trackPhrase`, which now hands `chooseFigure` the *last* bar's fill — the only
 * bar whose run-up the rest could possibly be interrupting. With that fixed the
 * schedule fires as written, and one figure in three being silence is the
 * proportion §22 asks for.
 */
const REST_AFTER = 2;
/**
 * Further figure changes a run-up may push the scheduled rest back before it is
 * taken anyway. Two, so the rest lands within about forty bars of when it was due
 * whatever the material is doing.
 *
 * A bound rather than a fix, and it should be read as one: on all four bench
 * patterns it never fires, and the figure occupancy is identical with it set to
 * infinity. What it rules out is the *shape* of the bug §22 found in the gate
 * beside it — a suppression with no ceiling, which on the wrong material cancels
 * the rest rather than moving it, and which is invisible in exactly the way the
 * `fill` maximum was until somebody counted frames. See `chooseFigure`.
 */
const REST_DEFER = 2;
/**
 * How far over its own recent reference a phrase has to sit before the composition
 * will open up and answer all four beats.
 *
 * This is now the *only* way `drive` is ever reached — see `FIGURE_ROTATION` — so
 * what makes the figure rare is that nothing else can select it, and the threshold
 * only has to separate a lift from a steady passage.
 *
 * ## It was raised to 1.3 and that made it unreachable
 *
 * The instinct on making `drive` evidence-only was to raise the bar with it. That is
 * wrong here, and the reason is worth keeping because the same trap is set for every
 * threshold measured against an adaptive reference. `barReference` is an EMA over the
 * latch at `BAR_MEMORY` — 0.3 a bar — so within the eight bars this ratio averages
 * over, the reference has already chased most of the way to the new level. The ratio
 * therefore saturates:
 *
 * | energy step | phrase ratio |
 * |---|---|
 * | ×1.5 | 1.10 |
 * | ×2 | 1.16 |
 * | ×3 | 1.22 |
 * | ×6 | 1.30 |
 *
 * A threshold of 1.3 does not mean "a big lift", it means "a sixfold one", which no
 * record contains. Measured on the bench it selected `drive` on 0–3% of frames and
 * every one of those was the seeded first phrase. At 1.12 the gate asks for about a
 * 1.7× lift, which is a chorus arriving, and a steady passage sits at 1.00 with the
 * whole of that margin to spare.
 */
const DRIVE_RATIO = 1.12;

/*
 * ## The figure that was removed, and why it is not coming back in this form
 *
 * There was a sixth member here, `back`, whose mask was `[0.2, 1, 0.2, 1]` — accent
 * two and four, the backbeat, gated on the reactor's `backbeatConfidence`.
 *
 * It was wrong, and not by a matter of degree. The reactor does not assume the
 * backbeat is on two and four: `creditBeat`'s sibling accumulates mid-band weight
 * per residue and *finds* which pair the snare is actually on, precisely because a
 * bar's alignment cannot be assumed — see `snareSlot`. That slot is used internally
 * to decide when to publish `frame.backbeat` and it is **not published itself**, so
 * a mask written here in bar coordinates has no way to agree with it. On the bench's
 * `halftime` pattern the snare is on beats one and three; the figure accented two
 * and four, exactly anti-phase, and held 49% of that run doing it.
 *
 * Fixing it properly means publishing the slot from the reactor and rotating the
 * pattern onto it, which is a change to `AudioFrame` and worth making when a
 * backbeat figure is wanted again — and §22 makes it a better idea than it was,
 * since a *rotation* of a two-beat figure onto the detected snare is exactly the
 * axis that section wants the vocabulary to vary along. Removed rather than
 * repaired at the time because a figure that accents two *and* four is four accents
 * a bar under another name, which is what both sections exist to stop.
 *
 * Nothing is lost from the backbeat as a *texture*. `hitMid` and `backbeat` still
 * reach the press, and both are driven by detected events rather than by a position
 * in the bar — so the plate still slips on the snare wherever the snare is, which is
 * the half of this that was never guessing.
 */
/** How much of the frame pulse the layers that are *not* the soloist keep.
 *
 *  Not zero. The stack turns over constantly and `pulse` is keyed on a layer's own
 *  id, so which layers match the chosen slot changes as they are born and retire —
 *  at four layers over six slots there are moments with no match at all, and a
 *  hard gate would make those moments a figure that silently does nothing. A floor
 *  keeps the stack answering as a stack while one member answers louder. */
const SOLO_OTHERS = 0.18;
/**
 * How far a beat may push a distortion the preset already runs — the `shape` route,
 * and the first beat-rate content this feature has ever put into the geometry.
 *
 * The rule it bends is §4.3's, that geometric velocity is what the eye reads as a
 * flinch, and it is bent under two conditions that were not available before: the
 * shape rests for half the beat after §19, and `mark` is the only figure that opens
 * this route at all — with a pattern of one and two of every other bar, so it fires
 * twice per eight beats rather than four times per four. Occasional and sharp is a
 * different object from continuous and sharp, and it is the one the rule was never
 * tested against.
 *
 * Small, and multiplicative on what the preset authored, so a piece running no
 * distortions gets nothing here at all.
 */
const SHAPE_BEAT = 0.22;

/**
 * Fraction of a bar the composition takes to move from one gesture to the next.
 *
 * A gesture change at the downbeat is a step, because two shapes do not agree on
 * their value at phase 0 — and a step through `SHAPE_SMOOTH` is a 50ms transient,
 * which is exactly the discontinuity §10 of the reach document found to be the
 * largest single source of jerk in the previous rewrite. So the two shapes are
 * *mixed* over the bar instead. Both are continuous functions of the same phase,
 * so the mix is continuous; what it adds to the slope is at most the difference
 * between the two divided by the blend length, which at 0.45 of a bar is about
 * 2/bar against a shape family that already runs at 4.4.
 */
const GESTURE_BLEND = 0.45;
/**
 * Onsets per bar in the top band over which a bar counts as busy, and low-band
 * share over which it counts as weighty. Both are read off the bar that just
 * ended — see `chooseGesture`.
 *
 * Nine rather than five, which was the first guess and was wrong for a reason
 * worth keeping: eight top-band onsets to the bar is a hi-hat on eighths, which
 * is not a busy bar, it is the single most ordinary drum pattern there is.
 * Measured against a generator playing exactly that, five put 83% of the run's
 * bars on the busy shape and never once selected the default. The threshold has
 * to sit above the ordinary case or the vocabulary has one member.
 */
const BUSY_HITS = 9;
const WEIGHTY_SHARE = 0.55;
/** How far under its own recent average a bar has to be to count as empty. */
const STILL_RATIO = 0.45;
/** How much fill the bar has to have carried for the next one to lean late. */
const LATE_FILL = 0.3;

/**
 * How much of the shapes' amplitude is present regardless of energy, 0..1.
 *
 * Not zero, and this is the answer to the complaint that started the rewrite. If
 * amplitude came only from energy then a quiet, steady, perfectly locked passage
 * would produce no motion at all — which is the failure the DC removal walked
 * into from the other direction. A grid the reactor is confident about is itself
 * a reason to move; energy decides how much more.
 */
const SHAPE_FLOOR = 0.45;
/**
 * Real seconds the amplitude takes to follow the energy, and the constant that
 * makes the whole scheme work.
 *
 * The amplitude is derived from the swell, and the swell has a 0.3s attack — so
 * without this it carries plenty of beat-rate content of its own, and a smooth
 * bar shape multiplied by a signal that steps on every kick is not a smooth
 * signal. Measured before it was added: 375%/s peak on the flight gain and
 * 23%/s on the frame scale, both from the amplitude edge rather than from the
 * shape, and both worse than the version this replaced.
 *
 * At two seconds the amplitude passes about 1% of the beat and all of a chorus
 * arriving, which is the split the hierarchy asks for: energy decides how far
 * the piece travels, the grid decides when.
 */
const AMPLITUDE_TAU = 2;
/**
 * How far the bar that just played may move the bar that follows it, ± — §3.2 of
 * `docs/visualizer-audio-attribution.md`, and the cheapest attributable thing in
 * the feature.
 *
 * The constant above is correct and is also why consecutive bars were identical:
 * at two seconds the amplitude passes about 1% of the beat, which is the split
 * the hierarchy asks for, and it passes almost as little of the *bar*. So the
 * energy a bar contained could not reach the bar after it, and the geometry ran
 * on a figure that had not changed materially in ten seconds.
 *
 * This is the term that restores it, and the reason it costs nothing is that it
 * is latched once per bar and glided over the next: a full swing divided by a bar
 * is well under the 9.5%/s the geometry already runs at. Measured against the
 * bar's own recent average rather than absolutely, so what it expresses is "this
 * bar was bigger than the last few" — which is a thing music does constantly and
 * which every filter in the chain above was removing.
 */
const BAR_SWING = 0.4;
/** How fast the reference the latch is measured against follows, per bar. Four
 *  bars of memory: long enough that a chorus reads as louder than the verse, short
 *  enough that the whole thing does not become a second dynamics channel. */
const BAR_MEMORY = 0.3;
/** Fraction of a bar the latched value takes to arrive. Under half, so it is
 *  established well before the bar's own peak and the two do not fight. */
const BAR_GLIDE = 0.4;
/** How far apart in the bar successive layers read the breath. See `spread`. */
const SPREAD_BARS = 0.085;
/**
 * How much of that spread is *removed* once the grid is locked — §17, and the
 * single largest cause of the composition reading as a wobble rather than as a
 * beat.
 *
 * The spread exists for a good reason: four full-bleed layers all scaling on the
 * same frame move as one sheet, and a sheet is not a composition. But at four
 * layers and 0.085 of a bar it puts 170ms at 120BPM between the first layer's
 * breath and the last's, over a shape that at the time filled 98% of the bar —
 * §19 has since narrowed it to two thirds, which sharpens the argument rather
 * than weakening it. Four
 * overlapping images each swelling 5.5% on a slightly different clock is a
 * literal description of jelly, and — this is the part that matters — it means
 * **there is no instant in the geometry at all**. Whatever the music does, some
 * layer is always part-way through doing it, so nothing on screen ever coincides
 * with anything.
 *
 * Rhythm is coincidence. What makes a stack read as being on the beat is that
 * its members arrive *together*, and the spread is the mechanism that guarantees
 * they cannot. So it stands down as the lock takes: off the grid it stays at
 * full strength, where it is carrying a delayed energy envelope that has no
 * phase in it and smearing genuinely helps; on the grid the stack converges
 * toward unison.
 *
 * Not all the way to it — a fifth of the spread survives, so the stack is a
 * stack rather than a sheet, and 34ms is inside the window in which the eye
 * reads two events as simultaneous anyway.
 */
const SPREAD_UNISON = 0.8;
/** Layers before the spread wraps. Six was the old tap count and reads well —
 *  far enough that the stack is legibly a wave, near enough that the two ends
 *  of it are still the same gesture. */
const SPREAD_SLOTS = 6;
/**
 * How much of the energy path the *positional* channels keep when there is no
 * lock — §19, and the last place in the file that judgement had not been made.
 *
 * `spread` crossfades the generated bar shape against a delayed swell, and
 * everything that moves the picture reads it: the frame's own scale, the spatial
 * flight and turn, and the geometry gains. Unlocked, therefore, the composition's
 * largest excursions are driven by a one-pole envelope of the bass — measured
 * `flight` at 0.72 of depth with a `sync` of 0.00 and a dominant period of 1.7
 * beats, which is not the music, it is `SWELL_RELEASE`. A camera whose speed
 * swings by 72% on a filter's time constant is the purest form of the complaint
 * this round is named for.
 *
 * The press family and the fold already refuse this fallback outright, on the
 * argument that "where there is no beat, the honest answer is to leave the mirror
 * where the composition put it". That argument applies here in full and the
 * conclusion is nearly the same — but not quite, because these four are the only
 * channels ambient and beatless material has at all, and taking them to zero would
 * make a whole class of music produce a composition that does not respond. So the
 * fallback is *quietened* rather than removed: a third of it survives, which is
 * enough that a drone still breathes and far too little to lurch.
 *
 * Note it does not touch the locked case. `onGrid` is untouched and this term is
 * already multiplied by `1 - grid`, so on material the tracker follows this
 * constant is arithmetically absent.
 */
const SPREAD_FALLBACK = 0.35;

// --- the energy channels ----------------------------------------------------
// Still the whole response on material with no beat in it, and the source of
// the amplitude on material that has one.

/** Real seconds. The swell is no longer asked to *be* the motion, only to say
 *  how far it should travel, so these can stay slow without costing anything. */
const SWELL_ATTACK = 0.3;
const SWELL_RELEASE = 0.95;
/**
 * The baseline the swell's excursion is measured against, real seconds — and it
 * is now removed in full.
 *
 * Only 55% of it used to be, and that compromise was the visible symptom of two
 * mechanisms doing one job badly. A subtraction of a running mean is a
 * high-pass, which is the right operation for an *event* channel, where "louder
 * than a moment ago" is the whole content, and the wrong one for a *level*,
 * because a steady groove has a steady mean and subtracting all of it leaves
 * nothing exactly where the music is most regular. Asked to be both, the swell
 * was mediocre at each and the mix was where the two failures balanced.
 *
 * It is now purely the event channel — removed in full, so a rest reads as zero
 * — and the level it used to half-carry comes from `AudioFrame.loudness`, which
 * is a ratio and therefore does not go dead on steady material. See `dynamics`.
 */
const SWELL_BASELINE = 6;
/**
 * The transfer curve the excursion goes through, in place of a gain and a
 * clamp — §4.4 of the reach document.
 *
 * The pair it replaces was a square wave. At a gain of 3.6 everything above the
 * baseline saturated: measured at 0.01–0.10 between beats and 0.94 on the kick,
 * whatever size that kick was. That is the same failure the plan's §13 found and
 * fixed in `onsetStrength`, one level downstream, and it survived here untouched
 * — a light hit and a heavy one arrived identical, so the channel had two states
 * and a channel with two states is not a channel.
 *
 * `SWELL_GATE` is a soft downward expansion at the bottom, so what is left of a
 * rest is pushed toward zero rather than amplified along with everything else,
 * and the curve leaves zero with zero slope rather than with the full gain.
 * Above `SWELL_KNEE` it asymptotes rather than clamping, so a heavier hit is
 * always a bigger number than a lighter one however hard either is hit.
 */
const SWELL_GATE = 0.012;
const SWELL_GAIN = 11;
const SWELL_KNEE = 0.55;

/** Air and melody, each on a time constant of its own and neither on the
 *  beat's. Nothing here should peak when anything else does. */
const SHIMMER_TAU = 0.5;
const TIDE_TAU = 1.7;

// --- the depth multiplier ---------------------------------------------------

/**
 * How the music's own dynamics reach the composition — §3.2 of the reach
 * document, and the answer to a verse and a chorus looking identical.
 *
 * Every other channel here takes its *shape* from bands the reactor normalised
 * against their own recent range, which is what lets this feature work on any
 * source at any distance from any speaker and is also what deletes the loudest
 * thing music does. `AudioFrame.loudness` is the one figure that escapes that
 * normalisation, and this is where it is spent: not on shape, only on how far
 * the shapes are allowed to travel.
 *
 * Slow, for the reason `AMPLITUDE_TAU` is slow. A depth multiplier with
 * beat-rate content in it multiplies two signals that both step on the kick, and
 * the product of those is the flinch the whole hierarchy exists to avoid — the
 * split only holds if the two are separated in frequency.
 */
const DYNAMICS_TAU = 3;
/**
 * How much of the ratio is passed through, as an exponent rather than a slope.
 *
 * A power law because the quantity is a ratio and its neutral is 1: an exponent
 * treats a halving and a doubling as the same size of event in opposite
 * directions, where a linear slope makes the quiet side of the music a much
 * smaller gesture than the loud side by construction.
 *
 * Well under 1, because the change is meant to read as the piece opening up
 * rather than as a different preset arriving. A 5dB lift into a chorus — about
 * as much as popular music usually offers — is a ratio of 1.8 and arrives here
 * as 1.3.
 */
const DYNAMICS_EXPONENT = 0.45;
const DYNAMICS_MIN = 0.45;
const DYNAMICS_MAX = 1.35;

// --- the tonal channel ------------------------------------------------------

/**
 * What drives the composition when there are no transients to drive it — the
 * capability §3.5 of the reach document says `clarity` is for.
 *
 * The swell is an event channel: its baseline is removed in full, so on a drone,
 * a pad, a bowed string or an organ chord it reads exactly zero, and every
 * energy binding downstream reads zero with it. That is correct for a channel
 * whose content is "louder than a moment ago" and it is why the feature has
 * always given up on this material. But such music is not static — it has slow
 * swells, and those are perfectly legible; they are simply an order of magnitude
 * slower than a kick.
 *
 * So there is a second envelope on a much longer baseline, which on percussive
 * material is nearly zero (transients come and go far faster than eighteen
 * seconds) and on tonal material is the whole shape of the piece. The two
 * crossfade on `clarity`, so nothing is ever driven by both.
 *
 * Only ever a *level*, and slow enough that it cannot flinch: the fastest thing
 * this can do is a full swing over several seconds, which is the bar row's
 * timescale rather than the beat row's, so it feeds the same places the breath
 * does and none of the places the pulse does.
 */
const TONAL_BASELINE = 18;
const TONAL_TAU = 2.5;
const TONAL_GAIN = 5;
/** Below this much clarity the material is treated as tonal. Deliberately low:
 *  the cost of running the tonal channel on percussive material is that it
 *  contributes almost nothing, and the cost of the reverse is that ambient gets
 *  nothing at all — so the crossfade is biased toward the transient path. */
const TONAL_CLARITY = 0.4;

/**
 * Real seconds of swell history kept for the per-layer spread on the *energy*
 * path, and how far apart successive layers read it.
 *
 * A ring buffer rather than the cascade of one-poles this replaces. The cascade
 * was introduced to stop the flat layers moving as one sheet and it did that,
 * but a chain of low-pass filters is not a delay line: by the fifth tap it was
 * passing 3% of the beat. A delay has the same amplitude at every tap, which is
 * the only property the spread ever wanted.
 */
const HISTORY = 64;
const SPREAD_SECONDS = 0.075;

// --- the three hits ---------------------------------------------------------

/**
 * Kick, snare and hat as three channels rather than one — §3.3 of
 * `docs/visualizer-audio-attribution.md`.
 *
 * The reactor has always run three independent detectors and then handed out
 * their maximum, so everything a listener would name as *what the drums are
 * doing* was measured and averaged away one function call before use. These are
 * the three arriving separately, and each goes somewhere the others do not: the
 * kick to the weight, the snare to the lateral, the hat to the texture.
 *
 * All three are on the **fast row** and none of them touches geometry, which is
 * what keeps three beat-rate event channels inside the architecture rather than
 * three times the chance of the flinch it exists to prevent. They are scaled by
 * `sharp` at the point they fire, so the `attack` axis reroutes them exactly as
 * it does everything else on that row — turning it down does not leave three
 * unreachable channels running underneath.
 *
 * Releases descend with frequency, because that is what the sounds do: a kick
 * rings, a snare cracks, a hat is gone. Attacks are all the accent's, which is
 * short and deliberately not instant.
 */
const HIT_ATTACK = 0.05;
const HIT_RELEASE_LOW = 0.34;
const HIT_RELEASE_MID = 0.26;
const HIT_RELEASE_HIGH = 0.18;
/** The backbeat's own envelope. Longer than the snare hit it is made of: what
 *  this expresses is the *pattern* rather than the transient, and a channel that
 *  is gone before the eye reaches it may as well not have fired. */
const BACKBEAT_RELEASE = 0.4;

// --- the wind-up and the arrival --------------------------------------------

/**
 * The fill, as a channel — the only anticipatory thing in the feature.
 *
 * Every other channel here reports what the music just did, which puts the
 * composition permanently a beat behind the one moment it could be ahead of. A
 * fill is the run-up to a downbeat, the reactor resolves it half a bar early, and
 * what this does with it is *wind up*: the amplitude rises across the fill so the
 * frame is already travelling when the bar lands.
 *
 * Short, because an anticipation that arrives late is worse than none, and small,
 * because it is a lean on top of the amplitude rather than a second amplitude.
 */
const WIND_TAU = 0.22;
const WIND_AMPLITUDE = 0.35;
/** How far the trail's stride opens across a fill. On the fast row's argument:
 *  a compounding term with no on-screen velocity of its own. */
const WIND_SCALE = 0.01;
/** How much of the wind-up reaches the slew-limited drive, so the trail
 *  lengthening across a fill is governed like everything else that can brighten
 *  the frame. */
const WIND_LUMA = 0.55;

/**
 * Minimum real seconds between arrivals — the drop's rate limit, and it is a
 * property of the mechanism rather than a taste setting.
 *
 * What an arrival spends is the largest gesture the engine has, and the floor
 * under how often that can happen must not be a function of how excitable the
 * material is. Shorter than `SECTION_GAP` because a drop is a rarer and much
 * better-evidenced event than a 3dB move in a running average, and because a
 * track that genuinely drops twice inside twenty seconds should be answered
 * twice.
 */
const ARRIVAL_GAP = 15;
/** How much of the accent budget a drop may take. Full: this is the one moment
 *  in a track where every channel arriving at once is the correct answer. */
const ARRIVAL_ACCENT = 1;

// --- the handover -----------------------------------------------------------

/**
 * How far the composition's *own* motion stands down while the music is carrying
 * it — §3.1 of `docs/visualizer-audio-attribution.md`, and the only term here
 * that moves the denominator.
 *
 * Attribution is a ratio. The wander, the cycler, the layer churn and the spatial
 * flight all keep their authored amplitude while the music plays, so whatever the
 * audio contributes is a minority share of the motion on screen, and the eye
 * attributes causation to whatever dominates. This is the composition yielding
 * the margin: as the musical drive rises, the autonomous rates come down, total
 * motion stays about where it was, and its *source* becomes musical.
 *
 * It is also the one proposal in that document that costs *negative* velocity —
 * it can only ever remove motion — which is why it is first and why it is allowed
 * to be this large.
 *
 * The margin, not the composition: at full drive 60% of the authored wander is
 * still running. A piece that stopped being itself the moment a beat was detected
 * would be a worse failure than the one this fixes.
 */
const HANDOVER = 0.4;
/** Real seconds the handover follows the drive. Slow: what it retunes are the
 *  rates of channels that are integrated, so a value that moved quickly would
 *  bend the drift audibly — and there is nothing in the music this needs to keep
 *  up with. */
const HANDOVER_TAU = 1.2;

// --- the accent -------------------------------------------------------------

/** Minimum real seconds between accents. Unchanged: what made accents invisible
 *  was never their rarity, it was that they were spent on a 1% frame scale. */
const ACCENT_MIN_GAP = 6;
/** How far over the recent average an onset must be to earn one. */
const ACCENT_RATIO = 1.75;
/** Short but deliberately not instant — at zero it moved the whole frame by
 *  more than a percent between two frames, which is a snap rather than a hit. */
const ACCENT_ATTACK = 0.07;
const ACCENT_RELEASE = 0.6;
/** How fast the running average of onset strength follows, per onset. */
const ACCENT_MEMORY = 0.12;

// --- depths, fast row -------------------------------------------------------
// Colour, tone, and the trail terms that compound. Everything here may run at
// beat rate because none of it can move the picture: a hue step has no velocity,
// and a trail zoom is applied a thousandth at a time to a buffer that
// accumulates it over hundreds of frames.

/**
 * Trail zoom added at full beat pulse.
 *
 * Still the smallest number here and still the one doing the most work, because
 * it compounds through the feedback buffer every frame rather than being applied
 * once. Against a default `feedbackScale` deviation of 0.006 this more than
 * doubles the trail's stride on the beat — which is a large visible change with
 * no on-screen velocity anywhere, and is exactly what the fast row is for.
 */
const PUMP_SCALE = 0.012;
/** Trail rotation, off the accent — a turn is a gesture, and a permanent one is
 *  just a spin. */
const PUMP_ROTATE = 0.004;
/** Colour opening on the beat, over the slower opening on the melody. */
const CHROMA_BEAT = 0.45;
const CHROMA_TIDE = 0.5;
/** Turns of hue on the beat pulse. Tiny, and free: hue is the one channel where
 *  a fast change cannot read as motion. */
const HUE_BEAT = 0.004;
/** Turns of hue per bar. Over a few minutes this is the colour of the piece
 *  walking with the music, not a light show. */
export const HUE_PER_BAR = 0.005;
/**
 * How far that walk may get from the page's own hue, in turns.
 *
 * The walk used to be unbounded — one direction, wrapped at a turn — which over
 * a track is not a walk but a circuit: at the old rate a bar every two seconds
 * carried the colour a full rotation every two minutes, and measured over two
 * hours it put the median frame 90° away from the printed colour with the piece
 * never once passing back through it. That is a light show with a long period,
 * and it is the largest single reason the visualiser did not look like the art.
 *
 * So it turns round at the ends instead. What the music gets is the same slow
 * walk, over a range a tenth of a turn either side, that keeps coming back
 * through the page's own colour — about a minute out and back at an ordinary
 * tempo, which is a phrase or two and reads as the piece thinking about a
 * colour rather than leaving for one. `colorFidelity` scales what survives of
 * it downstream; this is the shape of the thing, not its depth.
 */
export const HUE_RANGE = 0.1;

/**
 * What each of the three hits is worth, and where it goes.
 *
 * The kick joins the trail pump, which is the fast row's own argument in
 * miniature: a term applied a hundredth at a time to a buffer that accumulates it
 * over hundreds of frames is a large visible change with no on-screen velocity
 * anywhere. The hat opens the colour. The snare goes to the *press*, and
 * separately the backbeat does — a plate slipping sideways on two and four is
 * both the most on-theme answer this engine has and incapable of flashing.
 *
 * Note what is absent: none of them reaches geometry, opacity or anything the
 * governor limits. Three event channels at beat rate is exactly the arrangement
 * the hierarchy was built to make safe, and it is only safe while they stay on
 * the row that cannot move the picture.
 */
const KICK_SCALE = 0.008;
const SNARE_SLIP = 0.55;
const BACKBEAT_SLIP = 0.75;
const HAT_CHROMA = 0.25;

// --- depths, bar row --------------------------------------------------------
// The geometry, at a quarter of the rate the old bindings ran at and several
// times their depth. The trade is deliberate and it is the whole thesis: peak
// velocity, not amplitude, is what has to be budgeted.

/**
 * Scale of the whole flat composition at full breath.
 *
 * Only ever upward, so a full-bleed layer never pulls its own edge into frame.
 *
 * Cut from 0.055 by §19, and the cut is the point rather than a side effect. At
 * 5.5% this was the single largest excursion the flat path had, and it was spent
 * on a bar-length raised cosine — measured `bsync` 0.03, which is to say the frame
 * was scaling by 5% with no discernible relationship to *when* anything happened.
 * That is the largest single contribution to the jelly, and shrinking it is most of
 * the fix on its own: the budget it frees goes to `PULSE_BEAT` and
 * `PULSE_BACKBEAT`, which spend it at instants the music marks.
 *
 * The three together now peak at 3.4 + 2.0 + 0.8 = 6.2% against the old 5.5 + 1.2 =
 * 6.7, so the whole frame travels slightly *less* far than before. What changed is
 * that two thirds of it now happens at a beat instead of all of it happening
 * everywhere.
 */
const PULSE_BAR = 0.034;
/**
 * Scale of the whole composition on the *beat* — §17, and the rule this feature
 * has held for three rounds, now relaxed on purpose.
 *
 * The hierarchy at the top of this file says beat rate gets colour, tone and the
 * trail, and that geometry belongs to the bar, "because geometric velocity is
 * what the eye reads as a flinch". Three rounds of building against that rule
 * have produced a composition that provably follows the music and does not read
 * as being *on* it — and the reason is now visible in the rule's own wording.
 * The premise is that beat-rate motion flinches. What actually flinched, in v1,
 * was a **filtered energy signal**: a transient smoothed until it was safe still
 * has a corner where the transient arrived, and a corner at beat rate is a
 * flinch at any amplitude.
 *
 * `beatPulse` is not that. It is a raised cosine over predicted phase —
 * continuous in value and in derivative by construction, flat at both ends of
 * its window, and with a genuine rest between pulses. There is no corner in it to
 * flinch on. The rule was written against the wrong object and it has been costing
 * the feature the one channel that could ever have read as rhythm: the whole frame,
 * moving, at the moment of the beat.
 *
 * What makes it affordable is that the shape *rests* — and §19 is the round that
 * made that true rather than nearly true. At `BEAT_RISE` 0.5 and `BEAT_FALL` 0.28
 * the duty was 78%, which is a rest in the same sense that a sine has a flat spot,
 * and the channel measured `sync` 0.07. At 0.30 and 0.20 it is 50%, and the same
 * excursion now happens inside half a beat with the other half held still.
 *
 * Raised from 0.012 with the budget `PULSE_BAR` gave up. 1.2% of frame was chosen
 * when this was the exception to a rule and the whole question was whether it could
 * be afforded at all; at 2% it is legible as an arrival without being legible as a
 * jump, and the peak excursion of the three scale terms together still falls.
 *
 * The velocity is `π × PULSE_BEAT / (2 × BEAT_FALL × beat)`, and the **fall** is
 * what sets it rather than the rise — the shape is deliberately asymmetric, so
 * the steep side is the short one on the way out of the pulse, not the long
 * anticipating one on the way in. Getting that backwards understates the figure
 * by 1.8× and is worth recording because it is the same slip that put 43.8%/s on
 * the `late` gesture: in this family, the number to check is always the fall.
 *
 * Measured at 1/60s: 24%/s at 90BPM, 31%/s at 120, 45%/s at 174. That is well over
 * the 9.5%/s the bar row runs at, knowingly, and the trade is the whole thesis of
 * §§17 and 19 — the bar row spends its budget evenly across the whole bar, which
 * integrates into a wobble, and this spends a comparable one inside half a beat and
 * then holds still. The *excursion* is 2% of frame. What is being bought with the
 * rate is the only thing the eye can read as time.
 *
 * Scaled by `sharp`, so this is exactly what the `attack` slider has always
 * claimed to do and until now could not: "down for a breath over each bar, up
 * for the beat" — and it is the knob to reach for if this is too much. At the
 * `breathe` character's 0.1 it is 0.2% of frame and effectively gone, which is
 * what that character is for.
 */
const PULSE_BEAT = 0.02;
/**
 * And again on two and four — the backbeat, at a third of the beat's own depth.
 *
 * The cheapest legibility in the whole feature, and until §19 the backbeat reached
 * exactly one parameter: a printing plate sliding sideways. That is a good use of
 * it and it is not a *visible* one, which leaves the most recognisable rhythmic
 * pattern in popular music contributing nothing a viewer can see.
 *
 * What this adds is not a second pulse. `hitMid` and `backbeat` are impulse
 * envelopes with a 50ms attack and a 0.4s release, so what lands on two and four is
 * the beat's own arrival *carrying further* — the same gesture, weighted. That is
 * what a backbeat is, and it is why this is added to the pulse rather than given a
 * shape of its own.
 *
 * Small, because it compounds with `PULSE_BEAT` on the beats it fires on: 2.8% of
 * frame on two and four against 2% on one and three. Gated on the reactor's
 * `backbeatConfidence` upstream in `update`, so material in 3, or with no snare in
 * it, never sees this at all rather than getting a wrong guess about where its
 * backbeat is.
 */
const PULSE_BACKBEAT = 0.008;
/** And the accent on top, undelayed and on every layer at once. Being rare, it
 *  is allowed to be the one thing that moves together. */
const PULSE_ACCENT = 0.011;
/** Gain on the spatial rates. These move the composition rather than process it,
 *  and being integrated they bend rather than jump — which is what lets them
 *  carry twice what they did. */
const FLIGHT_DEPTH = 0.9;
const SPIN_DEPTH = 0.55;
/** How far a distortion the preset already asked for is deepened. */
const GEOMETRY_DEPTH = 0.5;
/** Multiplier added to the trail's depth at full breath. Luminance-affecting,
 *  so it runs off the slew-limited drive rather than the raw channel. */
const TRAIL_DEPTH = 0.4;
const BLOOM_DEPTH = 0.4;
/** Additive, and small: the vignette is the frame's own edge and a viewer reads
 *  a change in it as the picture breathing rather than as an effect. */
const VIGNETTE_DEPTH = 0.1;

// --- the stride -------------------------------------------------------------

/**
 * The frame's beat-locked walk — §16 of
 * `docs/visualizer-audio-attribution.md`, and the answer to a complaint neither
 * of the previous two rounds could have addressed.
 *
 * Every channel above is an *amplitude*: the music decides how far something
 * travels and the grid decides the shape it travels on. That arrangement is
 * correct and measurable and it still cannot produce the one thing a viewer
 * uses to decide whether a picture is following music, which is a **change
 * arriving at the same instant as a beat**. A raised cosine at bar rate has no
 * instant in it — it is at its maximum for a tenth of a bar and its own peak is
 * not an event. What the eye can find is a thing that was going one way and is
 * now going another, at the moment the beat lands.
 *
 * So this is not a level at all. Each beat, the whole flat composition commits
 * to a new position on a small circle and glides there, arriving before the next
 * beat is due. Nothing about it follows loudness — the size is a slow scalar and
 * the *timing* carries the whole content — which is precisely the property the
 * complaint asked for: it moves *on* the beat rather than popping *with* a
 * harder note.
 *
 * It also costs almost nothing in the currency this feature is budgeted in. A
 * translation has no velocity contribution beyond its own, the step is bounded
 * by `2 × STRIDE_REACH × sin(π × STRIDE_TURN)`, and it arrives over most of a
 * beat: at 128BPM the peak is about 6%/s, against the 9.5%/s the geometry row
 * already runs at, and unlike the frame scale it cannot compound.
 */
const STRIDE_REACH = 0.016;
/**
 * Turns of the circle taken per beat — and §19 reverses the reasoning that set it.
 *
 * This read 0.17, chosen so that the figure "has no period a viewer can find": a
 * quarter turn closes into a box every bar, a third into a triangle, and both were
 * rejected as reading like a mechanism. The argument is sound about *mechanisms*
 * and backwards about music.
 *
 * A viewer decides a picture is following music by *predicting* it and being right.
 * That is the whole perceptual content of rhythm — an expectation set up and met —
 * and a walk with no findable period can never set one up. It delivers a change on
 * every beat, which the measurement duly records as `sync` 0.24, and every one of
 * those changes goes somewhere unrelated to the last, so the accumulated reading is
 * agitation rather than time. Music is made of repeats at exactly these lengths;
 * the composition refusing to have any was the wrong kind of restraint.
 *
 * A quarter turn per beat closes the figure in four — one bar, the same unit the
 * gestures are chosen on and the layers are born on — so the frame traces the same
 * small square every bar and the eye learns it within two. `STRIDE_PRECESS` then
 * turns the whole square slightly at each downbeat, so it repeats at bar length
 * without repeating *exactly*, which is the difference between a groove and a
 * loop.
 *
 * The step between two positions is the chord, `2 × sin(π × 0.25)` of the radius,
 * which is 1.41 against the 0.99 of a 0.17 turn. Paid for by `STRIDE_GLIDE`: the
 * step is longer and the time it has to arrive is shorter, so peak speed rises from
 * about 6%/s to 12%/s at 128BPM — on a whole-frame translation of under 2%, which
 * cannot compound, cannot flash and is bounded by its own overscan.
 */
const STRIDE_TURN = 0.25;
/**
 * Turns the square is rotated by at each downbeat.
 *
 * An eighth, so the figure comes back to itself every eight bars — a phrase. What
 * this buys is that the bar-length repeat above is a repeat of the *shape* and not
 * of the position, so eight bars of it are eight recognisably related bars rather
 * than one bar shown eight times. Small enough that any two consecutive bars are
 * near neighbours, which is what keeps it legible as the same figure at all.
 */
const STRIDE_PRECESS = 0.125;
/** Mask weight above which a figure walks on a beat. Half, so the question is
 *  whether the figure accents the beat at all rather than how hard — a step is a
 *  discrete commitment and there is no such thing as taking 30% of one. */
const STRIDE_STEP_GATE = 0.5;
/**
 * Fraction of a beat the step takes to arrive.
 *
 * Under 1, so the frame is *settled* when the next beat lands rather than still
 * travelling — a walk that never stops moving is a drift, and a drift is what
 * the composition already had. The rest between steps is what makes each
 * arrival readable as an arrival, and it is the same argument `BEAT_RISE` plus
 * `BEAT_FALL` under 1 makes about the pulse.
 *
 * It is also the *lead*: the step is launched this far before the beat so that
 * it lands on it. See `trackStride`, which had this the wrong way round.
 *
 * Cut from 0.55 by §19 on the same reasoning as every other window in that round:
 * at 0.55 the frame is in motion for more than half of every beat, which is the
 * duty cycle of a wobble. At 0.38 it moves for a third of the beat and is still for
 * two thirds, and the stillness is what the arrival is read against.
 */
const STRIDE_GLIDE = 0.38;
/**
 * How much of the stride survives at `attack` 0.
 *
 * Scaled rather than rerouted, which is the exception to §6's rule and worth
 * naming. Everything else on the beat row has a bar-rate shape it can be
 * expressed as instead; a step has no slow form — a walk taken once a bar is a
 * different gesture, not a gentler one. So `attack` sets how far it walks, and
 * the floor is high enough that a viewer who has asked for no beat-rate detail
 * still gets a composition that is visibly on the grid.
 */
const STRIDE_FLOOR = 0.45;

/**
 * Bars before a beat at which the composition commits to answering it — §22, and
 * the one instant at which a figure's pattern is allowed to change.
 *
 * Everything on the beat row *leads*: the pulse begins `BEAT_RISE + (1 -
 * BEAT_PEAK)` of a beat early so that it peaks as the beat lands, and the walk is
 * launched `STRIDE_GLIDE` early so that it has arrived by then. The widest of those
 * is the moment the first channel commits, and quantising there is what makes "which
 * beat is this pulse for" a question with one answer for every channel — index at a
 * narrower lead and the walk resolves the beat it is stepping to a frame before the
 * pulse does, so at every figure change the two would play a different bar of the
 * pattern from each other.
 *
 * It also has to fall inside the rest between pulses, which bounds it above. Pulse
 * `k` occupies `[k - 0.34, k + 0.16]` of a beat, so the rest is `(k - 0.84, k -
 * 0.34)` and any lead in that range switches the pattern while the shape it
 * multiplies is exactly zero. 0.38 sits just inside it — see `trackMask`, which is
 * the property's whole point.
 */
const BEAT_COMMIT = Math.max(BEAT_RISE + (1 - BEAT_PEAK), STRIDE_GLIDE) / BEATS_PER_BAR;

// --- depths, phrase row -----------------------------------------------------

/** How far the phrase channel moves the amplitude of everything above it, ±.
 *  The piece is never quite as responsive as it was a minute ago, and there is
 *  no period a viewer can find in it. */
const PHRASE_SWING = 0.28;

// --- the attack axis --------------------------------------------------------

/**
 * What `attack` does to the fast row, and why turning it down is not turning the
 * feature down — §6 of the reach document.
 *
 * `reactivity` conflates depth with sharpness, because in the architecture this
 * replaced they were the same knob: every channel was a one-pole filter, so the
 * only way to soften the response was to slow it, and slowing it emptied it.
 * The two rows here are already separated in frequency, so the split is finally
 * expressible — and it is a *reroute* rather than a gain, which is the whole
 * point. At `attack` 0 the fast row still moves as far as it did; it moves on
 * the bar's shape instead of the beat's, so the colour and the press breathe
 * once a bar rather than pumping four times in it.
 *
 * Under 1 because the breath is the wider shape of the two — after §19 it travels
 * over two thirds of the bar where the pulse travels over half a beat, and it
 * carries a floor besides — so at equal peak it reads as more present, not less.
 * This is the value that makes the two ends of the axis sound like the same depth.
 */
const FAST_BREATH = 0.8;
/**
 * How much of the *energy* fast row survives at `attack` 0.
 *
 * Not zero, for the reason §10 found the first time the fast row was gated on
 * anything: unlocked material has no generated shape to fall back to, so a fast
 * row that closed completely would take the trail pump away from everything the
 * tracker cannot lock to — which is most of what this feature has to survive.
 * The swell is not a twitch to begin with, at a 0.95s release, so what is left
 * here is a level rather than an edge.
 */
const FAST_ENERGY_FLOOR = 0.3;
/** Below this much attack the accent does not fire at all — including its
 *  request to the governor, which is a budget worth not spending on a channel
 *  whose output is about to be multiplied by zero. */
const ACCENT_OPEN = 0.02;

// --- the section row --------------------------------------------------------

/**
 * The third timescale, and the row §2 listed and nothing has ever driven.
 *
 * Beat and bar are both *continuous* channels: they move parameters. A section
 * is not a level at all — it is an event, and a rare one, whose whole content is
 * "the music has just changed". So it is published as a cue rather than as a
 * channel, and what consumes it does something discrete: the effect cycler
 * brings its next pulse forward, and the composition turns its pages over.
 *
 * Measured on `dynamics` rather than on any band, because `dynamics` is derived
 * from the one figure in the chain that is not range-normalised — a verse and a
 * chorus are the same 0..1 in every band and differ only there. It is also
 * already smoothed over three seconds, so what this compares is two averages of
 * a quantity that cannot flicker.
 */
const SECTION_BASELINE = 22;
/**
 * How far the run's dynamics must have departed from that baseline to count as
 * a section, in the multiplier's own units.
 *
 * 0.13 against a range of 0.45–1.35 is about a 3dB move in the music, which is
 * the smallest change a listener would describe as the track doing something.
 * Both directions: a breakdown arriving is exactly as legible as a chorus, and
 * a cue that only fired upward would answer half of every song.
 */
const SECTION_THRESHOLD = 0.13;
/**
 * Minimum real seconds between cues.
 *
 * Long, and it is the safety of this row rather than a taste setting. What a cue
 * triggers is the largest gesture in the engine — every layer on screen crossing
 * over at once — and the floor under how fast that can happen has to be a
 * property of the mechanism, not of how excitable the material is. A track that
 * changes every eight bars gets a page turn every second one.
 */
const SECTION_GAP = 20;

// --- the print lift ---------------------------------------------------------

/**
 * The one place the music is allowed to introduce an effect the preset did not
 * ask for, and the argument for the exception.
 *
 * The rule everywhere else is that zero means off and audio may only deepen what
 * the composition already runs — which is right, and protects every preset from
 * having a fold switched on by a kick drum. But the fast row of the hierarchy
 * above needs somewhere to go, and on a default preset the only always-live
 * parameters in the whole of `PostParams` are the trail terms, `chroma` and
 * `vignette`. Everything else the fast row wants — `misreg`, `bleed`,
 * `krackle` — is 0 in `DEFAULT_POST`, so a strictly multiplicative binding is
 * multiplying by zero exactly as §12 of the plan found the first time.
 *
 * The press artefacts are a different class from the folds, and that is what
 * makes the exception defensible rather than a hole in the rule. They cannot
 * flash, they cannot restructure the frame, they do not move the picture, and a
 * comic visualiser answering music with a press drifting out of register is the
 * most on-theme response available to it. What the rule was protecting — the
 * composition's own geometry — is untouched.
 *
 * It is still a knob, and still one the config carries, so a preset that wants
 * none of it can say so.
 */
const MISREG_LIFT = 1;
const BLEED_LIFT = 0.5;
const KRACKLE_LIFT = 0.45;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Frame-rate independent one-pole coefficient for a time constant. */
function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}

/**
 * The swell's excursion above its baseline, expanded into 0..1 — a soft knee in
 * place of a gain and a clamp. See `SWELL_GATE`.
 *
 * Three regions, and each is answering a specific failure of the pair it
 * replaces. Below the gate a smoothstep pulls the residue of a rest toward zero,
 * so the channel's floor is silence rather than whatever the baseline filter
 * happened to leave; between the gate and the knee the response is linear, which
 * is where nearly every hit lands and where the dynamics have to survive; above
 * the knee it bends toward 1 without ever reaching it, so the loudest hit in a
 * passage is still measurably louder than the second loudest.
 */
function expand(excursion: number): number {
  if (excursion <= 0) return 0;
  const t = Math.min(1, excursion / SWELL_GATE);
  const gated = excursion * t * t * (3 - 2 * t) * SWELL_GAIN;
  if (gated <= SWELL_KNEE) return gated;
  return SWELL_KNEE + (1 - SWELL_KNEE) * Math.tanh((gated - SWELL_KNEE) / (1 - SWELL_KNEE));
}

/**
 * Every channel, for the trace in `audioTrace.ts`.
 *
 * Exposed because the whole argument of `docs/visualizer-audio-reach.md` §1 is
 * about what happens to a signal *between* the channels and the frame, and that
 * cannot be read from either end alone: the analysis meters show what arrives
 * and the reach readout shows what is delivered, and where those two disagree
 * the answer is always in here.
 */
export interface AudioChannels {
  grid: number;
  dynamics: number;
  amplitude: number;
  beatPulse: number;
  barBreath: number;
  phrase: number;
  /** How far the beat row is open, from `attack`. */
  sharp: number;
  /** The section cue, on the one frame it fires and 0 on every other. A spike
   *  in the trace rather than a channel — see `SECTION_BASELINE`. */
  section: number;
  /** The drop cue, on the one frame it fires. See `ARRIVAL_GAP`. */
  arrival: number;
  /** How far the bar that just played moved this one, around 1. */
  barGain: number;
  /** The wind-up across a fill. */
  wind: number;
  /** The three hits, and the backbeat over them. */
  hitLow: number;
  hitMid: number;
  hitHigh: number;
  backbeat: number;
  /** How much of the composition's own motion is standing down, 0..1 — the
   *  complement of what the director multiplies its autonomous rates by. */
  handover: number;
  /** How far the beat-locked walk is currently reaching. See `STRIDE_REACH`. */
  stride: number;
  fast: number;
  swell: number;
  tonal: number;
  shimmer: number;
  tide: number;
  accent: number;
  luma: number;
  hue: number;
  barPhase: number;
}

/**
 * An asymmetric raised cosine over a wrapped phase — the shape everything on the
 * synthesised path is made of.
 *
 * Continuous in value *and* in derivative at every point, including the two
 * where it meets zero, because a raised cosine is flat at both ends of its
 * window. That is the property that lets it run at beat rate without reading as
 * a flinch, and it is what no amount of filtering an energy signal can produce:
 * a filtered transient is smooth where the filter reached and has a corner where
 * the transient arrived.
 *
 * `rise` and `fall` are fractions of the cycle either side of `peak`. Their sum
 * must be under 1 or the pulse laps itself.
 */
function pulseShape(phase: number, peak: number, rise: number, fall: number): number {
  /*
   * Signed distance to the peak, wrapped into (-rise, 1 - rise] — so a peak at
   * 0.96 is 0.04 behind a phase of 0, not 0.96 ahead of it.
   *
   * Wrapped against the window rather than to the nearest representative, which
   * is the obvious thing and is wrong here. `d -= Math.round(d)` lands in
   * [-0.5, 0.5], and this window is *asymmetric* — a rise of 0.62 reaches back
   * further than that, so the far end of it was being folded to the other side
   * of the peak and read as zero. The shape then stepped by a tenth of its
   * range once per bar. Measured: 360%/s on the flight gain, out of a shape
   * whose own slope never exceeds 130%/s, and the single largest source of jerk
   * in the rewritten binding.
   */
  let d = (phase - peak) % 1;
  if (d < 0) d += 1;
  if (d > 1 - rise) d -= 1;
  if (d < 0) return 0.5 * (1 + Math.cos((Math.PI * d) / rise));
  return d >= fall ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / fall));
}

/**
 * One cell of a figure's pattern: how much of the pulse the beat at absolute cell
 * index `cell` carries — §22.
 *
 * A cell index is `bar × BEATS_PER_BAR + beat`, counted from the reactor's own bar
 * zero, so the modulo here is taken against the *absolute* position in the music
 * rather than against a count kept since the figure was chosen. That is what makes
 * a multi-bar pattern a property of the music: a two-bar figure always accents even
 * bars, and a figure that replaces it mid-phrase lands on the same two-bar unit
 * rather than starting one of its own.
 *
 * Written to survive a negative index, which the reactor can produce: the bar loop
 * slides onto the detected downbeat and may step backwards over one while it does.
 */
function cellAt(pattern: readonly number[], cell: number): number {
  const length = pattern.length;
  return pattern[((cell % length) + length) % length];
}

/** A plain raised cosine over a wrapped phase, 0..1, peaking at 0.5. */
function swellShape(phase: number): number {
  return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
}

/**
 * One bar gesture evaluated at a bar phase. See `GESTURES`.
 *
 * `lobes` multiplies the phase before wrapping, so a two-lobe gesture is the same
 * shape happening twice — which keeps the family a single function and keeps the
 * slope arithmetic in the note above honest.
 */
function gestureAt(gesture: Gesture, phase: number): number {
  const local = wrap01(phase * gesture.lobes);
  return (
    gesture.base +
    gesture.gain * pulseShape(local, gesture.peak, gesture.rise, gesture.fall)
  );
}

/**
 * Which gesture the coming bar runs, from what the bar that just ended contained
 * — §3.4 of `docs/visualizer-audio-attribution.md`.
 *
 * Deterministic, and that is the requirement rather than a simplification. A
 * choice drawn from the rng would give exactly the same *variety* and none of the
 * attribution: what makes a changing shape read as musical is that the change has
 * an audible cause, and a viewer who cannot hear why the bar leaned differently
 * is watching a random number generator with extra steps.
 *
 * Ordered by how much each condition is worth seeing. An empty bar is the most
 * legible thing on the list and comes first; a run-up is the next, because it is
 * the only one that is about the bar *ahead*; then the two textures.
 */
/**
 * Which figure the coming phrase runs — §20, and the same contract
 * `chooseGesture` holds one level down: deterministic, from evidence, ordered by
 * how much each condition is worth seeing.
 *
 * The arguments are all phrase averages rather than bar ones, because a figure
 * lasts eight bars and a choice made from a single bar's tally would flip on a
 * drum fill. `current` is the figure already running and is never returned — see
 * the note below.
 *
 * ## The rotation, and why the rule needs one
 *
 * A pure evidence rule has a fixed point: steady material produces the same
 * evidence every phrase, so it selects the same figure every phrase, and a piece
 * that never changes voice is the exact complaint this section was opened to
 * answer. So the first preference the evidence supports is taken *unless it is
 * already running*, in which case the search continues down `FIGURE_ORDER`. That
 * costs nothing on material that varies — the evidence wins outright — and on
 * material that does not it guarantees the composition keeps moving through the
 * vocabulary rather than settling into one corner of it.
 */
function chooseFigure(
  current: FigureName,
  sinceRest: number,
  energy: number,
  reference: number,
  hats: number,
  lowShare: number,
  fill: number
): FigureName {
  const wanted: FigureName[] = [];

  /*
   * The scheduled rest comes first and is the only entry not argued from the
   * music — see `REST_AFTER`. Deferred on a phrase that is visibly building,
   * because standing down into a run-up is the one place it would read as the
   * composition losing its nerve rather than as a choice.
   *
   * Deferred and not skipped, which is §22's correction to it. A suppression with
   * no ceiling on it is a suppression: on material whose fill measure happens to
   * sit over the threshold at every phrase boundary, the rest is not moved, it is
   * cancelled for the whole of a run — which is the failure that had just been
   * found one line up, in a gate nobody suspected until the frames were counted.
   * `REST_DEFER` bounds the wait, after which the composition stands down over the
   * run-up and takes the small loss. The break is the product here; the good
   * manners about where it lands are not worth never having one.
   */
  if (sinceRest >= REST_AFTER && (fill < LATE_FILL || sinceRest >= REST_AFTER + REST_DEFER)) {
    wanted.push("swell");
  }
  // A phrase with nothing in it gets the figure with nothing in it, on
  // `chooseGesture`'s argument about the `still` shape: the member that makes the
  // others mean something.
  if (energy < reference * STILL_RATIO) wanted.push("swell");
  // Busy material gets travel rather than impact — see `step`.
  if (hats >= BUSY_HITS) wanted.push("step");
  // Weight — a phrase carried by the low end — reads best sparse, and it is the
  // one place the shape route is opened.
  if (lowShare >= WEIGHTY_SHARE) wanted.push("mark");
  // A loud phrase against its own recent reference is a chorus, and a chorus is
  // what `drive` is for.
  if (energy > reference * DRIVE_RATIO) wanted.push("drive");

  for (const name of wanted) if (name !== current) return name;
  /*
   * Nothing distinctive was asked for — take the next voice along.
   *
   * There is deliberately no default figure at the end of the list above, and the
   * first version of this had one. `pane` sat there as the fallback, which sounds
   * harmless and is not: from any other figure the evidence is silent, so `pane` is
   * chosen; from `pane` the evidence is still silent, so the list falls through to
   * this rotation and picks something else; and the sequence becomes
   * X → pane → Y → pane → Z → pane. Measured on steady material, **54%** of the run
   * was spent in one figure and two of the six never appeared at all.
   *
   * Rotating instead spreads a phrase that has nothing to say across the whole
   * vocabulary evenly, and material that *does* have something to say still
   * overrides it above. Which is the right division: the evidence decides when it
   * can, and where it cannot the composition should keep moving rather than fall
   * back on a favourite.
   */
  const at = FIGURE_ROTATION.indexOf(current);
  return FIGURE_ROTATION[(at + 1) % FIGURE_ROTATION.length];
}

function chooseGesture(
  energy: number,
  reference: number,
  fill: number,
  hats: number,
  lowShare: number
): GestureName {
  if (energy < reference * STILL_RATIO) return "still";
  if (fill >= LATE_FILL) return "late";
  if (hats >= BUSY_HITS) return "push";
  if (lowShare >= WEIGHTY_SHARE) return "hold";
  return "breath";
}

export class AudioBinding {
  // --- the synthesised path -------------------------------------------------
  /** How far the grid is in charge, 0..1. Crossfades against the energy path. */
  private grid = 0;
  /** The generated shapes, after `SHAPE_SMOOTH`. */
  private beatPulse = 0;
  private barBreath = 0;
  private phrase = 0.5;
  /** Bar position of the most recent frame, so the per-layer spread can be
   *  taken as an offset into the same shape rather than as a filter. */
  private barPhase = 0;
  /** And which bar it is, carried beside the phase because a figure's pattern may
   *  run over more than one of them — see `cellAt`. Set from the same frame as
   *  `barPhase` and never derived from a beat count, which is a different loop
   *  with its own alignment. */
  private barCount = 0;
  /** The beat the row is currently answering, as an absolute cell index, and the
   *  pattern it is answering it with. Latched together once per beat — see
   *  `trackMask`, which is where the argument for latching at all lives. */
  private maskCell = 0;
  private maskFigure: FigureName = "drive";
  /** Amplitude the shapes are travelling at, 0..1 — the slow energy term, and
   *  the bar's own latch and the wind-up over the top of it. See `BAR_SWING`. */
  private amplitudeBase = 0;
  private amplitude = 0;
  /** The beat-rate channel the fast row reads, crossfaded against the swell on
   *  the lock. */
  private fast = 0;
  /** How far the beat and accent channels are open, 0..1 — the `attack` axis.
   *  Taken straight from the config rather than filtered: it is a control, and
   *  a slider being dragged is not a signal. */
  private sharp = 1;

  // --- the bar's own size and shape -----------------------------------------
  /** Which gesture this bar runs and which the last one did, and how far the
   *  composition has moved between them. See `GESTURE_BLEND`. */
  private gesture: GestureName = "breath";
  private previousGesture: GestureName = "breath";
  private gestureBlend = 1;
  /** The bar accumulators, and what the last completed bar came to. Peak swell,
   *  top-band hits, low-band share and the fill it carried — everything
   *  `chooseGesture` and the latch are decided from. */
  private barEnergy = 0;
  private barHats = 0;
  private barLowFlux = 0;
  private barAllFlux = 0;
  private barFill = 0;
  /** The latched size of the last bar, the reference it is measured against, and
   *  the multiplier gliding toward it. See `BAR_SWING`. */
  private barLatch = 0;
  private barReference = 0;
  private barGain = 1;
  private barMark = -1;

  // --- the figure -----------------------------------------------------------
  /** Which figure the beat row is currently spending itself through, which one it
   *  was, and how far the composition has moved between them. See `FIGURES`. */
  private figure: FigureName = "drive";
  private previousFigure: FigureName = "drive";
  private figureBlend = 1;
  /** Which `FIGURE_BARS` block the run is in, and whether a section change has
   *  asked for the next downbeat to end the phrase early. */
  private figureMark = -1;
  private figureCue = false;
  /** Figure changes since the last `swell`. See `REST_AFTER`. */
  private sinceRest = 0;
  /** Which layer slot answers under a soloing figure. Advanced on every figure
   *  change, so consecutive `pane` phrases do not pick out the same layer. */
  private soloSlot = 0;
  /** The phrase's own tally, on `trackBar`'s accumulators one level up: what the
   *  last `FIGURE_BARS` contained, and everything `chooseFigure` reads. */
  private phraseEnergy = 0;
  private phraseReference = 0;
  private phraseHats = 0;
  private phraseLowFlux = 0;
  private phraseAllFlux = 0;
  private phraseFill = 0;
  private phraseBars = 0;

  // --- the stride -----------------------------------------------------------
  /** Where on the circle the walk is heading, in turns, and the beat the last
   *  step was taken on. See `STRIDE_REACH`. */
  private strideAngle = 0;
  private strideMark = -1;
  /** The step in progress: where it came from, where it is going, and how far
   *  through it is. Unit vectors — the reach is applied at the point of use, so
   *  a reach that moves while a step is in flight bends it rather than
   *  restarting it. */
  private strideFromX = 0;
  private strideFromY = 0;
  private strideToX = 1;
  private strideToY = 0;
  private strideBlend = 1;
  /** Filled by `stride`, on `channels`' convention. */
  private readonly strideOut = { x: 0, y: 0, overscan: 1 };

  // --- the section row ------------------------------------------------------
  /** The cue for this frame, 0 on nearly all of them. Cleared at the top of
   *  every `update`, so a consumer reads it within the frame that raised it. */
  private sectionCue = 0;
  /** The long average `dynamics` is compared against, and time since the last
   *  cue. See `SECTION_BASELINE`. */
  private sectionBase = 1;
  private sinceSection = 0;
  /** The drop cue and its own gap. See `ARRIVAL_GAP`. */
  private arrivalCue = 0;
  private sinceArrival = ARRIVAL_GAP;

  // --- the hits and the wind-up ---------------------------------------------
  private hitLow = 0;
  private hitMid = 0;
  private hitHigh = 0;
  private backbeat = 0;
  private wind = 0;
  /** How far the composition's own motion has stood down, 0..1. */
  private handover = 0;

  // --- the energy path ------------------------------------------------------
  private swell = 0;
  private baseline = 0;
  /** The tonal channel and its long baseline. See `TONAL_BASELINE`. */
  private tonal = 0;
  private tonalBase = 0;
  /** The depth multiplier the run's own dynamics buy, around 1. See
   *  `DYNAMICS_TAU`. */
  private dynamics = 1;
  private shimmer = 0;
  private tide = 0;
  /** Ring buffer of the swell, for the per-layer spread when unlocked. */
  private readonly history = new Float32Array(HISTORY);
  private write = 0;
  private frameDt = 1 / 60;

  private accent = 0;
  /** What the accent is heading for; `accent` follows it with an attack. */
  private accentPeak = 0;
  private sinceAccent = ACCENT_MIN_GAP;
  private onsetAverage = 0;
  /** Whether the safety governor allowed the current accent to reach the
   *  highlights. See `KRACKLE_LIFT`. */
  private accentFlash = false;

  /** The luminance-affecting drive, after the governor's rate limit. */
  private luma = 0;
  private hue = 0;
  /** Which way the bar walk is currently carrying it — see `HUE_RANGE`. */
  private hueDirection = 1;
  private lastBar = -1;
  /** How far the print family may be lifted from zero, 0..1. */
  private lift = 0;

  /** Filled by `channels`. Mutated in place and handed out by reference, the
   *  same convention as `AudioFrame`: a reader consumes it within the frame that
   *  produced it, and a per-frame allocation on the hot path buys nothing. */
  private readonly exported: AudioChannels = {
    grid: 0,
    dynamics: 1,
    amplitude: 0,
    beatPulse: 0,
    barBreath: 0,
    phrase: 0,
    sharp: 1,
    section: 0,
    arrival: 0,
    barGain: 1,
    wind: 0,
    hitLow: 0,
    hitMid: 0,
    hitHigh: 0,
    backbeat: 0,
    handover: 0,
    stride: 0,
    fast: 0,
    swell: 0,
    tonal: 0,
    shimmer: 0,
    tide: 0,
    accent: 0,
    luma: 0,
    hue: 0,
    barPhase: 0,
  };

  /** Read-only, and only by the trace. Nothing in the composition may bind to
   *  these directly — the whole point of the three rows is that a channel
   *  reaches a parameter whose timescale matches it, and an accessor that hands
   *  out every channel at once is an invitation to skip that. */
  get channels(): AudioChannels {
    const out = this.exported;
    out.grid = this.grid;
    out.dynamics = this.dynamics;
    out.amplitude = this.amplitude;
    out.beatPulse = this.beatPulse;
    out.barBreath = this.barBreath;
    out.phrase = this.phrase;
    out.sharp = this.sharp;
    out.section = this.sectionCue;
    out.arrival = this.arrivalCue;
    out.barGain = this.barGain;
    out.wind = this.wind;
    out.hitLow = this.hitLow;
    out.hitMid = this.hitMid;
    out.hitHigh = this.hitHigh;
    out.backbeat = this.backbeat;
    out.handover = this.handover;
    out.stride = this.strideReach;
    out.fast = this.fast;
    out.swell = this.swell;
    out.tonal = this.tonal;
    out.shimmer = this.shimmer;
    out.tide = this.tide;
    out.accent = this.accent;
    out.luma = this.luma;
    out.hue = this.hue;
    out.barPhase = this.barPhase;
    return out;
  }

  /**
   * The breath as one layer of the flat composition sees it, ≥ 1.
   *
   * Each layer reads the same shape at its own offset, so a change passes
   * through the stack as a wave over about half a bar rather than scaling every
   * layer on the same frame. On the synthesised path that offset costs nothing
   * at all — it is an argument to `pulseShape`, and every layer gets the full
   * amplitude — where the cascade this replaces paid for the spread by
   * destroying the signal it was spreading.
   *
   * The accent is added undelayed and to every layer at once.
   */
  pulse(shardId: number): number {
    const frameRoute = this.routed("frame") * this.soloGain(shardId);
    return (
      1 +
      PULSE_BAR * this.spread(shardId) +
      // Undelayed and identical on every layer, which is the whole point — see
      // `PULSE_BEAT` and `SPREAD_UNISON`. A beat term handed out at a per-layer
      // offset would be the same smear the bar row was suffering from, one
      // octave faster and therefore worse.
      // Both beat terms carry the figure's frame gain and the soloing route, so a
      // phrase that has decided not to pulse the frame does not pulse it on two
      // and four either — see `FIGURES`.
      frameRoute * PULSE_BEAT * this.beat +
      // The backbeat rides the same instant rather than adding one, so it is
      // undelayed for the same reason. See `PULSE_BACKBEAT`.
      frameRoute * PULSE_BACKBEAT * this.backbeat +
      PULSE_ACCENT * this.accent
    );
  }

  /**
   * The beat shape as the geometry sees it: on the grid only, at the amplitude
   * everything else travels at, and open as far as `attack` asks.
   *
   * No energy fallback, deliberately, and for the reason the press family and
   * the fold already make the same call. The energy path is a delayed envelope
   * with no phase in it; a frame pulsing off *that* is the composition moving
   * near the music without ever landing on it, which is precisely the reading
   * this channel exists to replace. Where there is no beat, there is no beat
   * pulse.
   */
  private get beat(): number {
    return this.beatPulse * this.amplitude * this.grid * this.sharp;
  }

  /**
   * Which figure the beat row is currently spending itself through — §20.
   *
   * A name rather than a number, and read by the tuning panel rather than by
   * anything in the composition. Every effect a figure has reaches the frame
   * through the routing gains already; this exists so that a person watching can
   * tell *which* of six voices they are watching, which is the one thing about
   * this row that cannot be read off the picture with any confidence and the first
   * thing anybody tuning it will want to know.
   */
  get figureName(): string {
    return this.figure;
  }

  /**
   * How large a section change the music just made, 0..1, on the one frame it
   * made it — the section row of the hierarchy, and the only channel here that
   * is an event rather than a level.
   *
   * Read once per frame by the director, which is the only thing that can spend
   * it: what a section is worth is a *discrete* move, and there is no parameter
   * in `PostParams` whose timescale is a minute. See `SECTION_BASELINE`.
   */
  get section(): number {
    return this.sectionCue;
  }

  /**
   * A drop, on the one frame it lands — §3.5 of
   * `docs/visualizer-audio-attribution.md`.
   *
   * The same kind of thing as `section` and deliberately a second channel rather
   * than a larger value on the first. A section is "the music has moved to a
   * different level", measured over twenty seconds and resolved to within a few;
   * an arrival is "the bottom just came back", resolved to a frame. The gestures
   * they are worth are the same ones, and the difference that matters to the
   * director is that this one can be *hit* — the beat grid predicts, so a
   * crossfade fired here lands on the downbeat rather than after it.
   */
  get arrival(): number {
    return this.arrivalCue;
  }

  /**
   * What the composition should multiply its *own* rates by while the music is
   * carrying the frame, 0.6..1 — §3.1 of the attribution document.
   *
   * Not a channel and not something `applyPost` can spend, because what it
   * governs does not live in `PostParams`: the drift's rate, the cycler's
   * interval, the stage's authored flight. The director reads it and hands the
   * margin over.
   *
   * Every other number in this file answers "how far should the music move the
   * composition". This one answers "how much should the composition be moving on
   * its own while it does" — and since attribution is a ratio, it is the only one
   * that can move the denominator.
   */
  get autonomy(): number {
    return 1 - HANDOVER * this.handover;
  }

  /**
   * The frame's beat-locked offset, in fractions of the frame height, with the
   * overscan that keeps it from pulling a full-bleed layer's own edge into
   * shot — see `STRIDE_REACH`.
   *
   * The overscan is why this is one object rather than two getters. A
   * translation of `r` in any direction is covered by a scale of `1 + 2r` about
   * the frame centre, since the nearer half-dimension is 0.5 in stage units; the
   * two therefore have to be applied together or the gesture is a border
   * appearing on the beat. It is also under three percent at full reach and
   * moves on the amplitude's own time constant, so it contributes nothing to
   * velocity and nothing to the picture.
   *
   * Mutated in place and handed out by reference, the same convention as
   * `channels`.
   */
  get stride(): { x: number; y: number; overscan: number } {
    const reach = this.strideReach;
    const out = this.strideOut;
    if (reach <= 0) {
      out.x = 0;
      out.y = 0;
      out.overscan = 1;
      return out;
    }
    const t = this.strideBlend;
    const eased = t * t * (3 - 2 * t);
    out.x = reach * (this.strideFromX + (this.strideToX - this.strideFromX) * eased);
    out.y = reach * (this.strideFromY + (this.strideToY - this.strideFromY) * eased);
    out.overscan = 1 + 2 * reach;
    return out;
  }

  /** Gain on the spatial flight and turn rates. Read at different offsets, so
   *  the two do not surge on the same frame. */
  get flight(): number {
    return 1 + FLIGHT_DEPTH * this.spread(0);
  }

  get spin(): number {
    return 1 + SPIN_DEPTH * this.spread(3);
  }

  /**
   * Whether `applyPost` would do anything. The early return it guards is what
   * makes a run that is not listening an exact identity on the post chain.
   *
   * `hue` and `grid` are in here for a reason that is not about cost: the hue
   * walk is *accumulated*, so a frame on which this reads false would hand back
   * the whole of it at once and hand it straight back the frame after. Both
   * shapes rest at zero for a few tens of milliseconds every cycle, and on a
   * locked but very quiet passage every other term can rest with them — so
   * without these two the colour would pop once a bar on exactly the material
   * least able to hide it.
   */
  get active(): boolean {
    return (
      this.grid > 0.002 ||
      this.hue !== 0 ||
      this.fast > 0.002 ||
      this.swell > 0.002 ||
      this.luma > 0.002 ||
      this.accent > 0.002 ||
      this.tide > 0.002 ||
      this.shimmer > 0.002 ||
      this.hitLow > 0.002 ||
      this.hitMid > 0.002 ||
      this.hitHigh > 0.002 ||
      this.backbeat > 0.002 ||
      this.wind > 0.002
    );
  }

  /**
   * The bar breath at one layer's offset, blended against the energy path.
   *
   * Both halves are already scaled by `grid` and `1 - grid` respectively, so
   * this is a crossfade rather than a sum: a run that is locked reads the
   * generated breath, a run that is not reads the delayed swell, and a lock
   * arriving or leaving moves between them over `LOCK_FADE`.
   */
  private spread(slot: number): number {
    return this.onGrid(slot) + this.delayed(slot) * (1 - this.grid) * SPREAD_FALLBACK;
  }

  /**
   * The locked half of `spread` on its own: the generated bar shape at a slot's
   * offset, already weighted by how far the grid is believed.
   *
   * For the consumers that would rather not move at all than move off the grid.
   * The energy fallback is the right answer for anything that reads as breathing
   * — scale, travel, a swelling warp — because a delayed envelope with no phase
   * in it still looks like a response to loudness. It is the wrong answer for
   * anything that *restructures* the frame, where the same envelope reads as the
   * picture rearranging itself near the music but never with it.
   */
  private onGrid(slot: number): number {
    // Closed toward unison as the lock takes — see `SPREAD_UNISON`. Continuous
    // in `grid`, so a lock arriving or leaving draws the stack together or lets
    // it fan out over `LOCK_FADE` rather than restacking it on one frame.
    const offset =
      (Math.abs(slot) % SPREAD_SLOTS) * SPREAD_BARS * (1 - SPREAD_UNISON * this.grid);
    let phase = (this.barPhase - offset) % 1;
    if (phase < 0) phase += 1;
    return this.barShape(phase) * this.amplitude * this.grid;
  }

  /**
   * The bar's shape at a phase — this bar's gesture mixed against the last one's.
   *
   * Mixed rather than switched, and the blend is over most of a bar. Two gestures
   * do not agree on their value at phase 0, so changing at the downbeat is a
   * step, and a step through `SHAPE_SMOOTH` is a 50ms transient — which is
   * precisely the discontinuity §10 of the reach document identified as the
   * largest single source of jerk in the version before this one. A mix of two
   * continuous functions of the same phase is continuous, and what it adds to the
   * slope is bounded by their difference over the blend length.
   */
  private barShape(phase: number): number {
    const next = gestureAt(GESTURES[this.gesture], phase);
    if (this.gestureBlend >= 1) return next;
    const previous = gestureAt(GESTURES[this.previousGesture], phase);
    return previous + (next - previous) * this.gestureBlend;
  }

  /**
   * The walk, advanced by a frame. See `STRIDE_REACH`.
   *
   * The step fires on `beatCount` rather than on a phase test, for the reason
   * `TempoLock.mark` exists: a counter fires exactly once per beat however long
   * a frame runs, where a phase test either misses a beat on a slow frame or
   * fires twice on a fast one. And the beat count comes from the grid, which
   * *predicts* — so the position the frame is gliding to was chosen before the
   * beat it belongs to arrived, and the analysis latency is spent inside the
   * glide rather than after it.
   */
  private trackStride(frame: AudioFrame, dt: number): void {
    const beatSeconds = frame.bpm > 0 ? 60 / frame.bpm : 0.5;
    const glide = beatSeconds * STRIDE_GLIDE;

    /*
     * The step is launched so that it *finishes* on the beat, not so that it
     * starts there — §17, and a correction to §16 rather than an addition.
     *
     * Fired on the beat with a smoothstep, this channel had its peak velocity at
     * the midpoint of the glide, which is halfway *between* two beats, and was
     * at its slowest at the two instants the music was actually marking. It was
     * a textbook description of the complaint that produced this section: motion
     * loosely near a beat, never on one. The shape was right and it was pointing
     * the wrong way round.
     *
     * Led instead, which is the same anticipation `BEAT_PEAK` uses and the same
     * one `Director.beatIndex` uses for a layer birth: the walk moves through the
     * last half of the beat, is settled at the instant the next one lands, and
     * rests until the lead for the one after. It also absorbs the analysis
     * latency for free, because the grid predicts.
     */
    const target = frame.nextBeatIn <= glide ? frame.beatCount + 1 : frame.beatCount;

    if (target !== this.strideMark) {
      /*
       * Which step of the figure this beat is, or -1 if the figure does not walk
       * on it — §21, and the correction that makes the mask mean what it says.
       *
       * The walk used to step on every beat under every figure; only its *reach*
       * was routed. So a phrase whose whole statement was "accent the one" still
       * moved the frame four times a bar, slightly less far — which is not a
       * sparser rhythm, it is the same rhythm played quieter, and the walk is the
       * channel a viewer reads movement from most directly.
       */
      const step = this.strideStep();
      if (this.strideMark >= 0 && step >= 0) {
        // Where the walk actually is right now, which on a glide that finished
        // is the last target and on one still in flight is somewhere between —
        // taken before the target moves, so a step interrupted by the next beat
        // continues from where it got to instead of snapping back.
        const t = this.strideBlend;
        const eased = t * t * (3 - 2 * t);
        this.strideFromX = this.strideFromX + (this.strideToX - this.strideFromX) * eased;
        this.strideFromY = this.strideFromY + (this.strideToY - this.strideFromY) * eased;
        /*
         * The figure, rather than a fresh direction — §19.
         *
         * Taken from the reactor's own counters rather than accumulated here, and
         * that is the difference between a figure and a walk. `STRIDE_TURN` is a
         * quarter, so `0.25 × beatCount` closes a square every four beats and each
         * corner belongs to a specific beat; `STRIDE_PRECESS × barCount` turns the
         * whole square once per bar, so it repeats at bar length without repeating
         * exactly and comes back to itself after eight.
         *
         * An accumulator could not do this. It advances once per step, so a beat
         * missed while the lock was away — or one arriving twice across a long
         * frame — permanently rotates the figure against the music, and the square's
         * corners drift off the beats they were built to mark. Read off a monotonic
         * count instead, a gap costs the steps inside it and nothing after.
         */
        this.strideAngle = wrap01(
          STRIDE_TURN * step + STRIDE_PRECESS * frame.barCount
        );
        this.strideToX = Math.cos(this.strideAngle * 2 * Math.PI);
        this.strideToY = Math.sin(this.strideAngle * 2 * Math.PI);
        this.strideBlend = 0;
      }
      this.strideMark = target;
    }

    this.strideBlend = Math.min(1, this.strideBlend + dt / glide);
  }

  /**
   * Which step of the walk's figure the beat now being glided to is, or -1 if this
   * figure does not walk on it — §21.
   *
   * Counted rather than taken from the beat index, and that is what keeps the shape
   * intact as the pattern thins. `STRIDE_TURN` is a quarter turn *per step*, so if
   * the angle were `0.25 × beatCount` and the figure only stepped on the downbeat,
   * every step would land a full turn from the last one — which is the same place,
   * and the walk would stop moving altogether. Against a step count the square is
   * simply traced more slowly: over one bar when all four beats walk, and over four
   * under §22's vocabulary, where every figure walks twice in eight beats.
   *
   * Derived from the reactor's own counters rather than accumulated, on
   * `trackStride`'s argument about accumulators: a beat missed while the lock was
   * away would otherwise rotate the figure against the music permanently.
   *
   * ## Which bar and which beat, and why not `beatCount`
   *
   * This used to index the mask with `beatCount % 4`, and §22 is what makes that
   * unsafe rather than merely approximate. The reactor keeps the bar as a *loop of
   * its own*, slid onto the detected downbeat — `trackBar` there is explicit that a
   * residue of the beat count is not the same thing — so `beatCount % 4` is the bar
   * position plus whatever constant offset the downbeat detector settled on. Under
   * the old vocabulary, where every figure accented the one and the three, an
   * offset of two mapped the mask onto itself and the error was invisible. Under a
   * vocabulary of *placements* the same offset plays a different figure from the one
   * the pulse is playing.
   *
   * Taken from the bar phase instead, rounded to the nearest beat boundary. The
   * caller fires this a fraction of a beat *before* the beat it is gliding to — see
   * `STRIDE_GLIDE` — so the beat in question is always the nearest boundary, and
   * rounding rather than flooring is what makes it the one being approached rather
   * than the one just left. A round to `BEATS_PER_BAR` is the downbeat of the next
   * bar, which carries into the bar index exactly as `beatMask`'s lead does.
   */
  private strideStep(): number {
    const cell = this.barCount * BEATS_PER_BAR + Math.round(this.barPhase * BEATS_PER_BAR);
    /*
     * The pattern that is *sounding*, not the figure that is chosen — so the walk
     * and the pulse play the same bar of the same figure through a change, and a
     * figure switched on this frame does not move a step that was already launched.
     * `trackMask` runs earlier in the frame than this does, and the caller fires
     * `STRIDE_GLIDE` before the beat, which is the same instant the latch adopts —
     * so the pattern read here is the one the pulse for this beat will play.
     */
    const pattern = FIGURES[this.maskFigure].beats;
    if (cellAt(pattern, cell) <= STRIDE_STEP_GATE) return -1;
    // Where in the pattern this beat falls, counted from the pattern's start rather
    // than the bar's, so a step in the second bar of a two-bar figure follows the
    // ones in the first instead of restarting the count.
    const length = pattern.length;
    const within = ((cell % length) + length) % length;
    let perPattern = 0;
    let before = 0;
    for (let i = 0; i < length; i++) {
      if (pattern[i] <= STRIDE_STEP_GATE) continue;
      if (i < within) before++;
      perPattern++;
    }
    if (perPattern === 0) return -1;
    return Math.floor(cell / length) * perPattern + before;
  }

  /** How far the walk is currently allowed to reach, in fractions of the frame
   *  height. Gated on the grid: a walk with no beat under it is exactly the
   *  arbitrary motion this whole row exists to replace. */
  private get strideReach(): number {
    return (
      STRIDE_REACH *
      this.amplitude *
      this.grid *
      // The figure decides how far the walk reaches, and `step` is the one that
      // decides it should carry the phrase — see `FIGURES`.
      this.routed("walk") *
      (STRIDE_FLOOR + (1 - STRIDE_FLOOR) * this.sharp)
    );
  }

  /**
   * The bar as a unit of its own: what it contained, and what the next one does
   * about it — §§3.2 and 3.4 of `docs/visualizer-audio-attribution.md`.
   *
   * Everything here happens once a bar, and everything it produces is glided over
   * the bar that follows. That is what makes the whole of it free in the currency
   * the reach document established: a value latched once per bar and arriving
   * over four tenths of one contributes its full range divided by most of a bar
   * to peak velocity, which at any tempo the reactor will track is under what the
   * geometry already runs at.
   *
   * The accumulators run whether or not the grid is locked, because a lock that
   * arrives mid-track should find a bar's worth of evidence waiting rather than
   * spend its first bar deciding it was empty.
   */
  private trackBar(frame: AudioFrame, dt: number): void {
    // The bar's own tally. Peak swell for its size, top-band onsets for how busy
    // it was, and the low band's share of the flux for how weighty.
    if (this.swell > this.barEnergy) this.barEnergy = this.swell;
    if (frame.onsetHigh) this.barHats++;
    if (frame.fill > this.barFill) this.barFill = frame.fill;
    this.barLowFlux += frame.fluxLow * dt;
    this.barAllFlux += (frame.fluxLow + frame.fluxMid + frame.fluxHigh) * dt;

    // The gesture blend advances on the bar's own clock, so it is the same
    // fraction of a bar at every tempo. `bpm` is 0 until a tempo is claimed,
    // which is also when nothing below can have run yet.
    const barSeconds = frame.bpm > 0 ? (60 / frame.bpm) * 4 : 2;
    this.gestureBlend = Math.min(
      1,
      this.gestureBlend + coefficient(dt, barSeconds * GESTURE_BLEND) * (1 - this.gestureBlend)
    );
    // The figure crossfades on the same clock and for the same reason, a little
    // slower — see `FIGURE_BLEND`.
    this.figureBlend = Math.min(
      1,
      this.figureBlend + coefficient(dt, barSeconds * FIGURE_BLEND) * (1 - this.figureBlend)
    );
    // The latched multiplier glides toward its target over part of the bar,
    // rather than stepping at the downbeat with the gesture.
    const wantedGain = this.barTarget();
    this.barGain += (wantedGain - this.barGain) * coefficient(dt, barSeconds * BAR_GLIDE);

    if (frame.barCount === this.barMark) return;
    const first = this.barMark < 0;
    this.barMark = frame.barCount;

    /*
     * A bar boundary. The tally closes, the reference it is measured against
     * follows it, and the coming bar's shape is chosen from what the last one
     * turned out to contain.
     *
     * The reference is seeded rather than approached on the first bar, for the
     * reason `trackLoudness` seeds its own: a reference that starts at zero makes
     * the opening bar of every run the loudest thing that has ever happened.
     */
    this.barLatch = this.barEnergy;
    this.barReference = first
      ? this.barLatch
      : this.barReference + (this.barLatch - this.barReference) * BAR_MEMORY;

    const lowShare = this.barAllFlux > 0 ? this.barLowFlux / this.barAllFlux : 0;
    // Before the accumulators are cleared, and before the gesture is chosen: the
    // phrase reads the same closed tally the bar does. See `trackPhrase`.
    this.trackPhrase(frame, lowShare);
    const chosen = chooseGesture(
      this.barLatch,
      this.barReference,
      this.barFill,
      this.barHats,
      lowShare
    );
    if (chosen !== this.gesture) {
      this.previousGesture = this.gesture;
      this.gesture = chosen;
      this.gestureBlend = 0;
    }

    this.barEnergy = 0;
    this.barHats = 0;
    this.barLowFlux = 0;
    this.barAllFlux = 0;
    this.barFill = 0;
  }

  /**
   * The phrase as a unit of its own, and which figure the next one runs — §20.
   *
   * Called from `trackBar` at each bar boundary, with the tally of the bar that
   * just closed, so the accumulators here are sums of quantities that have already
   * been decided rather than a second pass over the frame. That ordering matters:
   * `chooseFigure` reads the same evidence `chooseGesture` does, one level slower,
   * and building it from the raw frame would give the two rows different answers
   * to the same question about the same music.
   */
  private trackPhrase(frame: AudioFrame, lowShare: number): void {
    this.phraseEnergy += this.barLatch;
    this.phraseReference += this.barReference;
    this.phraseHats += this.barHats;
    this.phraseLowFlux += this.barLowFlux;
    this.phraseAllFlux += this.barAllFlux;
    /*
     * The *last* bar's fill rather than the phrase's largest — §22, and this one
     * line is why the composition never rested.
     *
     * `chooseFigure` uses this for one thing: to suppress the scheduled rest on a
     * phrase that is visibly building, because standing down into a run-up is the
     * one place a rest reads as losing one's nerve. That is a statement about the
     * bar the rest would interrupt — the last one — and taking a maximum over eight
     * bars answers a different question, "did anything at all happen in the last
     * sixteen seconds", to which the answer on real material is always yes.
     * Measured on the bench, `swell` held 0% of frames on three of the four
     * patterns: the schedule was firing and the gate was swallowing every one of
     * them. See `REST_AFTER`.
     */
    this.phraseFill = this.barFill;
    this.phraseBars++;
    void lowShare;

    /*
     * A phrase boundary — the eight-bar block changing, or a section cue asking
     * for one early.
     *
     * `barCount` rather than a counter kept here, for the reason every other
     * consumer takes its position from the reactor: a block index derived from a
     * monotonic count cannot drift, where a local counter loses a phrase every
     * time the lock does.
     */
    const block = Math.floor(frame.barCount / FIGURE_BARS);
    const boundary = this.figureMark < 0 || block !== this.figureMark || this.figureCue;
    if (!boundary) return;
    const first = this.figureMark < 0;
    this.figureMark = block;
    this.figureCue = false;
    // Seeded rather than approached, on `trackBar`'s argument about its own
    // reference: a first phrase measured against zero is the loudest thing that
    // has ever happened, and it would put every run on `drive` for its first
    // sixteen seconds whatever it was listening to.
    if (first || this.phraseBars === 0) {
      this.resetPhrase();
      return;
    }

    const bars = Math.max(1, this.phraseBars);
    const chosen = chooseFigure(
      this.figure,
      this.sinceRest,
      this.phraseEnergy / bars,
      this.phraseReference / bars,
      this.phraseHats / bars,
      this.phraseAllFlux > 0 ? this.phraseLowFlux / this.phraseAllFlux : 0,
      this.phraseFill
    );
    if (chosen !== this.figure) {
      this.previousFigure = this.figure;
      this.figure = chosen;
      this.figureBlend = 0;
      // Advanced on every change rather than only on a soloing one, so which
      // layer answers is not a function of how many `pane` phrases have gone by —
      // two of them a minute apart should not pick the same layer.
      this.soloSlot = (this.soloSlot + 1) % SPREAD_SLOTS;
    }
    this.sinceRest = chosen === "swell" ? 0 : this.sinceRest + 1;
    this.resetPhrase();
  }

  private resetPhrase(): void {
    this.phraseEnergy = 0;
    this.phraseReference = 0;
    this.phraseHats = 0;
    this.phraseLowFlux = 0;
    this.phraseAllFlux = 0;
    this.phraseFill = 0;
    this.phraseBars = 0;
  }

  /** One of the figure's routing gains, mixed from the one before it. Continuous
   *  in the blend, so a figure change is a crossfade of gains rather than a
   *  switch — see `FIGURE_BLEND`. */
  private routed(key: "frame" | "walk" | "shape" | "colour" | "motion"): number {
    const next = FIGURES[this.figure][key];
    if (this.figureBlend >= 1) return next;
    return FIGURES[this.previousFigure][key] + (next - FIGURES[this.previousFigure][key]) * this.figureBlend;
  }

  /**
   * Which cell of a pattern the beat now being answered is — the absolute beat
   * index in the *bar's* coordinates, shifted by `BEAT_COMMIT` so that the whole of
   * a pulse falls inside the beat it is arriving at.
   *
   * The carry is the bar half of the same shift, and §22 is what made it necessary:
   * a pattern that runs over two bars is indexed by a bar as well as by a beat, and
   * the pulse belonging to the downbeat of the coming bar starts in the one before
   * it — so the shifted phase has to carry the bar with it or every pattern
   * boundary is read a beat early. Same arithmetic as the reactor's own latency
   * carry, and for the same reason: a phase pushed past a whole bar has pushed the
   * composition into the next one.
   */
  private beatCell(): number {
    const shifted = this.barPhase + BEAT_COMMIT;
    const carry = Math.floor(shifted);
    const slot = Math.min(
      BEATS_PER_BAR - 1,
      Math.floor((shifted - carry) * BEATS_PER_BAR)
    );
    return (this.barCount + carry) * BEATS_PER_BAR + slot;
  }

  /**
   * Adopt the running figure's pattern for the beat now being answered — §22, and
   * the reason a figure change is *not* a crossfade of rhythms.
   *
   * §20 blended the mask along with the routing gains, which is the obviously
   * consistent thing to do and is wrong about rhythm specifically. Two patterns at
   * half gain are not a transition between them, they are a third pattern with
   * every accent of both in it: `pane` fading out under `mark` fading in puts three
   * and four of one bar next to one and two of the next, which is four beats in a
   * row and precisely what the rule at the top of `FIGURES` forbids. Every pair in
   * the vocabulary but one overlaps into a run of three or four this way, and with
   * `FIGURE_BLEND` at most of a bar and a figure change every eight, that is a bar
   * in eight — frequent enough to be the thing a viewer remembers, since a bar
   * where everything is accented is louder than the seven where two beats are.
   *
   * So the pattern is *switched*, and the switch is free because of where it
   * happens. The cell index only advances during the rest between pulses — see
   * `BEAT_COMMIT` — so the mask is being multiplied by a shape that is exactly zero
   * at the instant the figure under it changes. Continuity, from the same property
   * §19 narrowed `BEAT_RISE + BEAT_FALL` to buy, now doing a third job.
   *
   * What still crossfades is everything that is not the rhythm: the routing gains,
   * the solo and the handover all move over `FIGURE_BLEND` as before. A figure
   * change is therefore a new pattern arriving at once, played by an ensemble that
   * takes a bar to rebalance — which is what it sounds like when a band changes
   * figure, and it is not what a dissolve between two rhythms sounds like.
   */
  private trackMask(): void {
    const cell = this.beatCell();
    if (cell === this.maskCell) return;
    this.maskCell = cell;
    this.maskFigure = this.figure;
  }

  /**
   * How much of the pulse the beat currently arriving carries, 0..1.
   *
   * Indexed by which beat of which bar the pulse is heading for — see `beatCell` —
   * and read from the pattern latched for that beat rather than from the figure
   * currently chosen, which is the whole of `trackMask`.
   */
  private beatMask(): number {
    return cellAt(FIGURES[this.maskFigure].beats, this.beatCell());
  }

  /**
   * How far a layer's own share of the frame pulse is open, 0..1 — the soloing
   * route of §20.
   *
   * Keyed on the layer's id rather than on its position in the stack, the same way
   * the spread is, so a layer keeps whatever role it was born into for its whole
   * life instead of being reassigned every time a neighbour retires. See
   * `SOLO_OTHERS` for why the others keep a floor rather than going silent.
   */
  private soloGain(shardId: number): number {
    const solo = FIGURES[this.figure].solo ? 1 : 0;
    const previous = FIGURES[this.previousFigure].solo ? 1 : 0;
    const blended = this.figureBlend >= 1 ? solo : previous + (solo - previous) * this.figureBlend;
    if (blended <= 0) return 1;
    const chosen = Math.abs(shardId) % SPREAD_SLOTS === this.soloSlot ? 1 : SOLO_OTHERS;
    return 1 + (chosen - 1) * blended;
  }

  /**
   * How far the last bar moves this one, around 1 — the latch of §3.2.
   *
   * Relative to the bars around it rather than absolute, which is the whole
   * content of the measurement: "this bar was bigger than the last few" is a
   * thing music does constantly and is exactly what every filter above removes.
   * Bounded, because a bar that swings the amplitude by more than this stops
   * reading as the same composition responding and starts reading as two.
   */
  private barTarget(): number {
    if (this.barReference <= 0.02) return 1;
    const departure = (this.barLatch - this.barReference) / this.barReference;
    return 1 + BAR_SWING * Math.max(-1, Math.min(1, departure));
  }

  /**
   * One hit channel advanced by a frame — an exponential decay with a short
   * attack onto whatever arrived.
   *
   * The attack is `HIT_ATTACK` rather than instant for the accent's reason: a
   * channel that reaches its peak between two frames is a step, and a step in
   * anything the eye can see is a snap however small it is. Fifty milliseconds
   * costs the impulse nothing anybody can perceive as latency and takes the
   * corner off it.
   */
  private decayHit(value: number, arriving: number, release: number, dt: number): number {
    const decayed = value * Math.exp(-dt / release);
    const target = Math.max(decayed, arriving);
    return decayed + (target - decayed) * clamp01(dt / HIT_ATTACK);
  }

  /** Seconds of smoothing the generated shapes get at this tempo, bounded either
   *  side. See `SHAPE_SMOOTH_BEATS`. */
  private shapeSmoothing(bpm: number): number {
    if (!(bpm > 0)) return SHAPE_SMOOTH_MAX;
    return Math.min(
      SHAPE_SMOOTH_MAX,
      Math.max(SHAPE_SMOOTH_MIN, (60 / bpm) * SHAPE_SMOOTH_BEATS)
    );
  }

  /** The swell as it was `slot` steps of `SPREAD_SECONDS` ago. A delay, so every
   *  slot carries the same amplitude as the source. */
  private delayed(slot: number): number {
    const lag = Math.min(
      HISTORY - 1,
      Math.round(((Math.abs(slot) % SPREAD_SLOTS) * SPREAD_SECONDS) / this.frameDt)
    );
    return this.history[(this.write - lag + HISTORY) % HISTORY];
  }

  /**
   * Fold one analysed frame into the channels. Real `dt`, always: the music does
   * not follow the speed control, so neither may anything derived from it.
   *
   * A missing frame, a silent room and a reactivity of 0 are all the same case —
   * every channel falls away and every binding below becomes an identity.
   */
  update(
    frame: AudioFrame | null,
    reactivity: number,
    attack: number,
    lift: number,
    dt: number,
    safety: SafetyGovernor
  ): void {
    const depth = clamp01(reactivity);
    this.sharp = clamp01(attack);
    this.lift = clamp01(lift);
    this.sectionCue = 0;
    this.arrivalCue = 0;
    const live = frame !== null && !frame.silent && depth > 0;
    // Smoothed, because the ring buffer indexes by frames and a single long
    // frame must not move where every layer is reading from.
    this.frameDt += (Math.min(0.1, Math.max(1 / 240, dt)) - this.frameDt) * 0.1;

    /*
     * How far everything below is allowed to travel, before any of it is
     * shaped. The reactor's loudness is the only unnormalised thing in the
     * chain, so it is the only place a chorus can differ from a verse — every
     * band it could have been taken from was mapped into 0..1 against its own
     * recent range on purpose.
     */
    const wantedDynamics = Math.min(
      DYNAMICS_MAX,
      Math.max(DYNAMICS_MIN, Math.pow(live ? frame.loudness : 1, DYNAMICS_EXPONENT))
    );
    this.dynamics += (wantedDynamics - this.dynamics) * coefficient(dt, DYNAMICS_TAU);
    const travel = depth * this.dynamics;

    /*
     * The section, off the same figure — two averages of it, twenty seconds
     * apart, and a cue when they disagree by more than a track's own noise. See
     * `SECTION_BASELINE`.
     *
     * The baseline follows whether or not a cue fires, so a track that arrives
     * at a new level and stays there raises one cue rather than holding the
     * condition true for the next twenty seconds; and the gap is measured from
     * the last cue rather than from the last crossing, so a passage that wanders
     * either side of the threshold still costs one gesture.
     */
    this.sinceSection += dt;
    if (live) {
      const departure = this.dynamics - this.sectionBase;
      if (Math.abs(departure) >= SECTION_THRESHOLD && this.sinceSection >= SECTION_GAP) {
        this.sinceSection = 0;
        // Scaled so that a change of twice the threshold is the whole of it: a
        // consumer that only wants the large ones has something to test.
        this.sectionCue = clamp01(Math.abs(departure) / (2 * SECTION_THRESHOLD)) * depth;
        // Taken to the new level rather than left to converge over the baseline's
        // own time constant, which would leave the departure standing and spend
        // the next cue on the same change.
        this.sectionBase = this.dynamics;
      } else {
        this.sectionBase += (this.dynamics - this.sectionBase) * coefficient(dt, SECTION_BASELINE);
      }
    } else {
      this.sectionBase = this.dynamics;
    }

    // --- the energy path ----------------------------------------------------
    // Bass carries the weight; broadband keeps it from dropping out through a
    // bar with no kick in it.
    const raw = live ? clamp01(frame.low * 0.65 + frame.level * 0.45) : 0;
    this.baseline += (raw - this.baseline) * clamp01(dt / SWELL_BASELINE);
    // Clamped after the multiplier, not before: `travel` can exceed 1 on a loud
    // passage at full reactivity, and everything downstream of the swell is a
    // depth in 0..1.
    const event = clamp01(expand(raw - this.baseline) * travel);

    /*
     * The tonal channel, on its own far longer baseline. See `TONAL_BASELINE`.
     * On percussive material this is near zero and `clarity` is near one, so the
     * crossfade below hands everything to the event channel and nothing here
     * reaches the frame; on a drone the two swap places.
     */
    this.tonalBase += (raw - this.tonalBase) * clamp01(dt / TONAL_BASELINE);
    const tonalTarget = clamp01((raw - this.tonalBase) * TONAL_GAIN) * travel;
    this.tonal += (tonalTarget - this.tonal) * clamp01(dt / TONAL_TAU);

    const clarity = live ? clamp01(frame.clarity / TONAL_CLARITY) : 1;
    const target = event * clarity + this.tonal * (1 - clarity);
    const swellTau = target > this.swell ? SWELL_ATTACK : SWELL_RELEASE;
    this.swell += (target - this.swell) * clamp01(dt / swellTau);

    this.write = (this.write + 1) % HISTORY;
    this.history[this.write] = this.swell;

    this.shimmer +=
      ((live ? frame.high : 0) * travel - this.shimmer) * clamp01(dt / SHIMMER_TAU);
    this.tide += ((live ? frame.mid : 0) * travel - this.tide) * clamp01(dt / TIDE_TAU);

    /*
     * The three hits — §3.3. Each is an impulse envelope over its own band's
     * onset, scaled at the point it fires by depth and by `sharp`, so the
     * `attack` axis reroutes them with the rest of the fast row rather than
     * leaving three channels running underneath it.
     *
     * Peaks are taken with `max` rather than replaced: two hits inside one
     * release is a louder passage, not a quieter second hit.
     */
    this.hitLow = this.decayHit(
      this.hitLow,
      live && frame.onsetLow ? frame.strengthLow * travel * this.sharp : 0,
      HIT_RELEASE_LOW,
      dt
    );
    this.hitMid = this.decayHit(
      this.hitMid,
      live && frame.onsetMid ? frame.strengthMid * travel * this.sharp : 0,
      HIT_RELEASE_MID,
      dt
    );
    this.hitHigh = this.decayHit(
      this.hitHigh,
      live && frame.onsetHigh ? frame.strengthHigh * travel * this.sharp : 0,
      HIT_RELEASE_HIGH,
      dt
    );
    /*
     * And the backbeat over the top of the snare, weighted by how consistently
     * the pattern has actually been landing. Material in 3, or with no snare in
     * it, never raises the reactor's confidence and therefore never reaches this
     * — which is the honest answer rather than a fallback worth building.
     */
    /*
     * Gated by the figure's mask at the instant it fires — §20, and at the instant
     * rather than continuously for a reason worth keeping.
     *
     * A backbeat is a rhythmic statement about two and four, so a figure that has
     * masked those beats out must not have it arrive anyway: `mark` says "one and
     * four" and was thumping the frame on two and four regardless, at its own
     * raised gain, which is the composition contradicting itself once a bar.
     *
     * Applied to `arriving` and not to the envelope. This channel is an impulse
     * with a 0.4s release, so a mask consulted every frame would step the decay
     * part-way down whenever the mask boundary fell inside it — reintroducing
     * exactly the discontinuity `beatMask` is careful to avoid. Scaled once, on
     * the frame the hit lands, the envelope that follows is whatever the mask said
     * at the moment the music played it.
     */
    this.backbeat = this.decayHit(
      this.backbeat,
      live && frame.backbeat > 0
        ? frame.backbeat * frame.backbeatConfidence * travel * this.sharp * this.beatMask()
        : 0,
      BACKBEAT_RELEASE,
      dt
    );

    /*
     * The wind-up. The reactor's fill rises across the last half of a bar, so
     * this is the one channel in the feature that is ahead of the music rather
     * than behind it, and the composition is already travelling when the downbeat
     * it was predicting arrives.
     */
    const windTarget = live ? frame.fill * this.grid * travel : 0;
    this.wind += (windTarget - this.wind) * clamp01(dt / WIND_TAU);

    /*
     * The arrival. Rate-limited here rather than in the reactor because what a
     * gap protects is the *gesture*, not the detection — the reactor should go on
     * reporting drops it sees, and the floor under how often the composition
     * turns itself over has to be a property of this side.
     */
    this.sinceArrival += dt;
    if (live && frame.drop > 0 && this.sinceArrival >= ARRIVAL_GAP) {
      this.sinceArrival = 0;
      this.arrivalCue = clamp01(frame.drop) * depth;
    }
    /*
     * Either structural cue ends the phrase at the next downbeat — §20.
     *
     * This is what stops the figures reading as a clock. Eight bars is the default
     * and the music is allowed to overrule it: a drop or a section change is the
     * composition's cue to pick a new voice, and because the change is deferred to
     * the downbeat rather than taken on the frame the cue arrived, it lands
     * somewhere the music also lands.
     */
    if (this.sectionCue > 0 || this.arrivalCue > 0) this.figureCue = true;

    // --- the synthesised path -----------------------------------------------
    /*
     * The gate is on `confidence` alone, not on energy: a grid the reactor
     * believes in is what makes generated motion legitimate, and a quiet locked
     * passage should still breathe. Faded rather than switched, over a time
     * constant long enough that a confidence hovering at the threshold reads as
     * nothing at all rather than as the composition changing its mind.
     */
    // `frame.locked` rather than a threshold tested here: the decision now has
    // hysteresis and belongs to the reactor, which is the only place that can
    // hold it consistently for the three consumers that used to derive it
    // independently. See `LOCK_RELEASE`.
    const locked = live && frame.locked ? 1 : 0;
    this.grid += (locked - this.grid) * coefficient(dt, LOCK_FADE);

    if (live) {
      /*
       * The bar position first, because the figure's mask is indexed by it —
       * `trackBar` calls `trackPhrase`, which decides which figure the next phrase
       * runs, and `beatMask` reads `this.barPhase` on the same frame. Set from a
       * stale value the mask would be a beat behind at every phrase boundary,
       * which is exactly one masked pulse landing in the wrong place per change.
       */
      this.barPhase = frame.barPhase;
      this.barCount = frame.barCount;
      /*
       * Before `trackBar`, which is where a new figure may be chosen — so a figure
       * arriving on this frame takes effect from the *next* beat rather than
       * part-way through the one already sounding. That is the whole of §22's
       * switch: at most one beat of the old pattern survives a change, and it
       * survives it intact. See `trackMask`.
       */
      this.trackMask();
      this.trackBar(frame, dt);
      this.trackStride(frame, dt);
      const position = frame.barCount + frame.barPhase;
      /*
       * The pulse, gated by the figure's mask — §20.
       *
       * Masked here, at the point the shape is generated, rather than at each of
       * the four places it is spent. That is what makes the mask a *rhythm* and
       * the routing gains an *orchestration*: every destination hears the same
       * pattern of accents and they differ only in how loudly they answer it,
       * which is the arrangement a band has and the one a bank of independently
       * gated channels does not.
       *
       * See `beatMask` for why multiplying a shape by a value that steps cannot
       * produce a step here.
       */
      const beat =
        pulseShape(frame.beatPhase, BEAT_PEAK, BEAT_RISE, BEAT_FALL) * this.beatMask();
      const bar = this.barShape(this.barPhase);
      // Two incommensurate periods, averaged: neither is visible as itself and
      // the sum does not come back for forty bars.
      const slow =
        0.5 *
        (swellShape(wrap01(position / BARS_PER_PHRASE)) +
          swellShape(wrap01(position / BARS_PER_PHRASE_ALT)));
      // A fraction of the beat rather than a fixed span — see `SHAPE_SMOOTH_BEATS`,
      // and note that this is the same argument `trackBar` already makes about the
      // gesture blend and `trackStride` about the glide. Everything on this path is
      // measured in music.
      const smooth = coefficient(dt, this.shapeSmoothing(frame.bpm));
      this.beatPulse += (beat - this.beatPulse) * smooth;
      this.barBreath += (bar - this.barBreath) * smooth;
      this.phrase += (slow - this.phrase) * coefficient(dt, LOCK_FADE);
    } else {
      const smooth = coefficient(dt, SHAPE_SMOOTH_MAX);
      this.beatPulse -= this.beatPulse * smooth;
      this.barBreath -= this.barBreath * smooth;
    }

    /*
     * How far the shapes travel. A floor, plus energy over the top, times the
     * phrase — so a locked run always breathes, a loud passage breathes harder,
     * and the whole response waxes and wanes on a period nobody can find.
     *
     * The floor carries `travel` explicitly because the swell already does: both
     * halves have to move with the dynamics or a chorus would only be able to
     * lift the part of the amplitude that the beat contributes, and the part
     * that is there simply for being locked would sit at its verse value
     * through it.
     *
     * Depth is applied here and only here on this path, which is what makes
     * `reactivity` a depth control rather than a smoothness control: turning it
     * down shortens the travel and leaves every time constant alone.
     */
    const swing = 1 - PHRASE_SWING + 2 * PHRASE_SWING * this.phrase;
    const wanted = clamp01(
      (SHAPE_FLOOR * travel + (1 - SHAPE_FLOOR) * this.swell) * swing
    );
    this.amplitudeBase += (wanted - this.amplitudeBase) * coefficient(dt, AMPLITUDE_TAU);
    /*
     * And the two terms this filter deliberately cannot pass, applied over it
     * rather than through it — §§3.2 and 3.5.
     *
     * The constant above is right and is also why every bar was the same size:
     * two seconds passes about 1% of the beat, which is what the hierarchy asks
     * for, and nearly as little of the bar. So the bar's own energy could not
     * reach the bar after it, and the run's whole geometry moved on a figure that
     * had not changed materially in ten seconds.
     *
     * `barGain` is latched once a bar and glides over the next; `wind` rises
     * across the last half of one. Both are outside the filter because that is
     * the only place they can be, and both are bounded and slow enough on their
     * own terms that being outside it costs no velocity — which is the whole
     * argument for them.
     */
    this.amplitude = clamp01(
      this.amplitudeBase * this.barGain * (1 + WIND_AMPLITUDE * this.wind)
    );

    /*
     * The fast channel, crossfaded on the lock exactly as `spread` is: the
     * generated beat pulse where the grid is believed, the swell where it is
     * not. Without the second half the whole fast row would go silent on
     * material the tracker cannot lock to — which is most of the material this
     * feature has to survive, and which used to have a trail pump.
     *
     * And crossfaded a second time, on `attack`, between the two generated
     * shapes: the pulse at 1 and the breath at 0. That is the axis §6 asks for,
     * and it is a *reroute* rather than a gain — at either end the colour, the
     * press and the trail pump travel about as far, and what changes is whether
     * they do it four times a bar or once. Turning this down cannot make the
     * feature quieter, which is the failure the single knob had.
     */
    const shaped = this.beatPulse * this.sharp + this.barBreath * FAST_BREATH * (1 - this.sharp);
    const energy = FAST_ENERGY_FLOOR + (1 - FAST_ENERGY_FLOOR) * this.sharp;
    this.fast =
      // The colour route scales only the generated half. The energy fallback is
      // what material the tracker cannot lock to has instead of a beat row, and
      // there is no figure running over it to have an opinion — `beatMask` and
      // every gain beside it are `grid`-gated by construction.
      shaped * this.amplitude * this.grid * this.routed("colour") +
      this.swell * energy * (1 - this.grid);

    // --- the accent ---------------------------------------------------------
    this.accentPeak *= Math.exp(-dt / ACCENT_RELEASE);
    this.sinceAccent += dt;
    if (live && frame.onset) {
      /*
       * An accent is an onset that stands out from the onsets around it, not
       * merely one that happened — measured against a running average rather
       * than an absolute number, because on a busy track every hit clears any
       * fixed bar and on a sparse one none of them do. The gap does the rest:
       * without it a loud passage promotes every hit in it, and the channel that
       * exists to be occasional becomes the pulse the breath already is.
       */
      /*
       * Closed entirely below `ACCENT_OPEN`, rather than scaled to nothing. The
       * accent is the sharpest thing in the feature — a 0.07s attack, against a
       * bar row measured in seconds — so it is the one channel `attack` does
       * switch off rather than reroute: there is no slow shape a hit can be
       * expressed as, and a crash spread over a bar is not a crash.
       */
      if (
        this.sharp > ACCENT_OPEN &&
        this.sinceAccent >= ACCENT_MIN_GAP &&
        frame.onsetStrength > this.onsetAverage * ACCENT_RATIO
      ) {
        this.sinceAccent = 0;
        this.accentPeak = clamp01(frame.onsetStrength) * depth * this.sharp;
        /*
         * The krackle reaches the highlights, so it is a flash request like any
         * other and the governor answers it. Asked once when the accent fires
         * rather than per frame: a refusal here means this accent stays in the
         * geometry and the trail, where it cannot brighten anything, and the
         * next one may light up instead.
         */
        this.accentFlash = this.lift > 0 && safety.requestFlash();
      }
      this.onsetAverage += (frame.onsetStrength - this.onsetAverage) * ACCENT_MEMORY;
    }
    /*
     * And the drop takes an accent on its own budget, outside the running average
     * and outside `ACCENT_MIN_GAP`.
     *
     * The average is what makes an accent mean "this hit stood out from the hits
     * around it", and a drop is precisely the case where there have been no hits
     * around it to stand out from — the low band has been gone for a bar or more,
     * so the thing the gate is measuring against is silence. It keeps `sharp`'s
     * switch, on §14's rule: there is no slow shape a hit can be expressed as,
     * and a viewer who has asked for no beat-rate detail has asked for this too.
     */
    if (this.arrivalCue > 0 && this.sharp > ACCENT_OPEN) {
      this.sinceAccent = 0;
      this.accentPeak = Math.max(
        this.accentPeak,
        this.arrivalCue * ARRIVAL_ACCENT * this.sharp
      );
      this.accentFlash = this.lift > 0 && safety.requestFlash();
    }
    const accentTau = this.accentPeak > this.accent ? ACCENT_ATTACK : ACCENT_RELEASE;
    this.accent += (this.accentPeak - this.accent) * clamp01(dt / accentTau);

    /*
     * One limiter over everything that can brighten the frame, and nothing
     * downstream may opt out of it — the same argument as the flash rate limit
     * and the fade floor. The bar breath is the fast half of what feeds it, and
     * at 0.5Hz a full swing takes about a second, so this sits well inside
     * `MAX_AUDIO_SLEW` and never binds in practice. That is the point: the
     * hierarchy is what keeps the frame safe, and the governor is the proof that
     * it has been followed rather than the mechanism enforcing it.
     */
    this.luma = safety.clampAudioDrive(
      Math.max(
        this.swell * (1 - this.grid),
        this.barBreath * this.amplitude * this.grid,
        // The wind-up lengthens the trail across a fill, which is a luminance
        // move like any other and goes through the one limiter like any other.
        this.wind * WIND_LUMA
      ),
      dt
    );

    /*
     * The handover — §3.1, and the only term here the composition reads about
     * itself rather than about the music.
     *
     * Taken from whichever path is carrying the frame, so it works on material
     * the tracker will not lock to as well: on the grid it is the amplitude the
     * shapes are travelling at, off it the swell. Followed slowly, because what
     * it retunes are the rates of integrated channels — a value that moved
     * quickly would bend the drift visibly, and there is nothing in the music
     * this has to keep up with.
     */
    /*
     * Scaled by the figure's own motion — §20, and the term that makes `swell`
     * read as the composition doing something else rather than as it stopping.
     *
     * The handover is how much of its *own* motion the composition stands down
     * while the music carries the frame. A figure that has taken the beat row away
     * is not carrying the frame, so standing the drift down through it would leave
     * a picture that is neither responding nor moving. Under `swell` this hands
     * most of the wander, the flight and the cycler's pace back.
     */
    const carrying = clamp01(
      // The figure scales the *grid* half only, the same way `colour` does one
      // row up. A figure is a statement about how the beat row is being spent,
      // and there is no beat row on material the tracker cannot lock to — folding
      // it into both halves would leave a run whose lock had dropped during
      // `swell` holding that figure's handover indefinitely, on a path the figure
      // has no say over.
      this.amplitude * this.grid * this.routed("motion") + this.swell * (1 - this.grid)
    );
    this.handover += (carrying - this.handover) * coefficient(dt, HANDOVER_TAU);

    if (live && frame.confidence > 0) {
      const bar = frame.barCount;
      if (this.lastBar < 0) this.lastBar = bar;
      if (bar !== this.lastBar) {
        // Weighted by how much the grid is believed, so an uncertain lock walks
        // the colour slowly rather than stepping it on a beat that may not be
        // there.
        this.hue += HUE_PER_BAR * frame.confidence * depth * this.hueDirection;
        // Turned at the ends rather than wrapped, so the colour this walk keeps
        // returning through is the page's own — see `HUE_RANGE`.
        if (Math.abs(this.hue) >= HUE_RANGE) {
          this.hue = Math.sign(this.hue) * HUE_RANGE;
          this.hueDirection = -this.hueDirection;
        }
        this.lastBar = bar;
      }
    }
  }

  /**
   * The audio pass over the post chain. Runs after the cycler and before
   * `Wander.settle`, so the music deepens whatever the other three passes
   * arrived at and the trail-against-symmetry governor still has the last word
   * over a channel that can move both.
   *
   * Read as three rows, and the rows are the whole design: what is on the fast
   * row cannot move the picture, what is on the bar row is slow enough to move
   * it a long way, and nothing crosses.
   */
  applyPost(post: PostParams): void {
    if (!this.active) return;

    // --- fast row: colour, tone, and the compounding trail -------------------
    // Neutral-point parameters, so additive: a deviation from neutral is the
    // only thing these can express and a multiply by neutral is a no-op.
    /*
     * The trail's stride: the beat's shape, the kick that actually landed, and
     * the wind-up across a fill. All three compound through the feedback buffer
     * rather than being applied once, which is what lets a term this small be a
     * large visible change with no on-screen velocity anywhere.
     */
    post.feedbackScale +=
      PUMP_SCALE * this.fast + KICK_SCALE * this.hitLow + WIND_SCALE * this.wind;
    /*
     * The trail's turn, faded out against the fold — the fast row's "this cannot
     * move the picture" argument is true of a trail and false of a *mirrored*
     * one.
     *
     * `feedbackRotate` is an angle applied to every tap of the feedback chain,
     * so it compounds down the trail into an arc, and under a kaleidoscope that
     * arc is drawn in every wedge at once. At full accent this is 0.004 a frame
     * against a fold turning at 0.02 a second — the trail sweeps an order faster
     * than the symmetry it is smearing, which `Wander.settle` calls a jolt
     * however smoothly it arrived, and which that governor only catches on
     * presets running the parameter drift. Folded presets that do not run it —
     * `fractal`, `mirror-mask` — were getting the whole of it.
     *
     * Faded rather than gated, so an unfolded frame keeps the gesture at full
     * size and a deep mirror keeps a tenth of it: the pump is a *turn*, and what
     * a turn is worth is exactly how much of the frame is not already defined by
     * one.
     */
    post.feedbackRotate += PUMP_ROTATE * this.accent * (1 - clamp01(post.kaleido));
    post.hueShift += this.hue + this.tide * 0.03 + HUE_BEAT * this.fast;

    // Always-on treatments, so multiplicative: a preset that turned one off
    // stays off.
    // The hat opens the colour: with the grain gone, `chroma` is the only
    // always-live parameter left that a top-band *event* can reach without
    // either moving the picture or waiting on `audioLift`.
    post.chroma *= 1 + CHROMA_BEAT * this.fast + CHROMA_TIDE * this.tide + HAT_CHROMA * this.hitHigh;

    /*
     * The press, lifted from zero — the one exception to the rule above, and
     * only ever as far as the config allows. See `MISREG_LIFT`.
     *
     * Plates slipping on the beat and ink spreading over the bar: neither can
     * flash, neither moves the picture, and both are what this engine's own
     * subject would do if it were being printed badly to music. Clamped, because
     * these are blend amounts rather than open scales.
     *
     * Gated on the lock as well as on the knob, and that matters more than it
     * looks. Every other binding here has an
     * energy fallback for material the tracker cannot lock to, and the press
     * deliberately does not: the swell carries a large DC term, so a press
     * lifted from it sits permanently a quarter out of register — measured at
     * 0.22 with no beat under it — which is not a response to music, it is
     * simply a misregistered frame. What is worth having is the press slipping
     * *on the beat*, and where there is no beat the honest answer is a clean
     * plate.
     */
    const press = this.lift * this.grid;
    if (press > 0.001) {
      /*
       * The plates slip on the beat's shape, on the snare that actually landed,
       * and again on the backbeat when the bar has one.
       *
       * The snare is the right place for a *lateral* artefact and the backbeat is
       * the right place for the largest of them: a press drifting sideways on two
       * and four is the most on-theme answer this engine has to popular music, it
       * cannot flash, and it does not move the picture. All three terms are
       * impulses over a level, so none of them carries the DC the press gate
       * below exists to keep out.
       */
      post.misreg = clamp01(
        post.misreg +
          MISREG_LIFT * press * this.fast +
          // The larger of the two, not their sum. A backbeat *is* a mid-band
          // onset, so both channels fire on the same hit, and adding them counts
          // one snare twice — measured, 537%/s on the plate against the 243%/s
          // the row was already running at. What the backbeat means is that this
          // particular snare is worth more, which is a stronger reading of one
          // event rather than a second event.
          press * Math.max(SNARE_SLIP * this.hitMid, BACKBEAT_SLIP * this.backbeat)
      );
      // On the slew-limited drive rather than the raw breath: a bleed dilates
      // the darks, so it moves frame luminance and belongs with the trail.
      post.bleed = clamp01(post.bleed + BLEED_LIFT * press * this.luma);
    }
    /*
     * The krackle is outside that gate, and deliberately: the DC argument above
     * is about the two channels that carry a *level*, and an accent is an
     * impulse with no level at all. A crash landing on a drone the tracker will
     * never lock to is still a crash, and punctuation is the one thing material
     * without a beat can still be given.
     */
    if (this.lift > 0 && this.accentFlash) {
      post.krackle = clamp01(post.krackle + KRACKLE_LIFT * this.lift * this.accent);
    }

    // --- bar row: the geometry ----------------------------------------------
    post.feedbackAmount *= 1 + TRAIL_DEPTH * this.luma;
    post.bloom *= 1 + BLOOM_DEPTH * this.luma;
    post.vignette += VIGNETTE_DEPTH * this.luma;

    /*
     * The distortions, every one of which is 0 unless a preset asked for it.
     * Multiplying is the whole point: the music may push a fold the piece is
     * already running and may never introduce one it is not. Deliberately not
     * the reparameterisations — droste, tunnel, julia — which decide what the
     * frame *is* rather than how far it is pushed, and which read as the picture
     * being replaced rather than modulated when they move.
     */
    /*
     * And the shape route over the top of it — §20, the only beat-rate content
     * this feature has ever put into the geometry, and open under one figure of
     * six. See `SHAPE_BEAT`.
     */
    const geometry =
      1 + GEOMETRY_DEPTH * this.spread(4) + SHAPE_BEAT * this.routed("shape") * this.beat;
    post.bulge *= geometry;
    post.twist *= geometry;
    post.ripple *= geometry;
    post.pond *= geometry;
    post.warp *= geometry;
    post.disperse *= geometry;

    /*
     * The fold, which is the one member of that list that does not scale — and
     * multiplying it was a defect rather than a matter of degree.
     *
     * Every other distortion above is an open scale with a neutral point at
     * zero, so a gain of 1.5 is half again as much of it. `kaleido` is a *blend*
     * — the shader runs `mix(uv, folded, kaleido)` — so 1 is the whole mirror and
     * there is nothing past it. A preset that authored 0.9 was being handed 1.35
     * on every bar, and a mix factor over 1 does not deepen anything: it
     * extrapolates along the chord from the pixel to its own reflection, which
     * leaves the frame neither folded nor unfolded, non-injective near the
     * seams, and swinging through that state once a bar. That is what a
     * kaleidoscope preset under music was doing, and it is why it read as
     * spastic rather than as deep.
     *
     * Spent in the headroom instead. The deviation the multiply asked for is
     * scaled by how much room is left above the authored fold, so it agrees with
     * the old arithmetic wherever the old arithmetic was sane — a fold of 0.26
     * still swells to about 0.36 — and saturates smoothly instead of clipping
     * where it was not. The bound is arithmetic rather than a clamp: the added
     * term is at most `0.5 * k * (1 - k)`, which peaks at an eighth, so this can
     * never reach 1 and there is no corner in the trajectory for a governor to
     * have to smooth.
     *
     * On the grid rather than on `spread`, and that is the other half of the
     * complaint. `spread` crossfades to the energy path where the tracker has no
     * lock, and the energy path is a delayed envelope with no phase in it — so
     * an unlocked run was restructuring the frame *near* the music without ever
     * landing on it, which is a worse reading than not moving at all. Same
     * judgement the press family already makes: where there is no beat, the
     * honest answer is to leave the mirror where the composition put it.
     */
    const fold = clamp01(post.kaleido);
    post.kaleido = fold + fold * GEOMETRY_DEPTH * this.onGrid(4) * (1 - fold);
  }

  reset(): void {
    this.grid = 0;
    this.beatPulse = 0;
    this.barBreath = 0;
    this.phrase = 0.5;
    this.barPhase = 0;
    this.strideAngle = 0;
    this.strideMark = -1;
    this.strideFromX = 0;
    this.strideFromY = 0;
    this.strideToX = 1;
    this.strideToY = 0;
    this.strideBlend = 1;
    this.amplitudeBase = 0;
    this.amplitude = 0;
    this.fast = 0;
    this.sharp = 1;
    this.gesture = "breath";
    this.previousGesture = "breath";
    this.gestureBlend = 1;
    this.barEnergy = 0;
    this.barHats = 0;
    this.barLowFlux = 0;
    this.barAllFlux = 0;
    this.barFill = 0;
    this.barLatch = 0;
    this.barReference = 0;
    this.barGain = 1;
    this.barMark = -1;
    this.figure = "drive";
    this.previousFigure = "drive";
    this.maskFigure = "drive";
    this.maskCell = 0;
    this.figureBlend = 1;
    this.figureMark = -1;
    this.figureCue = false;
    this.sinceRest = 0;
    this.soloSlot = 0;
    this.resetPhrase();
    this.sectionCue = 0;
    this.sectionBase = 1;
    this.sinceSection = 0;
    this.arrivalCue = 0;
    this.sinceArrival = ARRIVAL_GAP;
    this.hitLow = 0;
    this.hitMid = 0;
    this.hitHigh = 0;
    this.backbeat = 0;
    this.wind = 0;
    this.handover = 0;
    this.swell = 0;
    this.baseline = 0;
    this.tonal = 0;
    this.tonalBase = 0;
    this.dynamics = 1;
    this.shimmer = 0;
    this.tide = 0;
    this.history.fill(0);
    this.write = 0;
    this.frameDt = 1 / 60;
    this.accent = 0;
    this.accentPeak = 0;
    this.sinceAccent = ACCENT_MIN_GAP;
    this.onsetAverage = 0;
    this.accentFlash = false;
    this.luma = 0;
    // Back to the page's own colour, which is where a run starts.
    this.hue = 0;
    this.hueDirection = 1;
    this.lastBar = -1;
    this.lift = 0;
  }
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
