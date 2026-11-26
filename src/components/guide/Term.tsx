import { useCallback, useContext, useRef, useState } from "react";
import { concept } from "./concepts";
import { StepContext, useGuide } from "./guideContext";
import { pageDef, stepDef } from "./lessons";

/**
 * A word that names one of the Guide's concepts (`concepts.ts`).
 *
 * Where the concept is introduced (its home step, on the occurrence marked
 * `first`), it's styled as a definition and its one-line meaning sits beside
 * it: as a sidenote in the margin on wide screens, behind a small toggle on
 * phones. Everywhere else it's lightly underlined and shows the meaning on
 * hover or tap, with a way back to where it was introduced.
 */
export function Term({ id, first = false, children }: { id: string; first?: boolean; children: React.ReactNode }) {
  const { page, desktop, goTo } = useGuide();
  const step = useContext(StepContext);
  const [open, setOpen] = useState(false);
  const refEl = useRef<HTMLSpanElement>(null);
  const place = useCallback(() => {
    if (refEl.current) placePop(refEl.current);
  }, []);
  const c = concept(id);
  // Marked, so the lesson tests catch a misspelt id.
  if (!c) return <span data-term-unknown={id}>{children}</span>;

  const defining = first && c.lesson === page && c.step === step;

  if (defining) {
    return (
      <>
        <dfn className="guide-term is-defined" data-term-define={id}>
          {children}
        </dfn>
        {desktop ? (
          <span className="guide-sidenote" role="note">
            <span className="guide-sidenote-label">{c.label}</span>
            {c.short}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="guide-note-toggle"
              aria-expanded={open}
              aria-label={open ? `Hide what “${c.label}” means` : `What “${c.label}” means`}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="guide-note-toggle-q" aria-hidden="true">
                ?
              </span>
            </button>
            {/* Always mounted, so it can unfold and fold back; inert while shut. */}
            <span className="guide-inline-note" role="note" data-open={open || undefined} inert={!open}>
              <span className="guide-inline-note-clip">
                <span className="guide-inline-note-card">
                  <span className="guide-inline-note-label">{c.label}</span>
                  {c.short}
                </span>
              </span>
            </span>
          </>
        )}
      </>
    );
  }

  const home = pageDef(c.lesson);
  const homeStep = stepDef(c.lesson, c.step);
  const homeTitle = homeStep?.short ?? homeStep?.title;
  const atHome = c.lesson === page;
  return (
    <span
      ref={refEl}
      className="guide-term-ref"
      data-term={id}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onPointerEnter={place}
      onFocus={place}
      onClick={() => {
        place();
        setOpen((o) => !o);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          place();
          setOpen((o) => !o);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {children}
      <span role="tooltip" className="guide-pop guide-term-pop" onClick={(e) => e.stopPropagation()}>
        <span className="guide-pop-caret" aria-hidden="true" />
        <span className="guide-pop-main">
          <span className="guide-pop-name">{c.label}</span>
          <span className="guide-pop-meta">
            {home.label}
            {homeTitle ? ` · ${homeTitle}` : ""}
          </span>
          <span className="guide-pop-body">{c.short}</span>
        </span>
        {!(atHome && c.step === step) && (
          <button
            type="button"
            className="guide-pop-foot"
            onClick={() => {
              setOpen(false);
              goTo(c.lesson, c.step);
            }}
          >
            <span>{atHome ? "Back to where it's introduced" : `Introduced in ${home.label}`}</span>
            <span aria-hidden="true">{atHome ? "↑" : "→"}</span>
          </button>
        )}
      </span>
    </span>
  );
}

/** Room kept between a popover and the edges of the screen. */
const EDGE = 12;
/** The masthead's height, plus a little: a popover never tucks under it. */
const TOP_CLEAR = 64;
/** How far the caret keeps from the popover's corners. */
const CARET_INSET = 14;

/**
 * Places a term's popover before it shows: under the word (or over it, when
 * there's no room below), slid sideways to stay on screen, with the caret
 * still pointing at the word.
 */
function placePop(term: HTMLElement) {
  const pop = term.querySelector<HTMLElement>(".guide-term-pop");
  const box = term.getClientRects()[0];
  if (!pop || !box) return;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Positioned against the word's first line (an inline box's containing
  // block starts there, even when the word wraps).
  const left = Math.max(EDGE, Math.min(box.left, vw - EDGE - w));
  const caret = Math.max(CARET_INSET, Math.min(box.left + Math.min(box.width / 2, 40) - left, w - CARET_INSET));
  const above = box.bottom + h + EDGE > vh && box.top - h - EDGE > TOP_CLEAR;
  pop.style.setProperty("--pop-x", `${left - box.left}px`);
  pop.style.setProperty("--pop-caret", `${caret}px`);
  pop.dataset.side = above ? "top" : "bottom";
}
