import { Children, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { memoryStore, type Route, type RouteAdapter, type StorageAdapter } from "../core/adapters";
import { freezeLayers, type AppBehind } from "../core/layers";
import { MOTION, prefersReducedMotion } from "../core/motion";
import { isTopOverlay } from "../core/overlayStack";
import { holdPlace, offsetIn, type SpyState } from "../core/scroll";
import {
  DocContext,
  createDocStore,
  type DocContextValue,
  type Facet,
  type FigureRegistry,
  type OpenFacet,
  type SectionEntry,
  type TermDef,
} from "./context";
import { FACET_EXIT_MS, FacetPane, FacetSheet } from "./FacetPane";
import { useMediaQuery, useOverlay, usePresence, useReveal, useScrollSpy } from "./hooks";
import { ArrowLeft, ArrowRight, Menu } from "./icons";
import { ContentsSheet, Rail, type RailItem, type RailPage } from "./Rail";

// --- Pages ---------------------------------------------------------------------

export interface SourceGroupDef {
  id: string;
  title: string;
  /** The rail's label, when the title is long. */
  short?: string;
  items: ReactNode[];
}

export interface PageProps {
  id: string;
  title: string;
  /** The rail's label; the title by default. */
  label?: string;
  /** The line above the title. */
  eyebrow?: ReactNode;
  /** The one sentence under the title. */
  gist?: ReactNode;
  /**
   * The lede once the page is set past its first level; `gist` shows at the
   * first. Without it, `gist` shows at every level.
   */
  lede?: ReactNode;
  /**
   * False while the page's content is still arriving (a "Loading…" line):
   * jumps to a section wait for it, and it fades up when it comes.
   */
  ready?: boolean;
  /** Set apart at the end of the rail (a glossary). */
  apart?: boolean;
  /** Counted in the masthead's run of pips; default true. */
  inSequence?: boolean;
  /** This page's level names, when they differ from the document's. */
  levels?: string[];
  /** Reading time at each depth, when the sections don't give word counts. */
  minutes?: number[];
  /** Pages this one assumes, linked under the title. */
  buildsOn?: string[];
  /** The terms this page defines, by id. */
  terms?: Record<string, TermDef>;
  sources?: SourceGroupDef[];
  children?: ReactNode;
}

/** One page of a document. `DimDoc` reads its props; it renders nothing itself. */
export function Page(_: PageProps): null {
  return null;
}

function collectPages(children: ReactNode): PageProps[] {
  const out: PageProps[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === Fragment) out.push(...collectPages((c as ReactElement<{ children?: ReactNode }>).props.children));
    else if (c.type === Page) out.push((c as ReactElement<PageProps>).props);
  });
  return out;
}

// --- Hosts -------------------------------------------------------------------------

export interface RailState {
  pages: RailPage[];
  sections: RailItem[];
  sources: RailItem[];
  step: string | null;
}

/**
 * Where the document lives. `page`: it owns the window and scrolls with it.
 * `overlay`: it slides over a running app, which moves aside and dims
 * behind it, and a route with no page closes it. `embedded`: inside someone
 * else's layout, with no masthead, and the rail optionally handed to the
 * host's own sidebar.
 */
export type Host =
  | { mode: "page" }
  | {
      mode: "overlay";
      /** The app's top-level layers, moved aside as the document comes in. */
      appLayers: () => HTMLElement[];
      shift?: number;
      dim?: number;
      zIndex?: number;
      /** What closing does; by default the route's page is cleared. */
      onClose?: () => void;
      /** Called once the document has finished leaving. */
      onExited?: () => void;
      /** The app behind, frozen and moved aside; by default `freezeLayers(appLayers())`. */
      behind?: () => AppBehind;
      /** Open (or close) without the slide: a cold load, or a back swipe that animated itself. */
      instant?: boolean;
      /** Opened from a link with nothing to slide over: what's on the sheet arrives in order instead. */
      landing?: boolean;
      /** The edge swipe that closes it; off where the platform has its own (iOS). Default true. */
      swipe?: boolean;
      /** The masthead's way out; "Back" by default. */
      backLabel?: string;
    }
  | { mode: "embedded"; sidebar?: (rail: RailState) => void };

