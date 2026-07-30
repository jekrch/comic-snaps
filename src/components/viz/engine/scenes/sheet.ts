import type { Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { buildLayout, clamp, nextRevision, sheets, shells } from "./spatial";

/**
 * Sheet — three leaning planes, each one whole page, swelling along their own
 * normals until they pass through one another.
 *
 * This is the item the effects backlog listed as "real depth: layers gain
 * perspective and can pass *through* each other, which a UV warp can never
 * express", and the emphasis is the whole scene. The flat path has always been
 * able to stack layers; what it cannot do is put one *behind* another, because a
 * composite has no behind. Here the sheets are geometry at genuinely different
 * depths, no two of them parallel, and the displacement drives them across each
 * other — so a page emerges from inside another page and is occluded going back
 * in.
 *
 * The intersections are also what makes it read as depth rather than as a
 * parallax trick. Two planes crossing draw a line, the eye finds that line
 * immediately, and once it has, the arrangement is unambiguously three
 * dimensional in a way that no amount of foreshortening on its own achieves.
 *
 * Which is why a plane is now one page rather than forty crops of one. The
 * crossing line is only legible where it cuts across a *picture*: two pages
 * intersecting is a striking image, where two clouds of fragments intersecting is
 * a slightly denser cloud of fragments.
 */

/**
 * Planes in the stack. Three, and each one is a single page.
 *
 * The arrangement's subject is two surfaces crossing, and two surfaces is the
 * minimum for it; three gives a middle one to be crossed from both sides. Past
 * that every extra plane is another full-bleed additive layer for a reading the
 * eye already has.
 */
const SHEET_COUNT = 3;
/** Depth the stack spans, world units. */
const SHEET_SPREAD = 2.4;
/** How far off centre a plane's quad sits. Small, because there is now exactly one
 *  of them per plane and it *is* the plane — this is a nudge that keeps the three
 *  from being a perfectly concentric stack, not a spread. */
const SHEET_SIZE = 1.3;
/** Lean added per plane. Large, because there are only three of them — see the
 *  note on `sheets`. */
const SHEET_TILT = 0.34;

const SHELL_RADIUS = 2.1;
const SHELL_LENGTH = 3.6;

/** Camera distance, set by clearance: the planes swell along their own normals by
 *  more than a unit, and a plane that swells past the eye is a plane the viewer is
 *  suddenly behind. Far enough back that the swell always stays in front. */
const EYE_DISTANCE = 8.2;

/**
 * Spatial frequency of the swell, cycles per world unit.
 *
 * A whole wavelength has to be longer than a quad or the displacement bends one
 * page against itself; it has to be shorter than the *stack* or all three planes
 * move as one and never cross. At this value it is about six units — twice the
 * width of a plane, and several times the gap between them.
 */
const DISPLACE_SCALE = 0.95;

export const sheet: SpatialScene = {
  name: "sheet",
  kind: "sheet",
  // Three panels, one quad each — so a plane is exactly one page, and there are
  // three of them. Nothing is tiled, nothing is assembled out of fragments, and
  // the crossing line the scene exists for cuts across whole pictures.
  panels: 3,
  perPanel: 1,
  // A solid among intersecting planes reads as the thing they are all cutting
  // through, and nothing here is arranged around a centre for it to occupy.
  solidPanels: 0,

  build(ctx): SpatialFormation {
    const layout = buildLayout(
      ctx,
      nextRevision(),
      sheets(SHEET_COUNT, SHEET_SPREAD, SHEET_SIZE, SHEET_TILT),
      shells(SHEET_COUNT, SHELL_RADIUS, SHELL_LENGTH),
      // The whole page, and larger than the frame. A plane that stops inside the
      // picture is a poster hanging in the dark; one that runs off every edge is a
      // surface the viewer is inside the space of, which is what makes the moment
      // it swings edge-on land.
      { size: [2.1, 2.9], tilt: 0.05, crop: [0.88, 1] }
    );

    return {
      layout,

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        // Nearly side-on rather than square to the stack. Seen face-on the
        // sheets hide behind each other and the scene is a flat collage; a few
        // degrees off and the stack is legible as a stack, which is what the
        // whole arrangement is for.
        const eye: Vec3 = [
          Math.sin(time * 0.021) * 2.1,
          Math.sin(time * 0.0163) * 1.2,
          EYE_DISTANCE + Math.sin(time * 0.0117) * 1,
        ];

        return {
          morph,
          billboard: config.stageBillboard,
          // Zero, and it has to be: a quad turned to face the camera has left
          // the plane it was part of, and a sheet whose quads have all done that
          // is not a surface any more.
          align: 0,
          scale: config.stageScale,
          // Soft, and it is the only thing keeping three full-bleed planes from
          // reading as three hard-edged rectangles stacked in the dark: a
          // feathered plane loses its border into the black and the eye is left
          // with the crossing line, which is the one edge worth seeing here.
          feather: 0.12 + config.stageFeather,
          breathe: config.stageBreathe,
          // The scene's own reason for existing, so it carries a standing value
          // rather than waiting for the config to supply one — and adds whatever
          // the config asks for on top.
          // Enough to carry a plane clear across its neighbour: the gap between
          // two of three planes over this spread is a bit over a unit, and the
          // three waves in the shader sum to about twice this at their peak.
          displace: 0.5 + config.stageDisplace,
          displaceScale: DISPLACE_SCALE,
          displacePhase: swell,
          swirl: config.stageSwirl,
          swirlScale: 0.3,
          // Turn about y only, and slowly. The sheets sweep across the frame
          // edge-on twice a revolution, and that moment — the stack collapsing
          // to a set of lines and opening back out — is the best thing in the
          // scene, so it must not be hurried past.
          spin: [Math.sin(time * 0.0093) * 0.12, orbit, 0],
          eye,
          look: [Math.sin(time * 0.0083) * 0.6, Math.cos(time * 0.0061) * 0.4, -0.8],
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0.9,
          fogFar: EYE_DISTANCE + SHEET_SPREAD + 6,
          shell: null,
          solids: [],
        };
      },
    };
  },
};
