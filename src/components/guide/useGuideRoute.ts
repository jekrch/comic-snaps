import { useSyncExternalStore } from "react";
import { isPageId, type PageId } from "./lessons";

/**
 * The Guide's place in the URL, and its one entry in the browser's history.
 *
 *   ?guide                      the overview
 *   ?guide=siglip               a lesson, from the top
 *   ?guide=siglip#attention     scrolled to a step
 *   ?guide=siglip&anchor=<id>   with a fixed worked example
 *
 * Everything else in the query (sort, filters, view) is left as it was. The
 * site is a static SPA with no path routing, and every other piece of state
 * already lives in query params, so the Guide does too.
 *
 * History: opening pushes one entry, so Back (and the phone's back gesture)
 * closes the Guide. Everything after that (another lesson, a new anchor, the
 * step the reader has scrolled to) replaces it. The Guide never pushes more
 * than one entry, or Back would stop meaning "close the Guide".
 *
 * Owned here rather than in `useFilterParams`, which only ever replaces.
 */

export interface GuideRoute {
  page: PageId;
  step: string | null;
  anchor: string | null;
}

const GUIDE = "guide";
const ANCHOR = "anchor";
/** Params a Guide entry never carries: they belong to layers it covers. */
const COVERED = ["panel", "tab"];
/** Marks the history entry the Guide pushed. */
const ENTRY_KEY = "comicSnapsGuide";

// --- Pure parsing and serialization ---------------------------------------

