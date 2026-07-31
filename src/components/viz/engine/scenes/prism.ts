import type { SurfaceDraw, Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { clamp, nextRevision } from "./spatial";

/**
 * Prism — one large many-sided body, turning, with a different detail of the
 * same comic page on every face.
 *
 * This scene replaces a phyllotaxis funnel of separate quads, and the reason is
 * the reason the vault gave up its quads: a formation of rectangles in the dark
 * is mostly dark. Four large pages on a spiral is a *sparse* composition however
 * carefully the four are placed — the frame is four bright shapes and a great
 * deal of black between them, and no amount of turning it changes that, because
 * the emptiness is the arrangement rather than the pacing.
 *
 * A closed body has no emptiness in it. It is one surface, it fills the middle
 * of the frame at every angle, and it has *sides* — so the parallax the spiral
 * was reaching for is delivered by a face swinging away and its neighbour coming
 * round, which is the same cue much more strongly stated.
 *
 * What it buys beyond that is the crops. Every face draws its own
 * sub-rectangle of the one resident page, so a turn of the body is a dozen
 * unrelated details of a single page arriving one after another: a hand, a
 * caption, a corner of sky, all plainly from the same drawing and none of them
 * where they belong. That is the "out of context" reading the flat path gets by
 * scattering shards, except the pieces here are the faces of an object.
 *
 * The shape itself is on the morph knob and swings between two solids: a cut
 * gem — hard polygonal section, pointed ends — and a rounded drum. The
 * undulation runs on top of both, so the body is never quite the ideal solid it
 * is heading toward.
 */

/** Circumradius of the body. Set against the frame rather than against
 *  anything in the scene: at the camera distance below this is nearly the full
 *  width of the picture, which is the whole correction being made here. */
const RADIUS = 3;
/** Half-height. Close to the radius, so the body is stocky — a tall one leaves
 *  the corners of a wide frame empty, which is the failure being fixed. */
const HEIGHT = 3.1;
/**
 * Faces around.
 *
 * Six, and it is a compositional number rather than a geometric one: at any
 * moment about three of them face the camera, which is three large details of
 * one page on screen at once. Eight is four, and four is already a mosaic;
 * four faces is two, and two does not read as an object with sides at all.
 */
const SIDES = 6;
/** Rows of faces up the body. Two, for the same reason there are six around —
 *  this is twelve crops in total and three or four of them visible. */
const ROWS = 2;
/**
 * Widest helical shear of the facets, radians end to end.
 *
 * Bounded, and for the reason the vault's twist is: `orbit` only ever grows, and
 * spent as a shear rather than as a rotation that is a body which keeps winding
 * until its own facets cross. So the accumulator drives the shear's *phase* — it
 * winds one way, unwinds through straight and winds back — and `stageSpin` still
 * means the rate the facets crawl at.
 */
const TWIST_MAX = 0.75;

/** Camera distance, set by framing rather than by clearance: the body stands
 *  still and only turns, so nothing can arrive at the lens, and this is simply
 *  as close as it can be without the ripple pushing a facet through the frame's
 *  top edge. */
const EYE_DISTANCE = 5.7;

export const prism: SpatialScene = {
  name: "prism",
  kind: "prism",
  /**
   * Two panels, and both of them are the whole body.
   *
   * They hand over rather than being seen at once, exactly as the vault's two
   * do: a page owns every face of the object for the whole of its dwell, and the
   * only moment two are on it is the dissolve. The scene's entire premise is
   * that the faces are details of *one* drawing, and two pages superimposed on
   * every face at once would say the opposite.
   */
  panels: 2,
  // No quads. The body is the surface.
  perPanel: 0,
  sequential: true,
  // A solid inside a closed body is invisible, and one outside it is a second
  // object competing with the subject.
  solidPanels: 0,

  build(): SpatialFormation {
    return {
      // Nothing to lay out: a surface is geometry the pass builds from uniforms.
      layout: { revision: nextRevision(), slots: [] },

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const scale = clamp(config.stageScale, 0.5, 1.8);
        const radius = RADIUS * scale;

        const surface: SurfaceDraw = {
          body: "body",
          position: [0, 0, 0],
          // No turn of its own: the formation's spin below is the body's turn,
          // so `stageSpin` means one thing here rather than two.
          rotation: [0, 0, 0],
          size: [radius, HEIGHT * scale, 1],
          sides: SIDES,
          // Gem to drum. Held well under 1 at the round end — a body with no
          // corners left has no faces either, and the crops stop having edges to
          // hand over at.
          round: 0.04 + morph * 0.62,
          // 1 is a bipyramid and anything over about 4 is a barrel with nearly
          // flat ends, so this is the profile doing most of the shape change.
          cap: 1.45 + morph * 2.9,
          twist: Math.sin(orbit) * TWIST_MAX,
          burst: 0,
          // A standing undulation, plus whatever the config asks for. Standing
          // because it is the difference between a turning solid — which the eye
          // reads in a second and then stops looking at — and a surface that is
          // never quite the shape it is heading toward.
          ripple: 0.16 + config.stageDisplace * 0.45,
          rippleScale: 1,
          ripplePhase: swell,
          cells: [SIDES, ROWS],
          // One face is roughly the circumference over six by the height over
          // two — a little wider than tall, which is what the crop is matched to.
          cellAspect: ((Math.PI * 2 * RADIUS) / SIDES) / ((HEIGHT * 2) / ROWS),
          // Tight. A face is large on screen, so half a page across it is
          // already a detail blown up past the point of recognition — which is
          // exactly the reading wanted.
          zoom: 0.45,
          gutter: 0.028,
          rim: 0.35,
          solid: true,
          knot: [2, 3],
        };

        return {
          morph,
          // Everything on this half of the contract belongs to the quad program,
          // and there are no quads. Held at rest rather than at the config's
          // values so the tuning panel cannot make a surface scene look broken
          // by moving a slider with nothing to act on.
          billboard: 0,
          align: 0,
          scale: 1,
          feather: 0,
          breathe: 0,
          displace: 0,
          displaceScale: 1,
          displacePhase: swell,
          swirl: 0,
          swirlScale: 1,
          // The body's turn. About y mostly — that is the axis its faces are
          // arranged around, so turning about it is faces handing over — with a
          // slow bounded nod on the other two so the same three faces are never
          // presented from quite the same seat.
          spin: [Math.sin(time * 0.0113) * 0.22, orbit, Math.sin(time * 0.0087) * 0.1] as Vec3,
          eye: [
            Math.sin(time * 0.021) * 0.5,
            Math.sin(time * 0.0163) * 0.42,
            EYE_DISTANCE + Math.sin(time * 0.0117) * 0.7,
          ] as Vec3,
          look: [Math.sin(time * 0.0083) * 0.3, Math.cos(time * 0.0061) * 0.25, 0] as Vec3,
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0,
          // Far enough back that the body's own far side is only slightly dimmed
          // — the fog here is depth shading on one object, not a horizon.
          fogFar: EYE_DISTANCE + RADIUS + 7,
          shell: null,
          surface,
          solids: [],
        };
      },
    };
  },
};
