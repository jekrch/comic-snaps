import type { Panel } from "../../../types";
import type { DeviceCaps, StageMode, VizConfig } from "../vizConfig";
import { MODE_HANDOVER_CLOCK, effectiveAttack } from "../vizConfig";
import { cosineDistance, loadEmbeddings, paletteDistance } from "../../../utils/sorting";
import type { EmbeddingMap } from "../../../utils/sorting";
import type { Rng } from "./rng";
import { EffectCycler } from "./EffectCycler";
import { SafetyGovernor } from "./safety";
import { Stage, stageResidency } from "./Stage";
import { Wander } from "./Wander";
import { JULIA_WRAP, juliaEfoldsPerTurn } from "./julia";
import { POND_CYCLE } from "./shaders/post";
import type {
  DrawShard,
  PostParams,
  Shard,
  StageKind,
  VizFrame,
  VizHandover,
  VizPhases,
} from "./types";
import { resolveShard, shardEnd } from "./types";
import { CAST_FLOOR, rankCast } from "./cast";
import { chromaticDominant, complement, labToRgb, normalizeTint } from "./palette";
import type { Lab, Rgb } from "./palette";
import { driftStack } from "./scenes/driftStack";
import type { Affinity, Scene } from "./scenes/types";
import type { AudioFrame } from "./AudioReactor";
import { AudioBinding } from "./audioBind";
import type { AudioProbe } from "./audioTrace";
import { TempoLock } from "./tempoLock";

/** A panel plus the reason it was chosen, so presets can react to it. */
interface Pick {
  panel: Panel;
  affinity: Affinity;
}

/** Incommensurate rates, so the modulations never visibly re-align. */
const TAU = Math.PI * 2;

export const LFO_HZ = [0.037, 0.0611, 0.0893, 0.1307];

/**
 * The hue excursion — how far the frame's colour may travel from the page's,
 * in turns, before `colorFidelity` scales it down.
 *
 * This used to be a flat `lfo(time, 0) * 0.12` added to `hueShift` on every
 * frame of every preset, and it is the reason the piece never looked like the
 * artwork. A sine spends very little of its life near zero: measured over two
 * hours with nothing else running, that term alone put the median frame 31°
 * from the printed colour and only a sixth of the run inside 12° of it. The
 * frame's resting state *was* a rotation, so nothing could read as a departure
 * from anything.
 *
 * So the swing is windowed rather than shrunk. Its amplitude is gated by a much
 * slower oscillation which is shut most of the time, and what comes out is a
 * frame that states the page's own colour, drifts off it for a while every
 * couple of minutes, and comes back. Same gesture, made an event.
 */
export const HUE_SWING = 0.12;
/** Rate of the window that gates it — a little over two minutes a cycle. */
export const HUE_WINDOW_HZ = 0.0075;
/**
 * How far up the window's own sine the gate sits. At 0.7 it is open for under a
 * quarter of each cycle and at full width for none of it, so an excursion is a
 * slow arrival and departure rather than a state the piece switches into.
 */
export const HUE_WINDOW_GATE = 0.7;

/**
 * Chroma either side of which a page counts as grey or as coloured, in Lab
 * units — the window the complement tint is faded across.
 *
 * The tint exists so that overlapping layers go chromatic instead of settling
 * into grey, and against a monochrome page it is the only chroma in the frame.
 * Against a printed comic it is the opposite: the page arrives with more colour
 * than the tint could give it, and all the complement does there is argue with
 * the artist. So it is applied in proportion to how much colour the page has
 * *not* got, and `colorFidelity` decides how completely a coloured one is
 * spared.
 *
 * The ends are measured off the panel palettes rather than picked: newsprint
 * greys and inked blacks sit under 8, and a flat four-colour fill lands between
 * 40 and 70.
 */
const TINT_GREY = 8;
const TINT_COLOURED = 45;

/**
 * Rate the flow field's heading turns when the parameter drift is not supplying
 * one, cycles per clock second. A minute and a half for the current to come back
 * round, which is slower than any of the LFOs above: this decides which way the
 * whole frame smears, and it is the one derived value here that a viewer would
 * read as the piece changing direction rather than as it breathing.
 */
const FLOW_HEADING_HZ = 0.011;

/**
 * Rate the Julia frame drifts across its own fixed point, radians of the slower
 * of its two components per clock second. A circuit in a little over three
 * minutes — an order under the flight it is carried on, so the drift reads as
 * where the travel is happening rather than as a second travel (§6).
 */
const JULIA_DRIFT_RATE = 0.031;

/**
 * How large a section cue turns the whole composition over, 0..1.
 *
 * The section row of `docs/visualizer-audio-reach.md` §2 is the only one whose
 * gestures are discrete, and this is the largest of them: every page on screen
 * crossing over at once because the music just changed. The bar is high on
 * purpose — the cue's own floor is one every twenty seconds, and a page turn is
 * worth rather less than that often — so the small half of every cue is spent on
 * the cycler alone and only a real arrival moves the panels.
 *
 * The cue arrives already scaled by `reactivity`, so this bar is also what makes
 * depth mean something to a gesture that has no depth: under about 0.6 the
 * largest move in the feature stops happening at all, and the cycler cue — which
 * has no threshold — carries the row on its own.
 */
const SECTION_TURNOVER = 0.6;

/**
 * How long a turnover waits for the page it is turning to, in clock seconds.
 *
 * Everything else the composition brings up has lead time by construction: a
 * queued pick has been sitting in the prefetch since the handover before it, and
 * a stage slot is bound most of a dwell before its fade-in starts. A turnover is
 * the one gesture with none — it retires the whole frame *now* and asks for a
 * panel chosen on the same frame — so it is the one that has to be told to hold
 * on. See `settleTurnOver`.
 *
 * Bounded, because a panel that will not decode must not be able to stop the
 * composition turning over at all. Past this the turn happens regardless and the
 * incoming page arrives when it arrives, which is exactly what every turnover
 * did before this existed.
 */
const TURNOVER_WAIT = 3;

/** Hermite ramp between two edges, the shader's own. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How many panels to avoid repeating, capped against small filtered sets. */
function recentWindow(count: number): number {
  return Math.max(2, Math.min(24, Math.floor(count / 2)));
}

/**
 * Where every integrated rate stands when the run opens.
 *
 * Zero for all of them would be defensible and was what this did, but it makes
 * the first minute of every run the same first minute: the same wedge of the
 * fold pointing the same way, the same face of the prism toward the camera, the
 * same stretch of corridor, and — since the seed of the Julia set is read off
 * one of these — the same fractal every time. None of that is what the seed is
 * for. A phase is an offset into something that repeats, so starting anywhere in
 * it is free: nothing here has a preferred origin, and no value is any more
 * valid than another.
 *
 * The ranges are one full repeat of whatever the phase means, which is a turn
 * for the angles, a stride for the log-radius, and a page or two of travel for
 * the corridor.
 */
function openingPhases(rng: Rng): VizPhases {
  return {
    // Cycles of the pull-back's breath, and a whole one is the round trip. Free
    // like the angles below it: a run may open on a closed frame, on the grid
    // wide open, or anywhere on the way between.
    pane: rng.range(0, 1),
    kaleido: rng.range(0, TAU),
    // Which way the slide is pushing when the run opens. Free like the angles
    // around it: every direction is the same circulation caught elsewhere.
    mobius: rng.range(0, TAU),
    // Where the light stands when the run opens.
    relief: rng.range(0, TAU),
    // Cycles of ring travel, and a whole POND_CYCLE of them is the round trip
    // the wrap is taken against.
    pond: rng.range(0, POND_CYCLE),
    // Log-radii, and the widest stride a preset can ask for is 3.
    droste: rng.range(0, 3),
    fold: rng.range(0, TAU),
    // Depth down the tube, where a whole ring is 1.
    tunnel: rng.range(0, 1),
    // Which set the run opens on. The one phase here that decides what the
    // picture *is* rather than merely where it is pointing.
    julia: rng.range(0, TAU),
    // Preimages into the flight, and the whole span of the wrap is legal: every
    // value of it is a different point of the same endless descent.
    juliaTravel: rng.range(0, JULIA_WRAP),
    // Where across the set the frame opens. Free, like the travel above: every
    // point of the drift is the same descent seen from somewhere else.
    juliaDrift: rng.range(0, TAU),
    // World units. A page on the vault's wall is about eleven of them.
    travel: rng.range(0, 22),
    orbit: rng.range(0, TAU),
    swell: rng.range(0, TAU),
  };
}

