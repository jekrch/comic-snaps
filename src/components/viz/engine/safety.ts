import { MAX_EXPOSURE_SLEW, MIN_FLASH_INTERVAL, MIN_FULLBLEED_FADE_CLOCK } from "../vizConfig";
import type { PostParams } from "./types";

/**
 * Photosensitivity limits, enforced here rather than inside each scene so that
 * no future preset can opt out of them. Everything that can move the whole
 * frame's luminance goes through this object.
 */
export class SafetyGovernor {
  private exposure = 1;
  private lastFlash = -Infinity;
  /**
   * Wall-clock seconds since the run started. The composition clock is scaled
   * by the speed control, so limits that exist for photosensitivity reasons are
   * measured against this instead — a viewer at 2× is still a viewer.
   */
  private realTime = 0;

  /** A full-bleed layer may never fade faster than the floor. */
  clampFade(seconds: number): number {
    return Math.max(MIN_FULLBLEED_FADE_CLOCK, seconds);
  }

  /**
   * Whether a scene may trigger a whole-frame flash now. Returns false until
   * enough real time has passed to keep the rate under MAX_FLASH_HZ.
   */
  requestFlash(): boolean {
    if (this.realTime - this.lastFlash < MIN_FLASH_INTERVAL) return false;
    this.lastFlash = this.realTime;
    return true;
  }

  /** Rate-limits global brightness so exposure can never step discontinuously.
   *  Called once per frame with the real frame delta, which is also what
   *  advances the governor's own clock. */
  apply(post: PostParams, dt: number): PostParams {
    this.realTime += Math.max(0, dt);
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
