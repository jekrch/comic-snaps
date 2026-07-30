import type { Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, coil, lissajous, nextRevision } from "./spatial";

/**
 * Ribbons — one wide band of large panel crops swept along a Lissajous curve,
 * winding onto a torus knot and back.
 *
 * The backlog called this "`Polyline` ribbons", and it is built out of the
 * instanced quads instead. `Polyline` would have meant a second geometry, a
 * second program and a second path through the slot machinery to gain a stroked
 * line — and a stroked line cannot be textured with a different crop every few
 * centimetres, which is the only reason to want a ribbon of comic panels rather
 * than a ribbon. Quads laid nose to tail along a curve are the same picture and
 * reuse everything.
 *
 * What it needed instead was one thing the formation contract did not have: a
 * direction. Quads rolled off a world up vector are individually fine and
 * collectively confetti — the strip only reads as a strip when consecutive quads
 * agree which way is along it. So `Placement` gained a tangent and the vertex
 * shader gained `uAlign`, and this scene is the one that turns it on.
 */

/**
 * Strands. One.
 *
 * Seven was a weave, and a weave is a texture again — the strands cross every few
 * units and the eye loses which is which. Two was better and still divided the
 * quad budget in half, which starved both bands: a strand only reads as a *band*
 * if consecutive quads overlap, so the quads a scene can afford are far better
 * spent making one continuous thing than two dotted ones. One strand, every quad
 * on it, and the figure crosses itself often enough to be a braid with itself.
 */
const STRAND_COUNT = 1;
/**
 * Amplitude of the figure. Sized *against the quads*, not against the frame:
 * consecutive quads on a strand sit about a seventh of the curve apart, so the
 * curve's total arc length has to be short enough that a seventh of it is less
 * than a quad is wide. Enlarge the figure without adding quads and the band comes
 * apart into a dotted line.
 */
const FIGURE_SCALE = 1.9;
/**
 * Lissajous frequencies. Deliberately not small integers: those close the curve
 * after one pass and leave a wire loop, where these keep missing themselves and
 * the strand fills the space it moves through.
 *
 * Much lower than they were, and that is forced by the quad count. A strand is
 * now seven or eight large quads rather than seventy small ones, so consecutive
 * quads sit a couple of world units apart along the curve — and a curve that
 * turns sharply between them shears the band into a row of separate cards. These
 * are gentle enough that a quad's own width closes the gap to the next.
 */
const FREQ: Vec3 = [1, 1.31, 1.73];

const TORUS_MAJOR = 2.05;
const TORUS_MINOR = 0.7;
/** Turns around the tube per circuit of the ring. Low for the same reason the
 *  frequencies are: each turn costs curvature, and curvature between two quads
 *  is a break in the band. */
const KNOT_TURNS = 2;

/** Camera distance, set by clearance: the figure is nearly as deep as it is wide
 *  and the whole of it turns, so its far lobe comes round to face the lens. */
const EYE_DISTANCE = 9;

export const ribbons: SpatialScene = {
  name: "ribbons",
  kind: "ribbons",
  // The one scene that needs a run of quads rather than a couple: a band is
  // continuous or it is a row of cards. Two panels of six, dealt round-robin along
  // the single strand, so the band alternates between two pages as it travels and
  // never shows more than two at once.
  panels: 2,
  perPanel: 6,
  // One solid, as the thing the strands wind around. With the braid open it
  // reads as a core; with the knot closed it is inside the torus and hidden,
  // which is a change worth having for free.
  solidPanels: 1,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      lissajous(STRAND_COUNT, FIGURE_SCALE, FREQ),
      coil(STRAND_COUNT, TORUS_MAJOR, TORUS_MINOR, KNOT_TURNS),
      // No tilt at all, and this is the one formation where that is not a
      // preference: an in-plane rotation is exactly the roll the alignment just
      // went to the trouble of fixing, so a random tilt would undo it. Crops
      // stay wide, because a strip is read across its width.
      //
      // Four times the size they were: at this spacing along the curve the quads
      // have to be well over a unit across their own axis to touch the next one,
      // and a band that does not close is a row of stamps.
      { size: [1.3, 1.75], tilt: 0, crop: [0.6, 1] }
    );

    return {
      layout,

      frame({ time, orbit, swell, solidBudget, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const solids = solidBudget > 0 && config.stageSolids > 0
          ? [
              {
                shape: "torus" as const,
                position: [0, 0, 0] as Vec3,
                rotation: [time * 0.031, time * 0.043, time * 0.019] as Vec3,
                // Smaller than it was. With two bands instead of seven there is
                // much more empty middle for it to sit in, and a core that fills
                // that middle occludes the thing the scene is about.
                scale: 0.95,
                opacity: 1,
              },
            ]
          : [];

        return {
          morph,
          // Low, and bounded well under 1 whatever the config says. Billboarding
          // turns a quad to face the eye, which is the opposite of lying on the
          // curve — past about a third the strands stop being strips and become
          // strings of stamps.
          billboard: Math.min(0.3, config.stageBillboard),
          // The whole point of the scene. Standing at full strength rather than
          // config-driven: a ribbon at half alignment is not a softer ribbon, it
          // is a broken one.
          align: 1,
          // Larger than the other formations ask for. The quads have to overlap
          // along the curve to close into a continuous strip, and a gap between
          // two of them is a gap in the ribbon.
          scale: config.stageScale * 1.25,
          // Soft along the join. Each quad overlaps the next by design, and a
          // feathered overlap is a dissolve from one page into the next along the
          // band rather than a visible butt seam every couple of units.
          feather: 0.16 + config.stageFeather,
          breathe: config.stageBreathe,
          // A travelling wave along a curve pushes the strip sideways, so the
          // ribbon ripples like a streamer rather than the surface swelling.
          displace: 0.2 + config.stageDisplace,
          // Longer than a quad, so the wave travels *along* the band and lifts it
          // as a whole. A wavelength shorter than one quad would bend a page
          // against itself, which reads as a wobble in the art rather than in the
          // ribbon.
          displaceScale: 0.9,
          displacePhase: swell,
          swirl: config.stageSwirl,
          swirlScale: 0.4,
          spin: [Math.sin(time * 0.0111) * 0.3, orbit, Math.sin(time * 0.0087) * 0.18],
          eye: [
            Math.sin(time * 0.0193) * 1.3,
            Math.sin(time * 0.0149) * 1.0,
            EYE_DISTANCE + Math.sin(time * 0.0123) * 1.4,
          ],
          look: [Math.sin(time * 0.0079) * 0.4, Math.cos(time * 0.0059) * 0.35, 0],
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0.8,
          fogFar: EYE_DISTANCE + FIGURE_SCALE + 5,
          shell: null,
          solids,
        };
      },
    };
  },
};
