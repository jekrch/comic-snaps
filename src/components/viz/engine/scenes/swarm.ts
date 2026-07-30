import type { Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, fibonacciSphere, nextRevision, phyllotaxis } from "./spatial";

/**
 * Swarm — a few large panel crops on an open spiral, folding into a shell and
 * back.
 *
 * It used to be several hundred of them, and that was the wrong reading of what
 * the third dimension buys. What a real projection gives that a uv warp cannot is
 * *parallax*: quads at genuinely different depths sweep past one another as the
 * formation turns, and near ones foreshorten differently from far ones. None of
 * that needs a crowd. It needs faces large enough for the eye to track one across
 * the frame — and a crowd actively destroys it, because a hundred small crops all
 * moving at slightly different rates reads as boiling texture, not as depth.
 *
 * So: four quads, each most of the frame's height, on a spiral that recedes and
 * leans outward as it goes — a funnel of comic pages, turning, that folds into a
 * shell and back. Two pages at a time, seen twice each.
 */

/** Radius of the open spiral, in world units. Held under the visible half-height
 *  so the quads overlap near the axis rather than orbiting a hole. */
const DISC_RADIUS = 1.9;
/**
 * How far the spiral recedes as it opens out — the source of the parallax.
 *
 * Shallow, and it has to be. The formation turns through every angle, so whatever
 * depth the spiral has eventually swings *toward* the camera; with quads this
 * large, a deep funnel puts a page corner through the viewer's eye once a
 * revolution. The parallax that survives at this depth is still plainly parallax —
 * it is the near quad's foreshortening against the far one, not the span.
 */
const DISC_DEPTH = 2.6;
/** Sphere radius. Close to the disc's, so the fold is the same pages rearranging
 *  rather than the formation changing size. */
const SPHERE_RADIUS = 1.9;
/**
 * Camera distance.
 *
 * Set by clearance rather than by framing: the whole formation, plus the corner of
 * the largest quad on it, has to stay outside the eye at every angle the orbit
 * reaches. Framing then comes from the quad *size* instead — a page here is two
 * thirds of the frame's height from this far back, which is the same picture a
 * closer camera would give and none of the risk of flying through anything.
 */
const EYE_DISTANCE = 8.8;
/** How far the outermost quad leans outward — see `phyllotaxis`. Enough that the
 *  rim of the spiral is clearly turned away from the lens while the middle of it
 *  is not, which is what makes the arrangement a funnel and not a wall. */
const DISC_BOWL = 0.85;

export const swarm: SpatialScene = {
  name: "swarm",
  kind: "swarm",
  // Two pages, two crops each. Two is the floor for this scene rather than a
  // preference: the subject is one page passing in front of another, and one page
  // cannot pass in front of anything.
  panels: 2,
  perPanel: 2,
  // The swarm *is* the middle distance. A solid in among the quads would be
  // read as the thing the arrangement is orbiting, and it is not orbiting
  // anything — that reading belongs to the vault.
  solidPanels: 0,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      phyllotaxis(DISC_RADIUS, DISC_DEPTH, DISC_BOWL),
      fibonacciSphere(SPHERE_RADIUS),
      // Very large quads, near-whole-page crops, and a real tilt. The tilt is the
      // only source of variety left with four of them: without it, four rectangles
      // at the same roll read as a stack of cards.
      { size: [1.5, 2.3], tilt: 0.42, crop: [0.72, 1] }
    );

    return {
      layout,

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
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
          EYE_DISTANCE + Math.sin(time * 0.0131) * 1.2,
        ];
        const look: Vec3 = [
          Math.sin(time * 0.0091) * 0.55,
          Math.cos(time * 0.0071) * 0.45,
          -1.2,
        ];

        return {
          morph,
          // Capped well under 1. Billboarding is what a *speck* wants, because a
          // speck seen edge-on is gone; a page seen edge-on is the strongest cue
          // in the frame that this is geometry and not a collage, so at these
          // sizes turning them all to face the lens throws away the effect.
          billboard: Math.min(0.55, config.stageBillboard),
          // A scatter has no along-direction worth following; the quads' own
          // random tilt is the roll here.
          align: 0,
          scale: config.stageScale,
          // Slight. These are pages and want an edge, but a hard corner on
          // something this large aliases into a bright line as it turns.
          feather: 0.05 + config.stageFeather,
          breathe: config.stageBreathe,
          // Both off unless the config asks. On a sphere the displacement is the
          // whole surface breathing in and out, which is worth having — and the
          // scales are the formation's, since what counts as one wavelength
          // depends on how large the arrangement is.
          displace: config.stageDisplace,
          displaceScale: 0.8,
          displacePhase: swell,
          swirl: config.stageSwirl,
          swirlScale: 0.3,
          // Turning about y is the orbit; the slow tilt and roll keep the
          // spiral from ever being seen exactly edge-on or exactly flat.
          spin: [Math.sin(time * 0.0137) * 0.38, orbit, Math.sin(time * 0.0107) * 0.22],
          eye,
          look,
          fov: config.stageFov,
          // Nothing to repeat: the swarm is a finite object seen from outside.
          wrap: 0,
          fogNear: 0.6,
          fogFar: EYE_DISTANCE + DISC_DEPTH + 4,
          shell: null,
          solids: [],
        };
      },
    };
  },
};
