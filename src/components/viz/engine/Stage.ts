import type { Panel } from "../../../types";
import type { DeviceCaps, VizConfig } from "../vizConfig";
import type { Rng } from "./rng";
import type { SafetyGovernor } from "./safety";
import { levelsFor, stackKey } from "./palette";
import type { Rgb } from "./palette";
import type { Curve, SolidDraw, StageFrame, StageKind, StageSlotDraw } from "./types";
import { envelope } from "./types";
import { CAST_FLOOR, rankCast } from "./cast";
import type { SpatialFormation, SpatialScene } from "./scenes/spatial";
import { clamp } from "./scenes/spatial";
import { panelAspect } from "./scenes/types";
import { vault } from "./scenes/vault";
import { prism } from "./scenes/prism";
import { drape } from "./scenes/drape";
import { band } from "./scenes/band";
import { shatter } from "./scenes/shatter";

const SPATIAL_SCENES: Record<StageKind, SpatialScene> = {
  vault,
  prism,
  drape,
  band,
  shatter,
};

/**
 * A solid holds its panel for this multiple of a slot's dwell. It is one large
 * object rather than one of a hundred quads, so a panel change on it is a much
 * louder event and has to happen much less often.
 */
const SOLID_DWELL = 2.5;

/**
 * How many panels a formation of this scene holds resident, split into the slots
 * that carry the surface and the solids tumbling in front of it.
 *
 * Solids come out of the same residency budget as the slots, and are capped well
 * under it: a formation that spent most of its panels on tumbling objects would
 * be a scene about the objects.
 *
 * How many slots is the scene's decision alone — the device only caps it. The
 * density knob deliberately does *not* reach it: panels resident is how many
 * images are on screen at once, which is a compositional decision the scenes have
 * already made carefully, and a slider that quietly multiplied it would undo
 * every one of them at the first drag.
 */
function residency(
  scene: SpatialScene,
  caps: DeviceCaps
): { slots: number; solids: number } {
  const solids = Math.min(scene.solidPanels, Math.floor(caps.stagePanels / 4));
  const slots = clamp(scene.panels, 1, Math.max(1, caps.stagePanels - solids));
  return { slots, solids };
}

/**
 * The whole of that, as one number: what a formation of this kind asks for on
 * the frame it is built, and therefore what has to be decoded by then for it to
 * arrive whole. See `Director.expectStage`.
 */
export function stageResidency(kind: StageKind, caps: DeviceCaps): number {
  const { slots, solids } = residency(SPATIAL_SCENES[kind], caps);
  return slots + solids;
}

/** One panel's tenancy of a slot. */
interface Occupant {
  panel: Panel | null;
  /** Whether this slot has ever held a panel. Only the opening tenancy is
   *  staggered, and this is what says which one that is. */
  filled: boolean;
  /** Engine clock at the moment it took the slot. */
  bornAt: number;
  lifetime: number;
  curve: Curve;
  /**
   * Set when the tenancy was cut short by hand rather than served out — the
   * reader stepped the run on. Its replacement takes the slot the moment it is
   * clear, instead of waiting for the slot's turn to come round again: the wait
   * is what keeps a sequential set spread out, and a step is precisely a
   * request not to wait.
   */
  stepped?: boolean;
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
 * texture however many quads are bound to it, so a formation costs a handful of
 * resident panels whatever it draws, and the pool is the same bounded LRU it
 * always was.
 *
 * How many is a handful is the scene's call, not the device's — see
 * `SpatialScene.panels`. The caps here are a ceiling on that request rather than
 * the number itself: three large pages is a composition on a phone and on a
 * desktop alike, and filling the desktop's larger budget with more of them would
 * only make it busier.
 */
export class Stage {
  private scene: SpatialScene | null = null;
  private formation: SpatialFormation | null = null;
  private slots: Occupant[] = [];
  private solidSlots: Occupant[] = [];
  private lastBound: Panel | null = null;
  /** What the live layout was actually built with, so a density change can be
   *  told from the config being reapplied unchanged sixty times a second. */
  private builtSlots = 0;
  private builtPerSlot = 0;
  /** Set by `coverArrival`, spent by the first `update` after it. */
  private covered = false;

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
   * Bring the live formation into line with the config, rebuilding when it has
   * to. Returns whether the *scene* changed, which is the thing the director has
   * to empty the flat path for.
   *
   * Called every frame, so the common case has to be free: a config reapplied
   * unchanged resolves to the same counts and returns immediately, and a
   * formation that is merely morphing is never rebuilt.
   */
  /**
   * Open the arriving formation at full strength instead of fading it up.
   *
   * The hurried opening fade in `refill` exists because a formation coming up on
   * a frame with nothing else in it has nothing to cross against. When the
   * director is crossing this arrival against a still of the path it replaced,
   * that is no longer true — and the fade then becomes actively wrong, because
   * the two curves multiply: a dissolve at half and a formation at half is a
   * quarter of a frame, and the crossing sags in the middle instead of holding
   * level. So the dissolve does the crossing, and the formation simply arrives.
   */
  coverArrival(): void {
    this.covered = true;
  }

