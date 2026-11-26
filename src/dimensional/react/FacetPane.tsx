import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STOP_EVENTS, isTopOverlay } from "../core/overlayStack";
import { prefersReducedMotion } from "../core/motion";
import type { OpenFacet } from "./context";
import { useOverlay } from "./hooks";
import { Close, Collapse, Expand } from "./icons";

/** How long the pane takes to leave the margin (CSS: ddFacetOut). */
export const FACET_EXIT_MS = 200;

function Header({ facet, onGoToSection, children }: { facet: OpenFacet; onGoToSection: () => void; children: React.ReactNode }) {
  return (
    <div className="dd-facet-head">
      <div className="dd-facet-head-text">
        <p className="dd-label">{facet.name === "code" ? "The code behind" : facet.name}</p>
        <p className="dd-facet-title" key={facet.section}>
          {facet.title}
        </p>
        <button type="button" className="dd-facet-section" onClick={onGoToSection}>
          {facet.sectionLabel} ↑
        </button>
      </div>
      <div className="dd-facet-head-tools">{children}</div>
    </div>
  );
}

const FLIGHT_MS = { grow: 380, settle: 340 };

/**
 * Flies the pane between its slot in the margin and its expanded box over
 * the column (FLIP on the box itself, not a scale, so the text never
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
    const box = (r: DOMRect) => ({ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    const anim = el.animate(
      [
        { ...box(from), boxShadow: expanded ? flat : shadow },
        { ...box(to), boxShadow: expanded ? shadow : flat },
      ],
      { duration: expanded ? FLIGHT_MS.grow : FLIGHT_MS.settle, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
    );
    flight.current = anim;
    anim.onfinish = () => {
      if (flight.current === anim) land(el);
    };
  }, [ref, expanded, leaving]);

  useEffect(() => () => flight.current?.cancel(), []);
}

/**
 * A section's facet, pinned in the margin beside the prose. It can expand
 * over the reading column for long code; a click beside it, or Escape, puts
 * it back.
 */
export function FacetPane({
  facet,
  expanded,
  leaving = false,
  onExpand,
  onClose,
  onGoToSection,
}: {
  facet: OpenFacet;
  expanded: boolean;
  leaving?: boolean;
  onExpand: (v: boolean) => void;
  onClose: () => void;
  onGoToSection: () => void;
}) {
  // The CSS entrance plays only on first arrival in the margin; expanding
  // and collapsing are flown from wherever the pane sits.
  const everExpanded = useRef(false);
  if (expanded) everExpanded.current = true;
  const motion = leaving ? "out" : everExpanded.current ? "moved" : "in";
  const paneRef = useRef<HTMLDivElement>(null);
  useFlight(paneRef, expanded, leaving);

  return (
    <>
      {expanded && !leaving && <div className="dd-facet-scrim" onClick={() => onExpand(false)} aria-hidden="true" />}
      <div
        ref={paneRef}
        className={`dd-facet-pane${expanded ? " is-expanded" : ""}`}
        data-motion={motion}
        role="region"
        aria-label={facet.title}
      >
        <Header facet={facet} onGoToSection={onGoToSection}>
          <button
            type="button"
            className="dd-icon-btn"
            onClick={() => onExpand(!expanded)}
            aria-label={expanded ? "Back to the margin" : "Expand"}
            title={expanded ? "Back to the margin" : "Expand"}
          >
            {expanded ? <Collapse size={14} /> : <Expand size={14} />}
          </button>
          <button type="button" className="dd-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Close size={15} />
          </button>
        </Header>
        <div className={`dd-facet-body${facet.bare ? " is-bare" : ""}`} key={`${facet.section}:${facet.name}`}>
          {facet.body}
        </div>
      </div>
    </>
  );
}

const SHEET_MS = 280;

/** The same, on a phone: a sheet that slides up and is dragged down (or tapped above) to close. */
export function FacetSheet({
  facet,
  zIndex,
  onClose,
  onGoToSection,
}: {
  facet: OpenFacet;
  zIndex: number;
  onClose: () => void;
  onGoToSection: () => void;
}) {
  const id = useOverlay(true, "facet-sheet");
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
    if (start.current) setDrag(Math.max(0, e.touches[0].clientY - start.current.y));
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
    <div className="dd-root dd-sheet-layer" style={{ zIndex }} {...STOP_EVENTS}>
      <div
        className="dd-sheet-scrim"
        style={{ opacity: shown ? 1 : 0, transition: reduced ? "none" : `opacity ${SHEET_MS}ms ease-out` }}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className="dd-facet-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={facet.title}
        style={{
          transform,
          transition: drag !== null || reduced ? "none" : `transform ${SHEET_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        }}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <div className="dd-sheet-handle" aria-hidden="true" />
          <Header
            facet={facet}
            onGoToSection={() => {
              close();
              onGoToSection();
            }}
          >
            <button type="button" className="dd-icon-btn" onClick={close} aria-label="Close" title="Close">
              <Close size={16} />
            </button>
          </Header>
        </div>
        <div className={`dd-facet-body${facet.bare ? " is-bare" : ""}`} key={`${facet.section}:${facet.name}`}>
          {facet.body}
        </div>
      </div>
    </div>,
    document.body,
  );
}
