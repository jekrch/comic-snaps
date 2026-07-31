import type { SurfaceDraw, Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, cloud, fibonacciSphere, nextRevision } from "./spatial";

/**
 * Shatter — a globe of one comic page that opens along its own seams, throws a
 * few large shards clear of itself, and closes back up.
 *
 * The scene this replaces was six torn crops drifting apart on a curl current,
 * and the trouble with it was never the current — it was that six rectangles
 * dispersing through a dark frame is six rectangles in a dark frame. Something
 * has to come apart for a dispersal to read as one, and there was nothing there:
 * the "assembled" end of the morph was a loose slab of overlapping crops, which
 * is already most of the way to scattered.
 *
 * So the thing that comes apart is a body now. At the closed end of the morph it
 * is a single sealed object papered in one page; as the morph runs, every plate
 * on it swells outward off its own seams until the globe is armour standing off
 * itself in fifteen pieces with black valleys between them, and a handful of
 * shards have left it entirely and are drifting on the curl. Then it all comes
 * back. The frame is never empty at either end, because the body is always
 * there.
 *
 * This is also the one scene left that uses the instanced quad path, and it uses
 * it for the one thing quads are unambiguously better at than a surface: a piece
 * that is genuinely *separate*. A plate on the body can only bulge, because
 * tearing a grid needs per-cell geometry; a shard that has left is a free
 * rectangle with its own crop, its own roll and its own place in the current,
 * which is exactly a quad. The two halves run off the same morph and the same
 * slots, so the shards and the body they came off are always the same page.
 */

/**
 * Circumradius of the body.
 *
 * Large enough that the object's silhouette is wider than the frame's own field
 * at the camera distance below — so it overflows the picture rather than sitting
 * inside it with black all round. That is not a stylistic preference: a body
 * that fits comfortably in frame leaves two thirds of the picture empty, which
 * is the failing this whole scene replaced.
 */
const RADIUS = 5;
/** Half-height. Stocky, so the body is a boulder rather than an egg. */
const HEIGHT = 4.7;
/** Lobes around. Five, and softened nearly to round — this is not a faceted
 *  solid like the prism but a rough one, and the lobes are what keep the
 *  silhouette from being a circle at every angle. */
const LOBES = 5;
/** Plates around and up. Fifteen in total, of which five or six face the
 *  camera — a plate is a hand-sized piece of the page rather than a chip. */
const PLATES_AROUND = 5;
const PLATES_UP = 3;
/** How far a plate stands off the body at the open end of the morph, world
 *  units. Set against the gutter: far enough that the valley between two plates
 *  is plainly a gap rather than a crack. */
const BURST_MAX = 0.95;

/** Where the shards sit before they leave — just clear of the body, so they read
 *  as pieces resting on it rather than as pieces buried in it. */
const SHARD_REST = RADIUS * 1.12;
/** How far they get. Past the frame's edge at full dispersal, so some of them
 *  leave entirely and the ones that remain are unmistakably far from home. */
const SHARD_SPREAD = 7.5;

/** Camera distance, set by clearance: the body does not translate, so the only
 *  thing that can reach the lens is its own swelling — the radius, plus a plate
 *  standing off it, plus the undulation on top. This clears all three by about a
 *  unit and no more, because the object is meant to be crowding the frame. */
const EYE_DISTANCE = 7.4;

/** Coarseness of the current the shards ride. Low, so a whole region of the
 *  dispersal moves together and the scatter has structure rather than being
 *  per-shard jitter. */
const SWIRL_SCALE = 0.22;
/** Standing swirl, before the config adds to it. Without it the shards travel
 *  in straight lines between the two arrangements, which reads as a transition
 *  rather than as motion. */
const SWIRL_BASE = 0.4;

