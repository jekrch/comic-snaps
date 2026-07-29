import type { Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, fibonacciSphere, nextRevision, phyllotaxis } from "./spatial";

/**
 * Swarm — several hundred panel crops on a phyllotaxis spiral, folding into a
 * Fibonacci sphere and back.
 *
 * This is the scene the flat path structurally could not reach. The composite
 * shader blends twelve shards in one pass and ping-pongs beyond that, so the
 * cap on how much of the gallery can be on screen at once is a fill-rate cap;
 * instancing moves the count into a vertex attribute, where four hundred quads
 * cost four hundred vertices rather than four hundred screens of fill.
 *
 * What it buys over a mosaic is parallax. The quads sit at genuinely different
 * depths, so the near ones sweep past the far ones as the formation turns, and
 * that separation is not something a uv remap of a flat frame can imitate.
 */

/** Radius of the open spiral, in world units. */
const DISC_RADIUS = 3.3;
/** How far the spiral recedes as it opens out — the source of the parallax. */
const DISC_DEPTH = 5.2;
const SPHERE_RADIUS = 2.5;
/** Camera distance, sized so the sphere fills the frame without clipping it. */
const EYE_DISTANCE = 7.2;

export const swarm: SpatialScene = {
  name: "swarm",
  kind: "swarm",
  // The swarm *is* the middle distance. A solid in among the quads would be
  // read as the thing the arrangement is orbiting, and it is not orbiting
  // anything — that reading belongs to the vault.
  solidPanels: 0,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      phyllotaxis(DISC_RADIUS, DISC_DEPTH),
      fibonacciSphere(SPHERE_RADIUS),
      { size: [0.17, 0.36], tilt: 0.5, crop: [0.34, 0.9] }
    );

    return {
      layout,

      frame({ time, orbit, config }: SpatialFrameContext) {
        // The morph swings around wherever the preset parked it, by whatever
        // headroom is left on the nearer side. So 0 is a spiral that stays a
        // spiral, 1 is a sphere that stays a sphere, and 0.5 is the full fold
        // in both directions — one knob, with both ends meaning something.
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        // Three incommensurate wobbles, all well under a cycle a minute. The
        // formation's own turn is the motion here; the camera only has to stop
        // the composition from being the same picture from the same seat.
        const eye: Vec3 = [
          Math.sin(time * 0.023) * 0.9,
          Math.sin(time * 0.0173) * 0.7,
          EYE_DISTANCE + Math.sin(time * 0.0131) * 1.5,
        ];
        const look: Vec3 = [
          Math.sin(time * 0.0091) * 0.55,
          Math.cos(time * 0.0071) * 0.45,
          -1.2,
        ];

        return {
          morph,
          billboard: config.stageBillboard,
          scale: config.stageScale,
          breathe: config.stageBreathe,
          // Turning about y is the orbit; the slow tilt and roll keep the
          // spiral from ever being seen exactly edge-on or exactly flat.
          spin: [Math.sin(time * 0.0137) * 0.38, orbit, Math.sin(time * 0.0107) * 0.22],
          eye,
          look,
          fov: config.stageFov,
          // Nothing to repeat: the swarm is a finite object seen from outside.
          wrap: 0,
          fogNear: 0.7,
          fogFar: EYE_DISTANCE + DISC_DEPTH + 4,
          solids: [],
        };
      },
    };
  },
};
