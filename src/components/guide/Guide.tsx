import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Menu } from "lucide-react";
import type { Panel } from "../../types";
import { peekEmbeddings } from "../../utils/sorting";
import { METRIC_INFO } from "../explainer/explainerConstants";
import { HatchDivider } from "../explainer/explainerPrimitives";
import {
  ColorExplanation,
  ColorTldr,
  EmbeddingExplanation,
  EmbeddingTldr,
  PhashExplanation,
  PhashTldr,
  VectorsExplanation,
  VectorsTldr,
} from "../explainer/explanations";
import type { MetricKey } from "../graph/similarityConfig";
import { APP_DIM, freezeApp, type AppBehind } from "./appBehind";
import { CODE_EXIT_MS, CodePane, CodeSheet, usePresence, type OpenCode } from "./CodePane";
import { GuideContext, VariantContext, type GuideContextValue } from "./guideContext";
import { GuideLink } from "./GuideLink";
import { ContentsSheet, GuideRail } from "./GuideRail";
import { GUIDE_NAME, GUIDE_SUBTITLE, LESSONS, PAGES, neighbours, pageDef, stepNumber, type PageId } from "./lessons";
import { GUIDE_Z, isTopOverlay, useOverlay } from "./overlayStack";
import { Glossary } from "./pages/Glossary";
import { Overview } from "./pages/Overview";
import { AnchorPicker, SpecimenBar } from "./SpecimenBar";
import { LessonSources } from "./LessonSources";
import { isSourceStep } from "./sources";
import { EMBEDDING_METRICS, isEmbeddingMetric, pickAnchor, specimenPool, useSpecimen } from "./specimen";
import {
  IS_IOS,
  closeGuide,
  guideHref,
  navigateGuide,
  recordGuideStep,
  type GuideState,
} from "./useGuideRoute";
import {
  finishedPages,
  markFinished,
  prefersReducedMotion,
  savePosition,
  savedPosition,
  setTldrPreferred,
  tldrPreferred,
  useMediaQuery,
  useScrollSpy,
} from "./useScrollSpy";
import { useReveal } from "./useReveal";

/** At and above this width: rail, reading column and margin side by side. */
const DESKTOP_MIN = 1100;
/** The slide in and out. */
const SLIDE_MS = 340;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
/** The crossfade that replaces it under reduced motion. */
const FADE_MS = 150;
/** Clearance for the sticky masthead (and the phone's specimen strip) when jumping to a step. */
const JUMP_OFFSET_DESKTOP = 72;
const JUMP_OFFSET_PHONE = 112;
/** A step's glide between its short and full heights, scaled by the distance. */
const GLIDE_MIN_MS = 300;
const GLIDE_MAX_MS = 560;

/** Short page ledes, for the pages that aren't one of the five methods. */
const LEDES: Partial<Record<PageId, string>> = {
  vectors:
    "The idea the three neural-network lessons rest on: a model turns each panel into a list of numbers, and two panels are compared by the angle between their lists.",
  glossary: "Every term the lessons define, with a link back to where it's introduced.",
};

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export interface GuideProps {
  panels: Panel[];
  state: GuideState;
  onExited: () => void;
  /** Applies a sort to the gallery; absent when the Guide can't hand one back (over the viewer). */
  onSortBy?: (metric: MetricKey) => void;
}

