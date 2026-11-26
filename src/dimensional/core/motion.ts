export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The motion constants, the defaults for the `--dd-*` motion tokens. Script
 * reads the tokens where it times something itself (the glide, the slide),
 * so a theme that changes a token changes both.
 */
export const MOTION = {
  slideMs: 340,
  ease: "cubic-bezier(0.2, 0, 0, 1)",
  fadeMs: 150,
  glideMinMs: 300,
  glideMaxMs: 560,
  /**
   * The glide's curve: a cubic ease-out. An expo curve covers nine tenths
   * of the way in a third of the time, and on a long section the last
   * tenth crawls in long enough to read as stuck.
   */
  glideEase: "cubic-bezier(0.33, 1, 0.68, 1)",
  appShift: 0.25,
  appDim: 0.6,
};

/** A motion token's value on `el`, or the default when it isn't set. */
export function motionToken<K extends keyof typeof MOTION>(el: Element | null, key: K): (typeof MOTION)[K] {
  const fallback = MOTION[key];
  if (!el || typeof getComputedStyle === "undefined") return fallback;
  const name = `--dd-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (typeof fallback === "number") {
    const n = parseFloat(raw);
    return (Number.isFinite(n) ? n : fallback) as (typeof MOTION)[K];
  }
  return raw as (typeof MOTION)[K];
}
