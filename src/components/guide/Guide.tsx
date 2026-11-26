import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Panel } from "../../types";
import { peekEmbeddings } from "../../utils/sorting";
import { DimDoc, Page, type SlotState } from "@jekrch/dimensional-docs";
import "@jekrch/dimensional-docs/styles.css";
import { METRIC_INFO } from "../explainer/explainerConstants";
import { ColorExplanation, EmbeddingExplanation, PhashExplanation, VectorsExplanation } from "../explainer/explanations";
import type { MetricKey } from "../graph/similarityConfig";
import { freezeApp, isGuideCovering, releaseGuideCover } from "./appBehind";
import { GUIDE_TERMS, guideRoute, guideSources, guideStorage } from "./guideAdapters";
import { GuideContext } from "./guideContext";
import { GUIDE_NAME, GUIDE_SUBTITLE, LESSONS, PAGES, type PageDef, type PageId } from "./lessons";
import { GUIDE_Z } from "./overlayStack";
import { Glossary } from "./pages/Glossary";
import { Overview } from "./pages/Overview";
import { AnchorPicker, SpecimenBar } from "./SpecimenBar";
import { EMBEDDING_METRICS, isEmbeddingMetric, pickAnchor, specimenPool, useSpecimen } from "./specimen";
import { IS_IOS, closeGuide, navigateGuide, type GuideState } from "./useGuideRoute";

/**
 * The Guide: the gallery's lessons as a dimensional document
 * (@jekrch/dimensional-docs), sliding over the app in overlay mode. `DimDoc` runs the
 * shell: the slide, the rail, the depth switches and the glide, terms, code
 * beside the prose, keys and history. What stays here is the gallery's part:
 * the worked example (the anchor panel, its strip and picker), the pages
 * from the lesson registry, and the button that sorts the gallery.
 */

/** At and above this width: rail, reading column and margin side by side. */
const DESKTOP_MIN = 1100;

/** Short page ledes, for the pages that aren't one of the five methods. */
const LEDES: Partial<Record<PageId, string>> = {
  vectors:
    "The idea the three neural-network lessons rest on: a model turns each panel into a list of numbers, and two panels are compared by the angle between their lists.",
  glossary: "Every term the lessons define, with a link back to where it's introduced.",
};

/** The lede past the Essentials: the method's one-liner, a page's own, or none. */
function ledeFor(p: PageDef): string | null {
  return p.metric ? METRIC_INFO[p.metric].oneLiner : (LEDES[p.id] ?? null);
}

export interface GuideProps {
  panels: Panel[];
  state: GuideState;
  onExited: () => void;
  /** Applies a sort to the gallery; absent when the Guide can't hand one back (over the viewer). */
  onSortBy?: (metric: MetricKey) => void;
}