export interface DimDocProps {
  /** The document's (or collection's) name, in the masthead. */
  title: string;
  subtitle?: string;
  /** The level names, from the layer model or the legend. */
  levels: string[];
  route: RouteAdapter;
  /** Where the depth preference, positions and read pages are kept; memory by default. */
  storage?: StorageAdapter;
  host?: Host;
  /** Terms for every page, by id; a page's own come first. */
  terms?: Record<string, TermDef>;
  figures?: FigureRegistry;
  /** Adds a glossary page of every term, under this title. */
  glossary?: string;
  /** A way out of the document, in page mode. */
  back?: { label: string; onClick: () => void };
  /** At and above this width: rail, column and margin side by side. */
  desktopMin?: number;
  /** What a section is called in the way back from a facet ("Step 3"); "Section" by default. */
  sectionNoun?: string;
  /** Host content in fixed places, given the document's state. */
  slots?: {
    /** Under the masthead, on phones only (a sticky strip). */
    belowMasthead?: (s: SlotState) => ReactNode;
    /** At the top of the margin, on wide screens only, above any facet. */
    marginTop?: (s: SlotState) => ReactNode;
    /** At the end of the page, before the previous and next cards. */
    endOfPage?: (s: SlotState) => ReactNode;
    /** Over everything (a picker the host opens). */
    layer?: (s: SlotState) => ReactNode;
  };
  /** Replaces the note at the end of a folded page. */
  endNote?: (s: EndNoteState) => ReactNode;
  /** More elements that rise into place on first view, beside sections. */
  revealSelector?: string;
  children?: ReactNode;
}

export interface SlotState {
  page: string;
  desktop: boolean;
  /** The reader's place: section, progress, direction. */
  spy: SpyState;
}

export interface EndNoteState {
  page: string;
  levels: string[];
  /** The page switch's pressed level, or -1 when mixed. */
  pressed: number;
  /** Every section at its deepest. */
  deepen: () => void;
}

const GLOSSARY_ID = "glossary";
const WORDS_PER_MINUTE = 230;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

function sameEntries(a: SectionEntry[], b: SectionEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (e, i) =>
        e.id === b[i].id &&
        e.el === b[i].el &&
        e.title === b[i].title &&
        e.short === b[i].short &&
        e.layers === b[i].layers &&
        e.words?.join() === b[i].words?.join(),
    )
  );
}

/**
 * A dimensional document on a screen built for it: a page-wide depth
 * switch, a switch on every section, a rail that tracks the reader, term
 * popovers and sidenotes, facets in the margin, and motion that never loses
 * the reader's place when the depth changes.
 */