  sync(kind: StageKind | null, config: VizConfig, forkRng: () => Rng): boolean {
    const changed = kind !== this.kind;

    if (kind === null) {
      if (!changed) return false;
      this.scene = null;
      this.formation = null;
      this.slots = [];
      this.solidSlots = [];
      this.builtSlots = 0;
      this.builtPerSlot = 0;
      return true;
    }

    const scene = SPATIAL_SCENES[kind];
    const { slots, solids } = residency(scene, this.caps);
    // Quads per panel is what the knob moves, and the floor is 1 — except for a
    // scene that asked for none, which means its surface is a shell and there is
    // nothing here for the density of quads to be the density of.
    const perSlot =
      scene.perPanel <= 0
        ? 0
        : clamp(
            Math.round(scene.perPanel * clamp(config.stageDensity, 0.25, 4)),
            1,
            this.caps.stagePerSlot
          );

    if (!changed && slots === this.builtSlots && perSlot === this.builtPerSlot) return false;

    this.scene = scene;
    // Forked only here, so a run that never reaches a spatial preset never
    // draws from the stream and replays exactly as it did before this existed —
    // the same contract the cycler and the drift keep.
    this.formation = scene.build({ slots, perSlot, rng: forkRng() });
    this.builtSlots = slots;
    this.builtPerSlot = perSlot;
    // Residency survives a rebuild that did not change how many tenants there
    // are — dragging the density slider re-lays the quads out under the panels
    // already on screen, rather than blanking the frame and decoding three more.
    if (changed || this.slots.length !== slots) {
      this.slots = Array.from({ length: slots }, () => emptyOccupant());
      this.lastBound = null;
    }
    if (changed || this.solidSlots.length !== solids) {
      this.solidSlots = Array.from({ length: solids }, () => emptyOccupant());
    }
    return changed;
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

  /**
   * The panels carrying the frame, most prominent first — the stack behind the
   * credit line. Ranked on residency alone: a formation's slots are a fixed
   * arrangement the scene composed, so unlike a drift of free shards they are
   * already the sizes they are meant to be, and how far a tenancy has faded up
   * is the whole of how present its panel is.
   */
  cast(time: number, limit: number, incumbents: string[] = []): Panel[] {
    const scores = new Map<string, number>();
    const byId = new Map<string, Panel>();
    for (const slot of this.slots) {
      if (!slot.panel) continue;
      const opacity = envelope(slot.curve, time - slot.bornAt, slot.lifetime);
      if (opacity <= CAST_FLOOR) continue;
      byId.set(slot.panel.id, slot.panel);
      scores.set(slot.panel.id, (scores.get(slot.panel.id) ?? 0) + opacity);
    }
    // Solids join only when no slot is carrying anything, which happens on the
    // opening frames and while a heavily filtered wall decodes.
    if (scores.size === 0) {
      const solid = this.solidSlots.find((slot) => slot.panel)?.panel;
      if (!solid) return [];
      byId.set(solid.id, solid);
      scores.set(solid.id, 1);
    }
    return rankCast(scores, incumbents, limit, (id) => byId.get(id) ?? null);
  }

  /**
   * Cut every tenancy short, so the formation hands over to whatever the
   * director offers next instead of serving out its dwell. This is what a step
   * looks like on a stage: the arrangement never moves, so a panel change is
   * the only thing a step can be.
   *
   * Each occupant is dropped onto the point in its own fade-out where it is
   * already showing what it is showing, so nothing jumps — it simply starts
   * leaving. A slot whose tenancy has not opened yet is showing nothing, so it
   * expires immediately, which makes it the one the incoming panel arrives in
   * and the outgoing fade something to cross against.
   */
  retire(time: number): void {
    for (const slot of [...this.slots, ...this.solidSlots]) {
      if (!slot.panel) continue;
      const remaining = slot.bornAt + slot.lifetime - time;
      if (remaining <= 0) continue;
      const { level, fadeOut } = fadeState(slot, time);
      const target = level * fadeOut;
      // Already leaving at least this fast — hurrying it would be the jump
      // this is written to avoid.
      if (remaining <= target) continue;
      slot.bornAt = time + target - slot.lifetime;
      slot.stepped = true;
    }
  }

  /**
   * How many of the stage's surfaces a typical pixel sees at once — the depth
   * the levelling has to solve against, since the quads composite additively.
   *
   * Residency is most of the answer and it is usually one: a sequential scene
   * hands one panel the surface for the whole of its dwell, with the fades
   * abutting, so the two slots are never both contributing. The scene's own
   * `overlap` covers the case residency cannot see — quads of a single panel
   * crossing each other — and the density knob moves it, because multiplying
   * the quads is exactly what puts more of them over one pixel.
   */
  private depth(): number {
    const scene = this.scene;
    if (!scene) return 1;
    const resident = scene.sequential ? 1 : this.slots.length;
    const declared = Math.max(1, scene.overlap ?? 1);
    const density = scene.perPanel > 0 ? this.builtPerSlot / scene.perPanel : 1;
    return resident * (1 + (declared - 1) * density) + this.solidSlots.length;
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
    swell: number,
    config: VizConfig,
    tint: Rgb,
    safety: SafetyGovernor,
    pick: () => Panel | null
  ): StageFrame | null {
    const formation = this.formation;
    const scene = this.scene;
    if (!formation || !scene) return null;

    const dwell = Math.max(4, config.layerLifetime);
    this.refill(this.slots, time, dwell, config, safety, pick, scene.sequential === true);
    // Solids are separate objects in the middle distance, never the same surface
    // twice, so they overlap like the quads do whatever the slots are doing.
    this.refill(this.solidSlots, time, dwell * SOLID_DWELL, config, safety, pick, false);
    // Spent across both sets, and only here: an arrival is the frame the
    // formation is built on, and every tenancy opened after it is a handover
    // inside a scene that is already running.
    this.covered = false;

    const params = formation.frame({
      time,
      travel,
      orbit,
      swell,
      solidBudget: this.solidSlots.length,
      config,
    });

    // The same levelling the drift stack applies, and for a sharper version of
    // the same reason: these composite additively, so a wall of white comic
    // pages does not merely wash the frame out, it saturates it — and it does so
    // in the scene buffer, which is eight bits and clips on write, before any
    // rolloff in post can get to it. Solved once per frame: every surface on the
    // stage is under the same stack as every other.
    const key = stackKey(this.depth(), "additive");

    const slots: StageSlotDraw[] = this.slots.map((slot) => ({
      panelId: slot.panel?.id ?? "",
      opacity: slot.panel ? envelope(slot.curve, time - slot.bornAt, slot.lifetime) : 0,
      levels: levelsFor(slot.panel?.dominantColors ?? null, config.keyBalance, key),
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
        levels: levelsFor(slot.panel.dominantColors, config.keyBalance, key),
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
      align: params.align,
      scale: params.scale,
      // Clamped here rather than per scene: the shader's smoothstep runs from 0
      // to this in the quad's own uv, so at 0.5 the two ends meet in the middle
      // and the quad has no unfeathered interior left to show a panel in.
      feather: clamp(params.feather, 0, 0.45),
      shell: params.shell,
      surface: params.surface,
      breathe: params.breathe,
      displace: params.displace,
      displaceScale: params.displaceScale,
      displacePhase: params.displacePhase,
      swirl: params.swirl,
      swirlScale: params.swirlScale,
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
   * needing a second texture bound to cross-dissolve against.
   *
   * Two schedules, chosen by the scene. Concurrent staggers the slots evenly
   * across one dwell, so they are all resident all the time and it reads as pages
   * turning over somewhere in the formation. Sequential gives each slot the
   * surface to itself in turn: a slot's tenancy starts as its predecessor's fade
   * begins, so the two fades abut and everything between them is one panel alone.
   * See `SpatialScene.sequential` for which scenes want which and why.
   */
  private refill(
    slots: Occupant[],
    time: number,
    dwell: number,
    config: VizConfig,
    safety: SafetyGovernor,
    pick: () => Panel | null,
    sequential: boolean
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
      // Where this tenancy was due to start, from the one it is replacing.
      const due = slot.bornAt + slot.lifetime;
      /**
       * How long a slot waits between tenancies, for a sequential set.
       *
       * Each slot's turn comes round every `n * (lifetime - fade)`: a tenancy is
       * `lifetime` long, but successive tenancies overlap by exactly `fade`, which
       * is what makes the outgoing fade and the incoming one the same interval.
       * The wait is whatever is left over — so at crossfade 1 the fade is half the
       * life, the wait falls to zero, and the schedule collapses into the same
       * pair of complementary triangles a concurrent set of two would give. That
       * degeneracy is deliberate: it means this is a generalisation of the old
       * behaviour rather than a second mode with its own edge cases.
       *
       * Zero for a single slot, which has no partner to hand over to and therefore
       * has to fade to black and back however it is scheduled.
       */
      const wait =
        slots.length > 1 ? Math.max(0, slots.length * (lifetime - fade) - lifetime) : 0;

      slot.panel = panel;
      slot.lifetime = lifetime;
      slot.curve = { fadeIn: fade, fadeOut: fade, peak: config.stageOpacity };
      if (!slot.filled) {
        // First tenancy is staggered across the dwell, so the slots do not all
        // turn over together for the rest of the run.
        //
        // Keyed off an explicit flag rather than off `bornAt` being negative,
        // which is what it used to be and which was wrong in a way that took a
        // simulation to see: the stagger *itself* writes a negative birth time
        // for every slot but the first, so those slots took this branch again on
        // their second tenancy — jumping to full opacity instead of fading in,
        // and re-staggering from wherever the clock had got to. Two slots meant
        // to be exact complements came out of it very nearly in step, and a pair
        // of full-frame surfaces in step is a slow two-to-one swing of the whole
        // frame's brightness.
        slot.filled = true;
        // A sequential set is staggered *forward*: slot 0 takes the surface now
        // and the rest wait their turn, with a birth time in the future that the
        // envelope reads as an age below zero and draws nothing for.
        slot.bornAt = sequential
          ? time + i * (lifetime - fade)
          : time - (i / slots.length) * lifetime;
        // A tenancy opening *now* is the formation arriving, so its fade-in has
        // nothing to cross against: it is the whole frame coming up out of
        // black, which the authored crossfade is the wrong length for. These
        // scenes hand over rarely and dissolve for a fifth of a dwell when they
        // do — eight seconds of near-nothing on a preset the viewer has just
        // asked for. Only the opening fade is hurried, and only for the slot
        // that opens on arrival: one staggered into the future opens against its
        // predecessor's fade-out and has to stay its exact complement, or the
        // surface's brightness dips at the seam. The fade-out is untouched
        // either way, so the handover it hands to is the one the scene authored.
        //
        // Floored by the governor rather than cut, because a wall or a corridor
        // is full-bleed and this is the fastest §7 lets the whole frame's
        // luminance move — unless the arrival is being crossed against the path
        // it replaced, in which case there is no fade at all and the dissolve
        // carries the whole crossing. See `coverArrival`.
        if (slot.bornAt <= time) {
          slot.curve.fadeIn = this.covered ? 0 : Math.min(fade, safety.clampFade(0));
        }
      } else {
        // Handovers land on the slot's own cadence rather than on whichever frame
        // happened to notice the expiry. That frame is up to a tick late, and a
        // tick added to every tenancy is a phase that creeps: over an hour it is
        // enough to walk a complementary pair out of complement. Snapped to the
        // clock only if the slot is more than half a life overdue, which means
        // the run was suspended rather than merely sampled coarsely.
        const next = due + (sequential && !slot.stepped ? wait : 0);
        slot.bornAt = time - next < lifetime * 0.5 ? next : time;
      }
      slot.stepped = false;
      this.lastBound = panel;
    }
  }
}

/**
 * A tenancy's linear envelope level and the fade-out it will leave by, both
 * after the same rescaling `envelope` applies when a curve's fades exceed the
 * lifetime they have to fit in. Retiring a slot needs the pair: the level says
 * where in the fade-out it already is, and the fade-out says how long the rest
 * of it takes.
 */
function fadeState(slot: Occupant, time: number): { level: number; fadeOut: number } {
  const total = slot.curve.fadeIn + slot.curve.fadeOut;
  const scale = total > slot.lifetime ? slot.lifetime / total : 1;
  const fadeIn = slot.curve.fadeIn * scale;
  const fadeOut = slot.curve.fadeOut * scale;

  const age = time - slot.bornAt;
  // Staggered forward and not yet due: showing nothing, and nothing is where
  // its fade-out would have to start from.
  if (age <= 0) return { level: 0, fadeOut };

  let level = 1;
  if (fadeIn > 0 && age < fadeIn) level = age / fadeIn;
  const remaining = slot.lifetime - age;
  if (fadeOut > 0 && remaining < fadeOut) level = Math.min(level, remaining / fadeOut);
  return { level: clamp(level, 0, 1), fadeOut };
}

function emptyOccupant(): Occupant {
  return {
    panel: null,
    filled: false,
    bornAt: 0,
    lifetime: 1,
    curve: { fadeIn: 0, fadeOut: 0, peak: 1 },
  };
}
