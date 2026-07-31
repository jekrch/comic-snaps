import type { SurfaceDraw, Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { clamp, nextRevision } from "./spatial";

/**
 * Band — one broad continuous strip of comic, wound on a torus knot, rolling
 * about its own centre line as it goes.
 *
 * The scene this replaces was a ribbon assembled out of quads laid nose to tail,
 * and it never once managed to be a ribbon. A strip only reads as a strip if it
 * is continuous, quads are continuous only where they overlap, and the number of
 * quads a formation can afford is fixed — so every version of it was either a
 * dotted line of cards or a handful of enormous ones that had stopped following
 * the curve at all. The whole file was an argument about how to make separate
 * rectangles look like one surface.
 *
 * They do not need to. A swept surface is one draw, has no seams in it anywhere,
 * and can be *wide* — this band is over two units across, which at the camera
 * distance below is a third of the frame's height whenever a stretch of it comes
 * past. A ribbon that fills a third of the frame is a ribbon; the old one filled
 * a few percent and left the rest black, which was the complaint.
 *
 * Two things about the winding are load-bearing, and both are about the seam.
 * The strip closes on itself after one circuit, so its roll has to come back to
 * where it started — a whole or half number of turns, nothing between — and its
 * undulation has to have a whole number of wavelengths in that circuit. Either
 * one off and there is a visible step in the band where it meets itself.
 */

/**
 * Turns of the strip about its own centre line per circuit.
 *
 * A half-integer, which makes this a Möbius band: after one circuit the strip
 * arrives back at its start with its two edges swapped, which matches perfectly
 * and means the surface genuinely has one side. It is also the reason the band
 * reads as a *strip* rather than as a tube — the roll is what turns its face
 * toward and away from the lens as it travels, and a band with no roll is a flat
 * hoop.
 */
const TWIST_TURNS = 1.5;
/** Wavelengths of the undulation around the circuit. A whole number, or the
 *  wave does not meet itself at the seam. */
const RIPPLE_WAVES = 2;
/** Windings of the knot: turns around the ring, turns around the tube. Two and
 *  three — the trefoil, which is the lowest winding that crosses itself, and
 *  therefore the lowest at which the band passes in front of itself and the
 *  frame gains a foreground and a background. */
const KNOT: [number, number] = [2, 3];
/**
 * Scale of the figure. The knot's own radius runs from one to three, so the
 * whole thing spans about three times this.
 *
 * Small, and deliberately smaller than the strip is wide. That ratio is the
 * whole composition: with a large figure and a narrow strip the band is a wire
 * drawn through a dark frame, which is exactly what the quad version was; with a
 * small figure and a strip half again as wide as the gap between its own passes,
 * consecutive circuits overlap and the frame is a folded sheet of comic that
 * happens to be knotted.
 */
const FIGURE_SCALE = 1.05;

/**
 * Camera distance, set by clearance: the figure turns through every angle, so
 * its far lobe swings all the way round to the lens, and the strip's own
 * half-width and undulation ride on top of that. This is as close as it can be
 * with all three at their maximum — and it is close, because the band has to
 * overflow the frame rather than sit inside it.
 */
const EYE_DISTANCE = 6.1;

export const band: SpatialScene = {
  name: "band",
  kind: "band",
  // Two panels, both of them the whole strip, taking turns — as everywhere else
  // on this path. A band carrying two pages at once along its length was the old
  // scene's answer, and it made the strip read as a row of separate segments,
  // which is the thing being fixed.
  panels: 2,
  perPanel: 0,
  sequential: true,
  // One solid, as the thing the band winds around. It sits at the middle of the
  // knot, where the strip itself never goes, so it fills the one part of the
  // frame the band cannot reach.
  solidPanels: 1,

  build(): SpatialFormation {
    return {
      layout: { revision: nextRevision(), slots: [] },

      frame({ time, orbit, swell, solidBudget, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const scale = clamp(config.stageScale, 0.6, 1.6);
        /**
         * How wide the strip is, on the morph knob.
         *
         * The one dimension worth animating here, because it is the one the old
         * scene could not have at all: at the low end this is a ribbon threading
         * the figure, and at the high end the strip is broad enough that
         * consecutive passes of the knot nearly meet and the frame is a folded
         * sheet of comic rather than a line drawn in it.
         */
        const width = (2.7 + morph * 2.1) * scale;

        const surface: SurfaceDraw = {
          body: "band",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          size: [width, 1, FIGURE_SCALE * scale],
          sides: 4,
          round: 1,
          cap: 2,
          twist: TWIST_TURNS,
          burst: 0,
          ripple: 0.22 + config.stageDisplace * 0.5,
          rippleScale: RIPPLE_WAVES,
          ripplePhase: swell,
          /**
           * Cells along the strip, one across.
           *
           * Ten, which sounds like many and is not: the circuit is some fifty
           * world units long, so a cell is five units of band — larger than the
           * frame is tall wherever a stretch comes near the camera. At any moment
           * two or three of them are legible, which is the same budget every
           * other scene here keeps.
           */
          cells: [10, 1],
          // One cell is a tenth of the circuit by the strip's width. Estimated
          // from the knot's mean speed rather than measured — it only has to be
          // close enough that the crop is not visibly stretched.
          cellAspect: (5.8 * FIGURE_SCALE) / 3.7,
          zoom: 0.55,
          gutter: 0.022,
          // Strong, because a strip seen edge-on is a line and a line that lights
          // up as it turns away is what makes the twist legible from across the
          // frame. Not as strong as it wants to be, though: the rim fires exactly
          // where the knot's passes cross each other edge-on, so it is the term
          // that stacks fastest, and pushed further it is the one thing here that
          // can drive the frame to white.
          rim: 0.34,
          solid: false,
          knot: KNOT,
        };

        const solids =
          solidBudget > 0 && config.stageSolids > 0
            ? [
                {
                  shape: "torus" as const,
                  position: [0, 0, 0] as Vec3,
                  rotation: [time * 0.029, time * 0.041, time * 0.017] as Vec3,
                  scale: 1.6,
                  opacity: 1,
                },
              ]
            : [];

        return {
          morph,
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
          // The figure's own turn. About all three axes, because a torus knot
          // seen from directly above is a rosette and seen from the side is a
          // tangle, and the interest is in passing between the two.
          spin: [
            Math.sin(time * 0.0111) * 0.42,
            orbit,
            Math.sin(time * 0.0087) * 0.24,
          ] as Vec3,
          eye: [
            Math.sin(time * 0.0193) * 1.1,
            Math.sin(time * 0.0149) * 0.9,
            EYE_DISTANCE + Math.sin(time * 0.0123) * 1.2,
          ] as Vec3,
          look: [Math.sin(time * 0.0079) * 0.4, Math.cos(time * 0.0059) * 0.35, 0] as Vec3,
          fov: config.stageFov,
          wrap: 0,
          // High, and the band needs it more than anything else here: the knot's
          // near lobe swings all the way to the lens, and the strip's own half
          // width rides on top of that. Anything that gets this close fades out
          // rather than clipping through the near plane.
          fogNear: 1.6,
          fogFar: EYE_DISTANCE + FIGURE_SCALE * 3 + 6,
          shell: null,
          surface,
          solids,
        };
      },
    };
  },
};
