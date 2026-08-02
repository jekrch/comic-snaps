import type { Panel } from "../../../types";
import type { DeviceCaps, VizConfig } from "../vizConfig";
import { cosineDistance, loadEmbeddings, paletteDistance } from "../../../utils/sorting";
import type { EmbeddingMap } from "../../../utils/sorting";
import type { Rng } from "./rng";
import { EffectCycler } from "./EffectCycler";
import { SafetyGovernor } from "./safety";
import { Stage } from "./Stage";
import { Wander } from "./Wander";
import { JULIA_WRAP, juliaEfoldsPerTurn } from "./julia";
import type { PostParams, Shard, StageKind, VizFrame, VizPhases } from "./types";
import { resolveShard, shardEnd } from "./types";
import { CAST_FLOOR, rankCast } from "./cast";
import { chromaticDominant, complement, labToRgb, normalizeTint } from "./palette";
import type { Rgb } from "./palette";
import { driftStack } from "./scenes/driftStack";
import type { Affinity, Scene } from "./scenes/types";

/** A panel plus the reason it was chosen, so presets can react to it. */
interface Pick {
  panel: Panel;
  affinity: Affinity;
}

/** Incommensurate rates, so the modulations never visibly re-align. */
const TAU = Math.PI * 2;

const LFO_HZ = [0.037, 0.0611, 0.0893, 0.1307];

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
    kaleido: rng.range(0, TAU),
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
  /** The panel the run is locked onto, or null while it is free-running. */
  private focus: Panel | null = null;
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

  readonly safety = new SafetyGovernor();
  /** Forked lazily — see the note on EffectCycler about seeds replaying. */
  private readonly cycler = new EffectCycler(() => this.rng.fork(), this.safety);
  /** Same contract: inert, and untouched by the rng, until a preset asks. */
  private readonly wander = new Wander(() => this.rng.fork());
  /** Same again: built empty, and only ever draws once a spatial preset runs. */
  private readonly stage: Stage;

  constructor(
    panels: Panel[],
    private config: VizConfig,
    private readonly rng: Rng,
    caps: DeviceCaps
  ) {
    this.stage = new Stage(caps);
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

  /** Told by the engine which backend it got. */
  setSpatialSupported(supported: boolean): void {
    this.spatial = supported;
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
    if (panel) this.turnOver();
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

  update(time: number, dt: number): VizFrame {
    // Composition seconds since the last frame, as distinct from `dt`, which is
    // real time. The drift is part of the piece, so it follows the speed
    // control; the safety governor is not, so it does not.
    const clockDt = this.lastClock < 0 ? 0 : Math.max(0, time - this.lastClock);
    this.lastClock = time;
    this.wander.update(clockDt, this.config.wander, this.config.wanderRate);
    this.syncStage();

    if (this.panels.length === 0) {
      const post = this.safety.apply(this.config.post, dt);
      return {
        time,
        shards: [],
        stage: null,
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
    } else {
      // Births are discrete events, so they quantise to the beat grid rather
      // than landing wherever a layer happens to expire.
      const beat = Math.floor(time / Math.max(0.1, this.config.beat));
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
      shards: this.shards.map((shard) => resolveShard(shard, time)),
      stage: null,
      background: [0, 0, 0],
      post,
      phases: this.advancePhases(post, clockDt),
      flowAngle: this.flowHeading(time),
    };
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
   */
  private syncStage(): void {
    const wanted: StageKind | null =
      !this.spatial || this.config.stageKind === "flat" ? null : this.config.stageKind;

    if (!this.stage.sync(wanted, this.config, () => this.rng.fork())) return;

    this.shards = [];
    this.seeded = false;
    this.lastBeat = -1;
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
    this.phases.kaleido += post.kaleidoSpin * clockDt;
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
    this.phases.travel += this.config.stageFlight * clockDt;
    this.phases.orbit += this.config.stageSpin * clockDt;
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
      config: this.wander.spawnConfig(this.config),
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
    if (ageOffset === 0 && this.shards.length === 0 && this.spawnCount === 1) {
      shard.opacityCurve.fadeIn = Math.min(
        shard.opacityCurve.fadeIn,
        this.safety.clampFade(0)
      );
    }
    this.shards.push(shard);
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
    while (this.upcoming.length < 2) {
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

    const { rhyme, clash, color, random } = this.config.weights;
    const policy = this.rng.weightedIndex([rhyme, clash, color, random]);

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
   * overlapping layers go chromatic rather than settling into grey.
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
    return normalizeTint(labToRgb(complement([L / n, a / n, b / n])));
  }

  private lfo(time: number, index: number): number {
    return Math.sin(time * LFO_HZ[index % LFO_HZ.length] * Math.PI * 2);
  }

  private modulatePost(time: number, clockDt: number): PostParams {
    const base = this.config.post;
    const post: PostParams = {
      ...base,
      hueShift: base.hueShift + this.lfo(time, 0) * 0.12,
      feedbackAmount: base.feedbackAmount * (0.85 + 0.15 * this.lfo(time, 1)),
      chroma: base.chroma * (0.7 + 0.3 * this.lfo(time, 2)),
    };
    // The LFOs breathe around whatever the config asks for; the drift moves
    // what the config asked for; the cycler brings separate effects in and out
    // over the top. In that order, so a mode whose whole character is a drifted
    // parameter keeps it — the cycler only ever deepens what is already there.
    this.wander.applyPost(post);
    this.cycler.apply(post, time, this.config.psychedelia, this.config.cycleInterval);
    // Last, because it governs the frame's trail against its symmetry and both
    // of the passes above can move either one.
    this.wander.settle(post, clockDt);
    return post;
  }
}
