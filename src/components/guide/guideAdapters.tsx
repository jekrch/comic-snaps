import type { ReactNode } from "react";
import { localStore, type RouteAdapter, type StorageAdapter } from "../../dimensional/core/adapters";
import type { SourceGroupDef } from "../../dimensional/react/DimDoc";
import type { TermDef } from "../../dimensional/react/context";
import { CONCEPTS } from "./concepts";
import { isPageId, pageDef, stepDef, type PageId } from "./lessons";
import { SOURCE_GROUPS, sourcesFor, type Source } from "./sources";
import {
  closeGuide,
  getGuideState,
  guideUrl,
  navigateGuide,
  recordGuideStep,
  subscribeGuideRoute,
} from "./useGuideRoute";

/**
 * What the Guide hands the dimensional framework (src/dimensional) so that
 * `DimDoc` can run it: its route, its storage, its terms and its sources,
 * each in the framework's shape and backed by what the Guide already had.
 */

/**
 * The Guide's route (`?guide=page#step`, one history entry) as a
 * `RouteAdapter`. Moving within the Guide replaces; closing pops the entry
 * the Guide pushed. The framework hears about a change only when it asks
 * for a jump (`scrollNonce`) or opens or closes the Guide: a new anchor, or
 * the address bar following the reader, never moves the page.
 */
export function guideRoute(): RouteAdapter {
  const asRoute = (page: string | null, step: string | null) =>
    page === null ? null : { page: (isPageId(page) ? page : "overview") as PageId, step, anchor: getGuideState().route?.anchor ?? null };
  return {
    read() {
      const r = getGuideState().route;
      return r ? { page: r.page, step: r.step } : { page: null, step: null };
    },
    write(next) {
      if (next.page === null) closeGuide();
      else navigateGuide({ page: next.page as PageId, step: next.step }, { scroll: false });
    },
    record(next) {
      recordGuideStep(next.step);
    },
    subscribe(onChange) {
      let nonce = getGuideState().scrollNonce;
      let open = !!getGuideState().route;
      return subscribeGuideRoute(() => {
        const s = getGuideState();
        if (s.scrollNonce === nonce && !!s.route === open) return;
        nonce = s.scrollNonce;
        open = !!s.route;
        onChange();
      });
    },
    href: (r) => guideUrl(location.pathname, location.search, asRoute(r.page, r.step)),
  };
}

const DEPTH_KEY = "comicSnaps.guide.depth";

/**
 * Whether lessons open at their Essentials, which they do until the reader
 * picks "In depth" on the lesson switch.
 */
export function essentialsPreferred(): boolean {
  try {
    return window.localStorage.getItem(DEPTH_KEY) !== JSON.stringify("in-depth");
  } catch {
    return true;
  }
}

/**
 * The Guide's per-viewer storage under the keys it has always used
 * (`comicSnaps.guide.positions`, `.finished`, `.depth`). The framework keeps
 * the depth as a level index; the Guide stores it by name.
 */
export function guideStorage(): StorageAdapter {
  const base = localStore("comicSnaps.guide");
  return {
    get<T>(key: string, fallback: T): T {
      if (key === "depth") return (essentialsPreferred() ? 0 : 1) as T;
      return base.get(key, fallback);
    },
    set(key, value) {
      if (key === "depth") base.set("depth", value === 0 ? "essentials" : "in-depth");
      else base.set(key, value);
    },
  };
}

/** Every concept, as the framework's terms: introduced at its lesson and step. */
export const GUIDE_TERMS: Record<string, TermDef> = Object.fromEntries(
  CONCEPTS.map((c) => {
    const home = pageDef(c.lesson);
    const step = stepDef(c.lesson, c.step);
    return [
      c.id,
      {
        label: c.label,
        body: c.short,
        page: c.lesson,
        section: c.step,
        pageLabel: home.label,
        sectionTitle: `${home.label}${step ? ` · ${step.short ?? step.title}` : ""}`,
      },
    ];
  }),
);

function SourceItem({ source: s }: { source: Source }): ReactNode {
  return (
    <>
      <p className="dd-source">
        {s.cite}.{" "}
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="dd-link">
          {s.title}
        </a>
        . <span className="dd-source-venue">{s.venue}</span>.
      </p>
      <p className="dd-source-note">{s.note}</p>
    </>
  );
}

/**
 * A lesson's reading list as the framework's source groups: beginner
 * explainers first, then the papers. Empty for pages without sources.
 */
export function guideSources(page: PageId): SourceGroupDef[] {
  const sources = sourcesFor(page);
  if (!sources) return [];
  return SOURCE_GROUPS.filter((g) => sources[g.key].length > 0).map((g) => ({
    id: g.id,
    title: g.title,
    short: g.short,
    items: sources[g.key].map((s) => <SourceItem key={s.url} source={s} />),
  }));
}
