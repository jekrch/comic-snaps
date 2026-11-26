import { MOTION } from "./motion";

export interface GlideOptions {
  /** The scroller, whose scroll anchoring is held off while anything glides in it. */
  scroller?: HTMLElement | null;
  minMs?: number;
  maxMs?: number;
  ease?: string;
  /** The registered custom property that fades the bottom edge while opening. */
  fadeVar?: string;
  /** How long the fade is, at its widest. */
  fadePx?: number;
}

/** Glides in progress per scroller, so the last to end gives anchoring back. */
const active = new WeakMap<HTMLElement, number>();

/** How long a glide over `distance` pixels takes: longer for further, within bounds. */
export function glideDuration(distance: number, min = MOTION.glideMinMs, max = MOTION.glideMaxMs): number {
  return Math.round(Math.min(max, min + Math.abs(distance) * 0.18));
}

/**
 * Glides a box from the height it had before a swap to the height its new
 * content gives it. Call it after the swap is in the DOM, before paint,
 * with the old height. Returns what ends it early (a second swap first ends
 * the one in progress).
 *
 * While it runs the box carries `is-gliding` and `data-glide` ("open" or
 * "fold"), and its stylesheet clips the bottom edge only, so anything that
 * hangs out sideways (sidenotes in a margin) still shows. Opening fades the
 * bottom edge while the rest is still to come, and the fade closes as the
 * box lands, so no text is left dimmed; folding cuts clean.
 *
 * The new content can keep growing after it's measured (a figure settling,
 * images taking their size): the glide re-aims at the real height from
 * wherever it's got to, rather than stopping short and jumping.
 */
export function glide(el: HTMLElement, fromHeight: number, opts: GlideOptions = {}): (() => void) | null {
  const {
    scroller = null,
    minMs = MOTION.glideMinMs,
    maxMs = MOTION.glideMaxMs,
    ease = MOTION.glideEase,
    fadeVar = "--dd-glide-fade",
    fadePx = 64,
  } = opts;
  let to = el.getBoundingClientRect().height;
  const from = fromHeight;
  if (Math.abs(to - from) < 4) return null;
  const ms = glideDuration(to - from, minMs, maxMs);
  const started = performance.now();

  el.style.height = `${from}px`;
  el.classList.add("is-gliding");
  const opening = to > from;
  el.dataset.glide = opening ? "open" : "fold";
  if (opening) el.style.setProperty(fadeVar, `${fadePx}px`);
  // Scroll anchoring would chase whatever's below as it moves, and with it
  // move the heading the reader just clicked.
  if (scroller) {
    active.set(scroller, (active.get(scroller) ?? 0) + 1);
    scroller.style.overflowAnchor = "none";
  }
  void el.offsetHeight;
  const fade = `${fadeVar} ${ms}ms ${ease}`;
  el.style.transition = `height ${ms}ms ${ease}, ${fade}`;
  el.style.height = `${to}px`;
  if (opening) el.style.setProperty(fadeVar, "0px");
  let timer = window.setTimeout(() => end(), ms + 120);

  // Where the content ends, from layout boxes (new content may rise in on a
  // transform), plus whatever sits below it (padding, a last margin),
  // measured once now while the height is still its own.
  const contentBottom = () => {
    const last = el.lastElementChild as HTMLElement | null;
    if (!last) return 0;
    const top = last.offsetParent === el ? 0 : el.offsetTop;
    return last.offsetTop - top + last.offsetHeight;
  };
  const below = to - contentBottom();
  const retarget = () => {
    const next = contentBottom() + below;
    if (Math.abs(next - to) < 2) return;
    to = next;
    // Take height out of the transition to stop it where it is, then glide
    // on from there for the time that's left.
    const now = el.getBoundingClientRect().height;
    el.style.transition = fade;
    el.style.height = `${now}px`;
    void el.offsetHeight;
    const left = Math.max(minMs * 0.6, started + ms - performance.now());
    el.style.transition = `height ${Math.round(left)}ms ${ease}, ${fade}`;
    el.style.height = `${to}px`;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => end(), left + 120);
  };
  let primed = false;
  const ro =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          // The first call only reports the sizes as they are.
          if (!primed) {
            primed = true;
            return;
          }
          retarget();
        });
  for (const child of Array.from(el.children)) ro?.observe(child);

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    ro?.disconnect();
    el.removeEventListener("transitionend", onEnd);
    el.style.height = "";
    el.style.transition = "";
    el.style.removeProperty(fadeVar);
    el.classList.remove("is-gliding");
    delete el.dataset.glide;
    if (scroller) {
      const n = (active.get(scroller) ?? 1) - 1;
      active.set(scroller, n);
      if (n <= 0) scroller.style.overflowAnchor = "";
    }
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === "height") end();
  };
  el.addEventListener("transitionend", onEnd);
  return end;
}
