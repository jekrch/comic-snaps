import type { BlendMode, Shard } from "../types";
import { easeInOut } from "../types";
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
    const zoomIn = rng.bool();
    const zoomA = zoomIn ? 1 : config.zoomAmount;
    const zoomB = zoomIn ? config.zoomAmount : 1;

    const panAngle = rng.range(0, Math.PI * 2);
    const pan = config.panAmount;
    const ox = rng.range(0.5 - pan, 0.5 + pan);
    const oy = rng.range(0.5 - pan, 0.5 + pan);
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

    const srcFrom = coverRect(imageAspect, dstAspect, zoomA, clamp01(ox), clamp01(oy));
    const srcTo = coverRect(
      imageAspect,
      dstAspect,
      zoomB,
      clamp01(ox + Math.cos(panAngle) * pan),
      clamp01(oy + Math.sin(panAngle) * pan)
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
