/**
 * Where the document keeps its place and its preferences: adapters the host
 * chooses, so the framework never assumes a URL scheme or a storage API.
 */

// --- Routing -----------------------------------------------------------------

export interface Route {
  /** The page, or null: in overlay mode, the document is closed. */
  page: string | null;
  step: string | null;
}

export interface RouteAdapter {
  read(): Route;
  write(route: Route, how: "push" | "replace"): void;
  /** Calls back when the route changes from outside (Back, a link); returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** The address of a route, for links and "copy link". */
  href(route: Route): string;
  /**
   * Note where the reader is without moving them or notifying anyone (the
   * address bar following the section). Falls back to a replacing `write`.
   */
  record?(route: Route): void;
}

const ROUTE_EVENT = "dd:route";

function historyWrite(url: string, how: "push" | "replace") {
  if (url === location.pathname + location.search + location.hash) return;
  if (how === "push") history.pushState(history.state, "", url);
  else history.replaceState(history.state, "", url);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

function historySubscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

/**
 * `?<param>=<page>#<step>`, keeping the rest of the query: the Guide's
 * scheme, and the default for overlay mode. A bare `?<param>` is the first
 * page; no param at all is closed. The host's other query params pass
 * through untouched.
 */
export function queryRoute(param = "doc"): RouteAdapter {
  const href = (r: Route) => {
    const q = new URLSearchParams(location.search);
    if (r.page === null) q.delete(param);
    else q.set(param, r.page);
    const qs = q.toString().replace(new RegExp(`(^|&)${param}=(?=&|$)`), `$1${param}`);
    return `${location.pathname}${qs ? `?${qs}` : ""}${r.step ? `#${r.step}` : ""}`;
  };
  return {
    read() {
      const q = new URLSearchParams(location.search);
      if (!q.has(param)) return { page: null, step: null };
      return { page: q.get(param) || "", step: decodeURIComponent(location.hash.slice(1)) || null };
    },
    write: (r, how) => historyWrite(href(r), how),
    subscribe: historySubscribe,
    href,
  };
}

/** `#/<page>/<step>`, for a standalone page with nothing else in its URL. */
export function hashRoute(): RouteAdapter {
  const href = (r: Route) =>
    `${location.pathname}${location.search}${r.page === null ? "" : `#/${r.page}${r.step ? `/${r.step}` : ""}`}`;
  return {
    read() {
      const m = /^#\/([^/]*)(?:\/(.*))?$/.exec(location.hash);
      return m ? { page: decodeURIComponent(m[1]), step: m[2] ? decodeURIComponent(m[2]) : null } : { page: "", step: null };
    },
    write: (r, how) => historyWrite(href(r), how),
    subscribe: historySubscribe,
    href,
  };
}

/** Kept in memory: embedded documents that shouldn't touch the URL, and tests. */
export function memoryRoute(initial: Route = { page: "", step: null }): RouteAdapter {
  let route = initial;
  const subs = new Set<() => void>();
  return {
    read: () => route,
    write(r) {
      route = r;
      subs.forEach((f) => f());
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    href: (r) => `#${r.step ?? ""}`,
  };
}

// --- Storage -----------------------------------------------------------------

/**
 * Per-viewer conveniences, never required: the depth preference, where each
 * page was left, which pages were read to the end.
 */
export interface StorageAdapter {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

/**
 * `localStorage` under a prefix. Wrapped, since storage can be missing or
 * throw (private windows, blocked site data); then nothing is remembered.
 */
export function localStore(prefix: string): StorageAdapter {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = window.localStorage.getItem(`${prefix}.${key}`);
        return raw ? (JSON.parse(raw) as T) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(`${prefix}.${key}`, JSON.stringify(value));
      } catch {
        // Not remembered, then.
      }
    },
  };
}

export function memoryStore(): StorageAdapter {
  const m = new Map<string, unknown>();
  return {
    get: <T,>(key: string, fallback: T) => (m.has(key) ? (m.get(key) as T) : fallback),
    set: (key, value) => void m.set(key, value),
  };
}
