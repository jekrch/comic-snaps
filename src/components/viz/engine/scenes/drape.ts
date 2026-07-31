import type { SurfaceDraw, Vec3 } from "../types";
import type { SpatialFormation, SpatialFrameContext, SpatialScene } from "./spatial";
import { clamp, nextRevision } from "./spatial";

/**
 * Drape — one comic page on a cloth much larger than the frame, thrown into slow
 * travelling folds and curling away at every edge.
 *
 * This replaces three leaning planes of quads, and it keeps the one thing that
 * arrangement was for. The old scene existed to show real depth — surfaces at
 * genuinely different distances, passing *through* one another, which a flat
 * composite structurally cannot express. It got that, and paid for it with a
 * frame that was three rectangles hanging in the dark: the crossing line was
 * only ever a few centimetres of the picture and everything around it was black.
 *
 * A folded cloth makes the same statement everywhere at once. Every fold is a
 * near surface passing in front of a far one, the crest of one is a foot closer
 * to the lens than the trough beside it, and the shading across a fold is depth
 * stated continuously rather than at one intersection. And because the sheet is
 * larger than the frame in every direction and curls away rather than ending,
 * there is no silhouette to find: the picture is full bleed at every moment of
 * the run, which is what the leaning planes could never be.
 *
 * One cell, so one page across the whole cloth. This is the vault's argument
 * transplanted: the wall is *made of* one image rather than tiled with copies of
 * it, and here the cloth is too. No gutter, for the same reason — there is
 * nothing for it to be between.
 */

/** Half-extents of the cloth, world units. Set from the frame: at the camera
 *  distance below the visible half-width is about five and a half units, so
 *  both of these are comfortably past the edge even with the curl pulling them
 *  back. */
const CLOTH_WIDTH = 17;
const CLOTH_HEIGHT = 11;

/** Camera distance. Close, and it is the whole reason the folds read as folds:
 *  seen from far off a corrugated plane is a pattern, and seen from a few units
 *  away it is a landscape of cloth with the near crests overlapping the far. */
const EYE_DISTANCE = 5;

/** Spatial frequency of the folds, cycles per world unit. Low: a whole
 *  wavelength has to be several units so a fold is a broad sweep of the picture
 *  rather than a corrugation, and the three waves in the shader beat against
 *  each other at roughly this scale. */
const FOLD_SCALE = 0.5;
/** Standing fold depth, before the config adds to it. The scene's own reason for
 *  existing, so it carries a value rather than waiting to be given one. */
const FOLD_BASE = 0.85;

export const drape: SpatialScene = {
  name: "drape",
  kind: "drape",
  // Two panels, both of them the whole cloth, taking turns. See the note in the
  // prism: a surface that is one page is not one that two pages share.
  panels: 2,
  perPanel: 0,
  sequential: true,
  solidPanels: 0,

  build(): SpatialFormation {
    return {
      layout: { revision: nextRevision(), slots: [] },

      frame({ time, orbit, swell, config }: SpatialFrameContext) {
        const centre = clamp(config.stageMorph, 0, 1);
        const swing = Math.min(centre, 1 - centre);
        const morph = centre + swing * Math.sin(time * config.stageMorphRate * Math.PI * 2);

        const scale = clamp(config.stageScale, 0.6, 1.6);

        const surface: SurfaceDraw = {
          body: "drape",
          // Pushed back by a fraction of the fold depth, so the crests swing
          // toward the lens without a wave crossing it.
          position: [0, 0, -1.2],
          rotation: [0, 0, 0],
          size: [CLOTH_WIDTH * scale, CLOTH_HEIGHT * scale, 1],
          // Unread by this body.
          sides: 4,
          round: 1,
          cap: 2,
          /**
           * The curl, on the morph knob.
           *
           * Quadratic in distance from the middle, so the cloth is nearly flat
           * where the camera is looking and falls away steeply at the edges —
           * which is what stops the sheet from ever showing an edge, at any
           * amount, without having to be made larger still. At the low end it is
           * a sheet with a slight bow in it; at the high end the viewer is inside
           * a curl of paper.
           */
          twist: 0.018 + morph * 0.075,
          burst: 0,
          ripple: FOLD_BASE + config.stageDisplace * 0.8,
          rippleScale: FOLD_SCALE,
          ripplePhase: swell,
          // One page, whole, across the entire cloth.
          cells: [1, 1],
          cellAspect: CLOTH_WIDTH / CLOTH_HEIGHT,
          zoom: 1,
          // Nothing to be between.
          gutter: 0,
          // Low. A rim on an open surface fires wherever a fold turns edge-on,
          // which is a bright line down every crease — striking at a little and
          // a wireframe at a lot.
          rim: 0.22,
          solid: false,
          knot: [2, 3],
        };

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
          /**
           * A rock rather than a turn, and this is the one scene where that is
           * forced rather than preferred: a plane rotated through a right angle
           * is edge-on, which is to say gone, and a scene whose subject
           * disappears twice a revolution is not a scene. So the accumulator is
           * spent as the phase of a bounded sway — three incommensurate ones, so
           * the cloth never returns to quite the same attitude — and `stageSpin`
           * still means the rate it sways at.
           */
          spin: [
            Math.sin(orbit * 0.83) * 0.3,
            Math.sin(orbit) * 0.42,
            Math.sin(orbit * 0.47) * 0.14,
          ] as Vec3,
          eye: [
            Math.sin(time * 0.019) * 0.9,
            Math.sin(time * 0.0143) * 0.6,
            EYE_DISTANCE + Math.sin(time * 0.0111) * 0.8,
          ] as Vec3,
          look: [
            Math.sin(time * 0.0079) * 0.7,
            Math.cos(time * 0.0059) * 0.5,
            -3,
          ] as Vec3,
          fov: config.stageFov,
          wrap: 0,
          fogNear: 0,
          // Long, and it has to be: the curl carries the far edges of the cloth
          // a long way back, and they should dim into the dark rather than end.
          fogFar: EYE_DISTANCE + CLOTH_WIDTH,
          shell: null,
          surface,
          solids: [],
        };
      },
    };
  },
};
