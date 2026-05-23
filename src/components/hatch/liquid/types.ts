export type LiquidPhase = "dark" | "light";

/** A settled, stationary glob that has reached its rest position. */
export interface SettledGlob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** A chronological group of settled blobs from one continuous phase run. */
export interface SplashLayer {
  id: number;
  phase: LiquidPhase;
  globs: SettledGlob[];
}

/** A single droplet in one splash event. Emerges → falls → decelerates → rests. */
export interface Droplet {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Pixels of vertical fall from spawn to rest position. */
  fallDistance: number;
  /** Horizontal drift while falling (pixels) — equal to finalX - x. */
  driftX: number;
  finalX: number;
  finalY: number;
  /** Per-droplet emergence stagger (% of activeSec, 0–14). */
  inner: number;
  /** Sinusoidal horizontal wobble amplitude (pixels). */
  wobbleAmp: number;
  wobbleFreq: number;
  wobblePhase: number;
  /** Secondary higher-frequency wobble amplitude (pixels) for organic meander. */
  wobble2Amp: number;
  wobble2Freq: number;
  wobble2Phase: number;
  /** Independent rx/ry scale oscillation — drives the amorphous bulging. */
  bulgeXAmp: number;
  bulgeXFreq: number;
  bulgeXPhase: number;
  bulgeYAmp: number;
  bulgeYFreq: number;
  bulgeYPhase: number;
  /**
   * Per-droplet emerge profile: (t, sx, sy) control points where t spans the
   * emerge portion (0–1). Non-monotonic & axis-asymmetric so the blob bulges
   * into existence in fits rather than inflating smoothly.
   */
  growthProfile: { t: number; sx: number; sy: number }[];
  /**
   * Fall progression. Each entry maps a fraction of the fall portion of the
   * animation (t, 0–1) to a fraction of the fall distance covered (f, 0–1).
   */
  fallProfile: { t: number; f: number }[];
}

/** Tile-level stable config — doesn't change between events. */
export interface LiquidConfig {
  enabled: boolean;
  blurStd: number;
  baseRadius: number;
  darkColor: string;
}

/** One splash event — regenerated each cycle with fresh randomness. */
export interface SplashEvent {
  id: number;
  phase: LiquidPhase;
  /** On-screen drip time (seconds). */
  activeSec: number;
  /** Rest time after this event before the next one starts (seconds). */
  restSec: number;
  droplets: Droplet[];
  /**
   * Marks the "engulf" event that grows a single base-color glob across the
   * entire tile after MAX_LAYERS have accumulated. When this event finishes,
   * all settled layers and coverage grids are cleared and the cycle restarts.
   */
  isTakeover?: boolean;
}
