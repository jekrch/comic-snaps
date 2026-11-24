import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import { lookupDoc, type Doc } from "./docs";
import { extractSnippet, type Snippet, type SnippetSpec } from "./extract";
import { highlight, langOf, type TokenType } from "./highlight";
import { REPO_URL, githubUrl, type CodeRef } from "./snippets";
import { SOURCES } from "./sources";

const mono = "var(--font-mono, monospace)";
const FAINT = "rgba(255,255,255,0.3)";

/** Editor-style colours, muted to sit on the site's warm dark surface. */
const COLORS: Record<TokenType, React.CSSProperties> = {
  keyword: { color: "#c4a7e7" },
  literal: { color: "#d99ac5" },
  builtin: { color: "#7ec8c0" },
  string: { color: "#a9c98f" },
  docstring: { color: "rgba(169,201,143,0.6)" },
  number: { color: "#e6a46b" },
  comment: { color: "rgba(255,255,255,0.32)", fontStyle: "italic" },
  function: { color: "#8fb4e8" },
  definition: { color: "#9cc2f0", fontWeight: 600 },
  type: { color: "#e6c07b" },
  constant: { color: "#ef9f7f" },
  property: { color: "#d8c8b4" },
  decorator: { color: "#e6c07b" },
  punctuation: { color: "rgba(255,255,255,0.45)" },
  identifier: { color: "rgba(255,255,255,0.82)" },
  space: {},
};

/** The cue on names that have an explanation: a faint dotted underline that warms on hover. */
const EXPLAINED_CLASS =
  "cursor-pointer underline decoration-dotted underline-offset-[3px] decoration-white/20 " +
  "hover:decoration-[var(--color-accent,#e85d3a)] transition-[text-decoration-color] duration-150";

const POP_W = 300;
/** How far the caret sits from the popover's edge, at most. */
const CARET_INSET = 14;

interface Pop {
  key: string;
  doc: Doc;
  x: number;
  y: number;
  width: number;
  /** The caret's x within the popover, pointing at the name. */
  caretX: number;
  above: boolean;
}

type ToggleDoc = (key: string, el: HTMLElement, doc: Doc) => void;

function Elided() {
  return (
    <div className="guide-code-line select-none" style={{ color: FAINT }}>
      <span />
      <span>⋯</span>
    </div>
  );
}

function CodeBlock({
  id,
  snippet,
  activeKey,
  onToggle,
}: {
  id: number;
  snippet: Snippet;
  activeKey: string | null;
  onToggle: ToggleDoc;
}) {
  const lines = useMemo(() => {
    const toks = highlight(snippet.code, langOf(snippet.file));
    return toks.map((line) => line.map((t) => ({ ...t, doc: t.chain ? lookupDoc(snippet.file, t.chain, t.member) : null })));
  }, [snippet]);
  const gutter = String(snippet.endLine).length;

  return (
    <pre className="guide-code-snippet" style={{ "--gutter": `${gutter}ch` } as React.CSSProperties}>
      <div className="guide-code-lines">
        {snippet.elidedBefore && <Elided />}
        {lines.map((line, li) => (
          <div key={li} className="guide-code-line">
            <span className="guide-code-ln select-none">{snippet.startLine + li}</span>
            <span>
              {line.map((t, ti) => {
                if (!t.doc)
                  return (
                    <span key={ti} style={COLORS[t.type]}>
                      {t.text}
                    </span>
                  );
                const key = `${id}:${li}:${ti}`;
                const doc = t.doc;
                const active = activeKey === key;
                return (
                  <span
                    key={ti}
                    role="button"
                    tabIndex={0}
                    aria-expanded={active}
                    className={EXPLAINED_CLASS}
                    style={{
                      ...COLORS[t.type],
                      ...(active
                        ? {
                            background: "rgba(232,93,58,0.14)",
                            borderRadius: 2,
                            textDecorationColor: "var(--color-accent, #e85d3a)",
                          }
                        : null),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(key, e.currentTarget, doc);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      onToggle(key, e.currentTarget, doc);
                    }}
                  >
                    {t.text}
                  </span>
                );
              })}
            </span>
          </div>
        ))}
        {snippet.elidedAfter && <Elided />}
      </div>
    </pre>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline hover:underline"
      style={{ color: "var(--color-accent, #e97d62)" }}
    >
      {children} ↗
    </a>
  );
}

