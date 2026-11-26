import { useCallback, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  DimDoc,
  localStore,
  markdownPage,
  parseDimensional,
  queryRoute,
  useDocState,
  type FigureProps,
  type FigureRegistry,
  type Host,
  type LinkTarget,
  type RailState,
} from "@jekrch/dimensional-docs";
import "@jekrch/dimensional-docs/styles.css";
import {
  BitsFigure,
  DistanceRanges,
  ExampleFigure,
  GridFigure,
  HammingFigure,
  LumaFigure,
  PairFigure,
  PatternFigure,
  usePhashExamples,
} from "../explainer/PhashFigures";
import type { PhashExample, PhashExamples } from "../explainer/phashExamples";

/**
 * The framework's proving ground: the dimensional docs in `docs/` (the 0.4
 * spec, the portable and framework proposals, and the pHash lesson as a
 * dimensional document) rendered through `@jekrch/dimensional-docs`, on a hidden
 * route. `?dd` opens it in page mode; `&dd-host=overlay` slides it over the
 * gallery, `&dd-host=embedded` sets it inline in a stand-in host's layout
 * (a sticky header and its own nav, the page scrolling), and
 * `&dd-host=embedded&dd-scroll=pane` in an app shell whose content pane
 * scrolls instead.
 *
 * `docs/` is untracked, so a build without it (CI) has no documents and
 * says so.
 */

const SOURCES = import.meta.glob<string>(["/docs/dimensional-docs.md", "/docs/dimensional-docs/*.md"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Reading order, and the rail's label for each. */
const ORDER: { file: string; id: string; label: string }[] = [
  { file: "/docs/dimensional-docs.md", id: "spec", label: "The format" },
  { file: "/docs/dimensional-docs/portable.md", id: "portable", label: "Portable docs" },
  { file: "/docs/dimensional-docs/framework.md", id: "framework", label: "Dimensional UI" },
  { file: "/docs/dimensional-docs/phash.md", id: "phash", label: "Perceptual hash" },
];

const BASE = import.meta.env.BASE_URL;
/** The collection's fallback level names; each document's legend names its own. */
const LEVELS = ["Overview", "Explanation", "Reference"];

/** `../../public/data/x.jpg`, as written beside the docs, to where the app serves it. */
function resolveUrl(src: string): string {
  if (/^[a-z]+:/i.test(src) || src.startsWith("/")) return src;
  const path = src.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
  return path.startsWith("public/") ? `${BASE}${path.slice("public/".length)}` : `${BASE}${path}`;
}

function resolveLink(href: string): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href };
  const [file, hash] = href.split("#");
  const name = file.split("/").pop() ?? "";
  const page = ORDER.find((o) => o.file.endsWith(`/${name}`));
  return page && name.endsWith(".md") ? { page: page.id, step: hash ?? null } : null;
}

// --- The pHash lesson's figures, registered by the names phash.md gives them -----

/** Which example pair the figures follow, shared by every section and depth. */
const EXAMPLE_KEY = "phash.example";

function phashFigure(render: (e: PhashExample, d: PhashExamples) => ReactNode): ComponentType<FigureProps> {
  return function PhashFigure() {
    const data = usePhashExamples();
    const [index, setIndex] = useDocState(EXAMPLE_KEY, 0);
    return (
      <ExampleFigure data={data} index={index} onPick={setIndex}>
        {render}
      </ExampleFigure>
    );
  };
}

const FIGURES: FigureRegistry = {
  "phash-pair": phashFigure((e) => <PairFigure example={e} />),
  "phash-luma": phashFigure((e) => <LumaFigure example={e} />),
  "phash-grid": phashFigure((e) => <GridFigure example={e} />),
  "phash-patterns": phashFigure((e) => <PatternFigure example={e} />),
  "phash-bits": phashFigure((e) => <BitsFigure example={e} />),
  "phash-hamming": phashFigure((e) => <HammingFigure example={e} />),
  "phash-ranges": phashFigure((e, d) => <DistanceRanges stats={d.stats} example={e} />),
};

// --- The preview ----------------------------------------------------------------------

export type PreviewMode = "page" | "overlay" | "embedded";

/** The stand-in host's sticky header, which the document's jumps stop under. */
const HOST_HEAD_H = 45;

