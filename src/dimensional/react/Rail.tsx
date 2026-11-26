import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STOP_EVENTS, isTopOverlay } from "../core/overlayStack";
import { prefersReducedMotion } from "../core/motion";
import { useOverlay } from "./hooks";
import { Check, Close } from "./icons";

export interface RailPage {
  id: string;
  label: string;
  /** Set apart at the end (the glossary). */
  apart?: boolean;
}

export interface RailItem {
  id: string;
  label: string;
  /** A count beside it (a sources group's size). */
  count?: number;
}

export interface RailProps {
  pages: RailPage[];
  page: string;
  /** The current page's sections, in order. */
  sections: RailItem[];
  /** The current page's source groups. */
  sources: RailItem[];
  step: string | null;
  finished: ReadonlySet<string>;
  onGo: (page: string, step?: string) => void;
  href: (page: string, step?: string) => string;
  autoFocusCurrent?: boolean;
}

/**
 * Every page, with the current page's sections opened out and the section
 * the reader is in marked. Pages read to the end get a tick. A page's
 * sources follow its sections as a list of their own. With one page, only
 * its sections.
 */
export function Rail({ pages, page, sections, sources, step, finished, onGo, href, autoFocusCurrent = false }: RailProps) {
  const currentRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (autoFocusCurrent) currentRef.current?.focus({ preventScroll: false });
  }, [autoFocusCurrent]);

  const steps = (here: string) => (
    <>
      {sections.length > 0 && (
        <div className="dd-rail-track">
          <StepMarker step={step} />
          <ol className="dd-rail-steps">
            {sections.map((s, i) => {
              const on = s.id === step;
              return (
                <li key={s.id} className={on ? "is-current" : undefined} style={{ "--i": i } as React.CSSProperties}>
                  <a
                    href={href(here, s.id)}
                    ref={on ? currentRef : undefined}
                    aria-current={on ? "step" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onGo(here, s.id);
                    }}
                  >
                    <span className="dd-rail-num">{i + 1}</span>
                    <span>{s.label}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {sources.length > 0 && (
        <div className="dd-rail-sources">
          <p className="dd-rail-section" id="dd-rail-sources-label">
            Sources
          </p>
          <div className="dd-rail-track">
            <StepMarker step={step} />
            <ol className="dd-rail-steps" aria-labelledby="dd-rail-sources-label">
              {sources.map((g, i) => {
                const on = g.id === step;
                return (
                  <li key={g.id} className={on ? "is-current" : undefined} style={{ "--i": sections.length + i } as React.CSSProperties}>
                    <a
                      href={href(here, g.id)}
                      ref={on ? currentRef : undefined}
                      aria-current={on ? "step" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        onGo(here, g.id);
                      }}
                    >
                      <span>{g.label}</span>
                      {g.count !== undefined && (
                        <span className="dd-rail-count" aria-label={`${g.count} sources`}>
                          {g.count}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </>
  );

  if (pages.length <= 1) {
    return (
      <nav aria-label="Contents" className="dd-rail-nav is-single">
        {steps(page)}
      </nav>
    );
  }

  return (
    <nav aria-label="Contents" className="dd-rail-nav">
      <ol className="dd-rail-list">
        {pages.map((p) => {
          const here = p.id === page;
          return (
            <li key={p.id} className={`dd-rail-page${here ? " is-current" : ""}${p.apart ? " is-apart" : ""}`}>
              <a
                href={href(p.id)}
                ref={here && !step ? currentRef : undefined}
                aria-current={here ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onGo(p.id);
                }}
              >
                <span>{p.label}</span>
                {finished.has(p.id) && (
                  <span className="dd-rail-tick" aria-label="read">
                    <Check size={11} />
                  </span>
                )}
              </a>
              {here && steps(p.id)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The accent bar beside the item the reader is in. One bar that slides from
 * item to item, placed by measuring, since titles wrap to different heights.
 */
function StepMarker({ step }: { step: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  const place = (slide: boolean) => {
    const bar = ref.current;
    const li = bar?.parentElement?.querySelector<HTMLElement>("li.is-current");
    if (!bar) return;
    if (!li) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.transition = slide ? "" : "none";
    bar.style.transform = `translateY(${li.offsetTop}px)`;
    bar.style.height = `${li.offsetHeight}px`;
    bar.style.opacity = "1";
    placed.current = true;
  };

  // The first placement lands; later ones slide.
  useLayoutEffect(() => place(placed.current), [step]);

  // Titles rewrap when the rail resizes: follow without sliding.
  useEffect(() => {
    const track = ref.current?.parentElement;
    if (!track || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) first = false;
      else place(false);
    });
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  return <span ref={ref} className="dd-rail-marker" aria-hidden="true" />;
}

const SHEET_MS = 260;

/** The rail, on a phone: a sheet from the left, opened from the masthead. */
export function ContentsSheet(props: Omit<RailProps, "autoFocusCurrent"> & { zIndex: number; onClose: () => void }) {
  const { onClose, onGo, zIndex, ...rest } = props;
  const id = useOverlay(true, "contents");
  const [shown, setShown] = useState(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(r);
  }, []);

  const close = (then?: () => void) => {
    setShown(false);
    window.setTimeout(
      () => {
        onClose();
        then?.();
      },
      reduced ? 0 : SHEET_MS,
    );
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

  return createPortal(
    <div className="dd-root dd-sheet-layer" style={{ zIndex }} {...STOP_EVENTS}>
      <div
        className="dd-sheet-scrim"
        style={{ opacity: shown ? 1 : 0, transition: reduced ? "none" : `opacity ${SHEET_MS}ms ease-out` }}
        onClick={() => close()}
        aria-hidden="true"
      />
      <div
        className="dd-contents-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Contents"
        style={{
          transform: shown ? "translateX(0)" : "translateX(-100%)",
          transition: reduced ? "none" : `transform ${SHEET_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        }}
      >
        <div className="dd-contents-head">
          <p className="dd-label">Contents</p>
          <button type="button" className="dd-icon-btn" onClick={() => close()} aria-label="Close contents">
            <Close size={16} />
          </button>
        </div>
        <div className="dd-contents-body">
          <Rail {...rest} autoFocusCurrent onGo={(p, s) => close(() => onGo(p, s))} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
