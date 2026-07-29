import type { Panel } from "../../../types";
import type { DeviceCaps, VizConfig } from "../vizConfig";
import type { Rng } from "./rng";
import type { SafetyGovernor } from "./safety";
import { levelsFor } from "./palette";
import type { Rgb } from "./palette";
import type { Curve, SolidDraw, StageFrame, StageKind, StageSlotDraw } from "./types";
import { envelope } from "./types";
import type { SpatialFormation, SpatialScene } from "./scenes/spatial";
import { panelAspect } from "./scenes/types";
import { swarm } from "./scenes/swarm";
import { vault } from "./scenes/vault";

const SPATIAL_SCENES: Record<StageKind, SpatialScene> = { swarm, vault };

/**
 * A solid holds its panel for this multiple of a slot's dwell. It is one large
 * object rather than one of a hundred quads, so a panel change on it is a much
 * louder event and has to happen much less often.
 */
const SOLID_DWELL = 2.5;

/** One panel's tenancy of a slot. */
interface Occupant {
  panel: Panel | null;
  /** Engine clock at the moment it took the slot. */
  bornAt: number;
  lifetime: number;
  curve: Curve;
}

/**
 * Panel residency for the spatial scenes.
 *
 * The formation is fixed; this is what flows through it. Each slot is a
 * standing set of quads that panels take turns occupying, fading out and back
 * in as they hand over — so the arrangement never moves when the imagery
 * changes, which is the opposite of the flat path, where a new panel *is* a new
 * shard on a new trajectory.
 *
 * That inversion is also what makes the residency affordable. A slot is one
 * texture however many quads are bound to it, so five hundred crops cost a
 * dozen resident panels rather than five hundred, and the pool is the same
 * bounded LRU it always was.
 */
export class Stage {
  private scene: SpatialScene | null = null;
  private formation: SpatialFormation | null = null;
  private slots: Occupant[] = [];
  private solidSlots: Occupant[] = [];
  private lastBound: Panel | null = null;

  constructor(private readonly caps: DeviceCaps) {}

  get kind(): StageKind | null {
    return this.scene?.kind ?? null;
  }

  get name(): string {
    return this.scene?.name ?? "none";
  }

  get active(): boolean {
    return this.formation !== null;
  }

  /**
   * Switch formations, rebuilding the arrangement. A no-op when the kind is
   * already running, so a mode change that keeps the stage — or a config
   * reapplied for any other reason — does not reshuffle a live composition.
   */
  setScene(kind: StageKind | null, forkRng: () => Rng): void {
    if (kind === null) {
      this.scene = null;
      this.formation = null;
      this.slots = [];
      this.solidSlots = [];
      return;
    }
    if (this.scene?.kind === kind) return;

    const scene = SPATIAL_SCENES[kind];
    // Solids come out of the same residency budget as the slots, and they are
    // capped well under it: a formation that spent most of its panels on three
    // tumbling objects would be a scene about the objects.
    const solids = Math.min(scene.solidPanels, Math.floor(this.caps.stagePanels / 4));
    const slots = Math.max(1, this.caps.stagePanels - solids);

    this.scene = scene;
    // Forked only here, so a run that never reaches a spatial preset never
    // draws from the stream and replays exactly as it did before this existed —
    // the same contract the cycler and the drift keep.
    this.formation = scene.build({ slots, perSlot: this.caps.stagePerSlot, rng: forkRng() });
    this.slots = Array.from({ length: slots }, () => emptyOccupant());
    this.solidSlots = Array.from({ length: solids }, () => emptyOccupant());
    this.lastBound = null;
  }

  /** Panels that must stay resident, for the pool's pin set and the prefetch. */
  wants(): Panel[] {
    const panels: Panel[] = [];
    for (const slot of [...this.slots, ...this.solidSlots]) {
      if (slot.panel) panels.push(slot.panel);
    }
    return panels;
  }

  /** The most recently bound panel — the anchor the next selection rhymes off. */
  anchor(): Panel | null {
    return this.lastBound;
  }

  /** The panel carrying the frame, for the credit line. */
  feature(time: number): Panel | null {
    let best: Panel | null = null;
    let bestOpacity = 0.15;
    for (const slot of this.slots) {
      if (!slot.panel) continue;
      const opacity = envelope(slot.curve, time - slot.bornAt, slot.lifetime);
      if (opacity > bestOpacity) {
        bestOpacity = opacity;
        best = slot.panel;
      }
    }
    // Falls back to a solid only when no slot is carrying anything, which
    // happens on the opening frames and while a heavily filtered wall decodes.
    if (best) return best;
    return this.solidSlots.find((slot) => slot.panel)?.panel ?? null;
  }