function SnippetView({
  id,
  spec,
  activeKey,
  onToggle,
}: {
  id: number;
  spec: SnippetSpec;
  activeKey: string | null;
  onToggle: ToggleDoc;
}) {
  const snippet = useMemo(() => {
    const src = SOURCES[spec.file];
    return src ? extractSnippet(src, spec) : null;
  }, [spec]);

  return (
    <section className="guide-code-section" data-snippet={id}>
      <p className="guide-code-note m-0 mb-2">{spec.note}</p>
      <div className="guide-code-source">
        <p className="guide-caption m-0 min-w-0" style={{ fontFamily: mono }}>
          {snippet ? (
            <ExternalLink href={githubUrl(spec.file, snippet.startLine, snippet.endLine)}>
              {spec.file}:{snippet.startLine}–{snippet.endLine}
            </ExternalLink>
          ) : (
            <ExternalLink href={githubUrl(spec.file)}>{spec.file}</ExternalLink>
          )}
        </p>
        {snippet && <CopyButton text={snippet.code} />}
      </div>
      {snippet ? (
        <CodeBlock id={id} snippet={snippet} activeKey={activeKey} onToggle={onToggle} />
      ) : (
        <p className="guide-caption m-0" style={{ color: FAINT }}>
          This code has moved; the link opens the file.
        </p>
      )}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return null;
  return (
    <button
      type="button"
      className={`guide-code-tool${copied ? " is-done" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {},
        );
      }}
      aria-label={copied ? "Copied" : "Copy this code"}
      title="Copy this code"
    >
      <span className="guide-code-tool-icon" key={copied ? "done" : "copy"}>
        {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
      </span>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/**
 * The explanation card for a name: the Guide's popover (`.guide-pop`), with
 * the name set in code type and a caret pointing back at it.
 */
function DocPopover({ pop }: { pop: Pop }) {
  const { doc } = pop;
  return (
    <div
      className="absolute"
      style={{
        left: pop.x,
        top: pop.y,
        width: pop.width,
        transform: pop.above ? "translateY(-100%)" : undefined,
        zIndex: 2,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="tooltip"
        className="guide-pop guide-doc-pop"
        data-side={pop.above ? "top" : "bottom"}
        style={{ "--pop-caret": `${pop.caretX}px`, maxWidth: "none", width: "100%" } as React.CSSProperties}
      >
        <span className="guide-pop-caret" aria-hidden="true" />
        <div className="guide-pop-main">
          <span className="guide-pop-name is-code">{doc.name}</span>
          <span className="guide-pop-meta">{doc.kind}</span>
          <span className="guide-pop-body">{doc.text}</span>
        </div>
        {doc.href && (
          <a
            className="guide-pop-foot"
            href={githubUrl(doc.href.file, doc.href.startLine, doc.href.endLine)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>See it on GitHub</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </div>
  );
}

const WRAP_KEY = "comicSnaps.guide.codeWrap";

function readWrap(): boolean {
  try {
    return window.localStorage.getItem(WRAP_KEY) === "1";
  } catch {
    return false;
  }
}

function writeWrap(v: boolean) {
  try {
    window.localStorage.setItem(WRAP_KEY, v ? "1" : "0");
  } catch {
    // Not remembered, then.
  }
}

/**
 * The code behind one lesson step: the real definitions, cut from the repo's
 * own files at build time, coloured like an editor would, with an
 * explanation a click (or tap) away for the names that have one.
 *
 * Only the content; the Guide wraps it in a margin pane on wide screens and
 * a bottom sheet on phones (guide/CodePane.tsx). Fills its parent's height
 * and scrolls itself.
 */
export default function CodeViewerBody({ codeRef }: { codeRef: CodeRef }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  // Soft-wrapped lines, for the narrow margin; remembered per viewer.
  const [wrap, setWrap] = useState(readWrap);
  const [current, setCurrent] = useState(0);
  const many = codeRef.snippets.length > 1;
  const popOpen = useRef(false);
  popOpen.current = pop !== null;

  // A click (or tap) on a name opens its explanation; a second click on the
  // same name, a click anywhere else, Escape or scrolling closes it.
  const toggle = useCallback<ToggleDoc>((key, el, doc) => {
    const panel = panelRef.current;
    if (!panel) return;
    setPop((cur) => {
      if (cur?.key === key) return null;
      const r = el.getBoundingClientRect();
      const c = panel.getBoundingClientRect();
      const width = Math.min(POP_W, c.width - 16);
      const x = Math.max(8, Math.min(r.left - c.left, c.width - width - 8));
      const center = r.left + r.width / 2 - c.left - x;
      const caretX = Math.max(CARET_INSET, Math.min(center, width - CARET_INSET));
      const above = r.bottom + 190 > c.bottom && r.top - 190 > c.top;
      const y = above ? r.top - c.top - 9 : r.bottom - c.top + 9;
      return { key, doc, x, y, width, caretX, above };
    });
  }, []);

  const dismiss = useCallback(() => setPop(null), []);

  // An open explanation takes the first Escape; a capture-phase listener
  // runs before the Guide's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !popOpen.current) return;
      e.stopPropagation();
      setPop(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A different step's code starts with nothing open, at the top.
  useEffect(() => {
    setPop(null);
    setCurrent(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [codeRef]);

  // Which snippet is in view, for the chips.
  const onScroll = () => {
    dismiss();
    const el = scrollRef.current;
    if (!el || !many) return;
    const top = el.getBoundingClientRect().top + 56;
    let at = 0;
    el.querySelectorAll<HTMLElement>("[data-snippet]").forEach((s, i) => {
      if (s.getBoundingClientRect().top <= top) at = i;
    });
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) at = codeRef.snippets.length - 1;
    setCurrent(at);
  };

  const jumpTo = (i: number) => {
    const el = scrollRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-snippet="${i}"]`);
    if (!el || !target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 52,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <div ref={panelRef} className="relative flex flex-col min-h-0 h-full" onClick={dismiss}>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto info-modal-scroll px-4 pb-5" onScroll={onScroll}>
        <div className="guide-code-toolbar">
          {many ? (
            <nav className="guide-code-chips" aria-label="Snippets">
              {codeRef.snippets.map((spec, i) => (
                <button
                  key={i}
                  type="button"
                  aria-current={current === i ? "true" : undefined}
                  className="guide-code-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo(i);
                  }}
                >
                  {spec.symbol}
                </button>
              ))}
            </nav>
          ) : (
            <p className="guide-caption m-0 flex-1 min-w-0" style={{ fontFamily: mono, color: FAINT }}>
              Click an underlined name to see what it is.
            </p>
          )}
          <button
            type="button"
            className="guide-code-tool"
            aria-pressed={wrap}
            onClick={(e) => {
              e.stopPropagation();
              setWrap((w) => {
                writeWrap(!w);
                return !w;
              });
              setPop(null);
            }}
            title={wrap ? "Don't wrap long lines" : "Wrap long lines"}
          >
            <WrapText size={12} strokeWidth={1.75} />
            <span>Wrap</span>
          </button>
        </div>
        {many && (
          <p className="guide-caption m-0 mb-4" style={{ fontFamily: mono, color: FAINT }}>
            Click an underlined name to see what it is.
          </p>
        )}
        <div className={wrap ? "guide-code-wrap" : undefined}>
          {codeRef.snippets.map((spec, i) => (
            <SnippetView key={i} id={i} spec={spec} activeKey={pop?.key ?? null} onToggle={toggle} />
          ))}
        </div>
      </div>

      <div
        className="guide-caption shrink-0 px-4 py-2.5 border-t flex flex-wrap gap-x-4 gap-y-1"
        style={{ borderColor: "var(--color-border, rgba(74,71,69,0.25))", fontFamily: mono }}
      >
        {codeRef.links?.map((l) => (
          <ExternalLink key={l.href} href={l.href}>
            {l.label}
          </ExternalLink>
        ))}
        <ExternalLink href={REPO_URL}>The whole repo on GitHub</ExternalLink>
      </div>

      {pop && <DocPopover pop={pop} />}
    </div>
  );
}
