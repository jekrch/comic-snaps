import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { CodeRef } from "../explainer/code/snippets";
import { GUIDE_OVERLAY_Z, STOP_EVENTS, isTopOverlay, useOverlay } from "./overlayStack";
import { prefersReducedMotion } from "./useScrollSpy";

// The code view and the source text it quotes load only when first opened.
const CodeViewerBody = lazy(() => import("../explainer/code/CodeViewer"));

export interface OpenCode {
  step: string;
  stepLabel: string;
  ref: CodeRef;
}

function Header({ code, onGoToStep, children }: { code: OpenCode; onGoToStep: () => void; children: React.ReactNode }) {
  return (
    <div className="guide-code-head">
      <div className="min-w-0">
        <p className="guide-label">The code behind</p>
        <p className="guide-code-title" key={code.step}>
          {code.ref.title}
        </p>
        <button type="button" className="guide-code-step" onClick={onGoToStep}>
          {code.stepLabel} ↑
        </button>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">{children}</div>
    </div>
  );
}

const Loading = () => <p className="guide-caption px-4 py-3">Loading the code…</p>;

/** How long the pane takes to leave the margin (CSS: guideCodeOut). */
export const CODE_EXIT_MS = 200;

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

const FLIGHT_MS = { grow: 380, settle: 340 };

/**
 * Flies the pane between its slot in the margin and its expanded box over
 * the column (FLIP on the box itself, not a scale, so the code never
 * squashes): measure where it was and where it lands, pin it `fixed`, and
 * animate top/left/width/height between the two. Toggling mid-flight starts
 * from wherever it is on screen at that moment.
 */