  /**
   * Advance residency and produce the frame. `pick` is the director's weighted
   * selection — the stage decides *when* a panel is needed and the director
   * decides which, so the rhyme/clash policy applies here exactly as it does to
   * the flat path.
   */
  update(
    time: number,
    travel: number,
    orbit: number,
    config: VizConfig,
    tint: Rgb,
    safety: SafetyGovernor,
    pick: () => Panel | null
  ): StageFrame | null {
    const formation = this.formation;
    const scene = this.scene;
    if (!formation || !scene) return null;

    const dwell = Math.max(4, config.layerLifetime);
    this.refill(this.slots, time, dwell, config, safety, pick);
    this.refill(this.solidSlots, time, dwell * SOLID_DWELL, config, safety, pick);

    const params = formation.frame({
      time,
      travel,
      orbit,
      solidBudget: this.solidSlots.length,
      config,
    });

    const slots: StageSlotDraw[] = this.slots.map((slot) => ({
      panelId: slot.panel?.id ?? "",
      opacity: slot.panel ? envelope(slot.curve, time - slot.bornAt, slot.lifetime) : 0,
      // The same levelling the drift stack applies, and for a sharper version
      // of the same reason: these composite additively, so a wall of white
      // comic pages does not merely wash the frame out, it saturates it.
      levels: levelsFor(slot.panel?.dominantColors ?? null, config.keyBalance),
      tint,
      tintAmount: config.tintAmount,
      aspect: slot.panel ? panelAspect(slot.panel) : 0.75,
    }));

    const solids: SolidDraw[] = [];
    for (let i = 0; i < params.solids.length && i < this.solidSlots.length; i++) {
      const slot = this.solidSlots[i];
      if (!slot.panel) continue;
      const placement = params.solids[i];
      solids.push({
        shape: placement.shape,
        panelId: slot.panel.id,
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale,
        opacity:
          placement.opacity * envelope(slot.curve, time - slot.bornAt, slot.lifetime),
        levels: levelsFor(slot.panel.dominantColors, config.keyBalance),
        tint,
        tintAmount: config.tintAmount * 0.5,
      });
    }

    return {
      kind: scene.kind,
      layout: formation.layout,
      slots,
      solids,
      time,
      morph: params.morph,
      billboard: params.billboard,
      scale: params.scale,
      breathe: params.breathe,
      spin: params.spin,
      eye: params.eye,
      look: params.look,
      fov: params.fov,
      wrap: params.wrap,
      travel,
      fogNear: params.fogNear,
      fogFar: params.fogFar,
    };
  }

  /**
   * Hand any expired slot to a new panel.
   *
   * The handover lands exactly where the envelope is zero — a slot's tenancy
   * ends at the bottom of its own fade — so the swap is invisible rather than
   * needing a second texture bound to cross-dissolve against. With the slots
   * staggered across the dwell it reads as pages turning over somewhere in the
   * formation, never as the formation changing.
   */
  private refill(
    slots: Occupant[],
    time: number,
    dwell: number,
    config: VizConfig,
    safety: SafetyGovernor,
    pick: () => Panel | null
  ): void {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.panel && time < slot.bornAt + slot.lifetime) continue;

      const panel = pick();
      // Nothing eligible — a wall filtered down to fewer panels than there are
      // slots. Hold what is there rather than blanking the slot.
      if (!panel) {
        if (slot.panel) slot.bornAt = time;
        continue;
      }

      const jitter = 1 + ((i * 0.37) % 1) * config.layerLifetimeJitter;
      const lifetime = dwell * jitter;
      const fade = safety.clampFade(lifetime * config.crossfade * 0.5);

      slot.panel = panel;
      slot.lifetime = lifetime;
      slot.curve = { fadeIn: fade, fadeOut: fade, peak: config.stageOpacity };
      // First tenancy is staggered across the dwell, so the slots do not all
      // turn over together for the rest of the run.
      slot.bornAt = slot.bornAt < 0 ? time - (i / slots.length) * lifetime : time;
      this.lastBound = panel;
    }
  }
}

function emptyOccupant(): Occupant {
  return {
    panel: null,
    // Negative marks a slot that has never been filled, which is what the
    // opening stagger keys off.
    bornAt: -1,
    lifetime: 1,
    curve: { fadeIn: 0, fadeOut: 0, peak: 1 },
  };
}