/**
 * Picks what appears, when, and next to what.
 *
 * Selection is weighted rather than random (§4): most new layers are a near
 * neighbour of something already on screen, which is what makes superimposed
 * panels read as a deliberate composition instead of mud. The rest of the
 * weight buys variety — a deliberate clash, a colour-led step, a wildcard.
 */
export class Director {
  private readonly panels: Panel[];
  private readonly byId = new Map<string, Panel>();
  private readonly recent: string[] = [];
  private readonly upcoming: Pick[] = [];
  private shards: Shard[] = [];
  private embeddings: EmbeddingMap | null = null;
  private scene: Scene = driftStack;
  private spawnCount = 0;
  private nextShardId = 1;
  private lastBeat = -1;
  private seeded = false;
  /** Whether the next pick should deliberately cut against what is on screen.
   *  Armed by a structural cue and consumed by the pick it applies to — see
   *  `spendSection`. */
  private contrastNext = false;
  /** The panel the run is locked onto, or null while it is free-running. */
  private focus: Panel | null = null;
  /**
   * Whether a panel's texture is on the GPU and would draw if it were asked
   * for — the backend's own answer, handed down by the engine.
   *
   * The composition is otherwise entirely indifferent to decoding, and that is
   * the right default: a layer that is not drawable yet is simply skipped and
   * appears a frame or two later, and every path that brings one up has enough
   * lead time for that to be invisible. The one exception is `turnOver`, which
   * has no lead at all — hence this. Optimistic until the engine says otherwise,
   * so a director tested without a backend behaves exactly as it used to.
   */
  private drawable: (panelId: string) => boolean = () => true;
  /**
   * Clock time a turnover was asked for and has not been able to happen yet, or
   * -1 while none is waiting. See `TURNOVER_WAIT`.
   */
  private turnArmedAt = -1;
  private aspect = 1;
  private lastClock = -1;
  private readonly phases: VizPhases;
  /**
   * Whether the backend can draw a formation at all. The CSS fallback cannot —
   * there is no perspective in `mix-blend-mode` — so a spatial preset degrades
   * to the drift stack there rather than to a blank frame. Gated in the
   * director, not the backend, because the choice affects *selection*: a stage
   * holds a dozen panels resident and the flat path holds four.
   */
  private spatial = true;
  /**
   * The crossing between the two paths — see `syncStage` and `VizHandover`.
   *
   * `swapArmed` is the one frame the outgoing path is held for so the backend
   * can take its still; `swapAt` is the clock time the swap then happened, and
   * -1 while nothing is crossing. `coveredSeed` says the flat stack about to be
   * seeded is the incoming side of one, and is spent by that seeding.
   */
  private swapArmed = false;
  private swapAt = -1;
  private coveredSeed = false;
  /**
   * A path the run has been told it is about to switch to, ahead of the config
   * arriving. Only the queue depth reads it — see `fillUpcoming`.
   */
  private expecting: StageKind | null = null;
  /** Kept for `stageResidency`, which is how deep the queue has to be for an
   *  arriving formation to be decoded by the time it is built. */
  private readonly caps: DeviceCaps;

  readonly safety = new SafetyGovernor();
  /** Forked lazily — see the note on EffectCycler about seeds replaying. */
  private readonly cycler = new EffectCycler(() => this.rng.fork(), this.safety);
  /** Same contract: inert, and untouched by the rng, until a preset asks. */
  private readonly wander = new Wander(() => this.rng.fork());
  /** Same again: built empty, and only ever draws once a spatial preset runs. */
  private readonly stage: Stage;
  /** Inert until the run is given a listener, like everything else here that
   *  answers to something outside the seed. */
  private readonly audio = new AudioBinding();
  /** The composition's own durations, put in tempo. See `tempoLock.ts`. */
  private readonly tempo = new TempoLock();
  /** The reach readout, when something is watching. See `setAudioProbe`. */
  private probe: AudioProbe | null = null;
  /** The last analysed frame, handed down by the engine. Null unless the run is
   *  listening, which is the default and the common case. */
  private audioFrame: AudioFrame | null = null;

  constructor(
    panels: Panel[],
    private config: VizConfig,
    private readonly rng: Rng,
    caps: DeviceCaps
  ) {
    this.stage = new Stage(caps);
    this.caps = caps;
    // Off a forked stream rather than the main one, on the cycler's principle:
    // one draw here, and everything downstream keeps the sequence it would have
    // had. The run is still exactly reproducible from its seed — what changes is
    // that two runs with different seeds no longer open on the same frame.
    this.phases = openingPhases(rng.fork());
    // Blurred panels are gated behind an explicit tap on the wall and a
    // screensaver has no equivalent gesture, so they never surface here (§7).
    this.panels = panels.filter((panel) => !panel.blur);
    for (const panel of this.panels) this.byId.set(panel.id, panel);

    void loadEmbeddings("embedding-siglip").then((map) => {
      if (Object.keys(map).length > 0) this.embeddings = map;
    });
  }

