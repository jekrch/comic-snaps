import type { Panel } from "../../../../types";
import type { VizConfig } from "../../vizConfig";
import type { Rng } from "../rng";
import type { SafetyGovernor } from "../safety";
import type { Rect, Shard } from "../types";
import type { Rgb } from "../palette";

/** Why the director chose this panel — see the weighted policy in §4. */
export type Affinity = "rhyme" | "clash" | "color" | "random";

export interface SceneContext {
  id: number;
  panel: Panel;
  affinity: Affinity;
  /** Engine clock at birth. */
  time: number;
  /** Stage aspect (width / height). */
  aspect: number;
  config: VizConfig;
  rng: Rng;
  /** Complement-biased tint chosen by the director. */
  tint: Rgb;
  /** Monotonic spawn counter — lets a preset vary by position in the run. */
  index: number;
  safety: SafetyGovernor;
}

export interface Scene {
  readonly name: string;
  spawn(ctx: SceneContext): Shard;
}

/**
 * The largest uv sub-rectangle of an image with the given on-screen aspect,
 * scaled by `zoom` and positioned by two 0..1 offsets. Sampling a matched
 * sub-rectangle rather than the whole image is what keeps portrait panels from
 * being stretched across a landscape frame.
 */
export function coverRect(
  imageAspect: number,
  dstAspect: number,
  zoom: number,
  offsetX: number,
  offsetY: number
): Rect {
  // A uv rect (du, dv) displays at pixel aspect (du * pw) / (dv * ph).
  const ratio = dstAspect / imageAspect;
  let w = 1;
  let h = 1;
  if (ratio > 1) h = 1 / ratio;
  else w = ratio;

  const scale = 1 / Math.max(1, zoom);
  w *= scale;
  h *= scale;

  return {
    x: (1 - w) * offsetX,
    y: (1 - h) * offsetY,
    w,
    h,
  };
}

export function panelAspect(panel: Panel): number {
  if (panel.width > 0 && panel.height > 0) return panel.width / panel.height;
  return 3 / 4;
}
