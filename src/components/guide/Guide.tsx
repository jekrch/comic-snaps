import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Menu } from "lucide-react";
import type { Panel } from "../../types";
import { peekEmbeddings } from "../../utils/sorting";
import { METRIC_INFO } from "../explainer/explainerConstants";
import { HatchDivider } from "../explainer/explainerPrimitives";
import { ColorExplanation, EmbeddingExplanation, PhashExplanation, VectorsExplanation } from "../explainer/explanations";
import type { MetricKey } from "../graph/similarityConfig";
import { APP_DIM, freezeApp, type AppBehind } from "./appBehind";
import { CODE_EXIT_MS, CodePane, CodeSheet, usePresence, type OpenCode } from "./CodePane";
import { GuideContext, type GuideContextValue } from "./guideContext";
import { GuideLink } from "./GuideLink";
import { ContentsSheet, GuideRail } from "./GuideRail";
import { GUIDE_NAME, GUIDE_SUBTITLE, LESSONS, PAGES, neighbours, pageDef, stepNumber, type PageId } from "./lessons";
import { GUIDE_Z, isTopOverlay, useOverlay } from "./overlayStack";
import { Glossary } from "./pages/Glossary";
import { Overview } from "./pages/Overview";
import { AnchorPicker, SpecimenBar } from "./SpecimenBar";
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

  // --- Scrolling, steps, progress -------------------------------------------

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScroller(el);
  }, []);
  const spy = useScrollSpy(scroller, `${r.page}:${status.kind}:${anchor?.id ?? ""}`);
  useReveal(scroller, `${r.page}:${contentReady}`, !reduced);

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
  const pending = useRef<{ step: string | null; page: PageId } | null>(null);
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
    const top = p.step ? stepTop(p.step) ?? 0 : samePage ? 0 : savedPosition(r.page);
    scroller.scrollTo({ top, behavior: samePage && !reduced ? "smooth" : "auto" });

    // Figures above the step (the patch examples, the model inputs) load
    // after the jump and push it down. Keep it in place while they settle,
    // until the reader scrolls for themselves.
    if (!p.step || samePage || typeof ResizeObserver === "undefined") return;
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
    const t = window.setTimeout(() => savePosition(r.page, spy.scrollTop), 400);
    return () => window.clearTimeout(t);
  }, [spy.scrollTop, r.page, contentReady]);

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
    () => ({ page: r.page, desktop, codeStep: code?.step ?? null, openCode, goTo, copyStepLink }),
    [r.page, desktop, code, openCode, goTo, copyStepLink]
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
      } else if (e.key === "/" || e.key === "g") {
        e.preventDefault();
        if (desktop) setRailFocus((n) => n + 1);
        else setContentsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overlayId, code, codeExpanded, desktop, prev, next, goTo]);

  // --- Rendering --------------------------------------------------------------

  const stepIndex = spy.step ? stepNumber(r.page, spy.step) : 0;
  const lessonIndex = LESSONS.findIndex((l) => l.id === r.page);
  const width = typeof window === "undefined" ? 1000 : window.innerWidth;

  const sheetStyle: React.CSSProperties = reduced
    ? { opacity: entered ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out` }
    : {
        transform: drag !== null ? `translate3d(${drag}px,0,0)` : entered ? "translate3d(0,0,0)" : "translate3d(100%,0,0)",
        transition: drag !== null ? "none" : `transform ${SLIDE_MS}ms ${EASE}`,
      };
  const scrimOpacity = entered ? (drag !== null ? APP_DIM * (1 - drag / width) : APP_DIM) : 0;

  const lede = page.metric ? METRIC_INFO[page.metric].oneLiner : LEDES[r.page];
  const sortable = !!onSortBy && !!page.metric && contentReady;

  // Memoized: the masthead's progress and the rail re-render with every
  // scroll frame, and the lesson underneath has no reason to.
  const body = useMemo(() => {
    if (r.page === "overview") return <Overview anchor={anchor} pool={pool} />;
    if (r.page === "glossary") return <Glossary />;
    if (r.page === "phash") return <PhashExplanation />;
    if (!anchor) return <p className="guide-notice">Loading the gallery…</p>;
    if (status.kind === "loading") return <p className="guide-notice">Loading {methodName}'s numbers…</p>;
    if (status.kind === "none")
      return (
        <p className="guide-notice">
          {methodName} has nothing to compare this panel with.{" "}
          <button type="button" className="guide-link" onClick={shuffle}>
            Try another anchor
          </button>
          .
        </p>
      );
    const props = { anchorPanel: anchor, closest: status.specimen.closest, furthest: status.specimen.furthest };
    if (r.page === "color") return <ColorExplanation {...props} all={status.specimen.all} pool={pool} />;
    if (r.page === "vectors") return <VectorsExplanation {...props} />;
    if (page.metric && isEmbeddingMetric(page.metric)) return <EmbeddingExplanation metric={page.metric} {...props} />;
    return null;
  }, [r.page, page.metric, anchor, pool, status, methodName, shuffle]);

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
                  <p className="guide-meta">
                    {r.page !== "glossary" && <>~{page.minutes} min read</>}
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
                  <HatchDivider />
                </header>

                <div key={contentReady ? "ready" : "wait"} className={`guide-body${bodyArrives ? " is-arriving" : ""}`}>
                  {body}
                </div>

                <footer className="guide-end">
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