export default function Guide({ panels, state, onExited, onSortBy }: GuideProps) {
  const { route } = state;
  // While leaving, keep showing the page that was open.
  const lastRoute = useRef(route);
  if (route) lastRoute.current = route;
  const r = route ?? lastRoute.current ?? { page: "overview" as PageId, step: null, anchor: null };

  // The framework's adapters onto the Guide's own route and storage, made once.
  const [adapters] = useState(() => ({ route: guideRoute(), storage: guideStorage() }));
  // Opened from a link, with nothing to slide over: the sheet's contents land
  // in a sequence instead. Decided once, as the Guide mounts.
  const [landing] = useState(isGuideCovering);
  // A cold load kept the app hidden until now; once `DimDoc` has frozen it
  // (its layout effect runs first), it's the Guide's to manage.
  useLayoutEffect(() => releaseGuideCover(), []);

  // --- The worked example -------------------------------------------------

  const pool = useMemo(() => specimenPool(panels), [panels]);
  const anchor = useMemo(() => (r.anchor ? pool.find((p) => p.id === r.anchor) ?? null : null), [pool, r.anchor]);
  const open = route !== null;

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

  const page = PAGES.find((p) => p.id === r.page) ?? PAGES[0];
  const specimenMetric: MetricKey | undefined = page.ownExample
    ? undefined
    : page.metric ?? (r.page === "vectors" ? "embedding-siglip" : undefined);
  const status = useSpecimen(anchor, pool, specimenMetric);
  const methodName = specimenMetric ? METRIC_INFO[specimenMetric].name : null;
  const contentReady =
    r.page === "overview" || r.page === "glossary" || !!page.ownExample || (anchor !== null && status.kind !== "loading");

  // --- The current page's content -------------------------------------------

  // Memoized: the masthead's progress and the rail re-render with every
  // scroll frame, and the lesson underneath has no reason to. Each step
  // holds its Essentials and In depth layers and shows the one it's set to.
  const body = useMemo((): React.ReactNode => {
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

  // Every page from the registry; only the current one carries its content.
  const pages = useMemo(
    () =>
      PAGES.map((p) => (
        <Page
          key={p.id}
          id={p.id}
          title={p.title}
          label={p.label}
          eyebrow={p.family}
          gist={p.essentials?.gist}
          lede={ledeFor(p)}
          minutes={p.id === "glossary" ? undefined : p.essentials ? [p.essentials.minutes, p.minutes] : [p.minutes]}
          buildsOn={p.buildsOn}
          sources={guideSources(p.id)}
          ready={p.id === r.page ? contentReady : true}
          apart={p.id === "glossary"}
          inSequence={LESSONS.some((l) => l.id === p.id)}
        >
          {p.id === r.page ? body : null}
        </Page>
      )),
    [r.page, contentReady, body],
  );

  // --- The gallery's slots ------------------------------------------------------

  // The worked example: a strip under the masthead on phones (tucked away
  // while scrolling down), the top of the margin on wide screens.
  const specimen = (s: SlotState) =>
    page.ownExample ? null : (
      <SpecimenBar
        anchor={anchor}
        status={status}
        metric={specimenMetric}
        methodName={methodName}
        compact={!s.desktop}
        hidden={!s.desktop && s.spy.down && s.spy.scrollTop > 160}
        onShuffle={shuffle}
        onPick={() => setPicking(true)}
      />
    );

  const sortable = !!onSortBy && !!page.metric && contentReady;
  const shuffleAnchor = page.ownExample ? undefined : shuffle;
  const guideCtx = useMemo(() => ({ shuffleAnchor }), [shuffleAnchor]);

  return (
    <GuideContext.Provider value={guideCtx}>
      <DimDoc
        title={GUIDE_NAME}
        subtitle={GUIDE_SUBTITLE}
        levels={LEVELS}
        route={adapters.route}
        storage={adapters.storage}
        terms={GUIDE_TERMS}
        desktopMin={DESKTOP_MIN}
        sectionNoun="Step"
        revealSelector=".guide-glossary-entry"
        host={{
          mode: "overlay",
          appLayers: () => [],
          behind: freezeApp,
          zIndex: GUIDE_Z,
          instant: state.instant,
          landing,
          swipe: !IS_IOS,
          backLabel: "Gallery",
          onClose: () => closeGuide(),
          onExited,
        }}
        slots={{
          belowMasthead: specimen,
          marginTop: specimen,
          endOfPage: () =>
            sortable &&
            page.metric && (
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
            ),
          layer: () =>
            picking && (
              <AnchorPicker
                pool={pool}
                current={anchor?.id ?? null}
                onPick={(id) => {
                  setPicking(false);
                  navigateGuide({ anchor: id }, { scroll: false });
                }}
                onClose={() => setPicking(false)}
              />
            ),
        }}
        endNote={({ pressed, deepen }) => (
          <p className="dd-end-note">
            {pressed === 0 ? "Those are the essentials." : "Some steps show only their essentials."}{" "}
            <button type="button" className="dd-link" onClick={deepen}>
              Read the whole {r.page === "overview" ? "page" : "lesson"} in depth
            </button>
          </p>
        )}
      >
        {pages}
      </DimDoc>
    </GuideContext.Provider>
  );
}

const LEVELS = ["Essentials", "In depth"];