  setConfig(config: VizConfig): void {
    this.config = config;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  /** Handed the current analysis, or null when the run is not listening. */
  setAudioFrame(frame: AudioFrame | null): void {
    this.audioFrame = frame;
  }

  /**
   * Attach the reach readout, or detach it.
   *
   * Null unless the tuning panel is open, so a run nobody is measuring pays
   * nothing for this — the same rule the reactor follows about not opening a
   * device until asked.
   */
  setAudioProbe(probe: AudioProbe | null): void {
    this.probe = probe;
  }

  /** Told by the engine which backend it got. */
  setSpatialSupported(supported: boolean): void {
    this.spatial = supported;
  }

  /** Attach the backend's readiness answer. See `drawable`. */
  setDrawableProbe(probe: (panelId: string) => boolean): void {
    this.drawable = probe;
  }

  /**
   * A path the run is about to be switched to, told at the moment the reader
   * asks rather than when the ramp delivers it.
   *
   * The config crosses over its midpoint, so the director would otherwise learn
   * that a formation is wanted on the same frame it has to build one — and a
   * formation needs its whole residency decoded at once. This is the only thing
   * in the engine that gets to know about a switch early, and all it is allowed
   * to do with the knowledge is fetch: what arrives, and when, is still decided
   * by the config crossing like everything else.
   */
  expectStage(kind: StageMode): void {
    const wanted = kind === "flat" ? null : kind;
    this.expecting = wanted === this.stage.kind ? null : wanted;
  }

  get panelCount(): number {
    return this.panels.length;
  }

  get sceneName(): string {
    return this.stage.active ? this.stage.name : this.scene.name;
  }

  /** Panels worth having resident soon — the engine hands these to the pool. */
  prefetch(): Panel[] {
    // A stage's bound panels are wanted every frame it is on screen, not just
    // when they were chosen: it holds a dozen at once, which is most of the
    // pool, so leaving them out would let the prefetch evict a live slot.
    const resident = this.stage.active ? this.stage.wants() : [];
    // Held, there is nothing upcoming to fetch — every layer that is born from
    // here carries the one panel — and asking for a pick would only churn the
    // recency window against a selection that is not being made.
    if (this.focus) return [this.focus, ...resident];
    this.fillUpcoming();
    return [...resident, ...this.upcoming.map((pick) => pick.panel)];
  }

  /**
   * Lock the composition onto one panel, or let it run on.
   *
   * A held run is not a stopped one: layers are still born, still drift, and
   * the post chain still breathes — they all just carry the same panel, so the
   * frame keeps moving while the imagery stays put. That is the distinction
   * worth keeping against the speed control's floor and against an outright
   * pause: a screensaver that freezes is off, and one that will not settle is
   * no way to look at a panel.
   *
   * Locking turns the frame over onto the new panel rather than waiting for the
   * layers already in flight to expire, which on a slow preset is most of a
   * minute — far too long to read as the answer to a keypress.
   */
  setFocus(panel: Panel | null): void {
    if (this.focus?.id === panel?.id) return;
    this.focus = panel;
    // Picks made against the old anchor describe a composition that is about to
    // be replaced.
    this.upcoming.length = 0;
    // Whatever the music had asked for is answered by this — the reader has just
    // said what the frame is turning to.
    this.turnArmedAt = -1;
    if (panel) this.armTurnOver();
  }

  /**
   * Turn the frame over onto one panel and carry on choosing after it.
   *
   * The step controls' half of `setFocus`: the same crossfade onto a panel the
   * reader asked for, without the lock. Stepping used to park the run because a
   * step that let it carry on would be over before the panel had arrived — but
   * parking is what a *hold* is for, and a reader who wanted a particular page
   * should not have to un-park to get the run back. The panel is queued at the
   * head of the upcoming picks rather than held as the answer to all of them,
   * so it is what the turnover crosses to and the composition resumes its own
   * selection from there.
   *
   * Ignored while the run is held: the focus is the answer to every request for
   * a panel, so a queued pick would sit unread behind it.
   */
  turnTo(panel: Panel): void {
    if (this.focus) return;
    this.queueTurn({ panel, affinity: "random" });
  }

  /**
   * A step forward on a free-running composition: the director's own next
   * choice, turned onto rather than waited for.
   *
   * A fresh choice on every call, and not the one `nextPick` is showing —
   * pressing next twice before the first crossfade has landed has to be two
   * pages, not the same page aimed at twice.
   */
  stepForward(): Panel | null {
    if (this.focus) return null;
    this.upcoming.length = 0;
    const pick = this.pickPanel();
    if (!pick) return null;
    this.queueTurn(pick);
    return pick.panel;
  }

  /**
   * Move the post-processing on by hand: whatever the cycler is running goes,
   * and its next draw arrives in its place.
   *
   * Sits beside `stepForward` as the other half of what the transport can ask
   * for. A step changes the *page*; this changes the *treatment*, and they are
   * genuinely separate gestures — the run puts a new panel up every few seconds
   * and stays inside one movement of effects for minutes, so a reader who is
   * tired of the look has nothing else to press.
   *
   * Not gated on the hold, unlike the panel steps. Holding parks the panel and
   * exists so the composition can carry on drifting around one page; the
   * effects are the drift, and freezing them would be the hold doing something
   * nobody asked it to.
   */
  nextEffect(): void {
    this.cycler.advance();
  }

  /** Put one pick at the head of the queue and cross to it. Picks made before
   *  it describe a composition it has just replaced, the same reason
   *  `setFocus` drops them. */
  private queueTurn(pick: Pick): void {
    this.upcoming.length = 0;
    this.upcoming.push(pick);
    // So the run does not choose it straight back out of the recency window.
    this.remember(pick.panel.id);
    // Whatever was already waiting was waiting on a panel this replaces.
    this.turnArmedAt = -1;
    this.armTurnOver();
  }

  /**
   * The panel the run would bring up next — its own weighted choice, left in
   * place rather than consumed.
   *
   * This is what a step forward past the newest thing seen lands on, so that
   * stepping ahead is the composition brought forward rather than a jump to
   * somewhere it was never going: the rhyme and clash policies still choose it,
   * off the panel being stepped away from.
   */
  nextPick(): Panel | null {
    this.fillUpcoming();
    return this.upcoming[0]?.panel ?? null;
  }

  /**
   * Ask for a turnover, and take it as soon as the page it turns to can be
   * drawn.
   *
   * Nothing else in the engine has to care whether a panel has decoded, because
   * nothing else brings one up without lead time — a queued pick has been in the
   * prefetch since the handover before it, and a stage slot is bound most of a
   * dwell before its fade-in begins. A turnover has none: it retires everything
   * on screen *on this frame* and hands the frame to a panel chosen on the same
   * one, which by construction has not been fetched yet.
   *
   * So the frame emptied on the cue and the incoming page arrived whenever the
   * network answered — a second of black on a fast preset, where the outgoing
   * fade is the `MIN_FULLBLEED_FADE_CLOCK` floor and a cold panel is a round trip
   * away. What the viewer saw was the composition dropping out at exactly the
   * moment the music changed, which is the one moment it is most obviously
   * *about* the music.
   *
   * The wait is the whole fix. The pick is made now — so it is queued, requested
   * and decoding now — and the retirement it triggers is held until there is
   * something to cross to.
   */
  private armTurnOver(): void {
    // Already waiting on one, or nothing has been drawn for one to turn over —
    // the same case `turnOver` itself no-ops on, and the first layer born picks
    // the composition up.
    if (this.turnArmedAt >= 0 || this.lastClock < 0) return;
    this.turnArmedAt = this.lastClock;
    this.settleTurnOver();
  }

  /** Take an armed turnover once its page is drawable, or once it has waited
   *  long enough that waiting further is worse than arriving late. */
  private settleTurnOver(): void {
    if (this.turnArmedAt < 0) return;
    // What the frame is about to be handed to: the held panel, or the pick the
    // retirement will be crossed against. Null is a wall with nothing eligible
    // in it, which is not something waiting can fix.
    const next = this.focus ?? this.nextPick();
    const waited = this.lastClock - this.turnArmedAt;
    if (next && !this.drawable(next.id) && waited < TURNOVER_WAIT) return;
    this.turnArmedAt = -1;
    this.turnOver();
  }

  /**
   * Put everything on screen into its fade and bring the held panel up against
   * it. Both paths get the same treatment, so a step is one gesture whichever
   * preset is running — a crossfade, not a cut.
   */
  private turnOver(): void {
    // Nothing has been drawn yet, so there is nothing to turn over: the focus
    // will be picked up by the first layer born.
    if (this.lastClock < 0) return;
    if (this.stage.active) {
      // The stage takes its panels from `pick` on the frames its slots expire,
      // which retiring them has just arranged for.
      this.stage.retire(this.lastClock);
      return;
    }
    for (const shard of this.shards) {
      if (shard.retiredAt === undefined) shard.retiredAt = this.lastClock;
    }
    // One layer now, against the outgoing fade. The rest of the target count
    // fills in on the beats that follow, which is also what keeps them
    // staggered rather than turning the whole stack over together later.
    this.spawn(this.lastClock);
  }

  /**
   * The panels currently carrying the frame, most prominent first — the stack
   * the pinned label shows, and whose head is the attribution line.
   *
   * Weight is opacity scaled by how much of the frame the layer covers, summed
   * per panel: a panel is more present for being large, and more present again
   * for being on screen twice. The area is rooted so that size informs the
   * order without deciding it outright — a small, bright, front-and-centre crop
   * is what a reader is looking at, whatever is spread out behind it.
   */
  cast(time: number, limit: number, incumbents: string[] = []): Panel[] {
    if (this.stage.active) return this.stage.cast(time, limit, incumbents);
    const scores = new Map<string, number>();
    for (const shard of this.shards) {
      const draw = resolveShard(shard, time);
      if (draw.opacity <= CAST_FLOOR) continue;
      const area = Math.max(0, draw.dstRect.w * draw.dstRect.h);
      const weight = draw.opacity * Math.sqrt(area);
      scores.set(shard.panelId, (scores.get(shard.panelId) ?? 0) + weight);
    }
    return rankCast(scores, incumbents, limit, (id) => this.byId.get(id) ?? null);
  }

  /**
   * Spend the section cue, if the music raised one this frame — the row §2 of
   * the reach document lists and nothing has ever driven.
   *
   * Both timescales below it move *parameters*, because a parameter is a thing
   * that can be a little bit moved. A section is not: what the music did was
   * change, and the composition's answer to that is to change too. So the two
   * consumers here are the only genuinely discrete gestures the engine has — a
   * new effect arriving out of turn, and the pages turning over — and neither is
   * given any say in *what* arrives, only in when.
   *
   * A held run is exempt from the turn: every layer it spawns carries the same
   * panel, so turning it over would be a crossfade from a page to itself.
   */
  private spendSection(): void {
    /*
     * Two cues, spent the same way and detected on completely different
     * evidence — see `AudioBinding.arrival`. The section row compares two
     * averages of the run's dynamics twenty seconds apart; the arrival is the
     * low end coming back after a break, and it resolves to the frame it happens
     * on. Whichever is larger decides how much is spent.
     *
     * An arrival counts for more than its own size, because what it is is
     * better evidence: a drop is an event the composition can be *sure* about,
     * where a section is a slow figure crossing a threshold. So it clears the
     * turnover bar on its own.
     */
    const section = Math.max(this.audio.section, this.audio.arrival);
    if (section <= 0) return;
    this.cycler.cue();
    if (section >= SECTION_TURNOVER || this.audio.arrival > 0) {
      /*
       * And the one place the music is allowed a say in *what* arrives — §3.6 of
       * `docs/visualizer-audio-attribution.md`, and a deliberately narrow
       * exception to a rule this codebase has now held three times.
       *
       * The rule is that audio decides when, never what, and it protects the
       * director's editorial judgement: a kick drum must not be able to choose a
       * panel. This does not choose one. It says that the *next* choice should
       * be a contrast, and leaves the existing weighted selection to make it —
       * "the music decided this one should be different" rather than "the music
       * decided which one". That is a much weaker claim and it buys nearly all
       * of the attribution, because a page visibly changing on the drop is
       * legible to anyone in the room without their having to attend to it.
       */
      // Cleared, or the flag would arm a pick two ahead of the one that is about
      // to arrive: `fillUpcoming` runs a queue of two, so the layer this cue
      // spawns is chosen from a decision made before the music changed. A
      // discarded pick costs a slot in the recency window and nothing else.
      //
      // Except while a turnover is already waiting on its page to decode, where
      // clearing would throw away the very panel the wait is for and start its
      // fetch again from nothing — the cue this cleared for has already been
      // answered, and the answer is in flight.
      if (this.turnArmedAt < 0) {
        this.upcoming.length = 0;
        this.contrastNext = true;
      }
      if (!this.focus) this.armTurnOver();
    }
  }

  update(time: number, dt: number): VizFrame {
    // Composition seconds since the last frame, as distinct from `dt`, which is
    // real time. The drift is part of the piece, so it follows the speed
    // control; the safety governor is not, so it does not.
    const clockDt = this.lastClock < 0 ? 0 : Math.max(0, time - this.lastClock);
    this.lastClock = time;
    /*
     * The drift, at whatever rate the music has left it — §3.1 of
     * `docs/visualizer-audio-attribution.md`.
     *
     * Attribution is a ratio, and every previous round of this feature has only
     * ever moved its numerator. The wander, the cycler, the layer churn and the
     * spatial flight all keep their authored amplitude while the music plays, so
     * the audio contribution is a minority share of the motion on screen and the
     * eye attributes causation to whatever dominates. This is the composition
     * handing over the margin while the music is carrying the frame.
     *
     * Read one frame late, which is what letting it read `this.audio` before the
     * update below would cost anyway and is worth naming: at `HANDOVER_TAU` of
     * 1.2s a frame of lag is nothing, and the alternative is ordering the two
     * passes by a dependency that does not otherwise exist.
     */
    const autonomy = this.audio.autonomy;
    this.wander.update(
      clockDt,
      this.config.wander,
      this.config.wanderRate * autonomy,
      this.tempo
    );
    // Real `dt`, not the clock: the music does not follow the speed control.
    this.audio.update(
      this.audioFrame,
      this.config.reactivity,
      // Capped here rather than in the binding, because it is a property of the
      // reader rather than of the composition: a preset, a link and a slider all
      // arrive through the config, and none of them may raise this past what
      // somebody's own machine has asked for.
      effectiveAttack(this.config.attack),
      this.config.audioLift,
      dt,
      this.safety
    );
    this.spendSection();
    // Whatever is waiting on a page to decode, taken on the first frame it can
    // be. Every frame rather than only on the cue: what the wait is for is the
    // decode landing, and that lands on a frame of its own.
    this.settleTurnOver();
    // Real `dt` for the same reason the update above takes it: the trace is
    // measured in wall-clock seconds, so a run at 2× speed still reports the
    // rates the viewer's eye is actually subject to.
    this.probe?.observe(this.audioFrame, dt);
    /*
     * Real `dt` again, but `timeScale` too: what this holds is a *clock*
     * duration, and the speed control scales every duration in the composition
     * together. A viewer at 2x covers a bar of music in half a bar of clock, so
     * the durations that should match the music are half as long.
     */
    this.tempo.update(this.audioFrame, this.config.reactivity, this.timeScale, dt);
    this.syncStage();

    if (this.panels.length === 0) {
      const post = this.safety.apply(this.config.post, dt);
      return {
        time,
        shards: [],
        stage: null,
        handover: this.handover(time),
        background: [0, 0, 0],
        post,
        phases: this.advancePhases(post, clockDt),
        flowAngle: this.flowHeading(time),
      };
    }

    if (this.stage.active) {
      const post = this.safety.apply(this.modulatePost(time, clockDt), dt);
      // Advanced before the formation is placed, not after — the flight and the
      // turn are read straight out of these, so a stale phase would draw this
      // frame at the last one's position.
      const phases = this.advancePhases(post, clockDt);
      return {
        time,
        shards: [],
        stage: this.stage.update(
          time,
          phases.travel,
          phases.orbit,
          phases.swell,
          this.config,
          this.currentTint(this.stage.wants()),
          this.safety,
          () => this.takeUpcoming()?.panel ?? null
        ),
        handover: this.handover(time),
        background: [0, 0, 0],
        post,
        phases,
        flowAngle: this.flowHeading(time),
      };
    }

    this.shards = this.shards.filter((shard) => time < shardEnd(shard));

    const target = Math.max(1, Math.round(this.config.layerCount));

    if (!this.seeded) {
      this.seeded = true;
      // Stagger the initial births across one lifetime so the first crossfade
      // is not every layer turning over at once.
      for (let i = 0; i < target; i++) {
        this.spawn(time, ((target - 1 - i) / target) * 0.9);
      }
      // Spent by the stack it described, so the layers born on every beat after
      // this one open the way they were authored to.
      this.coveredSeed = false;
    } else {
      // Births are discrete events, so they quantise to the beat grid rather
      // than landing wherever a layer happens to expire.
      const beat = this.beatIndex(time);
      if (beat !== this.lastBeat) {
        this.lastBeat = beat;
        // A retired layer is on its way out however much life it had left, so
        // it is not one of the layers the frame is being held up by.
        let holding = this.shards.filter(
          (shard) =>
            shard.retiredAt === undefined &&
            time < shard.bornAt + shard.lifetime - shard.opacityCurve.fadeOut
        ).length;
        while (holding < target && this.shards.length < target * 2) {
          this.spawn(time);
          holding++;
        }
      }
    }

    const post = this.safety.apply(this.modulatePost(time, clockDt), dt);
    return {
      time,
      // Each layer carries its own id into the pulse, so the stack answers the
      // music as a wave through it rather than as one sheet moving at once.
      shards: this.shards.map((shard) => this.pulse(resolveShard(shard, time), shard.id)),
      stage: null,
      handover: this.handover(time),
      background: [0, 0, 0],
      post,
      phases: this.advancePhases(post, clockDt),
      flowAngle: this.flowHeading(time),
    };
  }

  /**
   * The grid births quantise to: the music's when it is being followed, the
   * config's fixed one otherwise.
   *
   * Below `LOCK_THRESHOLD` this hands back exactly the grid the engine has
   * always run on, which is the whole of the graceful fallback — ambient
   * material, spoken word, a drum solo in 7 and the gap between tracks all
   * arrive here and all get the composition's own pacing back. A run that never
   * listens never leaves this branch.
   *
   * ## The lead, and why a beat-synced birth needs one
   *
   * A crossfade here is a *fraction of a layer lifetime*, and lifetimes run to
   * ninety seconds; even the floor is `MIN_FULLBLEED_FADE_CLOCK`. A fade that
   * long cannot land on a beat. Firing the spawn on the downbeat gives a layer
   * that starts arriving on the beat and finishes arriving somewhere unrelated
   * to the music, which reads as nothing at all.
   *
   * So the index steps one fade *before* the beat it belongs to, and the layer
   * is fully resolved as the beat lands. This is only possible because the
   * reactor produces a phase-locked prediction rather than a notification —
   * and it absorbs the analysis latency for free, since a beat predicted early
   * does not care that its onset was detected 20ms late.
   */
  private beatIndex(time: number): number {
    const frame = this.audioFrame;
    if (!frame || !frame.locked || this.config.reactivity <= 0) {
      return Math.floor(time / Math.max(0.1, this.config.beat));
    }
    // What the next layer's fade will be, by the same arithmetic the scene uses
    // — it cannot be asked for, because the layer does not exist yet.
    const fade = this.safety.clampFade(
      this.config.layerLifetime * this.config.crossfade * 0.5
    );
    // Clock seconds into real ones, since the prediction is in real time. A
    // fade longer than a whole beat is clamped rather than allowed to run the
    // index a bar ahead: at that point the lead has stopped meaning anything
    // and firing on the beat is the honest fallback.
    const lead = Math.min(fade / Math.max(0.05, this.timeScale), frame.nextBeatIn + 1e-6);
    return frame.nextBeatIn <= lead ? frame.beatCount + 1 : frame.beatCount;
  }

  /** The speed control, as the director sees it. Mirrors `Engine.timeScale`. */
  private get timeScale(): number {
    const speed = this.config.speed;
    return Number.isFinite(speed) ? Math.max(0.05, speed) : 1;
  }

  /**
   * The whole flat composition scaled about the frame centre, on the bar.
   *
   * Applied to the resolved draw rather than to the shards themselves, so it is
   * a property of the frame and not of the layers: nothing accumulates, and a
   * layer born mid-pump is not permanently a different size from its
   * neighbours.
   *
   * Stage space has y over 0..1 and x over 0..aspect, so the centre is half of
   * each. Only ever upward — a scale below 1 would pull a full-bleed layer's
   * own edge into frame, and the whole design of this path is that its layers
   * overflow.
   */
  private pulse(draw: DrawShard, shardId: number): DrawShard {
    /*
     * And the walk over the top of it — §16 of
     * `docs/visualizer-audio-attribution.md`.
     *
     * The two belong in one transform because the overscan is what pays for the
     * offset: a translation on its own would pull a full-bleed layer's own edge
     * into shot on the beat, which is the loudest possible way to fail at being
     * subtle. See `AudioBinding.stride`.
     *
     * Deliberately only the flat path. The formations have a flight of their own
     * that already moves the whole frame, and a second whole-frame translation
     * over the top of it is two motions the eye has to separate rather than one
     * it can attribute.
     */
    const stride = this.audio.stride;
    const scale = this.audio.pulse(shardId) * stride.overscan;
    if (scale <= 1.0001 && stride.x === 0 && stride.y === 0) return draw;
    const cx = this.aspect / 2;
    const cy = 0.5;
    const rect = draw.dstRect;
    draw.dstRect = {
      x: cx + (rect.x - cx) * scale + stride.x,
      y: cy + (rect.y - cy) * scale + stride.y,
      w: rect.w * scale,
      h: rect.h * scale,
    };
    return draw;
  }

  /**
   * Which way the flow field is fed.
   *
   * The parameter drift's own heading whenever it is running: that channel is
   * already deciding which way layers pan, so feeding the field from it makes the
   * smear and the composition one motion instead of two. A preset is allowed to
   * want the field without wanting the drift, though, and a flow field with no
   * current is a standing one — so with the drift off this falls back to a curve
   * slower than anything else derived here.
   */
  private flowHeading(time: number): number {
    const bias = this.wander.bias();
    if (bias) return bias.angle;
    return Math.sin(time * FLOW_HEADING_HZ * Math.PI * 2) * Math.PI;
  }

  /**
   * Bring the stage into line with the config, which a mode switch can change
   * at the midpoint of its ramp.
   *
   * The two paths are exclusive, so whichever is being left is emptied. The
   * shards in particular have to go: they carry a birth time, and a stack left
   * standing through a minute of a formation would come back as four layers
   * that had all silently expired.
   *
   * The stage also re-lays its quads out here when the density knob moves, which
   * is a rebuild but not a scene change — hence the return value rather than a
   * comparison of kinds: only a genuine change of path invalidates the shards.
   *
   * Whatever is emptied here is *cut*, and no ramp around it changes that. The
   * mode switch crossfades every parameter in the config, but a parameter is not
   * what a viewer is watching: they are watching four layers drift, and those
   * layers do not fade out, they cease. So the swap is held back a frame first,
   * to give the backend a still of the outgoing path to dissolve the incoming
   * one over — see `VizHandover`. The frame's own arithmetic is the reason the
   * hold is a whole frame rather than a flag: the still has to be taken *after*
   * the last outgoing frame is drawn and *before* the first incoming one is, and
   * those are consecutive.
   */
  private syncStage(): void {
    const wanted: StageKind | null =
      !this.spatial || this.config.stageKind === "flat" ? null : this.config.stageKind;

    // Spent once the config has caught up with the hint — on the frame after the
    // swap, or on whichever frame a switch the reader stepped straight back out
    // of stops being pending.
    if (wanted === this.stage.kind) this.expecting = null;

    // Nothing on screen to cross against: the run is opening, and an opening has
    // its own hurried fade for exactly that case. Held panels are not a path, so
    // a formation arriving over an empty flat stack is still an opening.
    const drawn = this.stage.active || this.shards.length > 0;
    if (wanted !== this.stage.kind && !this.swapArmed && drawn) {
      this.swapArmed = true;
      // The density rebuild below is skipped for this one frame with it. That is
      // a frame of a slider drag landing late, against a cut this is here to
      // remove.
      return;
    }

    /*
     * The arm is spent either way. It is normally spent on the swap it was armed
     * for, but a reader stepping through the presets faster than the ramp can
     * cross can put the config back on the path it started from while it is
     * armed — and then there is nothing to swap, nothing to cross, and a still
     * that would sit waiting for a crossing that never comes.
     */
    const covered = this.swapArmed && wanted !== this.stage.kind;
    this.swapArmed = false;

    if (!this.stage.sync(wanted, this.config, () => this.rng.fork())) return;

    if (covered) {
      this.swapAt = this.lastClock;
      // Told to whichever path is arriving, so its opening does not fade under
      // the dissolve that is already crossing it.
      if (wanted !== null) this.stage.coverArrival();
      else this.coveredSeed = true;
    }
    this.shards = [];
    this.seeded = false;
    this.lastBeat = -1;
    // A turnover waiting on its page described a composition that no longer
    // exists — the path it was going to turn over has just been emptied.
    this.turnArmedAt = -1;
  }

  /**
   * What the backend should do about the crossing this frame, if anything.
   *
   * On the composition clock rather than in real seconds, so the dissolve and the
   * arriving path's own durations stay complements of each other at every speed —
   * and the clock length is the fade floor, so at the speed ceiling the crossing
   * still takes the longest §7 allows the whole frame to move in.
   */
  private handover(time: number): VizHandover | null {
    const elapsed = this.swapAt < 0 ? Infinity : time - this.swapAt;
    const mix = Math.max(0, 1 - elapsed / MODE_HANDOVER_CLOCK);
    if (mix <= 0) this.swapAt = -1;
    /*
     * A capture carries whatever crossing is already running rather than
     * cancelling it, which is what makes stepping through the presets faster
     * than they can cross survive: the still is taken of the frame as the viewer
     * is actually seeing it, half of one path over half of another, and the next
     * crossing starts from that. Read the other way round — capture first, then
     * mix — a second switch inside the first would snap to the incoming path for
     * one frame and then dissolve out of it, which is a flash.
     */
    if (this.swapArmed) return { capture: true, mix };
    return mix > 0 ? { capture: false, mix } : null;
  }

  /**
   * Integrates every rate the post chain is authored in. Integrated rather than
   * evaluated as `rate * time` so that a rate the drift is moving — or
   * reversing — bends the motion instead of teleporting it.
   *
   * Only the Droste's rate is scaled here. Its phase is a log-radius, and one
   * repeat of the regress is one `drostePeriod` of it — a stride a preset is
   * free to choose. Multiplying by that period turns the authored rate from
   * log-radii per second into *repeats* per second, so widening the stride
   * spaces the copies out rather than slowing the whole effect down.
   */
  private advancePhases(post: PostParams, clockDt: number): VizPhases {
    // Wrapped, unlike the angles below, because it can be: the shader reads this
    // through a cosine of one cycle, so every whole turn is discardable — and
    // discarding them is what keeps a screensaver left running overnight from
    // slowly losing the fraction that is the whole of what the phase means.
    this.phases.pane = (this.phases.pane + post.paneRate * clockDt) % 1;
    this.phases.kaleido += post.kaleidoSpin * clockDt;
    // The slide's heading. Integrated rather than evaluated for the reason all
    // of these are: an effect ramping in finds the direction already turning,
    // and a rate the drift is moving bends the circulation instead of jumping it.
    this.phases.mobius += post.mobiusRate * clockDt;
    this.phases.relief += post.reliefRate * clockDt;
    /*
     * The pond's rings, wrapped — and unusually, wrapped against something
     * other than one.
     *
     * Every other periodic phase here is read through a single sine and can
     * discard whole turns freely. This one is read through a sine *and* through
     * the packet age the burst reading is built on, at three per-source rates,
     * and POND_CYCLE is the shortest interval over which all of those come back
     * to where they started. Wrapping anywhere else would step the rings; not
     * wrapping at all would spend an overnight run's float on whole cycles
     * nobody can see, which is the pane's argument in a different unit.
     */
    this.phases.pond = (this.phases.pond + post.pondRate * clockDt) % POND_CYCLE;
    if (this.phases.pond < 0) this.phases.pond += POND_CYCLE;
    this.phases.droste += post.drosteSpin * Math.max(0.15, post.drostePeriod) * clockDt;
    this.phases.fold += post.foldSpin * clockDt;
    this.phases.tunnel += post.tunnelSpin * clockDt;
    // The walk around the Mandelbrot cardioid. Integrated like the rest, which
    // here means the seed can be slowed, stopped or reversed and the figure
    // carries on from the set it is currently showing rather than cutting to
    // whichever one the new rate says it should have reached by now.
    //
    /*
     * Slowed, though, by however far the flight has already magnified — and the
     * seed and the flight are not independent, which is what this admits.
     *
     * Moving the seed moves the whole set, and the set is being looked at
     * through a lens currently making everything `zoom` times larger. So a walk
     * that is a slow drift at the top of a descent is the same set skidding
     * sideways at the bottom of one: a part in a hundred of the plane, and a
     * whole width of the picture. Left alone it reads as the figure churning
     * itself to pieces as each descent goes on, and then being replaced — which
     * is a fault of this arithmetic and not of the fractal.
     *
     * Divided out, the *apparent* rate is the same at every depth, which is the
     * only rate anybody can see. What it costs is that the seed covers ground
     * unevenly in its own coordinates, quickly at the top of a descent and
     * barely at all at the bottom. Nothing in the frame reports that, because
     * the frame is measured in the same shrinking units.
     */
    const zoom = Math.exp(
      -this.phases.juliaTravel * juliaEfoldsPerTurn(post.juliaShape, this.phases.julia)
    );
    this.phases.julia += post.juliaSpin * clockDt * zoom;
    /*
     * The flight, carried in *preimages* rather than in the e-folds it is
     * authored in, and converted here at the exchange rate of the set the walk
     * is currently on.
     *
     * The conversion has to happen at the point of integration rather than at
     * the point of use, and this is the whole reason the walk and the flight are
     * not simply two phases. What the wrap is periodic in is preimages; what the
     * slider means is e-folds a second; and the number between them drifts by
     * half again as the seed walks. Integrating e-folds and dividing downstream
     * would put a *growing* quantity over a moving one, so the drift would
     * arrive multiplied by however long the run had been going — after a few
     * minutes the flight would speed up, stall and fly backwards, none of which
     * is on any slider.
     *
     * Wrapped here too, for the same reason in miniature: a phase that grew
     * without bound would eventually lose its fractional part to float, and the
     * fractional part is the whole of what this phase is for.
     */
    const perTurn = Math.max(0.05, juliaEfoldsPerTurn(post.juliaShape, this.phases.julia));
    this.phases.juliaTravel += (post.juliaFlight * clockDt) / perTurn;
    this.phases.juliaTravel -=
      Math.floor(this.phases.juliaTravel / JULIA_WRAP) * JULIA_WRAP;
    /*
     * The drift across the fixed point, and it is authored here rather than on a
     * slider because there is only one rate worth having.
     *
     * Slower than the flight by an order — a circuit takes about three minutes
     * where a wrap takes one — so what the eye reads is a picture flying into
     * itself while the place it is flying into wanders, rather than two motions
     * competing (§6). Unlike the walk it is not divided by the magnification:
     * the drift is a move of the frame in the frame's own units, so it already
     * means the same thing at every depth of the descent.
     */
    this.phases.juliaDrift += JULIA_DRIFT_RATE * clockDt;
    // The spatial rates live on the config rather than in `post`, because they
    // move the composition rather than processing it — but they are integrated
    // here with the rest for exactly the same reason.
    /*
     * The spatial rates take the music as a gain, which is the best-feeling
     * binding here and comes almost free: these are integrated rather than
     * evaluated, so a rate the music is moving *bends* the flight instead of
     * teleporting it — the same property the parameter drift already relies on.
     */
    /*
     * The handover applies to the *authored* half of each rate and not to the
     * audio gain over it, which is the arithmetic the whole idea turns on:
     * scaling the product would take the musical contribution down with the
     * composition's own and leave the ratio exactly where it started. So the
     * base stands down by `1 - autonomy` and the gain's deviation is added back
     * at full size.
     */
    const autonomy = this.audio.autonomy;
    this.phases.travel +=
      this.config.stageFlight * (autonomy + (this.audio.flight - 1)) * clockDt;
    this.phases.orbit += this.config.stageSpin * (autonomy + (this.audio.spin - 1)) * clockDt;
    this.phases.swell += this.config.stageDisplaceRate * clockDt;
    return this.phases;
  }

  // --- selection ------------------------------------------------------------

  private spawn(time: number, ageOffset = 0): void {
    const pick = this.takeUpcoming();
    if (!pick) return;

    const shard = this.scene.spawn({
      id: this.nextShardId++,
      panel: pick.panel,
      affinity: pick.affinity,
      time,
      aspect: this.aspect,
      // The drift hands back the config untouched when it is off, so a preset
      // that does not use it builds its layers from exactly what it authored.
      config: this.inTempo(this.wander.spawnConfig(this.config)),
      drift: this.wander.bias(),
      rng: this.rng,
      tint: this.currentTint(this.shardPanels()),
      index: this.spawnCount++,
      safety: this.safety,
    });
    shard.bornAt -= ageOffset * shard.lifetime;
    /*
     * A layer opening the run comes up over black, and the authored crossfade is
     * the wrong length for that.
     *
     * A crossfade is a length chosen for one picture *replacing* another, where
     * every second of it has something on screen. Spent instead on an empty
     * frame filling up, the same number is a wait — and on the presets whose
     * pages linger longest it is a fifteen-second one, which is the first thing
     * a viewer sees of the piece.
     *
     * Only the opening is hurried, and only where nothing is being crossed
     * against: a layer given an age offset is already past its fade, and every
     * later one is answering an outgoing fade it has to stay the complement of.
     * The floor is the photosensitivity limit, which is the whole of what
     * decides how fast a full-bleed layer may arrive. The stage path has done
     * this for its own opening tenancy all along — see `Stage.rotate`.
     */
    if (this.coveredSeed) {
      /*
       * Except where the stack is not opening over black at all, but over a
       * still of the formation it replaced.
       *
       * Then the argument above inverts. Every layer of this seeding arrives
       * under a dissolve that is already carrying the crossing, and a fade
       * underneath it would multiply against it — so the layers arrive at their
       * full authored strength and the dissolve does the work, which is also
       * what keeps the stack from still filling up after the crossing has ended.
       * See `Stage.coverArrival`, which says the same thing on the other path.
       */
      shard.opacityCurve.fadeIn = 0;
    } else if (ageOffset === 0 && this.shards.length === 0 && this.spawnCount === 1) {
      shard.opacityCurve.fadeIn = Math.min(
        shard.opacityCurve.fadeIn,
        this.safety.clampFade(0)
      );
    }
    this.shards.push(shard);
  }

  /**
   * A layer's own durations, snapped to the bar — the lifetime it will live and
   * the fraction of it spent crossfading.
   *
   * Applied to the config the layer is *built* from rather than to the config
   * the run holds, so it is a property of that layer and nothing retunes
   * underneath a layer already on screen. A lifetime is the longest duration in
   * the engine and the one a viewer is least able to time, which is exactly why
   * it is worth locking: births then land on the bar without anything having
   * been made to move.
   *
   * The crossfade is carried as a fraction, so it follows the lifetime for
   * free — and `driftStack` still puts the result through `safety.clampFade`,
   * which no snap here may undercut.
   */
  private inTempo(config: VizConfig): VizConfig {
    if (!this.tempo.active) return config;
    const lifetime = this.tempo.duration(config.layerLifetime);
    if (lifetime === config.layerLifetime) return config;
    return { ...config, layerLifetime: lifetime };
  }

  private takeUpcoming(): Pick | null {
    // A held run has one answer to every request for a panel, which is what
    // makes it hold: the flat path's next shard and the stage's next tenancy
    // both come through here.
    if (this.focus) return { panel: this.focus, affinity: "random" };
    this.fillUpcoming();
    return this.upcoming.shift() ?? null;
  }

  private fillUpcoming(): void {
    /*
     * Two picks ahead, which is what the flat path consumes: one layer per beat,
     * and a decode has a whole beat to land in.
     *
     * A formation does not arrive one panel at a time. It takes its entire
     * residency on the frame it is built, and a slot whose panel has not decoded
     * is not drawn at all — so a switch into a spatial preset queued two deep
     * arrives as a corridor with most of its pages missing, which is precisely
     * the frames the crossing is there to cover. Queued to the residency instead,
     * from the moment the reader asks for the switch, the decodes run under the
     * ramp and the formation arrives whole.
     *
     * The scene's own residency, and not the device's ceiling on it — which is
     * thirteen, where every scene in the engine asks for two or three. A queue is
     * filled in one pass against one anchor, so queueing the ceiling would turn
     * the rhyme walk into a star: thirteen panels all chosen off the same page,
     * the last of them used ten minutes later. Only while the switch is in
     * flight, and back to two the moment it lands, for the same reason.
     */
    const depth = this.expecting
      ? Math.max(2, stageResidency(this.expecting, this.caps))
      : 2;
    while (this.upcoming.length < depth) {
      const pick = this.pickPanel();
      if (!pick) return;
      this.upcoming.push(pick);
      this.remember(pick.panel.id);
    }
  }

  private remember(id: string): void {
    this.recent.push(id);
    while (this.recent.length > recentWindow(this.panels.length)) this.recent.shift();
  }

  /** Panels the flat path currently has in flight. */
  private shardPanels(): Panel[] {
    const panels: Panel[] = [];
    for (const shard of this.shards) {
      const panel = this.byId.get(shard.panelId);
      if (panel) panels.push(panel);
    }
    return panels;
  }

  /** Panels on screen right now, whichever path is drawing them. */
  private onScreen(): Panel[] {
    return this.stage.active ? this.stage.wants() : this.shardPanels();
  }

  private eligible(): Panel[] {
    const onScreen = this.onScreen();
    const excluded = new Set(this.recent);
    for (const panel of onScreen) excluded.add(panel.id);
    for (const pick of this.upcoming) excluded.add(pick.panel.id);
    const pool = this.panels.filter((panel) => !excluded.has(panel.id));
    // A heavily filtered wall can exhaust the pool; fall back to everything
    // except what is literally on screen right now. A stage makes this the
    // common case rather than the corner one — it holds a dozen panels at once,
    // so a wall filtered to fifteen is permanently in the relaxed branch.
    if (pool.length > 0) return pool;
    const held = new Set(onScreen.map((panel) => panel.id));
    const relaxed = this.panels.filter((panel) => !held.has(panel.id));
    return relaxed.length > 0 ? relaxed : this.panels;
  }

  private anchor(): Panel | null {
    if (this.stage.active) return this.stage.anchor();
    if (this.shards.length === 0) return null;
    const shard = this.shards[this.shards.length - 1];
    return this.byId.get(shard.panelId) ?? null;
  }

  private pickPanel(): Pick | null {
    const pool = this.eligible();
    if (pool.length === 0) return null;

    const wildcard = (): Pick => ({
      panel: pool[this.rng.int(pool.length)],
      affinity: "random",
    });

    const anchor = this.anchor();
    if (!anchor) return wildcard();

    /*
     * A structural cue asked for a contrast — §3.6 of the attribution document.
     *
     * Expressed as the clash policy rather than as a new mechanism, which is the
     * whole reason this is defensible: the selection logic still picks, with its
     * own embeddings and its own fallbacks, and all the music has done is choose
     * which of the four policies it already has runs this once. Consumed here so
     * it applies to exactly one pick — an arrival is a moment, not a mode.
     *
     * Deliberately not drawn from the rng, and it does not disturb the stream:
     * the weighted draw is skipped rather than taken and overridden, so a seeded
     * run that never listens still replays frame for frame.
     */
    const { rhyme, clash, color, random } = this.config.weights;
    let policy: number;
    if (this.contrastNext) {
      this.contrastNext = false;
      policy = 1;
    } else {
      policy = this.rng.weightedIndex([rhyme, clash, color, random]);
    }

    // Each policy degrades to the next-best signal rather than failing: a panel
    // missing an embedding still gets placed by palette, and a panel with no
    // palette still gets placed at random.
    switch (policy) {
      case 0: {
        const panel = this.byEmbedding(anchor, pool, false) ?? this.byPalette(anchor, pool, false);
        return panel ? { panel, affinity: "rhyme" } : wildcard();
      }
      case 1: {
        const panel = this.byEmbedding(anchor, pool, true) ?? this.byPalette(anchor, pool, true);
        return panel ? { panel, affinity: "clash" } : wildcard();
      }
      case 2: {
        const panel = this.byPalette(anchor, pool, false);
        return panel ? { panel, affinity: "color" } : wildcard();
      }
      default:
        return wildcard();
    }
  }

  private byEmbedding(anchor: Panel, pool: Panel[], far: boolean): Panel | null {
    const embeddings = this.embeddings;
    if (!embeddings) return null;
    const source = embeddings[anchor.id];
    if (!source) return null;
    return this.extreme(pool, far, (panel) => {
      const target = embeddings[panel.id];
      return target ? cosineDistance(source, target) : null;
    });
  }

  private byPalette(anchor: Panel, pool: Panel[], far: boolean): Panel | null {
    if (!anchor.dominantColors) return null;
    return this.extreme(pool, far, (panel) => {
      const distance = paletteDistance(anchor.dominantColors, panel.dominantColors);
      return Number.isFinite(distance) ? distance : null;
    });
  }

  private extreme(
    pool: Panel[],
    far: boolean,
    distanceOf: (panel: Panel) => number | null
  ): Panel | null {
    let best: Panel | null = null;
    let bestDistance = far ? -Infinity : Infinity;
    for (const panel of pool) {
      const distance = distanceOf(panel);
      if (distance === null) continue;
      if (far ? distance > bestDistance : distance < bestDistance) {
        bestDistance = distance;
        best = panel;
      }
    }
    return best;
  }

  // --- colour and modulation ------------------------------------------------

  /**
   * Bias tints toward the complement of what is currently on screen, so that
   * overlapping layers go chromatic rather than settling into grey — and only
   * as far as the pages on screen need it.
   *
   * The complement is what the tint *is*; how much of it survives is the
   * question `colorFidelity` answers, faded across the chroma the panels
   * already have. A monochrome page gets the whole thing, which is the case the
   * tint was written for and the case where it is the only colour in the frame.
   * A four-colour page gets almost none of it, because it arrived with more
   * colour than the tint could add and the only thing a complement does there is
   * pull against the artist.
   *
   * Returned as a weakened tint rather than as a separate strength, so this
   * needs nothing of the scenes or of the shader: white is the tint's own
   * identity — `mix(tex, tex * white, a)` is `tex` at any amount — so fading
   * toward it is exactly fading the tint out, wherever a scene chose to apply
   * it and at whatever share of `tintAmount` that scene asked for.
   */
  private currentTint(panels: Panel[]): Rgb {
    let L = 0;
    let a = 0;
    let b = 0;
    let n = 0;
    for (const panel of panels) {
      const lab = chromaticDominant(panel.dominantColors);
      if (!lab) continue;
      L += lab[0];
      a += lab[1];
      b += lab[2];
      n++;
    }
    if (n === 0) return [1, 1, 1];
    const mean: Lab = [L / n, a / n, b / n];
    const tint = normalizeTint(labToRgb(complement(mean)));
    const coloured = smoothstep(TINT_GREY, TINT_COLOURED, Math.hypot(mean[1], mean[2]));
    const kept = 1 - coloured * Math.min(1, Math.max(0, this.config.colorFidelity));
    return [1 + (tint[0] - 1) * kept, 1 + (tint[1] - 1) * kept, 1 + (tint[2] - 1) * kept];
  }

  /**
   * The frame's colour brought back toward the page's own — the last word on
   * every hue term in the chain, and the only place any of them is answered.
   *
   * Written as a governor over the *net* departure rather than as a smaller
   * number at each of the three sources, because the sources do not know about
   * each other and a viewer only ever sees the sum: the director's own
   * excursion, the walk the music takes the colour on over a phrase, and
   * whatever a `hue-sweep` pulse is adding on top. Scaling the sum keeps their
   * proportions — the sweep is still the largest thing that happens to the
   * colour, and it still arrives when the pool decided it would — and puts one
   * number in charge of how far any of it gets.
   *
   * Measured from what the preset authored, so a mode that asked to sit at a
   * rotation keeps it. This holds the frame to the *page*, and a preset's own
   * `hueShift` is part of what the page is being shown as.
   *
   * Runs after the probe has taken its reading, which costs the trace nothing
   * that matters: `Channel.share` is a ratio of two path lengths, this scales
   * the authored and the musical halves of `hueShift` by the same factor, and
   * the attribution comes out unchanged. Only the absolute depth column reads
   * high, by exactly `1 / (1 - colorFidelity)`.
   */
  private holdColour(post: PostParams, base: PostParams): void {
    const keep = Math.min(1, Math.max(0, this.config.colorFidelity));
    if (keep <= 0) return;
    post.hueShift = base.hueShift + (post.hueShift - base.hueShift) * (1 - keep);
  }

  /**
   * Every rate in the post chain that turns or cycles, snapped so a whole number
   * of them fits a whole number of bars — the quiet row of §5 and probably the
   * best of them.
   *
   * A fold that completes exactly one rotation every eight bars is locked to the
   * music in a way a viewer feels without being able to name, and it involves no
   * reactive machinery at all: nothing here responds to anything, and the rate
   * a snap produces differs from the authored one by at most the gap between
   * two adjacent musical durations.
   *
   * Applied after the drift and before the cycler, so it snaps what the
   * composition actually intends to run at — the drift moves these rates over
   * minutes and a snap taken before it would be immediately undone — while a
   * cycled effect's own ramp, which is a transient rather than a tempo, stays
   * out of it.
   *
   * `feedbackRotate` is deliberately absent: it is a per-frame angle rather than
   * a rate, `Wander.settle` governs it against the fold, and a snap here would
   * be arguing with the governor about a number that is not in the same units.
   */
  private inTempoRates(post: PostParams): void {
    if (!this.tempo.active) return;
    // The one entry here whose units make the snap exact rather than close: the
    // spins are radians a second and `rate` reads their reciprocal as a period,
    // where this is already cycles a second, so a pull-back locked to eight bars
    // really does open and close on the bar.
    post.paneRate = this.tempo.rate(post.paneRate);
    post.kaleidoSpin = this.tempo.rate(post.kaleidoSpin);
    post.drosteSpin = this.tempo.rate(post.drosteSpin);
    post.tunnelSpin = this.tempo.rate(post.tunnelSpin);
    post.foldSpin = this.tempo.rate(post.foldSpin);
    post.juliaSpin = this.tempo.rate(post.juliaSpin);
  }

  private lfo(time: number, index: number): number {
    return Math.sin(time * LFO_HZ[index % LFO_HZ.length] * Math.PI * 2);
  }

  /**
   * How far open the hue excursion's window is, 0..1 — see `HUE_SWING`.
   *
   * Shut for most of every cycle and never quite at full width, which is the
   * whole difference between a colour that departs and a colour that is
   * departed. Squared on the way out so the shoulders are gentle: the window
   * opens over tens of seconds either side, and there is no instant at which
   * the piece can be seen deciding to change colour.
   */
  private hueWindow(time: number): number {
    const open = Math.sin(time * HUE_WINDOW_HZ * TAU);
    const t = Math.max(0, (open - HUE_WINDOW_GATE) / (1 - HUE_WINDOW_GATE));
    return t * t;
  }

  private modulatePost(time: number, clockDt: number): PostParams {
    const base = this.config.post;
    const post: PostParams = {
      ...base,
      hueShift: base.hueShift + this.lfo(time, 0) * HUE_SWING * this.hueWindow(time),
      feedbackAmount: base.feedbackAmount * (0.85 + 0.15 * this.lfo(time, 1)),
      chroma: base.chroma * (0.7 + 0.3 * this.lfo(time, 2)),
    };
    // The LFOs breathe around whatever the config asks for; the drift moves
    // what the config asked for; the cycler brings separate effects in and out
    // over the top. In that order, so a mode whose whole character is a drifted
    // parameter keeps it — the cycler only ever deepens what is already there.
    this.wander.applyPost(post);
    this.inTempoRates(post);
    /*
     * The cycler's interval, lengthened by the same handover — a spontaneous
     * pulse every fourteen seconds is autonomous motion like any other, and while
     * the music is carrying the frame the piece should be bringing fewer effects
     * in of its own accord. Note the direction: this is a gap, so dividing by
     * `autonomy` makes them rarer. The section and arrival cues are untouched by
     * it, which is the point — what the music asks for still arrives.
     */
    this.cycler.apply(
      post,
      time,
      this.config.psychedelia,
      this.tempo.duration(this.config.cycleInterval) / Math.max(0.2, this.audio.autonomy),
      // And the grid it should arrive on — §16. The interval above is how often
      // an effect comes in; this is the far more visible question of when.
      this.tempo
    );
    // Fourth pass, after the three that decide what the piece is and before the
    // governor below: the music deepens whatever they arrived at.
    //
    // Measured either side, so what the readout reports is the audio pass alone
    // — whatever the LFOs, the drift and the cycler arrived at counts as the
    // authored value. That is the isolation §10's table in
    // `docs/visualizer-audio-reach.md` was produced under by hand.
    this.probe?.authored(post);
    this.audio.applyPost(post);
    this.probe?.deliver(post, this.audio);
    // Fifth, over the sum of the four above rather than inside any of them:
    // three of those passes move the hue and none of them can see the others.
    this.holdColour(post, base);
    // Last, because it governs the frame's trail against its symmetry and both
    // of the passes above can move either one.
    this.wander.settle(post, clockDt);
    return post;
  }
}