export default function DimensionalPreview({ mode, onExited }: { mode: PreviewMode; onExited?: () => void }) {
  const route = useMemo(() => queryRoute("dd"), []);
  const storage = useMemo(() => localStore("comicSnaps.dd"), []);
  const docs = useMemo(
    () => ORDER.filter((o) => SOURCES[o.file]).map((o) => ({ ...o, doc: parseDimensional(SOURCES[o.file]) })),
    [],
  );
  // Built once: the pages are the same elements on every render, so the
  // document doesn't redo its terms and pages when the host re-renders.
  const pages = useMemo(
    () => docs.map((d) => markdownPage(d.doc, { id: d.id, label: d.label, resolveUrl, resolveLink })),
    [docs],
  );
  const [rail, setRail] = useState<RailState | null>(null);
  const sidebar = useCallback((s: RailState) => setRail(s), []);
  const pane = useMemo(() => new URLSearchParams(location.search).get("dd-scroll") === "pane", []);

  const host = useMemo<Host>(() => {
    if (mode === "overlay") {
      return {
        mode: "overlay",
        appLayers: () => {
          const app = document.getElementById("root")?.firstElementChild;
          return app ? (Array.from(app.children) as HTMLElement[]) : [];
        },
        onExited,
      };
    }
    // In the app shell the header sits above the scrolling pane, not over it.
    if (mode === "embedded") return { mode: "embedded", sidebar, top: pane ? 0 : HOST_HEAD_H };
    return { mode: "page" };
  }, [mode, onExited, sidebar, pane]);

  if (docs.length === 0) {
    return (
      <p style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" }}>
        No dimensional documents in this build: docs/dimensional-docs is untracked.
      </p>
    );
  }

  const doc = (
    <DimDoc
      title="Dimensional docs"
      subtitle="Drafts, rendered"
      levels={LEVELS}
      route={route}
      storage={storage}
      host={host}
      figures={FIGURES}
      glossary="Glossary"
      back={{ label: "Gallery", onClick: () => location.assign(BASE) }}
    >
      {pages}
    </DimDoc>
  );

  if (mode !== "embedded") return doc;

  // A stand-in host: its own sticky header and nav, with the document's rail
  // handed to the nav and the document inline in the content column.
  const go = (e: React.MouseEvent, page: string, step?: string) => {
    e.preventDefault();
    rail?.onGo(page, step);
  };
  return (
    <div className={`dd-host-demo${pane ? " is-pane" : ""}`}>
      <header className="dd-host-demo-head">Host site · embedded mode{pane ? " · scrolling pane" : ""}</header>
      <div className="dd-host-demo-cols">
        <nav className="dd-host-demo-side" aria-label="Host sidebar">
          {rail?.pages.map((p) => (
            <a
              key={p.id}
              href={rail.href(p.id)}
              className={p.id === rail.page ? "is-page" : undefined}
              onClick={(e) => go(e, p.id)}
            >
              {p.label}
              {rail.finished.has(p.id) ? " ✓" : ""}
            </a>
          ))}
          <hr />
          {rail?.sections.map((s) => (
            <a
              key={s.id}
              href={rail.href(rail.page, s.id)}
              className={s.id === rail.step ? "is-current" : undefined}
              onClick={(e) => go(e, rail.page, s.id)}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <main className="dd-host-demo-main">{doc}</main>
      </div>
      <style>{`
        .dd-host-demo { min-height: 100vh; background: #f4f1ec; color: #222; font-family: system-ui, sans-serif; }
        .dd-host-demo-head { position: sticky; top: 0; z-index: 10; height: ${HOST_HEAD_H}px; box-sizing: border-box; padding: 14px 24px; border-bottom: 1px solid #ddd; background: #f4f1ec; font-size: 13px; color: #555; }
        .dd-host-demo-cols { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 32px; padding: 24px; }
        .dd-host-demo-side { position: sticky; top: ${HOST_HEAD_H + 24}px; align-self: start; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
        .dd-host-demo-side a { color: #555; text-decoration: none; }
        .dd-host-demo-side a.is-page { color: #222; font-weight: 600; }
        .dd-host-demo-side a.is-current { color: #c44d2f; }
        .dd-host-demo-side hr { border: 0; border-top: 1px solid #ddd; margin: 6px 0; }
        .dd-host-demo.is-pane { height: 100vh; min-height: 0; display: flex; flex-direction: column; }
        .dd-host-demo.is-pane .dd-host-demo-cols { flex: 1; min-height: 0; padding: 0 0 0 24px; }
        .dd-host-demo.is-pane .dd-host-demo-side { top: 0; padding-top: 24px; }
        .dd-host-demo.is-pane .dd-host-demo-main { overflow-y: auto; padding: 24px 24px 0 0; }
        .dd-host-demo-main .dd-root {
          --dd-bg: #fffdf9; --dd-surface: #f6f2ec; --dd-pop-bg: #fff; --dd-pop-foot-bg: #f7f3ee;
          --dd-ink: #1d1b19; --dd-ink-prose: #2b2825; --dd-ink-muted: #5d5853; --dd-ink-faint: #8a847e;
          --dd-border: rgba(0,0,0,0.12); --dd-line: rgba(0,0,0,0.1);
          --dd-code-bg: #f3efe9; --dd-code-ink: #3b3733; --dd-mono-bg: rgba(0,0,0,0.05); --dd-mono-ink: #3b3733;
          padding: 24px 32px; border-radius: 8px;
        }
        @media (max-width: 900px) { .dd-host-demo-cols { grid-template-columns: 1fr; } .dd-host-demo-side { display: none; } }
      `}</style>
    </div>
  );
}
