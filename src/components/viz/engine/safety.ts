import {
  MAX_AUDIO_SLEW,
  MAX_EXPOSURE_SLEW,
  MIN_EFFECT_RAMP_CLOCK,
  MIN_FLASH_INTERVAL,
  MIN_FULLBLEED_FADE_CLOCK,
} from "../vizConfig";
import type { PostParams } from "./types";

/**
 * Photosensitivity limits, enforced here rather than inside each scene so that
 * no future preset can opt out of them. Everything that can move the whole
 * frame's luminance goes through this object.
 */
export class SafetyGovernor {
  private exposure = 1;
  private lastFlash = -Infinity;
  /** See `clampAudioDrive`. */
  private audioDrive = 0;
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

  /** A cycled post effect may never fade in or out faster than the floor. */
  clampRamp(seconds: number): number {
    return Math.max(MIN_EFFECT_RAMP_CLOCK, seconds);
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

  /**
   * Rate limit on how fast live audio may move anything that reaches frame
   * luminance, in real seconds.
   *
   * The gap this closes: `apply` below rate-limits `exposure` itself, but audio
   * can brighten the frame without ever touching it — through the trail's
   * depth, through bloom, through layer opacity. Onsets on a fast track arrive
   * at 10Hz even after the reactor's refractory period, which is squarely in
   * the photosensitivity band, and audio reactivity is the standard way a
   * project accidentally ships a strobe.
   *
   * So every audio-derived multiplier on a luminance parameter is taken from
   * *one* drive scalar, and that scalar passes through here. One limiter, and
   * no binding downstream can opt out of it — which is the same argument as the
   * flash rate limit and the fade floor, and the reason all three live on this
   * object rather than in the code that wants them.
   *
   * The fast, unlimited drive stays available for geometry and colour, which
   * cannot flash the frame however hard they are pushed.
   */
  clampAudioDrive(target: number, dt: number): number {
    const step = MAX_AUDIO_SLEW * Math.max(0, Math.min(dt, 0.1));
    const delta = Math.max(0, target) - this.audioDrive;
    this.audioDrive += Math.sign(delta) * Math.min(Math.abs(delta), step);
    return this.audioDrive;
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
    this.audioDrive = 0;
  }
}