export function DimDoc(props: DimDocProps) {
  const { route, host = { mode: "page" }, figures = {}, desktopMin = 1100 } = props;
  const mode = host.mode;
  const [fallbackStorage] = useState(memoryStore);
  const storage = props.storage ?? fallbackStorage;
  const [store] = useState(createDocStore);

  const pages = useMemo(() => {
    const list = collectPages(props.children);
    if (props.glossary) list.push({ id: GLOSSARY_ID, title: props.glossary, label: props.glossary });
    return list;
  }, [props.children, props.glossary]);

  // --- Where we are ------------------------------------------------------------

  const [r, setR] = useState(() => ({ ...route.read(), nonce: 0 }));
  /**
   * True while this document writes the route itself, so the adapter's
   * notice of that write (adapters notify as they write) isn't taken for a
   * jump from outside. An adapter that doesn't notify its own writes leaves
   * nothing behind to swallow a later, real one.
   */
  const writing = useRef(false);
  const writeRoute = useCallback(
    (next: Route, how: "push" | "replace") => {
      writing.current = true;
      try {
        route.write(next, how);
      } finally {
        writing.current = false;
      }
    },
    [route],
  );
  useEffect(
    () =>
      route.subscribe(() => {
        if (writing.current) return;
        const next = route.read();
        setR((cur) => ({ ...next, nonce: cur.nonce + 1 }));
      }),
    [route],
  );
  /** Record the reader's place without moving them. */
  const record = useCallback(
    (next: Route) => {
      const cur = route.read();
      if (cur.page === next.page && cur.step === next.step) return;
      if (route.record) return route.record(next);
      writeRoute(next, "replace");
    },
    [route, writeRoute],
  );
  /** Go somewhere: write the route and make the jump. */
  const navigate = useCallback(
    (next: Route, how: "push" | "replace") => {
      writeRoute(next, how);
      setR((cur) => ({ ...next, nonce: cur.nonce + 1 }));
    },
    [writeRoute],
  );

  const open = mode !== "overlay" || r.page !== null;
  const lastPage = useRef(pages[0]?.id ?? "");
  const known = r.page !== null && pages.some((p) => p.id === r.page);
  const pageId = known ? r.page! : r.page === null && mode === "overlay" ? lastPage.current : (pages[0]?.id ?? "");
  lastPage.current = pageId;
  const page = pages.find((p) => p.id === pageId) ?? { id: "", title: "" };
  const pageIndex = pages.findIndex((p) => p.id === pageId);
  const levels = page.levels ?? props.levels;

  const desktop = useMediaQuery(`(min-width: ${desktopMin}px)`);
  const [reduced] = useState(prefersReducedMotion);
  const overlayId = useOverlay(open, "dimensional");
  const zIndex = host.mode === "overlay" ? (host.zIndex ?? 120) : 50;

  // --- Sections --------------------------------------------------------------------

  const registry = useRef(new Map<string, SectionEntry>());
  const [entries, setEntries] = useState<SectionEntry[]>([]);
  const refresh = useCallback(() => {
    const list = [...registry.current.values()].sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    setEntries((prev) => (sameEntries(prev, list) ? prev : list));
  }, []);
  const register = useCallback(
    (e: SectionEntry) => {
      registry.current.set(e.id, e);
      refresh();
      return () => {
        if (registry.current.get(e.id) === e) {
          registry.current.delete(e.id);
          refresh();
        }
      };
    },
    [refresh],
  );
  const titled = useMemo(() => entries.filter((e) => e.title), [entries]);
  const sectionNumber = useCallback((id: string) => titled.findIndex((e) => e.id === id) + 1, [titled]);

  // --- Depth --------------------------------------------------------------------------

  // The page setting is remembered as a level index; each section's own
  // choice lasts for the visit.
  const [pageDepth, setPageDepthState] = useState(() => {
    const d = storage.get<number>("depth", 0);
    return Number.isInteger(d) && d >= 0 ? d : 0;
  });
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const requestedDepth = useCallback(
    (section: string) => overrides[`${pageId}:${section}`] ?? pageDepth,
    [overrides, pageId, pageDepth],
  );
  // Before the sections are in (a page still loading), the switch offers
  // every level the document names.
  const maxLayers = entries.length ? Math.max(1, ...entries.map((e) => e.layers)) : levels.length;
  const pageLevels = levels.slice(0, maxLayers);
  const switchable = entries.filter((e) => e.layers > 1);
  const asked = new Set(switchable.map((e) => requestedDepth(e.id)));
  /** The page switch's pressed level, or -1 when sections have been mixed by hand. */
  const pressed = asked.size > 1 ? -1 : Math.min(asked.size ? [...asked][0] : pageDepth, pageLevels.length - 1);

  // Sections switched by hand on this page, whose new content fades in.
  const [swapped, setSwapped] = useState<{ page: string; ids: ReadonlySet<string> }>({ page: pageId, ids: new Set() });
  const swappedHere = useMemo(() => (swapped.page === pageId ? swapped.ids : new Set<string>()), [swapped, pageId]);
  const markSwapped = useCallback(
    (ids: string[]) =>
      setSwapped((cur) => ({ page: pageId, ids: new Set([...(cur.page === pageId ? cur.ids : []), ...ids]) })),
    [pageId],
  );

  // --- Facets beside the prose ------------------------------------------------------

  const [facet, setFacet] = useState<OpenFacet | null>(null);
  const [facetExpanded, setFacetExpanded] = useState(false);
  useEffect(() => {
    setFacet(null);
    setFacetExpanded(false);
  }, [pageId]);
  const toggleFacet = useCallback(
    (section: string, f: Facet) => {
      setFacetExpanded(false);
      setFacet((cur) =>
        cur?.section === section && cur.name === f.name
          ? null
          : { ...f, section, sectionLabel: `${props.sectionNoun ?? "Section"} ${sectionNumber(section) || "·"}` },
      );
    },
    [sectionNumber, props.sectionNoun],
  );

  // --- Scrolling ------------------------------------------------------------------------

  // Page and embedded modes scroll with the window; overlay mode in its sheet.
  const [ownScroller, setOwnScroller] = useState<HTMLDivElement | null>(null);
  const scroller =
    mode === "overlay" ? ownScroller : typeof document !== "undefined" ? (document.scrollingElement as HTMLElement | null) : null;
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const ready = page.ready !== false;
  const contentKey = `${pageId}:${ready}:${entries.length}`;
  const spy = useScrollSpy(rootEl ? scroller : null, contentKey, { root: rootEl ?? undefined });
  const revealSelector = `.dd-section, .dd-glossary-entry${props.revealSelector ? `, ${props.revealSelector}` : ""}`;
  useReveal(rootEl ? scroller : null, `${pageId}:${ready}`, !reduced, revealSelector, rootEl);
  // The page's content fades up when it arrives after its "Loading…" line.
  const sawLoading = useRef<string | null>(null);
  if (!ready) sawLoading.current = pageId;

  const positions = useCallback(() => storage.get<Record<string, number>>("positions", {}), [storage]);

  // A jump that's been asked for (a rail click, a link, opening on a step)
  // and not yet made. `keep`: the page switch, which changes every section
  // at once, so the jump is instant and held while figures settle.
  const pending = useRef<{ page: string; step: string | null; keep?: boolean } | null>(null);
  const seenNonce = useRef(-1);
  if (r.nonce !== seenNonce.current) {
    seenNonce.current = r.nonce;
    pending.current = { page: pageId, step: r.step };
  }
  const shownPage = useRef<string | null>(null);
  const pin = useRef<(() => void) | null>(null);
  useEffect(() => () => pin.current?.(), []);

  const jumpOffset = mode === "embedded" ? 16 : desktop ? 72 : 64;
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || !scroller || !rootEl || p.page !== pageId || !ready) return;
    pending.current = null;
    pin.current?.();
    const samePage = shownPage.current === pageId;
    shownPage.current = pageId;
    const stepTop = (step: string): number | null => {
      const el = rootEl.querySelector(`[data-step="${CSS.escape(step)}"]`) ?? rootEl.querySelector(`#${CSS.escape(step)}`);
      return el ? Math.max(0, offsetIn(scroller, el) - jumpOffset) : null;
    };
    let top: number | null;
    if (p.step) top = stepTop(p.step) ?? (samePage ? null : 0);
    else if (mode === "embedded") top = samePage ? offsetIn(scroller, rootEl) - jumpOffset : null;
    else top = samePage ? 0 : (positions()[pageId] ?? 0);
    if (top === null) return;
    scroller.scrollTo({ top, behavior: samePage && !p.keep && !reduced ? "smooth" : "auto" });
    if (!p.step || (samePage && !p.keep)) return;
    const step = p.step;
    pin.current = holdPlace(scroller, rootEl, () => stepTop(step));
  });

  // The address follows the reader's section.
  useEffect(() => {
    if (!open || pending.current) return;
    const t = window.setTimeout(() => record({ page: pageId, step: spy.step }), 200);
    return () => window.clearTimeout(t);
  }, [open, spy.step, pageId, record]);

  // Where each page was left, and which pages were read to the end.
  useEffect(() => {
    if (mode === "embedded" || pending.current || !ready) return;
    const t = window.setTimeout(() => storage.set("positions", { ...positions(), [pageId]: Math.round(spy.scrollTop) }), 400);
    return () => window.clearTimeout(t);
  }, [spy.scrollTop, pageId, mode, storage, positions]);
  const [finished, setFinished] = useState(() => new Set(storage.get<string[]>("finished", [])));
  useEffect(() => {
    if (pageId === GLOSSARY_ID || finished.has(pageId) || spy.scrollTop <= 0 || spy.progress <= 0.97) return;
    const next = new Set(finished).add(pageId);
    storage.set("finished", [...next]);
    setFinished(next);
  }, [spy.progress, spy.scrollTop, pageId, finished, storage]);

  // --- Moving around ----------------------------------------------------------------------

  const goTo = useCallback(
    (to: string, step?: string | null) => navigate({ page: to, step: step ?? null }, to === pageId ? "replace" : "push"),
    [navigate, pageId],
  );

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);
  const copyLink = useCallback(
    (step: string) => {
      const href = new URL(route.href({ page: pageId, step }), location.href).toString();
      goTo(pageId, step);
      const done = () => setToast("Link copied");
      const fail = () => setToast("The address bar has the link");
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(done, fail);
      else fail();
    },
    [route, pageId, goTo],
  );

  const spyStep = useRef(spy.step);
  spyStep.current = spy.step;

  const setSectionDepth = useCallback(
    (section: string, depth: number) => {
      setOverrides((o) => ({ ...o, [`${pageId}:${section}`]: depth }));
      markSwapped([section]);
    },
    [pageId, markSwapped],
  );

  /** The page switch: every section to one depth, keeping the reader at `step` (default: where they are). */
  const setPageDepth = useCallback(
    (depth: number, step?: string | null) => {
      storage.set("depth", depth);
      const changing = switchable
        .filter((e) => Math.min(requestedDepth(e.id), e.layers - 1) !== Math.min(depth, e.layers - 1))
        .map((e) => e.id);
      setPageDepthState(depth);
      setOverrides((o) => {
        const next = { ...o };
        for (const k of Object.keys(next)) if (k.startsWith(`${pageId}:`)) delete next[k];
        return next;
      });
      if (changing.length === 0) {
        if (step) goTo(pageId, step);
        return;
      }
      pending.current = { page: pageId, step: step === undefined ? spyStep.current : step, keep: true };
      markSwapped(changing);
    },
    [storage, switchable, requestedDepth, pageId, goTo, markSwapped],
  );

  // --- Terms ----------------------------------------------------------------------------------

  const allTerms = useMemo(() => {
    const out: { key: string; def: TermDef }[] = [];
    for (const p of pages) for (const [id, def] of Object.entries(p.terms ?? {})) out.push({ key: `${p.id}/${id}`, def });
    for (const [id, def] of Object.entries(props.terms ?? {})) out.push({ key: id, def });
    return out;
  }, [pages, props.terms]);
  const term = useCallback(
    (id: string): TermDef | null =>
      page.terms?.[id] ?? props.terms?.[id] ?? allTerms.find((t) => t.key.endsWith(`/${id}`))?.def ?? null,
    [page.terms, props.terms, allTerms],
  );

  const ctx = useMemo<DocContextValue>(
    () => ({
      page: pageId,
      levels,
      desktop,
      reduced,
      scroller,
      requestedDepth,
      setSectionDepth,
      swapped: swappedHere,
      sectionNumber,
      register,
      openFacet: facet,
      toggleFacet,
      goTo,
      copyLink,
      term,
      figures,
      store,
    }),
    [pageId, levels, desktop, reduced, scroller, requestedDepth, setSectionDepth, swappedHere, sectionNumber, register, facet, toggleFacet, goTo, copyLink, term, figures, store],
  );

  // --- Overlay mode: coming and going ----------------------------------------------------------

  const app = useRef<AppBehind | null>(null);
  const instant = host.mode === "overlay" && !!host.instant;
  const [entered, setEntered] = useState(mode !== "overlay" || instant);
  // Opened from a link with nothing to slide over: the sheet's contents land
  // in a sequence instead (`.is-landing`), once.
  const [landing, setLanding] = useState(host.mode === "overlay" && !!host.landing);
  useEffect(() => {
    if (!landing) return;
    const t = window.setTimeout(() => setLanding(false), 1400);
    return () => window.clearTimeout(t);
  }, [landing]);
  const [drag, setDrag] = useState<number | null>(null);
  const slideMs = MOTION.slideMs;
  const slide = `transform ${slideMs}ms ${MOTION.ease}`;
  const close = useCallback(() => {
    if (host.mode !== "overlay") return;
    if (host.onClose) host.onClose();
    else navigate({ page: null, step: null }, "push");
  }, [host, navigate]);

  useLayoutEffect(() => {
    if (host.mode !== "overlay") return;
    const behind = host.behind ? host.behind() : freezeLayers(host.appLayers(), host.shift ?? MOTION.appShift);
    app.current = behind;
    if (host.instant) {
      behind.shift(reduced ? 0 : 1, null);
      behind.hide();
    }
    return () => {
      behind.restore();
      app.current = null;
    };
    // Once, for the document's whole stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus on the sheet's scroller, so Space and the arrow keys scroll the document.
  useEffect(() => {
    ownScroller?.focus({ preventScroll: true });
  }, [ownScroller]);

  useEffect(() => {
    if (mode !== "overlay" || instant) return;
    let live = true;
    const r1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!live) return;
        setEntered(true);
        app.current?.shift(reduced ? 0 : 1, reduced ? null : slide);
      }),
    );
    return () => {
      live = false;
      cancelAnimationFrame(r1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once fully covered, stop painting the app underneath.
  useEffect(() => {
    if (mode !== "overlay" || !open || !entered || drag !== null) return;
    const t = window.setTimeout(() => app.current?.hide(), instant ? 0 : (reduced ? MOTION.fadeMs : slideMs) + 30);
    return () => window.clearTimeout(t);
  }, [mode, open, entered, drag, reduced, slideMs, instant]);

  // Leave: show the app first, so it's painted before it slides back.
  useEffect(() => {
    if (host.mode !== "overlay" || open) return;
    app.current?.show();
    // Closed by a back swipe that already animated itself: leave at once.
    if (host.instant) {
      host.onExited?.();
      return;
    }
    setDrag(null);
    setEntered(false);
    app.current?.shift(0, reduced ? null : slide);
    const t = window.setTimeout(() => host.onExited?.(), reduced ? MOTION.fadeMs : slideMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Edge swipe to close.
  const swipe = useRef<{ x: number; y: number; t: number; locked: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (host.mode !== "overlay" || host.swipe === false || reduced || !open) return;
    const t = e.touches[0];
    if (t && t.clientX < 20) swipe.current = { x: t.clientX, y: t.clientY, t: performance.now(), locked: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current;
    const t = e.touches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      s.locked = true;
      app.current?.show();
    }
    const d = Math.max(0, dx);
    setDrag(d);
    app.current?.shift(1 - d / window.innerWidth, null);
  };
  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || drag === null) return;
    const v = drag / Math.max(1, performance.now() - s.t);
    if (drag > window.innerWidth * 0.35 || v > 0.5) close();
    else {
      setDrag(null);
      app.current?.shift(1, slide);
    }
  };

  // --- Keys ------------------------------------------------------------------------------------------

  const [contentsOpen, setContentsOpen] = useState(false);
  const [railFocus, setRailFocus] = useState(0);
  const prev = pageIndex > 0 ? pages[pageIndex - 1] : null;
  const next = pageIndex >= 0 && pageIndex < pages.length - 1 ? pages[pageIndex + 1] : null;
  const showRail = mode !== "embedded" || !host.sidebar;

  // Escape closes the innermost thing; arrows walk the pages; D steps the
  // depth; / or g goes to the contents. Only while this is the top layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open || !isTopOverlay(overlayId)) return;
      if (e.key === "Escape") {
        if (facetExpanded) setFacetExpanded(false);
        else if (facet && desktop) setFacet(null);
        else if (mode === "overlay") close();
        else return;
        e.preventDefault();
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      if (e.key === "ArrowLeft" && prev && mode !== "embedded") {
        e.preventDefault();
        goTo(prev.id);
      } else if (e.key === "ArrowRight" && next && mode !== "embedded") {
        e.preventDefault();
        goTo(next.id);
      } else if ((e.key === "d" || e.key === "D") && pageLevels.length > 1) {
        e.preventDefault();
        setPageDepth(pressed < 0 ? 0 : (pressed + 1) % pageLevels.length);
      } else if ((e.key === "/" || e.key === "g") && showRail) {
        e.preventDefault();
        if (desktop) setRailFocus((n) => n + 1);
        else setContentsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overlayId, facet, facetExpanded, desktop, mode, close, prev, next, goTo, pageLevels.length, pressed, setPageDepth, showRail]);

  // --- Rail -------------------------------------------------------------------------------------------

  const railPages: RailPage[] = useMemo(
    () => pages.map((p) => ({ id: p.id, label: p.label ?? p.title, apart: p.apart ?? p.id === GLOSSARY_ID })),
    [pages],
  );
  const railSections: RailItem[] = useMemo(() => titled.map((e) => ({ id: e.id, label: e.short ?? e.title })), [titled]);
  const railSources: RailItem[] = useMemo(
    () => (page.sources ?? []).map((g) => ({ id: g.id, label: g.short ?? g.title, count: g.items.length })),
    [page.sources],
  );
  const hrefFor = useCallback((p: string, s?: string) => route.href({ page: p, step: s ?? null }), [route]);
  const sidebar = host.mode === "embedded" ? host.sidebar : undefined;
  useEffect(() => {
    sidebar?.({ pages: railPages, sections: railSections, sources: railSources, step: spy.step });
  }, [sidebar, railPages, railSections, railSources, spy.step]);

  // --- Rendering -------------------------------------------------------------------------------------

  // Which way a page change goes: forward enters from the right, back from the left.
  const motion = useRef({ page: pageId, dir: 0 });
  if (motion.current.page !== pageId) {
    const at = (id: string) => pages.findIndex((p) => p.id === id);
    motion.current = { page: pageId, dir: at(pageId) >= at(motion.current.page) ? 1 : -1 };
  }

  // Reading time follows the depth each section is at.
  const depthOf = (e: SectionEntry) => Math.min(requestedDepth(e.id), e.layers - 1);
  let minutes: number | null = null;
  if (entries.length && entries.every((e) => e.words)) {
    const words = entries.reduce((n, e) => n + (e.words![depthOf(e)] ?? 0), 0);
    minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  } else if (page.minutes?.length) {
    const m = page.minutes;
    const at = (d: number) => m[Math.min(d, m.length - 1)];
    minutes = Math.round(
      switchable.length ? switchable.reduce((n, e) => n + at(depthOf(e)), 0) / switchable.length : at(pageDepth),
    );
  }
  const folded = switchable.some((e) => depthOf(e) < e.layers - 1);
  const deepest = pageLevels.length - 1;

  const marginFacet = usePresence(desktop ? facet : null, FACET_EXIT_MS);
  const goToFacetSection = () => facet && goTo(pageId, facet.section);

  const isGlossary = pageId === GLOSSARY_ID && !!props.glossary;
  const progress = mode === "embedded" ? null : (
    <div className="dd-progress" aria-hidden="true">
      <div style={{ transform: `scaleX(${spy.progress})` }} />
    </div>
  );
  const backButton =
    host.mode === "overlay" ? { label: host.backLabel ?? "Back", onClick: close } : mode === "page" ? props.back : undefined;
  const slotState: SlotState = { page: pageId, desktop, spy };
  // The run of pips counts only the pages in sequence (not an overview or a glossary).
  const sequence = pages.filter((p) => p.inSequence !== false);
  const seqIndex = sequence.findIndex((p) => p.id === pageId);
  // The gist at the first level; past it, the lede if the page has one.
  const lede = pageDepth > 0 && page.lede !== undefined ? page.lede : (page.gist ?? page.lede);
  const sectionCount = titled.length;
  const stepIndex = spy.step ? Math.max(1, titled.findIndex((e) => e.id === spy.step) + 1 || sectionCount) : 1;

  const masthead =
    mode === "embedded" ? null : desktop ? (
      <header className="dd-masthead">
        {backButton && (
          <button type="button" className="dd-back" onClick={backButton.onClick}>
            <ArrowLeft size={14} />
            <span>{backButton.label}</span>
          </button>
        )}
        <p className="dd-crumb">
          <a
            href={hrefFor(pages[0]?.id ?? "")}
            className="dd-crumb-home"
            onClick={(e) => {
              e.preventDefault();
              goTo(pages[0]?.id ?? "");
            }}
          >
            {props.title}
          </a>
          {props.subtitle && (
            <>
              <span aria-hidden="true"> / </span>
              <span>{props.subtitle}</span>
            </>
          )}
        </p>
        {sequence.length > 1 && seqIndex >= 0 && (
          <p className="dd-pips" aria-label={`${seqIndex + 1} of ${sequence.length}`}>
            {sequence.map((p, i) => (
              <span key={p.id} className={`dd-pip${i <= seqIndex ? " is-on" : ""}`} />
            ))}
            <span className="dd-pip-count">
              {seqIndex + 1}/{sequence.length}
            </span>
          </p>
        )}
        {progress}
      </header>
    ) : (
      <header className="dd-masthead is-phone">
        {backButton && (
          <button type="button" className="dd-icon-btn" onClick={backButton.onClick} aria-label={backButton.label}>
            <ArrowLeft size={18} />
          </button>
        )}
        <p className="dd-phone-title" key={pageId}>
          {page.label ?? page.title}
        </p>
        {sectionCount > 0 && (
          <button
            type="button"
            className="dd-counter"
            onClick={() => setContentsOpen(true)}
            aria-label={`${props.sectionNoun ?? "Section"} ${stepIndex} of ${sectionCount}. Contents`}
          >
            {stepIndex}/{sectionCount}
          </button>
        )}
        <button type="button" className="dd-icon-btn" onClick={() => setContentsOpen(true)} aria-label="Contents">
          <Menu size={18} />
        </button>
        {progress}
      </header>
    );

  const article = (
    <article
      className="dd-prose"
      key={pageId}
      data-enter={motion.current.dir === 0 ? undefined : motion.current.dir > 0 ? "next" : "prev"}
    >
      <header className="dd-page-head">
        {page.eyebrow && <p className="dd-eyebrow">{page.eyebrow}</p>}
        <h1 className="dd-title">{page.title}</h1>
        {lede && <div className="dd-lede">{lede}</div>}
        <div className="dd-meta-row">
          <p className="dd-meta">
            {minutes !== null && <>~{minutes} min read</>}
            {page.buildsOn && page.buildsOn.length > 0 && (
              <>
                {minutes !== null && " · "}
                {"builds on "}
                {page.buildsOn.map((b, i) => {
                  const target = pages.find((p) => p.id === b);
                  return (
                    <span key={b}>
                      {i > 0 && ", "}
                      <a
                        className="dd-link"
                        href={hrefFor(b)}
                        onClick={(e) => {
                          e.preventDefault();
                          goTo(b);
                        }}
                      >
                        {target?.label ?? target?.title ?? b}
                      </a>
                    </span>
                  );
                })}
              </>
            )}
          </p>
          {pageLevels.length > 1 && <DepthSwitch levels={pageLevels} pressed={pressed} onChange={(d) => setPageDepth(d)} />}
        </div>
        <div className="dd-divider" aria-hidden="true" />
      </header>

      <div
        className={`dd-body${sawLoading.current === pageId && ready ? " is-arriving" : ""}`}
        key={`${pageId}:${ready}`}
      >
        {isGlossary ? <GlossaryList terms={allTerms} pages={pages} goTo={goTo} /> : page.children}
      </div>

      {page.sources && page.sources.length > 0 && (
        <section className="dd-sources" aria-labelledby="dd-sources-title" data-progress-end="">
          <h2 id="dd-sources-title" className="dd-sources-title">
            Sources
          </h2>
          {page.sources.map((g) => (
            <div key={g.id} id={g.id} data-step={g.id} className="dd-sources-group">
              <h3 className="dd-sources-group-title">{g.title}</h3>
              <ol className="dd-sources-list">
                {g.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      <footer className="dd-end">
        {folded &&
          deepest > 0 &&
          (props.endNote ? (
            props.endNote({ page: pageId, levels: pageLevels, pressed, deepen: () => setPageDepth(deepest, null) })
          ) : (
            <p className="dd-end-note">
              {pressed === 0 ? `That's the page at ${pageLevels[0]}.` : "Some sections show less than they have."}{" "}
              <button type="button" className="dd-link" onClick={() => setPageDepth(deepest, null)}>
                Read it all at {pageLevels[deepest]}
              </button>
            </p>
          ))}
        {props.slots?.endOfPage?.(slotState)}
        {mode !== "embedded" && pages.length > 1 && (
          <nav className="dd-prevnext" aria-label="More pages">
            {prev ? (
              <a
                href={hrefFor(prev.id)}
                className="dd-card is-prev"
                onClick={(e) => {
                  e.preventDefault();
                  goTo(prev.id);
                }}
              >
                <span className="dd-caption">
                  <ArrowLeft size={11} className="dd-inline-icon" /> Previous
                </span>
                <span className="dd-card-title">{prev.label ?? prev.title}</span>
              </a>
            ) : (
              <span />
            )}
            {next && (
              <a
                href={hrefFor(next.id)}
                className="dd-card is-next"
                onClick={(e) => {
                  e.preventDefault();
                  goTo(next.id);
                }}
              >
                <span className="dd-caption">
                  Next <ArrowRight size={11} className="dd-inline-icon" />
                </span>
                <span className="dd-card-title">{next.label ?? next.title}</span>
              </a>
            )}
          </nav>
        )}
      </footer>
    </article>
  );

  const doc = (
    <div ref={setRootEl} className={`dd-root dd-doc is-${mode}`}>
      {masthead}
      {!desktop && props.slots?.belowMasthead?.(slotState)}
      <div
        className={`dd-grid${desktop ? " is-desktop" : ""}${showRail ? "" : " no-rail"}${facet && desktop ? " has-facet" : ""}`}
      >
        {desktop && showRail && (
          <aside className="dd-rail">
            <Rail
              key={railFocus}
              pages={railPages}
              page={pageId}
              sections={railSections}
              sources={railSources}
              step={spy.step}
              finished={finished}
              onGo={goTo}
              href={hrefFor}
              autoFocusCurrent={railFocus > 0}
            />
          </aside>
        )}
        {article}
        {desktop && (
          <aside className="dd-margin">
            <div className="dd-margin-sticky">
              {props.slots?.marginTop?.(slotState)}
              {marginFacet.item && (
                <FacetPane
                  facet={marginFacet.item}
                  leaving={marginFacet.leaving}
                  expanded={facetExpanded}
                  onExpand={setFacetExpanded}
                  onClose={() => setFacet(null)}
                  onGoToSection={goToFacetSection}
                />
              )}
            </div>
          </aside>
        )}
      </div>
      {toast && (
        <p className="dd-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );

  const sheets = (
    <>
      {props.slots?.layer?.(slotState)}
      {!desktop && facet && (
        <FacetSheet facet={facet} zIndex={zIndex + 10} onClose={() => setFacet(null)} onGoToSection={goToFacetSection} />
      )}
      {!desktop && contentsOpen && showRail && (
        <ContentsSheet
          zIndex={zIndex + 10}
          pages={railPages}
          page={pageId}
          sections={railSections}
          sources={railSources}
          step={spy.step}
          finished={finished}
          onGo={goTo}
          href={hrefFor}
          onClose={() => setContentsOpen(false)}
        />
      )}
    </>
  );

  if (host.mode !== "overlay") {
    return (
      <DocContext.Provider value={ctx}>
        {doc}
        {sheets}
      </DocContext.Provider>
    );
  }

  const dim = host.dim ?? MOTION.appDim;
  const width = typeof window === "undefined" ? 1000 : window.innerWidth;
  const sheetStyle: React.CSSProperties = reduced
    ? { opacity: entered ? 1 : 0, transition: `opacity ${MOTION.fadeMs}ms ease-out` }
    : {
        transform: drag !== null ? `translate3d(${drag}px,0,0)` : entered ? "translate3d(0,0,0)" : "translate3d(100%,0,0)",
        transition: drag !== null ? "none" : slide,
      };
  return createPortal(
    <DocContext.Provider value={ctx}>
      <div className="dd-root dd-layer" style={{ zIndex }}>
        <div
          className="dd-scrim"
          aria-hidden="true"
          style={{
            opacity: entered ? (drag !== null ? dim * (1 - drag / width) : dim) : 0,
            transition: drag !== null ? "none" : `opacity ${reduced ? MOTION.fadeMs : slideMs}ms ease-out`,
          }}
        />
        <div
          className={`dd-sheet${landing && motion.current.dir === 0 ? " is-landing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${props.title}: ${page.title}`}
          tabIndex={-1}
          style={sheetStyle}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div ref={setOwnScroller} className="dd-scroll" tabIndex={-1}>
            {doc}
          </div>
        </div>
      </div>
      {sheets}
    </DocContext.Provider>,
    document.body,
  );
}

/**
 * The page switch: every section at one level, the chosen one under a
 * sliding thumb, as many positions as the page has levels. When sections
 * have been switched one by one into a mix, none is pressed and the thumb
 * steps aside.
 */
export function DepthSwitch({ levels, pressed, onChange }: { levels: string[]; pressed: number; onChange: (d: number) => void }) {
  return (
    <div
      className="dd-depth"
      role="group"
      aria-label="Depth"
      data-mixed={pressed < 0 || undefined}
      style={{ "--n": levels.length, "--at": Math.max(0, pressed) } as React.CSSProperties}
    >
      <span className="dd-depth-thumb" aria-hidden="true" />
      {levels.map((l, i) => (
        <button key={l} type="button" aria-pressed={pressed === i} onClick={() => onChange(i)} title={`Every section at ${l} (D)`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function GlossaryList({
  terms,
  pages,
  goTo,
}: {
  terms: { key: string; def: TermDef }[];
  pages: PageProps[];
  goTo: (page: string, step?: string | null) => void;
}) {
  const sorted = [...terms].sort((a, b) => a.def.label.localeCompare(b.def.label));
  return (
    <dl className="dd-glossary">
      {sorted.map(({ key, def }) => {
        const home = pages.find((p) => p.id === def.page);
        return (
          <div key={key} className="dd-glossary-entry" id={`term-${key.replace(/\//g, "-")}`}>
            <dt>{def.label}</dt>
            <dd>
              <span className="dd-glossary-body">{def.body}</span>
              <button type="button" className="dd-glossary-home" onClick={() => goTo(def.page, def.section)}>
                {home?.label ?? home?.title ?? def.page}
                {def.sectionTitle ? ` · ${def.sectionTitle}` : ""} →
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
