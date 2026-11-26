import { useEffect, useId, useState } from "react";
import { popOverlay, pushOverlay } from "../core/overlayStack";
import { prefersReducedMotion } from "../core/motion";
import { INITIAL_SPY, createScrollSpy, type SpyOptions, type SpyState } from "../core/scroll";
import { observeReveal } from "../core/reveal";

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/**
 * Keeps the last non-null value around for `ms` after it goes null, so
 * something closing can animate out before it unmounts.
 */
export function usePresence<T>(value: T | null, ms: number): { item: T | null; leaving: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setKept(value);
      return;
    }
    const t = window.setTimeout(() => setKept(null), prefersReducedMotion() ? 0 : ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return { item: value ?? kept, leaving: value === null && kept !== null };
}

/**
 * Holds a place on the overlay stack while `active`, and returns the
 * entry's id so the layer can ask whether it's on top.
 */
export function useOverlay(active: boolean, name = "overlay"): string {
  const id = `${name}${useId()}`;
  useEffect(() => {
    if (!active) return;
    pushOverlay(id);
    return () => popOverlay(id);
  }, [active, id]);
  return id;
}

/** The scroll spy (core/scroll), re-reading the steps whenever `contentKey` changes. */
export function useScrollSpy(scroller: HTMLElement | null, contentKey: unknown, opts?: SpyOptions): SpyState {
  const [state, setState] = useState<SpyState>(INITIAL_SPY);
  const root = opts?.root;
  const offset = opts?.offset;
  useEffect(() => {
    if (!scroller) return;
    const spy = createScrollSpy(scroller, setState, { root: root ?? scroller, offset });
    return spy.destroy;
  }, [scroller, root, offset, contentKey]);
  return state;
}

/** Reveal on first view (core/reveal), looked for again when `contentKey` changes. */
export function useReveal(
  scroller: HTMLElement | null,
  contentKey: unknown,
  enabled: boolean,
  selector: string,
  root?: Element | null,
) {
  useEffect(() => {
    if (!scroller || !enabled) return;
    return observeReveal(scroller, root ?? scroller, selector);
  }, [scroller, root, contentKey, enabled, selector]);
}