function useFlight(ref: React.RefObject<HTMLDivElement | null>, expanded: boolean, leaving: boolean) {
  const was = useRef(expanded);
  const flight = useRef<Animation | null>(null);

  const land = (el: HTMLElement) => {
    flight.current?.cancel();
    flight.current = null;
    el.style.removeProperty("position");
    el.style.removeProperty("z-index");
    el.style.removeProperty("margin");
  };

  useLayoutEffect(() => {
    if (was.current === expanded) return;
    was.current = expanded;
    const el = ref.current;
    if (!el) return;
    if (leaving || prefersReducedMotion() || typeof el.animate !== "function") {
      land(el);
      return;
    }

    // Where it is now: mid-flight it's held `fixed` inline, so its rect is
    // what's on screen; otherwise put the old class back for a moment.
    let from: DOMRect;
    if (flight.current) {
      from = el.getBoundingClientRect();
      land(el);
    } else {
      el.classList.toggle("is-expanded", !expanded);
      from = el.getBoundingClientRect();
      el.classList.toggle("is-expanded", expanded);
    }
    const to = el.getBoundingClientRect();
    if (Math.abs(from.left - to.left) + Math.abs(from.top - to.top) + Math.abs(from.width - to.width) < 1) return;

    // The expanded shadow, read once from the stylesheet.
    if (!expanded) el.classList.add("is-expanded");
    const shadow = getComputedStyle(el).boxShadow;
    if (!expanded) el.classList.remove("is-expanded");
    const flat = "0 0 0 rgba(0, 0, 0, 0)";

    el.style.position = "fixed";
    el.style.zIndex = "6";
    el.style.margin = "0";
    const box = (r: DOMRect) => ({
      top: `${r.top}px`,
      left: `${r.left}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const anim = el.animate(
      [
        { ...box(from), boxShadow: expanded ? flat : shadow },
        { ...box(to), boxShadow: expanded ? shadow : flat },
      ],
      {
        duration: expanded ? FLIGHT_MS.grow : FLIGHT_MS.settle,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      }
    );
    flight.current = anim;
    anim.onfinish = () => {
      if (flight.current === anim) land(el);
    };
  }, [ref, expanded, leaving]);

  useEffect(
    () => () => {
      flight.current?.cancel();
    },
    []
  );
}

/**
 * A step's code, pinned in the margin beside the prose. It can expand to
 * take over the reading column for long snippets; a click beside it, or
 * Escape, puts it back.
 */
export function CodePane({
  code,
  expanded,
  leaving = false,
  onExpand,
  onClose,
  onGoToStep,
}: {
  code: OpenCode;
  expanded: boolean;
  /** Closing: animating out of the margin, about to unmount. */
  leaving?: boolean;
  onExpand: (v: boolean) => void;
  onClose: () => void;
  onGoToStep: () => void;
}) {
  // The CSS entrance plays only on first arrival in the margin; expanding
  // and collapsing are flown by useFlight from wherever the pane sits.
  const everExpanded = useRef(false);
  if (expanded) everExpanded.current = true;
  const motion = leaving ? "out" : everExpanded.current ? "moved" : "in";
  const paneRef = useRef<HTMLDivElement>(null);
  useFlight(paneRef, expanded, leaving);

  return (
    <>
      {expanded && !leaving && <div className="guide-code-scrim" onClick={() => onExpand(false)} aria-hidden="true" />}
      <div
        ref={paneRef}
        className={`guide-code-pane${expanded ? " is-expanded" : ""}`}
        data-motion={motion}
        role="region"
        aria-label={`The code behind “${code.ref.title}”`}
      >
        <Header code={code} onGoToStep={onGoToStep}>
          <button
            type="button"
            className="guide-icon-btn"
            onClick={() => onExpand(!expanded)}
            aria-label={expanded ? "Back to the margin" : "Expand"}
            title={expanded ? "Back to the margin" : "Expand"}
          >
            {expanded ? <Minimize2 size={14} strokeWidth={1.5} /> : <Maximize2 size={14} strokeWidth={1.5} />}
          </button>
          <button type="button" className="guide-icon-btn" onClick={onClose} aria-label="Close the code" title="Close">
            <X size={15} strokeWidth={1.5} />
          </button>
        </Header>
        <div className="guide-code-body" key={code.step}>
          <Suspense fallback={<Loading />}>
            <CodeViewerBody codeRef={code.ref} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

const SHEET_MS = 280;

/**
 * The same, on a phone: a sheet that slides up to most of the screen and is
 * dragged down (or tapped above) to close.
 */
export function CodeSheet({ code, onClose, onGoToStep }: { code: OpenCode; onClose: () => void; onGoToStep: () => void }) {
  const id = useOverlay(true, "code-sheet");
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const closing = useRef(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(r);
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setDrag(null);
    setShown(false);
    window.setTimeout(onClose, reduced ? 0 : SHEET_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(id)) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = { y: e.touches[0].clientY, t: performance.now() };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    setDrag(Math.max(0, e.touches[0].clientY - start.current.y));
  };
  const onTouchEnd = () => {
    if (!start.current) return;
    const d = drag ?? 0;
    const v = d / Math.max(1, performance.now() - start.current.t);
    start.current = null;
    if (d > 120 || v > 0.6) close();
    else setDrag(null);
  };

  const transform = drag !== null ? `translateY(${drag}px)` : shown ? "translateY(0)" : "translateY(100%)";

  return createPortal(
    <div className="guide-sheet-layer" style={{ zIndex: GUIDE_OVERLAY_Z }} {...STOP_EVENTS}>
      <div
        className="guide-sheet-scrim"
        style={{ opacity: shown ? 1 : 0, transition: reduced ? "none" : `opacity ${SHEET_MS}ms ease-out` }}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className="guide-code-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`The code behind “${code.ref.title}”`}
        style={{
          transform,
          transition: drag !== null || reduced ? "none" : `transform ${SHEET_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        }}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <div className="guide-sheet-handle" aria-hidden="true" />
          <Header
            code={code}
            onGoToStep={() => {
              close();
              onGoToStep();
            }}
          >
            <button type="button" className="guide-icon-btn" onClick={close} aria-label="Close the code" title="Close">
              <X size={16} strokeWidth={1.5} />
            </button>
          </Header>
        </div>
        <div className="guide-code-body" key={code.step}>
          <Suspense fallback={<Loading />}>
            <CodeViewerBody codeRef={code.ref} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