export const shatter: SpatialScene = {
  name: "shatter",
  kind: "shatter",
  // Two panels, taking turns. Sequential and not concurrent, because the body
  // and the shards have to be the *same* page for the scene to say anything —
  // two pages resident at once would be a globe of one and debris of another.
  panels: 2,
  // Four shards on the page that owns the body. Few, and large: these are the
  // pieces that have left, and a cloud of small ones would be the confetti the
  // whole rework is getting away from.
  perPanel: 4,
  sequential: true,
  solidPanels: 0,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      // Resting on the body, facing outward — so at the closed end of the morph
      // a shard lies flat against the globe and is hard to tell from a plate of
      // it, which is the point.
      fibonacciSphere(SHARD_REST),
      cloud(SHARD_SPREAD),
      // Large quads, generous crops, and a wide roll. The roll is what makes
      // them read as torn: four rectangles at the same angle read as a set,
      // however far apart they get.
      { size: [1.1, 1.7], tilt: 0.7, crop: [0.4, 0.75] }
    );

    return {
      layout,

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const scale = clamp(config.stageScale, 0.5, 1.8);

        const surface: SurfaceDraw = {
          body: "body",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          size: [RADIUS * scale, HEIGHT * scale, 1],
          sides: LOBES,
          // Nearly round, and deliberately not quite: a sphere's silhouette is
          // the same circle from every direction, and a body whose outline never
          // changes as it turns does not look like it is turning.
          round: 0.72,
          cap: 2.2,
          // A slow shear of the plate grid, bounded for the reason the prism's
          // is: the accumulator only grows, and a shear that grows tears the
          // body's own seams past each other.
          twist: Math.sin(orbit * 0.6) * 0.35,
          // The whole scene, on the morph. Squared, so the body stays sealed
          // through the first part of the swing and then opens quickly — an
          // object breaking rather than an object slowly inflating.
          burst: morph * morph * BURST_MAX,
          ripple: 0.12 + config.stageDisplace * 0.4,
          rippleScale: 1.4,
          ripplePhase: swell,
          cells: [PLATES_AROUND, PLATES_UP],
          cellAspect: ((Math.PI * 2 * RADIUS) / PLATES_AROUND) / ((HEIGHT * 2) / PLATES_UP),
          zoom: 0.5,
          // The widest in the engine. The gutter is what lands at the bottom of
          // the valley between two lifted plates, so it has to be wide enough to
          // still be dark once the plates have pulled apart over it.
          gutter: 0.045,
          rim: 0.42,
          solid: true,
          knot: [2, 3],
        };

        return {
          morph,
          // Bounded on both sides. A shard turned fully edge-on is gone, and one
          // turned fully to the lens is a sprite with no depth in it — held
          // between so some of them always catch the light at an angle.
          billboard: clamp(config.stageBillboard, 0.3, 0.75),
          align: 0,
          scale: config.stageScale,
          // Soft. These are torn pieces, and a hard rectangle edge is the one
          // thing that would say otherwise — feathered, they dissolve into the
          // dark and into the body they came off.
          feather: 0.18 + config.stageFeather,
          breathe: config.stageBreathe,
          displace: config.stageDisplace,
          displaceScale: 1.1,
          displacePhase: swell,
          swirl: SWIRL_BASE + config.stageSwirl,
          swirlScale: SWIRL_SCALE,
          // The body's turn, carrying the shards with it — they are in the same
          // frame, so a piece that has left still orbits with what it left.
          spin: [
            Math.sin(time * 0.0121) * 0.26,
            orbit,
            Math.sin(time * 0.0091) * 0.15,
          ] as Vec3,
          eye: [
            Math.sin(time * 0.0187) * 0.9,
            Math.sin(time * 0.0141) * 0.7,
            EYE_DISTANCE + Math.sin(time * 0.0109) * 1,
          ] as Vec3,
          look: [Math.sin(time * 0.0073) * 0.45, Math.cos(time * 0.0057) * 0.35, -0.4] as Vec3,
          fov: config.stageFov,
          wrap: 0,
          // Generous, because the shards now rest much closer to the lens than
          // they used to: a piece coming past the camera fades out well before
          // it can swell through it.
          fogNear: 1.4,
          fogFar: EYE_DISTANCE + SHARD_SPREAD + 4,
          shell: null,
          surface,
          solids: [],
        };
      },
    };
  },
};
