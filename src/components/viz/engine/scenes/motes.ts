import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, cloud, nextRevision, slab } from "./spatial";

/**
 * Motes — a page torn into a few large shards, drifting apart into a slow ball of
 * them and back together, carried on a curl-noise current the whole time.
 *
 * It was flecks, and flecks were the mistake this scene existed to make. Ground
 * fine enough, comic art stops being comic art: a few hundred small crops on a
 * current is a beautiful *particle field* in which nothing can be recognised, and
 * the point of the piece is the panels. So the grind is coarse now — six shards,
 * each a good fraction of the frame, each showing a readable piece of a page. The
 * slab still assembles into something like a single image and still comes apart,
 * but what comes apart is legible while it does it.
 *
 * The backlog asked for this as *GPGPU particles*, and it is not that: the
 * positions are a formation morph plus a stateless field evaluated in the vertex
 * shader, not a ping-pong integration. That is a deliberate substitution and
 * worth being explicit about, because it trades something away.
 *
 * What it buys: no fourth simulation buffer beside the bloom, the history ring
 * and the two fields; nothing to desynchronise from the morph, which is the one
 * schedule the pacing rules want in charge; and no accumulation, so a run that
 * lasts an hour is in exactly the state a run that lasted a minute would be. An
 * integrated field drifts, and a drift over an hour is a scene that has quietly
 * become a different scene.
 *
 * What it gives up is inertia and history. These shards cannot trail, cannot be
 * flung and settle, and cannot remember having been somewhere — every one of them
 * is a pure function of its index and the clock. A real integrator is the only way
 * to get those, and it is a separate piece of work rather than a flag on this one.
 *
 * The curl noise is what keeps it from being a lerp. It is divergence-free, so it
 * transports the shards without piling them up, and it is evaluated on each
 * shard's *own* position — so the slab does not merely expand, it is stirred while
 * it expands.
 */

/** The assembled block. Sized so six large crops tile it with overlap: the slab
 *  has to read as one surface for the dispersal to be a surface coming apart. */
const SLAB_WIDTH = 3.2;
const SLAB_HEIGHT = 2.2;
/** Thin. A slab with depth reads as a cloud already, and the interest is in it
 *  becoming one. */
const SLAB_DEPTH = 0.5;

/** Dispersal radius. Only a little larger than the slab's own diagonal — the
 *  shards are big, so they need to travel much less far than flecks did to be
 *  unmistakably scattered, and a wider ball just pushes them out of frame. */
const CLOUD_RADIUS = 2.4;
/** Camera distance, set by clearance: the shards are large, and the curl current
 *  carries them more than a unit off the arrangement in any direction it likes. */
const EYE_DISTANCE = 8.4;

/** How coarse the current is. Low, so a whole region of the slab moves together
 *  and the dispersal has structure — high values are per-shard jitter, which is
 *  noise rather than a current. */
const SWIRL_SCALE = 0.2;
/** Standing swirl, before the config adds to it. Raised with the shard size: the
 *  current has to move something a unit across far enough to be seen doing it. */
const SWIRL_BASE = 0.55;

export const motes: SpatialScene = {
  name: "motes",
  kind: "motes",
  // Two pages, three shards each. Six pieces is enough to read as something torn
  // and few enough that each piece is a picture.
  panels: 2,
  perPanel: 3,
  solidPanels: 0,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      slab(SLAB_WIDTH, SLAB_HEIGHT, SLAB_DEPTH),
      cloud(CLOUD_RADIUS),
      // Big quads and generous crops: a shard is a torn half of a page rather than
      // either a whole one or a fleck of one. The wide tilt is what makes them read
      // as torn — six rectangles at the same roll read as a grid, however far apart
      // they drift.
      { size: [1.2, 2], tilt: 0.7, crop: [0.45, 0.8] }
    );

    return {
      layout,

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        return {
          morph,
          // Bounded on both sides. A fleck turned edge-on is simply gone, which is
          // why this used to be pinned at 1 — but a shard this size turned edge-on
          // is a bright line in space, and that is worth having. Held under 1 so
          // some of them always catch the light at an angle, and over a third so
          // the whole field never disappears at once.
          billboard: clamp(config.stageBillboard, 0.35, 0.8),
          align: 0,
          scale: config.stageScale,
          // The softest in the engine. These are torn pieces, and a hard rectangle
          // edge is the one thing that would say otherwise — feathered, the crops
          // dissolve into the dark and into each other where they cross.
          feather: 0.2 + config.stageFeather,
          breathe: config.stageBreathe,
          displace: config.stageDisplace,
          displaceScale: 1.1,
          displacePhase: swell,
          // The current, standing. Without it the morph is a lerp between two
          // arrangements and every shard travels in a straight line, which is
          // visible immediately and reads as a transition rather than as motion.
          swirl: SWIRL_BASE + config.stageSwirl,
          swirlScale: SWIRL_SCALE,
          spin: [Math.sin(time * 0.0121) * 0.24, orbit, Math.sin(time * 0.0091) * 0.14],
          eye: [
            Math.sin(time * 0.0187) * 1.1,
            Math.sin(time * 0.0141) * 0.8,
            EYE_DISTANCE + Math.sin(time * 0.0109) * 1.2,
          ],
          look: [Math.sin(time * 0.0073) * 0.5, Math.cos(time * 0.0057) * 0.4, -0.5],
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0.6,
          fogFar: EYE_DISTANCE + CLOUD_RADIUS + 5,
          shell: null,
          solids: [],
        };
      },
    };
  },
};
