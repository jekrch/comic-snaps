import { MAX_EXPOSURE_SLEW, MIN_FLASH_INTERVAL, MIN_FULLBLEED_FADE } from "../vizConfig";
import type { PostParams } from "./types";

/**
 * Photosensitivity limits, enforced here rather than inside each scene so that
 * no future preset can opt out of them. Everything that can move the whole
 * frame's luminance goes through this object.
 */
export class SafetyGovernor {
  private exposure = 1;
  private lastFlash = -Infinity;

  /** A full-bleed layer may never fade faster than the floor. */
  clampFade(seconds: number): number {
    return Math.max(MIN_FULLBLEED_FADE, seconds);
  }

  /**
   * Whether a scene may trigger a whole-frame flash now. Returns false until
   * enough time has passed to keep the rate under MAX_FLASH_HZ.
   */
  requestFlash(time: number): boolean {
    if (time - this.lastFlash < MIN_FLASH_INTERVAL) return false;
    this.lastFlash = time;
    return true;
  }

  /** Rate-limits global brightness so exposure can never step discontinuously. */
  apply(post: PostParams, dt: number): PostParams {
    const target = Math.max(0, post.exposure);
    const maxStep = MAX_EXPOSURE_SLEW * Math.max(0, Math.min(dt, 0.1));
    const delta = target - this.exposure;
    this.exposure += Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
    return { ...post, exposure: this.exposure };
  }

  reset(): void {
    this.exposure = 1;
    this.lastFlash = -Infinity;
  }
}
