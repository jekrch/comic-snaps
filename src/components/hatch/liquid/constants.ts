/** Random splash duration range (seconds, on-screen time). */
export const ACTIVE_MIN_SEC = 10;
export const ACTIVE_MAX_SEC = 14;

/** Random rest between splashes (seconds). */
export const REST_MIN_SEC = 1;
export const REST_MAX_SEC = 2;

/** Per-event droplet count range. */
export const DROPLET_MIN = 1;
export const DROPLET_MAX = 4;

/** Coverage grid resolution for tracking filled territory cheaply. */
export const COVERAGE_COLS = 12;
export const COVERAGE_ROWS = 8;
export const COVERAGE_TOTAL = COVERAGE_COLS * COVERAGE_ROWS;

/** Phase flips when the active phase's coverage reaches this fraction. */
export const FLIP_THRESHOLD = 0.8;

/** Number of candidate rest positions sampled per droplet (best one wins). */
export const REST_CANDIDATES = 3;

/**
 * Cap on retained splash layers — chronological list. Once this many layers
 * have accumulated, the next phase flip triggers a "takeover" glob in the
 * base color that grows to cover the entire tile, after which all layers are
 * cleared and the cycle restarts. Visually seamless because the takeover
 * matches the underlying base hatch color.
 */
export const MAX_LAYERS = 3;

/**
 * Stretched emerge span (% of the active animation). Larger value = slower,
 * more gradual blob emergence rather than a quick mushroom puff.
 */
export const EMERGE_SPAN_PCT = 80;