export function parseGuideRoute(search: string, hash: string): GuideRoute | null {
  const params = new URLSearchParams(search);
  if (!params.has(GUIDE)) return null;
  const raw = params.get(GUIDE);
  const page: PageId = raw && isPageId(raw) ? raw : "overview";
  let step: string | null = null;
  const h = hash.replace(/^#/, "");
  if (h) {
    try {
      step = decodeURIComponent(h);
    } catch {
      step = h;
    }
  }
  return { page, step: step || null, anchor: params.get(ANCHOR) || null };
}

/**
 * The URL for a route on top of the current one, or with the Guide's params
 * taken off when `route` is null. The overview is a bare `?guide`.
 */
export function guideUrl(pathname: string, search: string, route: GuideRoute | null): string {
  const params = new URLSearchParams(search);
  params.delete(GUIDE);
  params.delete(ANCHOR);
  if (route) for (const k of COVERED) params.delete(k);
  let qs = params.toString();
  if (route) {
    const own = new URLSearchParams();
    if (route.page !== "overview") own.set(GUIDE, route.page);
    if (route.anchor) own.set(ANCHOR, route.anchor);
    let ownQs = own.toString();
    if (route.page === "overview") ownQs = ownQs ? `${GUIDE}&${ownQs}` : GUIDE;
    qs = qs ? `${qs}&${ownQs}` : ownQs;
  }
  const hash = route?.step ? `#${encodeURIComponent(route.step)}` : "";
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}

// --- The store --------------------------------------------------------------

export interface GuideState {
  route: GuideRoute | null;
  /** Skip the transition: a cold load opens without one, and an iOS back
   *  swipe has already animated its own. */
  instant: boolean;
  /** Bumped whenever something asks to *go* to `route.step` (a rail click, a
   *  link), as opposed to the reader scrolling past it. */
  scrollNonce: number;
}

let state: GuideState = { route: null, instant: false, scrollNonce: 0 };
const listeners = new Set<() => void>();
/** Whether the current history entry is one the Guide pushed. */
let ownEntry = false;
/** Run once the Guide has finished closing (see `notifyGuideExited`). */
let afterClose: (() => void)[] = [];
let backTimer: number | null = null;
/** When a touch last started at a screen edge, for telling an iOS back swipe
 *  from a button. */
let edgeTouchAt = -Infinity;

function set(next: Partial<GuideState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Listen for any change to the Guide's route (for adapters outside React). */
export function subscribeGuideRoute(l: () => void): () => void {
  return subscribe(l);
}

export function useGuideRoute(): GuideState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getGuideState(): GuideState {
  return state;
}

function loc() {
  return window.location;
}

/**
 * The current entry's state, to build on. Carried into the Guide's own entry
 * so that a layer underneath that keys its history by state (the panel
 * viewer's lightbox) still recognises the entry as one of its own, and
 * doesn't take a Forward into the Guide for a Back out of itself.
 */
function baseState(): Record<string, unknown> {
  const st = window.history.state as unknown;
  return st && typeof st === "object" ? { ...(st as Record<string, unknown>) } : {};
}

function write(route: GuideRoute | null, mode: "push" | "replace") {
  const url = guideUrl(loc().pathname, loc().search, route);
  try {
    const st = baseState();
    if (mode === "push" || (route && ownEntry)) st[ENTRY_KEY] = true;
    else delete st[ENTRY_KEY];
    if (mode === "push") window.history.pushState(st, "", url);
    else window.history.replaceState(Object.keys(st).length ? st : null, "", url);
  } catch {
    // A sandboxed frame can refuse history writes; the Guide still works,
    // it just isn't in the URL.
  }
}

function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** Open the Guide (pushing its history entry), or move within it if open. */
export function openGuide(opts: { page?: PageId; step?: string | null; anchor?: string | null } = {}): void {
  const route: GuideRoute = {
    page: opts.page ?? "overview",
    step: opts.step ?? null,
    anchor: opts.anchor ?? state.route?.anchor ?? null,
  };
  if (state.route) {
    navigateGuide(route);
    return;
  }
  // Chrome skips history entries added without a user gesture when going
  // Back, which would make Back leave the site. Every entry point is a
  // click, so this is only a guard.
  if (hasUserActivation()) {
    write(route, "push");
    ownEntry = true;
  } else {
    write(route, "replace");
  }
  set({ route, instant: false, scrollNonce: state.scrollNonce + 1 });
}

/** Move within the open Guide: another page, step or anchor. Replaces. */
export function navigateGuide(next: Partial<GuideRoute>, opts: { scroll?: boolean } = {}): void {
  if (!state.route) return;
  const pageChanged = next.page !== undefined && next.page !== state.route.page;
  const route: GuideRoute = {
    ...state.route,
    // A new page starts from its top unless a step was named.
    ...(pageChanged ? { step: null } : null),
    ...next,
  };
  write(route, "replace");
  const scroll = opts.scroll ?? (pageChanged || next.step !== undefined);
  set({ route, scrollNonce: scroll ? state.scrollNonce + 1 : state.scrollNonce });
}

/**
 * Note the step the reader has scrolled to, in the URL only, so the address
 * bar is always a link to where they are. Doesn't re-render anything.
 */
export function recordGuideStep(step: string | null): void {
  if (!state.route) return;
  const route = { ...state.route, step };
  write(route, "replace");
  state = { ...state, route };
}

/**
 * Close the Guide. `after` runs once it has finished leaving (the exit
 * transition included), e.g. to apply a sort behind it.
 */
export function closeGuide(after?: () => void): void {
  if (!state.route) {
    after?.();
    return;
  }
  if (after) afterClose.push(after);
  const st = window.history.state as Record<string, unknown> | null;
  if (ownEntry && st && st[ENTRY_KEY]) {
    // Pop our own entry; the popstate below does the rest. If it never
    // comes (a frame that ignores history), close anyway.
    window.history.back();
    if (backTimer !== null) window.clearTimeout(backTimer);
    backTimer = window.setTimeout(() => {
      backTimer = null;
      if (state.route) {
        ownEntry = false;
        write(null, "replace");
        set({ route: null, instant: false });
      }
    }, 500);
    return;
  }
  ownEntry = false;
  write(null, "replace");
  set({ route: null, instant: false });
}

/** Called by the host once the Guide has unmounted. */
export function notifyGuideExited(): void {
  const run = afterClose;
  afterClose = [];
  run.forEach((f) => f());
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export const IS_IOS = isIOS();

function onPopState() {
  if (backTimer !== null) {
    window.clearTimeout(backTimer);
    backTimer = null;
  }
  const route = parseGuideRoute(loc().search, loc().hash);
  const st = window.history.state as Record<string, unknown> | null;
  if (state.route && !route) {
    ownEntry = false;
    // Safari has already played its own back-swipe animation over a
    // snapshot; animating the exit too would show it twice.
    const swiped = IS_IOS && performance.now() - edgeTouchAt < 1000;
    set({ route: null, instant: swiped });
  } else if (route) {
    // Forward into a Guide entry, or between two of them.
    ownEntry = !!(st && st[ENTRY_KEY]);
    set({ route, instant: !state.route && IS_IOS, scrollNonce: state.scrollNonce + 1 });
  }
}

let installed = false;

/**
 * Wire up history, and handle a cold load of a Guide link. Called once,
 * before the app first renders, so that the gallery underneath reads a URL
 * without the layers the Guide covers (an open panel, an info tab).
 */
export function initGuideRoute(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener(
    "touchstart",
    (e) => {
      const x = e.touches[0]?.clientX ?? 100;
      if (x < 24 || x > window.innerWidth - 24) edgeTouchAt = performance.now();
    },
    { capture: true, passive: true }
  );

  const route = parseGuideRoute(loc().search, loc().hash);
  if (!route) return;
  ownEntry = false;
  write(route, "replace");
  state = { route, instant: true, scrollNonce: 1 };

  // A shared link lands with the Guide open and nothing to go Back to. Once
  // the reader has interacted (so the entry won't be skipped), put the bare
  // gallery underneath and the Guide on top, so Back shows the gallery.
  const events = ["pointerup", "keydown", "touchend", "click"] as const;
  const promote = () => {
    if (!hasUserActivation()) return;
    events.forEach((ev) => window.removeEventListener(ev, promote, true));
    if (!state.route || ownEntry) return;
    try {
      window.history.replaceState(null, "", guideUrl(loc().pathname, loc().search, null));
      write(state.route, "push");
      ownEntry = true;
    } catch {
      // Leave it as a single entry.
    }
  };
  events.forEach((ev) => window.addEventListener(ev, promote, true));
}

/** An absolute link to a place in the Guide, for copying. */
export function guideHref(route: GuideRoute): string {
  return `${loc().origin}${guideUrl(loc().pathname, loc().search, route)}`;
}
