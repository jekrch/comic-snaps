import { useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { placePopover } from "../core/layers";
import { SectionContext, useDoc } from "./context";

/**
 * A word that names one of the document's terms.
 *
 * Where the term is introduced (its home section, on the use marked
 * `first`) it's set as a definition with its meaning beside it: a sidenote
 * in the margin on wide screens, behind a small toggle on phones. Everywhere
 * else it's lightly underlined and shows the meaning on hover or tap, with a
 * way back to where it was introduced.
 */
export function Term({ id, first = false, children }: { id: string; first?: boolean; children?: ReactNode }) {
  const { page, desktop, goTo, term } = useDoc();
  const section = useContext(SectionContext);
  const [open, setOpen] = useState(false);
  const refEl = useRef<HTMLSpanElement>(null);
  const place = useCallback(() => {
    const el = refEl.current;
    const pop = el?.querySelector<HTMLElement>(".dd-term-pop");
    if (el && pop) placePopover(el, pop);
  }, []);
  const def = term(id);
  const label = children ?? def?.label ?? id;
  // Marked, so a linter or test can catch a misspelt id.
  if (!def) return <span data-term-unknown={id}>{label}</span>;

  if (first && def.page === page && def.section === section) {
    return (
      <>
        <dfn className="dd-term is-defined" data-term-define={id}>
          {label}
        </dfn>
        {desktop ? (
          <span className="dd-sidenote" role="note">
            <span className="dd-sidenote-label">{def.label}</span>
            {def.body}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="dd-note-toggle"
              aria-expanded={open}
              aria-label={open ? `Hide what “${def.label}” means` : `What “${def.label}” means`}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="dd-note-toggle-q" aria-hidden="true">
                ?
              </span>
            </button>
            {/* Always mounted, so it can unfold and fold back; inert while shut. */}
            <span className="dd-inline-note" role="note" data-open={open || undefined} inert={!open}>
              <span className="dd-inline-note-clip">
                <span className="dd-inline-note-card">
                  <span className="dd-inline-note-label">{def.label}</span>
                  {def.body}
                </span>
              </span>
            </span>
          </>
        )}
      </>
    );
  }

  const atHome = def.page === page;
  const here = atHome && def.section === section;
  return (
    <span
      ref={refEl}
      className="dd-term-ref"
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
      {label}
      <span role="tooltip" className="dd-pop dd-term-pop" onClick={(e) => e.stopPropagation()}>
        <span className="dd-pop-caret" aria-hidden="true" />
        <span className="dd-pop-main">
          <span className="dd-pop-name">{def.label}</span>
          {def.sectionTitle && <span className="dd-pop-meta">{def.sectionTitle}</span>}
          <span className="dd-pop-body">{def.body}</span>
        </span>
        {!here && (
          <button
            type="button"
            className="dd-pop-foot"
            onClick={() => {
              setOpen(false);
              goTo(def.page, def.section);
            }}
          >
            <span>
              {atHome ? "Back to where it's introduced" : def.pageLabel ? `Introduced in ${def.pageLabel}` : "Where it's introduced"}
            </span>
            <span aria-hidden="true">{atHome ? "↑" : "→"}</span>
          </button>
        )}
      </span>
    </span>
  );
}
