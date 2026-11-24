import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { PAGES, type PageId } from "./lessons";
import { GUIDE_OVERLAY_Z, STOP_EVENTS, isTopOverlay, useOverlay } from "./overlayStack";
import { prefersReducedMotion } from "./useScrollSpy";

/**
 * Every page of the Guide, with the current page's steps opened out and the
 * step the reader is in marked. Lessons they've read to the end get a tick.
 */
export function GuideRail({
  page,
  step,
  finished,
  onGo,
  autoFocusCurrent = false,
}: {
  page: PageId;
  step: string | null;
  finished: Set<string>;
  onGo: (page: PageId, step?: string) => void;
  autoFocusCurrent?: boolean;
}) {
  const currentRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (autoFocusCurrent) currentRef.current?.focus({ preventScroll: false });
  }, [autoFocusCurrent]);

  return (
    <nav aria-label="Contents" className="guide-rail-nav">
      <ol className="guide-rail-list">
        {PAGES.map((p) => {
          const here = p.id === page;
          return (
            <li key={p.id} className={`guide-rail-page${here ? " is-current" : ""}${p.id === "glossary" ? " is-glossary" : ""}`}>
              <a
                href={`?guide${p.id === "overview" ? "" : `=${p.id}`}`}
                ref={here && !step ? currentRef : undefined}
                aria-current={here ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onGo(p.id);
                }}
              >
                <span>{p.label}</span>
                {finished.has(p.id) && <Check size={11} strokeWidth={2} className="guide-rail-tick" aria-label="read" />}
              </a>
              {here && p.steps.length > 0 && (
                <div className="guide-rail-track">
                  <StepMarker step={step} />
                  <ol className="guide-rail-steps">
                    {p.steps.map((s, i) => {
                      const on = s.id === step;
                      return (
                        <li key={s.id} className={on ? "is-current" : undefined} style={{ "--i": i } as React.CSSProperties}>
                          <a
                            href={`#${s.id}`}
                            ref={on ? currentRef : undefined}
                            aria-current={on ? "step" : undefined}
                            onClick={(e) => {
                              e.preventDefault();
                              onGo(p.id, s.id);
                            }}
                          >
                            <span className="guide-rail-num">{i + 1}</span>
                            <span>{s.short ?? s.title}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The accent bar beside the step the reader is in. One bar that slides from
 * step to step, rather than a bar per step blinking on and off. Placed by
 * measuring the current item, since step titles wrap to different heights.
 */
function StepMarker({ step }: { step: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  const place = (glide: boolean) => {
    const bar = ref.current;
    const li = bar?.parentElement?.querySelector<HTMLElement>("li.is-current");
    if (!bar) return;
    if (!li) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.transition = glide ? "" : "none";
    bar.style.transform = `translateY(${li.offsetTop}px)`;
    bar.style.height = `${li.offsetHeight}px`;
    bar.style.opacity = "1";
    placed.current = true;
  };

  // The first placement lands; later ones glide.
  useLayoutEffect(() => place(placed.current), [step]);

  // Titles rewrap when the rail resizes: follow without gliding.
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

  return <span ref={ref} className="guide-rail-marker" aria-hidden="true" />;
}

const SHEET_MS = 260;

/** The rail, on a phone: a sheet from the left, opened from the header. */
export function ContentsSheet(
  props: Omit<React.ComponentProps<typeof GuideRail>, "autoFocusCurrent"> & {
    onClose: () => void;
  },
) {
  const { onClose, onGo, ...rest } = props;
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
    <div className="guide-sheet-layer" style={{ zIndex: GUIDE_OVERLAY_Z }} {...STOP_EVENTS}>
      <div
        className="guide-sheet-scrim"
        style={{
          opacity: shown ? 1 : 0,
          transition: reduced ? "none" : `opacity ${SHEET_MS}ms ease-out`,
        }}
        onClick={() => close()}
        aria-hidden="true"
      />
      <div
        className="guide-contents-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Contents"
        style={{
          transform: shown ? "translateX(0)" : "translateX(-100%)",
          transition: reduced ? "none" : `transform ${SHEET_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="guide-label">Contents</p>
          <button type="button" className="guide-icon-btn" onClick={() => close()} aria-label="Close contents">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-3 pb-6 overflow-y-auto info-modal-scroll">
          <GuideRail {...rest} autoFocusCurrent onGo={(p, s) => close(() => onGo(p, s))} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
