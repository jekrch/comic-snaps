import type { BlendMode, Shard } from "../types";
import { IDENTITY_LEVELS, easeInOut } from "../types";
import { levelsFor, stackKey } from "../palette";
import type { Scene, SceneContext } from "./types";
import { coverRect, panelAspect } from "./types";

/**
 * Blend modes that are identity over a black background, so a layer looks the
 * same whether it is the bottom of the stack or composited over the layer
 * below. Overlay, hard-light and multiply all collapse to black over an empty
 * frame, which reads as a dropped layer during a crossfade.
 *
 * The split matters: difference and exclusion of two *similar* images cancel
 * to near-black, and the director's dominant policy is deliberately to pick a
 * near neighbour. So the subtractive modes are reserved for the clash picks,
 * where the two images genuinely diverge and the inversion has something to
 * bite on.
 */
const RHYME_BLENDS: BlendMode[] = ["screen", "screen", "screen", "lighten"];
const CLASH_BLENDS: BlendMode[] = ["difference", "exclusion", "screen", "lighten"];

/**
 * The tightest crop a layer is allowed to open or close on. Enough headroom
 * that the anchor offsets have somewhere to move even under the gentlest
 * presets, and small enough to stay invisible as a zoom.
 */
const MIN_ZOOM = 1.05;

/**
 * Folds an offset back inside 0..1 by reflecting off the edges rather than
 * clamping. Clamping would flatten the move for any layer anchored near a
 * border into a still, which is exactly where the freed-up anchors now land.
 */
function reflect01(v: number): number {
  const m = Math.abs(v % 2);
  return m > 1 ? 2 - m : m;
}

/**
 * Drift stack — the hypnotic baseline. A few full-bleed layers with a slow Ken
 * Burns move, crossfading over a large fraction of their lifetime.
 *
 * The move is applied to the crop rather than to the on-screen rectangle: the
 * frame stays full-bleed while the sampled region drifts and tightens inside
 * the source image, which avoids ever exposing an edge.
 */
export const driftStack: Scene = {
  name: "drift-stack",

  spawn(ctx: SceneContext): Shard {
    const { rng, config, aspect, panel } = ctx;

    const lifetime =
      config.layerLifetime * rng.range(1 - config.layerLifetimeJitter, 1 + config.layerLifetimeJitter);
    const fade = ctx.safety.clampFade(lifetime * config.crossfade * 0.5);

    const imageAspect = panelAspect(panel);
    // A modest overscan on the destination gives the rotation somewhere to go
    // without pulling the frame edge into view.
    const over = 0.06 + Math.abs(config.rotateAmount) * 1.5;
    const dst = {
      x: -over * aspect,
      y: -over,
      w: aspect * (1 + 2 * over),
      h: 1 + 2 * over,
    };
    const dstAspect = dst.w / dst.h;

    // Zoom in or out over the layer's life, never both, so the motion reads as
    // one continuous move rather than a wobble.
    //
    // Neither end sits at zoom 1. The full cover rect is the one crop every
    // layer would share, and on the axis where it already spans the image it
    // pins the offset outright — so a move that touches it drags the whole
    // stack through the same framing. A little headroom at both ends leaves the
    // anchor free to place the layer anywhere in the panel.
    const zoomSpan = Math.max(config.zoomAmount, MIN_ZOOM * 1.02);
    const zoomLo = Math.max(MIN_ZOOM, 1 + (zoomSpan - 1) * rng.range(0.1, 0.45));
    const zoomHi = 1 + (zoomSpan - 1) * rng.range(0.85, 1);
    const zoomIn = rng.bool();
    const zoomA = zoomIn ? zoomLo : zoomHi;
    const zoomB = zoomIn ? zoomHi : zoomLo;

    // Without a shared heading every layer drifts its own way and the frame as
    // a whole goes nowhere; with one, the stack reads as a current — and the
    // spread keeps it a current rather than a slideshow of parallel moves.
    const panAngle = ctx.drift
      ? ctx.drift.angle + rng.range(-Math.PI, Math.PI) * (1 - ctx.drift.coherence)
      : rng.range(0, Math.PI * 2);
    const pan = config.panAmount;
    // The anchor is *where in the panel* this layer looks; the pan is how far it
    // travels from there. Deriving the anchor from the pan — one ±pan range
    // around centre — tied the two together, so a calm preset meant every layer
    // opened on the same middle slice of the art. They are independent choices.
    const ox = rng.range(0, 1);
    const oy = rng.range(0, 1);

    const srcFrom = coverRect(imageAspect, dstAspect, zoomA, ox, oy);
    const srcTo = coverRect(
      imageAspect,
      dstAspect,
      zoomB,
      reflect01(ox + Math.cos(panAngle) * pan),
      reflect01(oy + Math.sin(panAngle) * pan)
    );

    const rot = config.rotateAmount === 0 ? 0 : rng.range(-config.rotateAmount, config.rotateAmount);

    return {
      id: ctx.id,
      panelId: panel.id,
      srcFrom,
      srcTo,
      dstFrom: dst,
      dstTo: dst,
      rotFrom: -rot,
      rotTo: rot,
      blendMode:
        ctx.index === 0
          ? "normal"
          : rng.pick(ctx.affinity === "clash" ? CLASH_BLENDS : RHYME_BLENDS),
      // A white comic page screened onto anything is white, and four of them is
      // a blank frame — so every layer that blends is levelled first. The key it
      // is levelled *to* is solved backwards from how deep the stack this layer
      // joins will be, because screening compounds: one common key at every
      // depth held the frame at a mid tone with two layers and blew it out with
      // four, which is the wash. See `stackKey`.
      //
      // The opening layer is exempt: it is one panel on a normal blend over
      // black, with nothing to wash out and every reason to look like the
      // artwork it is.
      levels:
        ctx.index === 0
          ? IDENTITY_LEVELS
          : levelsFor(
              panel.dominantColors,
              config.keyBalance,
              stackKey(config.layerCount, "screen", config.layerOpacity)
            ),
      tint: ctx.tint,
      tintAmount: config.tintAmount * rng.range(0.4, 1),
      opacityCurve: {
        fadeIn: fade,
        fadeOut: fade,
        peak: ctx.index === 0 ? 1 : config.layerOpacity * rng.range(0.85, 1),
      },
      bornAt: ctx.time,
      lifetime,
      mask: "hard",
      feather: 0,
      ease: easeInOut,
    };
  },
};
