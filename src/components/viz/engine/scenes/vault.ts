import type { ShellDraw, Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { clamp, nextRevision } from "./spatial";

/**
 * Vault — the inside of a tube, papered with one comic page wrapped twice around
 * it, flown down forever.
 *
 * This scene was quads on a tube wall twice over: five hundred small ones, and
 * then a dozen large ones. Both were the same mistake in different sizes. A quad
 * has a rim; a rim sliding past the eye is an object passing the viewer; and a
 * corridor made of them is a corridor made of postcards being handed to you at
 * speed, which is busy however few of them there are and however large each one
 * gets. The complaint was never really about size.
 *
 * So there are no quads here at all. The wall is one continuous surface — see
 * `ShellDraw` — textured with whichever page is resident, mirrored so the copies
 * meet without a seam anywhere. What used to be a dozen separate pictures is now
 * one picture the size of the corridor.
 *
 * And nothing in the scene translates. The tube stands still around the camera and
 * the wallpaper's coordinates scroll along it, so the flight is entirely in the
 * texture: there is no depth at which anything arrives, nothing crosses the lens,
 * and the corridor cannot run out. Foreshortening supplies the rest — a pattern
 * scrolling down a tube in perspective accelerates as it comes, which is the whole
 * of what reads as speed.
 */

/** Radius of the corridor at its widest. Wide enough that the wall beside the
 *  camera is well outside the frustum, so the frame is filled by the *depth* of
 *  the tube rather than by whatever happens to be alongside. */
const TUBE_RADIUS = 2.6;
/** How far down the axis the tube reaches. Long: the fog has to take the far end
 *  entirely, or the frame has a bright disc at the vanishing point. */
const TUBE_LENGTH = 30;
/** How far behind the camera the mouth sits, so the open end can never swing into
 *  frame as the camera sways off the axis. */
const TUBE_BACK = 2.5;
/**
 * Copies of the page around the circumference.
 *
 * Two, and this is the number the whole rework turns on. At two, the page is
 * around seven world units wide on the wall — wider than the frame at any depth
 * that is not already fogged — so what is on screen is always a *part* of one
 * page. Raise it and the wall becomes patterned with comic art instead of made of
 * it; that is precisely the cluttered reading, and it arrives fast.
 */
const TUBE_TILES = 2;

export const vault: SpatialScene = {
  name: "vault",
  kind: "vault",
  /**
   * Two panels, and both of them are the whole wall.
   *
   * They exist to hand over to each other rather than to be seen at once — with
   * the preset's complementary crossfade one is always arriving as the other
   * leaves, and their sum is one wall of constant brightness. A third would be a
   * third full-frame additive layer for no picture that is not already there.
   */
  panels: 2,
  // No quads. The corridor is the surface.
  perPanel: 0,
  // And because both slots paint that one surface, they take turns rather than
  // overlapping: a page owns the whole corridor for the whole of its dwell, and
  // the only moment two are on the wall at once is the dissolve between them.
  // Concurrent residency here would be two comic pages superimposed forever,
  // which is the opposite of a wall made of one image.
  sequential: true,
  // No solids either, and this one is the user's call rather than a compositional
  // one: a solid in the middle distance of a tube is a thing the flight closes on,
  // and either it passes the camera — the thing this scene is now built never to
  // do — or it stops short and gives the lie to the flight. The occlusion those
  // objects bought is worth less than the corridor being uninterrupted.
  solidPanels: 0,

  build(): SpatialFormation {
    return {
      // Nothing to lay out: a shell is geometry the pass builds from uniforms, so
      // there are no instances, no crops, and nothing for a revision to invalidate
      // beyond the one bump that tells the backend the arrangement changed.
      layout: { revision: nextRevision(), slots: [] },

      frame({ time, travel, orbit, swell, config }: SpatialFrameContext) {
        // The corridor's own shape, on the morph knob. Held wherever the preset
        // parks it and swung by whatever headroom is left, exactly as the quad
        // formations treat their pair of arrangements — here the two ends are a
        // straight pipe and a cavern.
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const profile = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const shell: ShellDraw = {
          radius: TUBE_RADIUS * clamp(config.stageScale, 0.4, 2),
          length: TUBE_LENGTH,
          back: TUBE_BACK,
          profile,
          tiles: TUBE_TILES,
          // The formation's turn, spent as a helical wrap instead of a roll. A
          // rolled tube is indistinguishable from a rolled camera and fights the
          // eye's sense of which way is up; a twisted *wallpaper* is the corridor
          // itself winding away from you, which is the same knob buying a much
          // stranger picture.
          twist: orbit,
          scroll: travel,
          // The wall breathing in and out along its own radius, on the shared
          // displacement rate. The one motion here that is geometry rather than
          // texture — and it moves the wall sideways past the camera, never toward
          // it, so it cannot deliver anything to the lens either.
          ripple: config.stageDisplace * 0.6,
          rippleScale: 0.55,
          ripplePhase: swell,
        };

        return {
          // Everything on this half of the contract belongs to the quad program,
          // and there are no quads. Left at rest rather than at the config's
          // values so the tuning panel cannot make a shell scene look broken by
          // moving a slider that has nothing to act on.
          morph: profile,
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
          // The tube is drawn in the camera's own frame, so a spin here would
          // rotate the corridor about the eye — which is the roll the twist above
          // replaces. Held at zero deliberately.
          spin: [0, 0, 0] as Vec3,
          // The camera holds the axis and only sways off it. The flight is the
          // wallpaper moving past rather than the eye going anywhere, and that is
          // now literally true rather than an implementation detail.
          eye: [Math.sin(time * 0.019) * 0.34, Math.sin(time * 0.0143) * 0.28, 0] as Vec3,
          look: [Math.sin(time * 0.0089) * 0.55, Math.cos(time * 0.0067) * 0.45, -6] as Vec3,
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0,
          // Just short of the tube's own length, so the far end is fully into the
          // black before the geometry stops.
          fogFar: TUBE_LENGTH * 0.85,
          shell,
          solids: [],
        };
      },
    };
  },
};
