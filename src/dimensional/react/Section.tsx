import { Children, isValidElement, useEffect, useLayoutEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { glide } from "../core/glide";
import { motionToken } from "../core/motion";
import { SectionContext, useDoc, type Facet } from "./context";
import { ChevronDown, ChevronUp } from "./icons";

/**
 * One layer of a section: a complete retelling of it at one depth. Layers
 * are positional: a section's first `Layer` is L1, the next L2, and so on.
 */
export function Layer({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export interface SectionProps {
  id: string;
  /** A statement of ten words or fewer. Leave it out for an untitled intro. */
  title?: string;
  /** A shorter label for the rail. */
  short?: string;
  /** The code behind the section, opened beside it at any depth. */
  code?: { title: string; body: ReactNode; bare?: boolean } | null;
  /** Other things beside it, each with its own button. */
  facets?: Facet[];
  /** Words at each depth, when known, for the page's reading time. */
  words?: number[];
  /** Its `Layer`s, shallowest first. Anything else is a single layer. */
  children?: ReactNode;
}

/**
 * A section and every layer of it. It shows one layer at a time: the depth
 * the page is set to, or the one the reader picked with the section's own
 * switch, clamped to the layers it has (R6). Switching here keeps the
 * heading where it was clicked and glides the box from its old height to
 * its new one.
 */
export function Section({ id, title = "", short, code, facets, words, children }: SectionProps) {
  const doc = useDoc();
  const items = Children.toArray(children);
  const layered = items.filter((c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c) && c.type === Layer);
  const layers: ReactNode[] = layered.length ? layered.map((l) => l.props.children) : [children];
  const count = layers.length;
  const depth = Math.min(doc.requestedDepth(id), count - 1);

  const ref = useRef<HTMLElement>(null);
  const hold = useRef<{ top: number; height: number } | null>(null);
  // Which way the last switch went: opening rises in, folding only settles.
  const shown = useRef({ depth, dir: "open" as "open" | "fold" });
  if (shown.current.depth !== depth) shown.current = { depth, dir: depth > shown.current.depth ? "open" : "fold" };
  const endGlide = useRef<(() => void) | null>(null);

  const wordsKey = words?.join(",") ?? "";
  const { register } = doc;
  useLayoutEffect(() => {
    if (!ref.current) return;
    return register({
      id,
      title,
      short,
      layers: count,
      words: wordsKey ? wordsKey.split(",").map(Number) : undefined,
      el: ref.current,
    });
  }, [register, id, title, short, count, wordsKey]);

  const switchTo = (d: number) => {
    const box = ref.current?.getBoundingClientRect();
    hold.current = box ? { top: box.top, height: box.height } : null;
    doc.setSectionDepth(id, d);
  };

  // After a switch of this section's own: hold the heading still, then
  // glide from the old height.
  useLayoutEffect(() => {
    const h = hold.current;
    const el = ref.current;
    if (!h || !el) return;
    hold.current = null;
    const scroller = doc.scroller;
    const delta = el.getBoundingClientRect().top - h.top;
    if (scroller && Math.abs(delta) > 1) scroller.scrollTop += delta;
    if (doc.reduced) return;
    endGlide.current?.();
    endGlide.current = glide(el, h.height, {
      scroller,
      minMs: motionToken(el, "glideMinMs"),
      maxMs: motionToken(el, "glideMaxMs"),
      ease: motionToken(el, "glideEase"),
    });
    // Only a change of depth glides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);
  useEffect(() => () => endGlide.current?.(), []);

  const all: Facet[] = [...(code ? [{ name: "code", title: code.title, body: code.body, bare: code.bare }] : []), ...(facets ?? [])];
  const swapped = doc.swapped.has(id);
  const n = doc.sectionNumber(id);
  const { levels } = doc;
  const labelCh = Math.max(...levels.slice(0, count).map((l) => l.length), 4);

  const tools =
    all.length > 0 || count > 1 ? (
      <span className="dd-section-tools" style={{ "--dd-depth-ch": labelCh } as React.CSSProperties}>
        {all.map((f) => (
          <button
            key={f.name}
            type="button"
            className="dd-facet-btn"
            aria-pressed={doc.openFacet?.section === id && doc.openFacet.name === f.name}
            onClick={() => doc.toggleFacet(id, f)}
            title={f.name === "code" ? "See the code behind this section" : f.title}
          >
            {f.name === "code" ? "</> code" : f.name}
          </button>
        ))}
        {depth > 0 && (
          <button
            type="button"
            className="dd-depth-btn"
            data-dir="up"
            onClick={() => switchTo(depth - 1)}
            aria-expanded={true}
            title={`Back to ${levels[depth - 1] ?? `L${depth}`}, here`}
          >
            <ChevronUp size={13} />
            <span>{levels[depth - 1] ?? `L${depth}`}</span>
          </button>
        )}
        {depth < count - 1 && (
          <button
            type="button"
            className="dd-depth-btn"
            data-dir="down"
            onClick={() => switchTo(depth + 1)}
            aria-expanded={false}
            title={`Go on to ${levels[depth + 1] ?? `L${depth + 2}`}, here`}
          >
            <ChevronDown size={13} />
            <span>{levels[depth + 1] ?? `L${depth + 2}`}</span>
          </button>
        )}
      </span>
    ) : null;

  const body = (
    <SectionContext.Provider value={id}>
      <div className={`dd-section-body${swapped ? " is-swapped" : ""}`} data-swap={shown.current.dir} key={depth}>
        {layers[depth]}
      </div>
    </SectionContext.Provider>
  );

  return (
    <section
      ref={ref}
      id={id}
      data-step={title ? id : undefined}
      data-depth={depth}
      data-deepest={depth === count - 1 || undefined}
      className={`dd-section${title ? "" : " is-untitled"}`}
    >
      {title ? (
        <>
          <h2 className={`dd-section-heading${swapped ? " is-swapped" : ""}`}>
            <span className="dd-section-num">{n > 0 ? n : "·"}</span>
            <span className="dd-section-title">{title}</span>
            <a
              href={`#${id}`}
              className="dd-section-link"
              onClick={(e) => {
                e.preventDefault();
                doc.copyLink(id);
              }}
              aria-label={`Copy a link to “${title}”`}
              title="Copy a link to this section"
            >
              #
            </a>
            {tools}
          </h2>
          {body}
        </>
      ) : (
        <>
          {body}
          {tools && <div className={`dd-section-foot${swapped ? " is-swapped" : ""}`}>{tools}</div>}
        </>
      )}
    </section>
  );
}
