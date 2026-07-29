import type { Panel } from "../../../types";
import type { DeviceCaps, VizConfig } from "../vizConfig";
import { cosineDistance, loadEmbeddings, paletteDistance } from "../../../utils/sorting";
import type { EmbeddingMap } from "../../../utils/sorting";
import type { Rng } from "./rng";
import { EffectCycler } from "./EffectCycler";
import { SafetyGovernor } from "./safety";
import { Stage } from "./Stage";
import { Wander } from "./Wander";
import type { PostParams, Shard, StageKind, VizFrame, VizPhases } from "./types";
import { resolveShard } from "./types";
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
const LFO_HZ = [0.037, 0.0611, 0.0893, 0.1307];

/** How many panels to avoid repeating, capped against small filtered sets. */
function recentWindow(count: number): number {
  return Math.max(2, Math.min(24, Math.floor(count / 2)));
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
  private aspect = 1;
  private lastClock = -1;
  private readonly phases: VizPhases = {
    kaleido: 0,
    droste: 0,
    fold: 0,
    tunnel: 0,
    travel: 0,
    orbit: 0,
  };
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
    this.fillUpcoming();
    const upcoming = this.upcoming.map((pick) => pick.panel);
    // A stage's bound panels are wanted every frame it is on screen, not just
    // when they were chosen: it holds a dozen at once, which is most of the
    // pool, so leaving them out would let the prefetch evict a live slot.
    return this.stage.active ? [...this.stage.wants(), ...upcoming] : upcoming;
  }

  /** The panel currently carrying the frame, for the attribution line. */
  feature(time: number): Panel | null {
    if (this.stage.active) return this.stage.feature(time);
    let best: Panel | null = null;
    let bestOpacity = 0.15;
    for (const shard of this.shards) {
      const draw = resolveShard(shard, time);
      if (draw.opacity > bestOpacity) {
        bestOpacity = draw.opacity;
        best = this.byId.get(shard.panelId) ?? null;
      }
    }
    return best;
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
          this.config,
          this.currentTint(this.stage.wants()),
          this.safety,
          () => this.takeUpcoming()?.panel ?? null
        ),
        background: [0, 0, 0],
        post,
        phases,
      };
    }

    this.shards = this.shards.filter((shard) => time < shard.bornAt + shard.lifetime);

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
        let holding = this.shards.filter(
          (shard) => time < shard.bornAt + shard.lifetime - shard.opacityCurve.fadeOut
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
    };
  }

  /**
   * Bring the stage into line with the config, which a mode switch can change
   * at the midpoint of its ramp.
   *
   * The two paths are exclusive, so whichever is being left is emptied. The
   * shards in particular have to go: they carry a birth time, and a stack left
   * standing through a minute of a formation would come back as four layers
   * that had all silently expired.
   */
  private syncStage(): void {
    const wanted: StageKind | null =
      !this.spatial || this.config.stageKind === "flat" ? null : this.config.stageKind;
    if (wanted === this.stage.kind) return;

    this.stage.setScene(wanted, () => this.rng.fork());
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
    // The spatial rates live on the config rather than in `post`, because they
    // move the composition rather than processing it — but they are integrated
    // here with the rest for exactly the same reason.
    this.phases.travel += this.config.stageFlight * clockDt;
    this.phases.orbit += this.config.stageSpin * clockDt;
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
    this.shards.push(shard);
  }

  private takeUpcoming(): Pick | null {
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
