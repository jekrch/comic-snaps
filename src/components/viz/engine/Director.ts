import type { Panel } from "../../../types";
import type { VizConfig } from "../vizConfig";
import { cosineDistance, loadEmbeddings, paletteDistance } from "../../../utils/sorting";
import type { EmbeddingMap } from "../../../utils/sorting";
import type { Rng } from "./rng";
import { EffectCycler } from "./EffectCycler";
import { SafetyGovernor } from "./safety";
import type { PostParams, Shard, VizFrame } from "./types";
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

  readonly safety = new SafetyGovernor();
  /** Forked lazily — see the note on EffectCycler about seeds replaying. */
  private readonly cycler = new EffectCycler(() => this.rng.fork(), this.safety);

  constructor(
    panels: Panel[],
    private config: VizConfig,
    private readonly rng: Rng
  ) {
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

  get panelCount(): number {
    return this.panels.length;
  }

  get sceneName(): string {
    return this.scene.name;
  }

  /** Panels worth having resident soon — the engine hands these to the pool. */
  prefetch(): Panel[] {
    this.fillUpcoming();
    return this.upcoming.map((pick) => pick.panel);
  }

  /** The panel currently carrying the frame, for the attribution line. */
  feature(time: number): Panel | null {
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
    if (this.panels.length === 0) {
      return {
        time,
        shards: [],
        background: [0, 0, 0],
        post: this.safety.apply(this.config.post, dt),
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

    return {
      time,
      shards: this.shards.map((shard) => resolveShard(shard, time)),
      background: [0, 0, 0],
      post: this.safety.apply(this.modulatePost(time), dt),
    };
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
      config: this.config,
      rng: this.rng,
      tint: this.currentTint(),
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

  private eligible(): Panel[] {
    const excluded = new Set(this.recent);
    for (const shard of this.shards) excluded.add(shard.panelId);
    for (const pick of this.upcoming) excluded.add(pick.panel.id);
    const pool = this.panels.filter((panel) => !excluded.has(panel.id));
    // A heavily filtered wall can exhaust the pool; fall back to everything
    // except what is literally on screen right now.
    if (pool.length > 0) return pool;
    const onScreen = new Set(this.shards.map((shard) => shard.panelId));
    const relaxed = this.panels.filter((panel) => !onScreen.has(panel.id));
    return relaxed.length > 0 ? relaxed : this.panels;
  }

  private anchor(): Panel | null {
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
  private currentTint(): Rgb {
    let L = 0;
    let a = 0;
    let b = 0;
    let n = 0;
    for (const shard of this.shards) {
      const lab = chromaticDominant(this.byId.get(shard.panelId)?.dominantColors ?? null);
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

  private modulatePost(time: number): PostParams {
    const base = this.config.post;
    const post: PostParams = {
      ...base,
      hueShift: base.hueShift + this.lfo(time, 0) * 0.12,
      feedbackAmount: base.feedbackAmount * (0.85 + 0.15 * this.lfo(time, 1)),
      chroma: base.chroma * (0.7 + 0.3 * this.lfo(time, 2)),
    };
    // The LFOs breathe around whatever the config asks for; the cycler is the
    // thing that changes what the config asked for, on its own schedule.
    this.cycler.apply(post, time, this.config.psychedelia, this.config.cycleInterval);
    return post;
  }
}
