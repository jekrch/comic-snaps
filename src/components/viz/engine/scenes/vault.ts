import type { Vec3 } from "../types";
import type {
  SolidPlacement,
  SpatialFormation,
  SpatialFrameContext,
  SpatialScene,
} from "./spatial";
import { buildLayout, clamp, nextRevision, tube } from "./spatial";

/**
 * Vault — comic pages papering the inside of a tube, flown down the axis, with
 * solids tumbling through the middle distance.
 *
 * The post chain already has a `tunnel`: it maps screen radius to depth and
 * textures an infinite cylinder in one fullscreen pass. This is the thing that
 * one is an impression of. The pages are separate quads at separate depths seen
 * through a real projection, so they foreshorten individually, the near ones
 * slide past the lens at a different rate from the far ones, and the solids
 * *occlude* — a page behind a torus is gone, which no uv remap can express
 * because a uv remap has nothing to be behind.
 *
 * The flight never accumulates a coordinate. The tube is a finite ring of
 * instances wrapped by its own length in the vertex shader, so the camera sits
 * still and the corridor moves through it: endless, and immune to the precision
 * loss a camera flying forever down -z would eventually hit.
 */

const TUBE_RADIUS = 2.7;
/** Length the formation repeats over. Also how far ahead the fog reaches, so
 *  the wrap seam always lands well inside the black. */
const TUBE_LENGTH = 30;
/** How many solids the formation is laid out for. The config selects how many
 *  of those are actually drawn, so the lanes stay put as the count changes. */
const MAX_SOLIDS = 4;

/** The barrel the straight corridor morphs into: narrow at both ends, open in
 *  the middle. Bounded away from zero so the walls never cross the axis. */
function barrel(t: number): number {
  return 0.5 + 0.85 * Math.sin(t * Math.PI);
}

interface Lane {
  shape: "torus" | "box";
  /** Where in the tube's cross-section the solid rides. */
  angle: number;
  radius: number;
  /** Offset along the repeat, so they do not arrive in a convoy. */
  offset: number;
  /** Fraction of the flight speed — under 1, so they drift back as we pass. */
  speed: number;
  scale: number;
  tumble: Vec3;
}

export const vault: SpatialScene = {
  name: "vault",
  kind: "vault",
  solidPanels: MAX_SOLIDS,

  build(ctx): SpatialFormation {
    const { rng } = ctx;

    const layout = buildLayout(
      ctx,
      nextRevision(),
      tube(TUBE_RADIUS, TUBE_LENGTH, () => 1),
      tube(TUBE_RADIUS, TUBE_LENGTH, barrel),
      // Larger and less tilted than the swarm's: these are wallpaper, and they
      // have to meet each other to read as a wall rather than as confetti.
      { size: [0.42, 0.78], tilt: 0.22, crop: [0.45, 1] }
    );

    const lanes: Lane[] = Array.from({ length: MAX_SOLIDS }, (_, i) => ({
      shape: rng.bool(0.6) ? "torus" : "box",
      angle: rng.range(0, Math.PI * 2),
      // Kept well inside the wall: a solid grazing the pages reads as a
      // collision, and one near the axis reads as something we fly through.
      radius: rng.range(0.25, 1.5),
      offset: ((i + rng.range(0.1, 0.9)) / MAX_SOLIDS) * TUBE_LENGTH,
      speed: rng.range(0.55, 0.85),
      scale: rng.range(0.5, 0.95),
      tumble: [rng.range(-0.09, 0.09), rng.range(-0.09, 0.09), rng.range(-0.06, 0.06)],
    }));

    return {
      layout,

      frame({ time, travel, orbit, solidBudget, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const wanted = Math.round(clamp(config.stageSolids, 0, Math.min(MAX_SOLIDS, solidBudget)));
        const solids: SolidPlacement[] = lanes.slice(0, wanted).map((lane) => {
          // Same wrap the pages use, at the lane's own fraction of the speed —
          // which is what makes them read as objects being overtaken rather
          // than as decoration pinned to the corridor.
          const z = ((lane.offset + travel * lane.speed) % TUBE_LENGTH) - TUBE_LENGTH;
          return {
            shape: lane.shape,
            position: [
              Math.cos(lane.angle) * lane.radius,
              Math.sin(lane.angle) * lane.radius,
              z,
            ],
            rotation: [
              time * lane.tumble[0],
              time * lane.tumble[1],
              time * lane.tumble[2],
            ],
            scale: lane.scale,
            opacity: 1,
          };
        });

        return {
          morph,
          billboard: config.stageBillboard,
          scale: config.stageScale,
          breathe: config.stageBreathe,
          // Roll only. Tilting the corridor would swing the walls across the
          // frame, and the walls are most of the frame.
          spin: [0, 0, orbit],
          // The camera holds the axis and only sways off it, because the flight
          // is the wrap moving past rather than the eye going anywhere.
          eye: [Math.sin(time * 0.019) * 0.32, Math.sin(time * 0.0143) * 0.26, 0],
          look: [Math.sin(time * 0.0089) * 0.5, Math.cos(time * 0.0067) * 0.4, -6],
          fov: config.stageFov,
          wrap: TUBE_LENGTH,
          // A page arriving at the lens has nowhere left to go, so it is faded
          // out over the last stretch instead of swelling and vanishing.
          fogNear: 1.6,
          fogFar: TUBE_LENGTH * 0.92,
          solids,
        };
      },
    };
  },
};