export default function Guide({ panels, state, onExited, onSortBy }: GuideProps) {
  const { route, instant, scrollNonce } = state;
  const open = route !== null;
  // While leaving, keep showing the page that was open.
  const lastRoute = useRef(route);
  if (route) lastRoute.current = route;
  // (Closed before it ever rendered, if its chunk was slow: it leaves at once.)
  const r = route ?? lastRoute.current ?? { page: "overview" as PageId, step: null, anchor: null };

  const desktop = useMediaQuery(`(min-width: ${DESKTOP_MIN}px)`);
  const reduced = useMemo(prefersReducedMotion, []);
  const overlayId = useOverlay(true, "guide");

  // --- Coming and going ---------------------------------------------------

  const app = useRef<AppBehind | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [entered, setEntered] = useState(instant);
  const [drag, setDrag] = useState<number | null>(null);

  useLayoutEffect(() => {
    const behind = freezeApp();
    app.current = behind;
    if (instant) {
      behind.shift(reduced ? 0 : 1, null);
      behind.hide();
    }
    // Focus on the scroller, so Space and the arrow keys scroll the Guide.
    scrollRef.current?.focus({ preventScroll: true });
    return () => {
      behind.restore();
      app.current = null;
    };
    // Once, for the Guide's whole stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter: paint the start position once, then move.
  useEffect(() => {
    if (instant) return;
    let live = true;
    const r1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!live) return;
        setEntered(true);
        app.current?.shift(reduced ? 0 : 1, reduced ? null : `transform ${SLIDE_MS}ms ${EASE}`);
      })
    );
    return () => {
      live = false;
      cancelAnimationFrame(r1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once fully covered, stop painting the app underneath.
  useEffect(() => {
    if (!open || !entered || drag !== null) return;
    const t = window.setTimeout(() => app.current?.hide(), instant ? 0 : (reduced ? FADE_MS : SLIDE_MS) + 30);
    return () => window.clearTimeout(t);
  }, [open, entered, drag, instant, reduced]);

  // Leave: show the app again first, so it's painted (and measurable)
  // before it slides back.
  useEffect(() => {
    if (open) return;
    app.current?.show();
    if (instant) {
      onExited();
      return;
    }
    setDrag(null);
    setEntered(false);
    app.current?.shift(0, reduced ? null : `transform ${SLIDE_MS}ms ${EASE}`);
    const t = window.setTimeout(onExited, reduced ? FADE_MS : SLIDE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Edge swipe to close. Off on iOS, whose own back swipe already closes the
  // Guide through history, and would fight this one.
  const swipe = useRef<{ x: number; y: number; t: number; locked: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (IS_IOS || reduced || !open) return;
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
    if (drag > window.innerWidth * 0.35 || v > 0.5) {
      closeGuide();
    } else {
      setDrag(null);
      app.current?.shift(1, `transform ${SLIDE_MS}ms ${EASE}`);
    }
  };

  // --- The worked example -------------------------------------------------

  const pool = useMemo(() => specimenPool(panels), [panels]);
  const anchor = useMemo(() => (r.anchor ? pool.find((p) => p.id === r.anchor) ?? null : null), [pool, r.anchor]);

  // No anchor in the URL (or one that isn't in the gallery): draw one, and
  // write it back so a reload or a shared link shows the same example.
  useEffect(() => {
    if (!open || pool.length < 3 || anchor) return;
    const pick = pickAnchor(pool, EMBEDDING_METRICS.map((m) => peekEmbeddings(m)));
    if (pick) navigateGuide({ anchor: pick.id }, { scroll: false });
  }, [open, pool, anchor]);

  const shuffle = useCallback(() => {
    const pick = pickAnchor(pool, EMBEDDING_METRICS.map((m) => peekEmbeddings(m)), anchor?.id ?? null);
    if (pick) navigateGuide({ anchor: pick.id }, { scroll: false });
  }, [pool, anchor]);

  const [picking, setPicking] = useState(false);

  const page = pageDef(r.page);
  const specimenMetric: MetricKey | undefined = page.ownExample
    ? undefined
    : page.metric ?? (r.page === "vectors" ? "embedding-siglip" : undefined);
  const status = useSpecimen(anchor, pool, specimenMetric);
  const methodName = specimenMetric ? METRIC_INFO[specimenMetric].name : null;
  const contentReady =
    r.page === "overview" || r.page === "glossary" || !!page.ownExample || (anchor !== null && status.kind !== "loading");

  // --- Code beside the prose ----------------------------------------------

  const [code, setCode] = useState<OpenCode | null>(null);
  const [codeExpanded, setCodeExpanded] = useState(false);
  useEffect(() => {
    setCode(null);
    setCodeExpanded(false);
  }, [r.page]);

  // --- Short or full ---------------------------------------------------------

  // Each step of a lesson shows its short or its full version. The lesson
  // switch picks one for every step of every lesson, remembered; a step's
  // own switch opens just that step in full (or folds it), for this visit.
  // Pages without a short version (the overview, the glossary) just show
  // what they have.
  const [shortChosen, setShortChosen] = useState(tldrPreferred);
  /** Steps switched on their own, keyed `page:step`. */
  const [stepChoice, setStepChoice] = useState<Record<string, boolean>>({});
  const hasShort = !!page.tldr;
  const stepShort = useCallback(
    (step: string) => hasShort && (stepChoice[`${r.page}:${step}`] ?? shortChosen),
    [hasShort, stepChoice, r.page, shortChosen]
  );
  const shortCount = page.steps.filter((s) => stepShort(s.id)).length;
  const lessonMode: LessonMode =
    !hasShort || shortCount === 0 ? "full" : shortCount === page.steps.length ? "short" : "mixed";
  // Steps switched by hand on this page, whose new content fades in.
  const [swapped, setSwapped] = useState<{ page: PageId; steps: ReadonlySet<string> }>({ page: r.page, steps: new Set() });
  const swappedHere = swapped.page === r.page ? swapped.steps : undefined;
  const posKey = lessonMode === "short" ? `${r.page}:tldr` : r.page;

  // --- Scrolling, steps, progress -------------------------------------------

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScroller(el);
  }, []);
  const spy = useScrollSpy(scroller, `${r.page}:${status.kind}:${anchor?.id ?? ""}:${lessonMode}`);
  useReveal(scroller, `${r.page}:${contentReady}`, !reduced);

  // A lesson with a short version keeps one empty <section> per step, in
  // order, and both versions portal into them (Section in
  // explainerPrimitives). The slots are found from the body element once
  // it's in the page; until then (the first pass after it's made) the
  // lesson renders nothing, and React re-renders before painting.
  const bodyKey = `${r.page}:${contentReady ? "ready" : "wait"}`;
  const [slotRoot, setSlotRoot] = useState<{ key: string; el: HTMLElement } | null>(null);
  const attachBody = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) setSlotRoot({ key: bodyKey, el });
    },
    [bodyKey]
  );
  const slotsReady = slotRoot?.key === bodyKey;
  const stepSlot = useCallback(
    (step: string) =>
      slotsReady ? slotRoot!.el.querySelector<HTMLElement>(`:scope > [data-slot="${CSS.escape(step)}"]`) : null,
    [slotsReady, slotRoot]
  );

  // Which way a page change goes, for the page coming in: forward through
  // the contents (+1) enters from the right, back (-1) from the left. 0 on
  // opening, which has the sheet's slide already.
  const motion = useRef<{ page: PageId; dir: number }>({ page: r.page, dir: 0 });
  if (motion.current.page !== r.page) {
    const at = (id: PageId) => PAGES.findIndex((p) => p.id === id);
    motion.current = { page: r.page, dir: at(r.page) >= at(motion.current.page) ? 1 : -1 };
  }
  // The lesson fades up when it arrives after its "Loading…" line, or with
  // a new page; not when it's simply there as the Guide opens.
  const sawLoading = useRef(false);
  if (!contentReady) sawLoading.current = true;
  const bodyArrives = motion.current.dir !== 0 || sawLoading.current;

  // A jump that's been asked for (a rail click, a link, opening on a step)
  // and not yet made. Made once the page's content is in.
  // `keep` is the lesson switch, short to full or back: the page is the
  // same but its content isn't, so the jump is instant and held in place
  // while figures load, as on arriving at a new page.
  const pending = useRef<{ step: string | null; page: PageId; keep?: boolean } | null>(null);
  const lastNonce = useRef<number | null>(null);
  if (scrollNonce !== lastNonce.current) {
    lastNonce.current = scrollNonce;
    pending.current = { step: r.step, page: r.page };
  }
  const shownPage = useRef<PageId | null>(null);
  const pin = useRef<(() => void) | null>(null);
  useEffect(() => () => pin.current?.(), []);

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || !scroller || !contentReady || p.page !== r.page) return;
    if (hasShort && !slotsReady) return;
    pending.current = null;
    pin.current?.();
    const samePage = shownPage.current === r.page;
    shownPage.current = r.page;
    const offset = desktop ? JUMP_OFFSET_DESKTOP : JUMP_OFFSET_PHONE;
    const stepTop = (step: string): number | null => {
      const el = scroller.querySelector<HTMLElement>(`[data-step="${CSS.escape(step)}"]`);
      if (!el) return null;
      return Math.max(0, el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset);
    };
    const top = p.step ? stepTop(p.step) ?? 0 : samePage ? 0 : savedPosition(posKey);
    scroller.scrollTo({ top, behavior: samePage && !p.keep && !reduced ? "smooth" : "auto" });

    // Figures above the step (the patch examples, the model inputs) load
    // after the jump and push it down. Keep it in place while they settle,
    // until the reader scrolls for themselves.
    if (!p.step || (samePage && !p.keep) || typeof ResizeObserver === "undefined") return;
    const step = p.step;
    const article = scroller.querySelector("article");
    if (!article) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      const t = stepTop(step);
      if (t !== null && Math.abs(scroller.scrollTop - t) > 2) scroller.scrollTo({ top: t, behavior: "auto" });
    });
    ro.observe(article);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stop = () => {
      ro.disconnect();
      events.forEach((ev) => scroller.removeEventListener(ev, stop));
      window.clearTimeout(timer);
      pin.current = null;
    };
    events.forEach((ev) => scroller.addEventListener(ev, stop, { passive: true }));
    const timer = window.setTimeout(stop, 2500);
    pin.current = stop;
  });

  // The address bar follows the reader's step.
  useEffect(() => {
    if (!open || pending.current) return;
    const t = window.setTimeout(() => recordGuideStep(spy.step), 200);
    return () => window.clearTimeout(t);
  }, [open, spy.step]);

  // Where each page was left, and which lessons were read to the end.
  useEffect(() => {
    if (!contentReady || pending.current) return;
    const t = window.setTimeout(() => savePosition(posKey, spy.scrollTop), 400);
    return () => window.clearTimeout(t);
  }, [spy.scrollTop, posKey, contentReady]);

  const [finished, setFinished] = useState(finishedPages);
  const isLesson = LESSONS.some((l) => l.id === r.page);
  useEffect(() => {
    if (isLesson && contentReady && spy.scrollTop > 0 && spy.progress > 0.97) {
      markFinished(r.page);
      setFinished(finishedPages());
    }
  }, [isLesson, contentReady, spy.progress, spy.scrollTop, r.page]);

  // --- Moving around --------------------------------------------------------

  const goTo = useCallback(
    (to: PageId, step?: string) => {
      if (to === r.page) navigateGuide({ step: step ?? null }, { scroll: true });
      else navigateGuide({ page: to, step: step ?? null });
    },
    [r.page]
  );

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const copyStepLink = useCallback(
    (step: string) => {
      const href = guideHref({ ...r, step });
      goTo(r.page, step);
      const done = () => setToast("Link copied");
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(done, () => setToast("The address bar has the link"));
      else setToast("The address bar has the link");
    },
    [r, goTo]
  );

  const spyStep = useRef(spy.step);
  spyStep.current = spy.step;

  // A step switched on its own changes only below its heading, so the
  // heading is held where the reader clicked it, and the step's box glides
  // from its old height to its new one (clipped meanwhile, so the new
  // version unrolls rather than appearing all at once).
  const hold = useRef<{ step: string; top: number; height: number } | null>(null);
  /** Steps mid-glide, each with what ends it early. */
  const gliding = useRef(new Map<string, () => void>());
  const stepEl = useCallback(
    (step: string) => scroller?.querySelector<HTMLElement>(`[data-step="${CSS.escape(step)}"]`) ?? null,
    [scroller]
  );
  useLayoutEffect(() => {
    const h = hold.current;
    if (!h || !scroller) return;
    hold.current = null;
    const el = stepEl(h.step);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - h.top;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    if (reduced) return;

    gliding.current.get(h.step)?.();
    const to = el.getBoundingClientRect().height;
    const from = h.height;
    if (Math.abs(to - from) < 4) return;
    const ms = Math.round(Math.min(GLIDE_MAX_MS, GLIDE_MIN_MS + Math.abs(to - from) * 0.18));
    el.style.height = `${from}px`;
    el.classList.add("is-gliding");
    // Opening fades its bottom edge while the rest is still to come, and
    // the fade closes as the box lands, so no text is left dimmed.
    const opening = to > from;
    el.dataset.glide = opening ? "open" : "fold";
    if (opening) el.style.setProperty("--guide-glide-fade", "64px");
    // Scroll anchoring would chase whatever's below as it moves, and with it
    // move the heading the reader just clicked.
    scroller.style.overflowAnchor = "none";
    void el.offsetHeight;
    el.style.transition = `height ${ms}ms var(--guide-ease-out), --guide-glide-fade ${ms}ms var(--guide-ease-out)`;
    el.style.height = `${to}px`;
    if (opening) el.style.setProperty("--guide-glide-fade", "0px");
    const step = h.step;
    const end = () => {
      window.clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      el.style.height = "";
      el.style.transition = "";
      el.style.removeProperty("--guide-glide-fade");
      el.classList.remove("is-gliding");
      delete el.dataset.glide;
      gliding.current.delete(step);
      if (gliding.current.size === 0) scroller.style.overflowAnchor = "";
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "height") end();
    };
    el.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(end, ms + 120);
    gliding.current.set(step, end);
  });

  const markSwapped = useCallback(
    (steps: string[]) =>
      setSwapped((cur) => ({ page: r.page, steps: new Set([...(cur.page === r.page ? cur.steps : []), ...steps]) })),
    [r.page]
  );

  const setStepShort = useCallback<GuideContextValue["setStepShort"]>(
    (step, on) => {
      if (stepShort(step) === on) return;
      const el = stepEl(step);
      const box = el?.getBoundingClientRect();
      hold.current = box ? { step, top: box.top, height: box.height } : null;
      setStepChoice((c) => ({ ...c, [`${r.page}:${step}`]: on }));
      markSwapped([step]);
      // Its code went with the full version.
      if (on) setCode((cur) => (cur?.step === step ? null : cur));
    },
    [stepShort, stepEl, r.page, markSwapped]
  );

  /** The lesson switch: every step one way, keeping the reader at `step` (default: where they are). */
  const switchAll = useCallback(
    (on: boolean, step?: string | null) => {
      setTldrPreferred(on);
      const changing = page.steps.filter((s) => stepShort(s.id) !== on).map((s) => s.id);
      if (changing.length === 0) {
        if (step) goTo(r.page, step);
        return;
      }
      pending.current = { step: step === undefined ? spyStep.current : step, page: r.page, keep: true };
      setShortChosen(on);
      if (on) setCode(null);
      setStepChoice((c) => {
        const next = { ...c };
        for (const s of page.steps) delete next[`${r.page}:${s.id}`];
        return next;
      });
      markSwapped(changing);
    },
    [page.steps, stepShort, r.page, goTo, markSwapped]
  );
  const setAllShort = useCallback((on: boolean) => switchAll(on), [switchAll]);

  const openCode = useCallback<GuideContextValue["openCode"]>(
    (step, ref) => {
      setCodeExpanded(false);
      setCode((cur) =>
        cur?.step === step ? null : { step, ref, stepLabel: `Step ${stepNumber(r.page, step)}` }
      );
    },
    [r.page]
  );

  const ctx = useMemo<GuideContextValue>(
    () => ({
      page: r.page,
      desktop,
      codeStep: code?.step ?? null,
      openCode,
      goTo,
      copyStepLink,
      stepShort: hasShort ? stepShort : undefined,
      setStepShort,
      setAllShort,
      stepSlot: hasShort ? stepSlot : undefined,
      swapped: swappedHere,
      shuffleAnchor: page.ownExample ? undefined : shuffle,
    }),
    [
      r.page,
      desktop,
      code,
      openCode,
      goTo,
      copyStepLink,
      hasShort,
      stepShort,
      setStepShort,
      setAllShort,
      stepSlot,
      swappedHere,
      page.ownExample,
      shuffle,
    ]
  );

  const { prev, next } = neighbours(r.page);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [railFocus, setRailFocus] = useState(0);

  // Escape closes the innermost thing; arrows walk the lessons; / or g opens
  // the contents. Only while the Guide is the top layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open || !isTopOverlay(overlayId)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (codeExpanded) setCodeExpanded(false);
        else if (code && desktop) setCode(null);
        else closeGuide();
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        goTo(prev.id);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        goTo(next.id);
      } else if (e.key === "t" && page.tldr) {
        e.preventDefault();
        switchAll(lessonMode !== "short");
      } else if (e.key === "/" || e.key === "g") {
        e.preventDefault();
        if (desktop) setRailFocus((n) => n + 1);
        else setContentsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overlayId, code, codeExpanded, desktop, prev, next, goTo, page.tldr, lessonMode, switchAll]);

  // --- Rendering --------------------------------------------------------------

  // In the sources, past the last step: the counter holds at the end.
  const stepIndex = !spy.step ? 0 : isSourceStep(spy.step) ? page.steps.length : stepNumber(r.page, spy.step);
  const lessonIndex = LESSONS.findIndex((l) => l.id === r.page);
  const width = typeof window === "undefined" ? 1000 : window.innerWidth;

  const sheetStyle: React.CSSProperties = reduced
    ? { opacity: entered ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out` }
    : {
        transform: drag !== null ? `translate3d(${drag}px,0,0)` : entered ? "translate3d(0,0,0)" : "translate3d(100%,0,0)",
        transition: drag !== null ? "none" : `transform ${SLIDE_MS}ms ${EASE}`,
      };
  const scrimOpacity = entered ? (drag !== null ? APP_DIM * (1 - drag / width) : APP_DIM) : 0;

  // The lede follows the lesson switch, not each step's.
  const lede =
    shortChosen && page.tldr ? page.tldr.gist : page.metric ? METRIC_INFO[page.metric].oneLiner : LEDES[r.page];
  // Reading time scales with how many steps are open in full.
  const minutes = page.tldr
    ? Math.round(page.tldr.minutes + ((page.minutes - page.tldr.minutes) * (page.steps.length - shortCount)) / Math.max(1, page.steps.length))
    : page.minutes;
  const sortable = !!onSortBy && !!page.metric && contentReady;

  // Memoized: the masthead's progress and the rail re-render with every
  // scroll frame, and the lesson underneath has no reason to.
  // A lesson with a short version gives both, and each step shows one.
  const body = useMemo((): LessonBody => {
    const both = (short: React.ReactNode, full: React.ReactNode): LessonBody =>
      page.tldr ? { short, full } : { node: full };
    if (r.page === "overview") return { node: <Overview anchor={anchor} pool={pool} /> };
    if (r.page === "glossary") return { node: <Glossary /> };
    if (r.page === "phash") return both(<PhashTldr />, <PhashExplanation />);
    if (!anchor) return { node: <p className="guide-notice">Loading the gallery…</p> };
    if (status.kind === "loading") return { node: <p className="guide-notice">Loading {methodName}'s numbers…</p> };
    if (status.kind === "none")
      return {
        node: (
        <p className="guide-notice">
          {methodName} has nothing to compare this panel with.{" "}
          <button type="button" className="guide-link" onClick={shuffle}>
            Try another anchor
          </button>
          .
        </p>
        ),
      };
    const props = { anchorPanel: anchor, closest: status.specimen.closest, furthest: status.specimen.furthest };
    if (r.page === "color")
      return both(
        <ColorTldr {...props} all={status.specimen.all} pool={pool} />,
        <ColorExplanation {...props} all={status.specimen.all} pool={pool} />
      );
    if (r.page === "vectors") return both(<VectorsTldr {...props} />, <VectorsExplanation {...props} />);
    if (page.metric && isEmbeddingMetric(page.metric))
      return both(
        <EmbeddingTldr metric={page.metric} {...props} />,
        <EmbeddingExplanation metric={page.metric} {...props} />
      );
    return { node: null };
  }, [r.page, page.tldr, page.metric, anchor, pool, status, methodName, shuffle]);

  const specimen = page.ownExample ? null : (
    <SpecimenBar
      anchor={anchor}
      status={status}
      metric={specimenMetric}
      methodName={methodName}
      compact={!desktop}
      hidden={!desktop && spy.down && spy.scrollTop > 160}
      onShuffle={shuffle}
      onPick={() => setPicking(true)}
    />
  );

  const codeGoToStep = () => code && goTo(r.page, code.step);
  // The margin pane, kept a moment after closing so it can slide out.
  const marginCode = usePresence(desktop ? code : null, CODE_EXIT_MS);

  return createPortal(
    <GuideContext.Provider value={ctx}>
      <div className="guide-layer" style={{ zIndex: GUIDE_Z }}>
        <div
          className="guide-scrim"
          aria-hidden="true"
          style={{
            opacity: scrimOpacity,
            transition: drag !== null ? "none" : `opacity ${reduced ? FADE_MS : SLIDE_MS}ms ease-out`,
          }}
        />
        <div
          ref={sheetRef}
          className="guide-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={`${GUIDE_NAME}: ${page.title}`}
          tabIndex={-1}
          style={sheetStyle}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div ref={attachScroller} className="guide-scroll info-modal-scroll" tabIndex={-1}>
            <header className={`guide-masthead${desktop ? "" : " is-phone"}`}>
              {desktop ? (
                <>
                  <button type="button" className="guide-back" onClick={() => closeGuide()}>
                    <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span>Gallery</span>
                  </button>
                  <p className="guide-crumb">
                    <GuideLink to="overview" className="guide-crumb-home">
                      {GUIDE_NAME}
                    </GuideLink>
                    <span aria-hidden="true"> / </span>
                    <span>{GUIDE_SUBTITLE}</span>
                  </p>
                  {lessonIndex >= 0 && (
                    <p className="guide-pips" aria-label={`Lesson ${lessonIndex + 1} of ${LESSONS.length}`}>
                      {LESSONS.map((l, i) => (
                        <span key={l.id} className={`guide-pip${i <= lessonIndex ? " is-on" : ""}`} />
                      ))}
                      <span className="guide-pip-count">
                        {lessonIndex + 1}/{LESSONS.length}
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="guide-icon-btn" onClick={() => closeGuide()} aria-label="Back to the gallery">
                    <ArrowLeft size={18} strokeWidth={1.5} />
                  </button>
                  <p className="guide-phone-title" key={r.page}>
                    {page.label}
                  </p>
                  {page.steps.length > 0 && (
                    <button
                      type="button"
                      className="guide-counter"
                      onClick={() => setContentsOpen(true)}
                      aria-label={`Step ${stepIndex || 1} of ${page.steps.length}. Contents`}
                    >
                      {stepIndex || 1}/{page.steps.length}
                    </button>
                  )}
                  <button type="button" className="guide-icon-btn" onClick={() => setContentsOpen(true)} aria-label="Contents">
                    <Menu size={18} strokeWidth={1.5} />
                  </button>
                </>
              )}
              <div className="guide-progress" aria-hidden="true">
                <div style={{ transform: `scaleX(${spy.progress})` }} />
              </div>
            </header>

            {!desktop && specimen}

            <div className={`guide-grid${desktop ? " is-desktop" : ""}${code && desktop ? " has-code" : ""}`}>
              {desktop && (
                <aside className="guide-rail">
                  <GuideRail
                    key={railFocus}
                    page={r.page}
                    step={spy.step}
                    finished={finished}
                    onGo={goTo}
                    autoFocusCurrent={railFocus > 0}
                  />
                </aside>
              )}

              <article
                className="guide-prose"
                key={r.page}
                data-enter={motion.current.dir === 0 ? undefined : motion.current.dir > 0 ? "next" : "prev"}
              >
                <header className="guide-lesson-head">
                  <p className="guide-eyebrow">{page.family}</p>
                  <h1 className="guide-title">{page.title}</h1>
                  {lede && <p className="guide-lede">{lede}</p>}
                  <div className="guide-meta-row">
                    <p className="guide-meta">
                      {r.page !== "glossary" && <>~{minutes} min read</>}
                      {page.buildsOn.length > 0 && (
                        <>
                          {" · builds on "}
                          {page.buildsOn.map((b, i) => (
                            <span key={b}>
                              {i > 0 && ", "}
                              <GuideLink to={b}>{pageDef(b).label}</GuideLink>
                            </span>
                          ))}
                        </>
                      )}
                    </p>
                    {page.tldr && <ModeSwitch mode={lessonMode} onChange={setAllShort} />}
                  </div>
                  <HatchDivider />
                </header>

                <div
                  key={bodyKey}
                  ref={attachBody}
                  className={`guide-body${bodyArrives ? " is-arriving" : ""}`}
                >
                  {"node" in body ? (
                    body.node
                  ) : (
                    <>
                      {page.steps.map((s) => (
                        <section
                          key={s.id}
                          id={s.id}
                          data-step={s.id}
                          data-slot={s.id}
                          className={`guide-step${stepShort(s.id) ? " is-short" : ""}`}
                        />
                      ))}
                      <VariantContext.Provider value="short">{body.short}</VariantContext.Provider>
                      <VariantContext.Provider value="full">{body.full}</VariantContext.Provider>
                    </>
                  )}
                </div>

                <LessonSources page={r.page} />

                <footer className="guide-end">
                  {lessonMode !== "full" && (
                    <p className="guide-tldr-end">
                      {lessonMode === "short" ? "That's the short version." : "Some steps are still short."}{" "}
                      <button type="button" className="guide-link" onClick={() => switchAll(false, null)}>
                        Read the whole lesson
                      </button>
                    </p>
                  )}
                  {sortable && page.metric && (
                    <button
                      type="button"
                      className="guide-sort-btn"
                      onClick={() => {
                        const m = page.metric!;
                        closeGuide(() => onSortBy!(m));
                      }}
                    >
                      Sort the gallery by {METRIC_INFO[page.metric].name} →
                    </button>
                  )}
                  <nav className="guide-prevnext" aria-label="More lessons">
                    {prev ? (
                      <GuideLink to={prev.id} className="guide-card is-prev">
                        <span className="guide-caption block">
                          <ArrowLeft size={11} className="inline -mt-0.5" aria-hidden="true" /> Previous
                        </span>
                        <span className="guide-card-title">{prev.label}</span>
                      </GuideLink>
                    ) : (
                      <span />
                    )}
                    {next && (
                      <GuideLink to={next.id} className="guide-card is-next">
                        <span className="guide-caption block">
                          Next <ArrowRight size={11} className="inline -mt-0.5" aria-hidden="true" />
                        </span>
                        <span className="guide-card-title">{next.label}</span>
                      </GuideLink>
                    )}
                  </nav>
                </footer>
              </article>

              {desktop && (
                <aside className="guide-margin">
                  <div className="guide-margin-sticky">
                    {specimen}
                    {marginCode.item && (
                      <CodePane
                        code={marginCode.item}
                        leaving={marginCode.leaving}
                        expanded={codeExpanded}
                        onExpand={setCodeExpanded}
                        onClose={() => setCode(null)}
                        onGoToStep={codeGoToStep}
                      />
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>

          {toast && (
            <p className="guide-toast" role="status">
              {toast}
            </p>
          )}
        </div>

        {!desktop && code && <CodeSheet code={code} onClose={() => setCode(null)} onGoToStep={codeGoToStep} />}
        {!desktop && contentsOpen && (
          <ContentsSheet page={r.page} step={spy.step} finished={finished} onGo={goTo} onClose={() => setContentsOpen(false)} />
        )}
        {picking && (
          <AnchorPicker
            pool={pool}
            current={anchor?.id ?? null}
            onPick={(id) => {
              setPicking(false);
              navigateGuide({ anchor: id }, { scroll: false });
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </GuideContext.Provider>,
    document.body
  );
}

type LessonMode = "full" | "short" | "mixed";

/** What a page's body is: one tree, or a lesson's short and full versions. */
type LessonBody = { node: React.ReactNode } | { short: React.ReactNode; full: React.ReactNode };

/**
 * The lesson switch: every step full or every step short, two options in one
 * pill, the chosen one under a sliding thumb. When steps have been switched
 * one by one into a mix, neither is chosen and the thumb steps aside.
 */
function ModeSwitch({ mode, onChange }: { mode: LessonMode; onChange: (short: boolean) => void }) {
  return (
    <div className="guide-mode" role="group" aria-label="Lesson length" data-mode={mode}>
      <span className="guide-mode-thumb" aria-hidden="true" />
      <button type="button" aria-pressed={mode === "full"} onClick={() => onChange(false)} title="Every step in full">
        Full
      </button>
      <button type="button" aria-pressed={mode === "short"} onClick={() => onChange(true)} title="Every step short (T)">
        TL;DR
      </button>
    </div>
  );
}
