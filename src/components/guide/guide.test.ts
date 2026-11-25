import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { makePanel } from "../../utils/testPanel";
import {
  ColorExplanation,
  ColorTldr,
  EmbeddingExplanation,
  EmbeddingTldr,
  PhashExplanation,
  PhashTldr,
  VectorsExplanation,
  VectorsTldr,
} from "../explainer/explanations";
import { CONCEPTS } from "./concepts";
import { Overview } from "./pages/Overview";
import { LessonSources } from "./LessonSources";
import { SOURCE_GROUPS, SOURCES, isSourceStep } from "./sources";
import { readingProgress } from "./useScrollSpy";
import { GuideContext, VariantContext, type GuideContextValue } from "./guideContext";
import { LESSONS, PAGES, lessonForMetric, neighbours, pageDef, stepNumber, type PageId } from "./lessons";
import { hasOverlays, isTopOverlay, popOverlay, pushOverlay, resetOverlays } from "./overlayStack";
import { isUsableAnchor, pickAnchor, specimenPool } from "./specimen";

const lab = (L: number, a: number, b: number): [number, number, number] => [L, a, b];

const anchor = makePanel({
  id: "anchor",
  title: "Anchor",
  phash: "a3c1e7f0a3c1e7f0",
  dominantColors: [lab(50, 20, 30), lab(80, 5, 10), lab(20, -5, -10)],
  colorfulness: 20,
});
const closest = makePanel({
  id: "closest",
  title: "Closest",
  phash: "a3c1e6f0a3c1e7f0",
  dominantColors: [lab(52, 22, 28), lab(78, 4, 9), lab(22, -4, -9)],
  colorfulness: 18,
});
const furthest = makePanel({
  id: "furthest",
  title: "Furthest",
  phash: "5c3e180f5c3e180f",
  dominantColors: [lab(30, -40, 10), lab(60, -20, -30), lab(10, 0, 0)],
  colorfulness: 25,
});

const specimen = {
  anchorPanel: anchor,
  closest: { panel: closest, distance: 0.12 },
  furthest: { panel: furthest, distance: 0.61 },
};

/** Each lesson's content, as the Guide renders it. */
const LESSON_BODIES: Partial<Record<PageId, () => ReactElement>> = {
  overview: () => createElement(Overview, { anchor, pool: [anchor, closest, furthest] }),
  color: () => createElement(ColorExplanation, specimen),
  phash: () => createElement(PhashExplanation),
  vectors: () => createElement(VectorsExplanation, specimen),
  siglip: () => createElement(EmbeddingExplanation, { metric: "embedding-siglip", ...specimen }),
  dino: () => createElement(EmbeddingExplanation, { metric: "embedding-dino", ...specimen }),
  gram: () => createElement(EmbeddingExplanation, { metric: "embedding-gram", ...specimen }),
};

/** Each lesson's short version, behind the TL;DR switch. */
const TLDR_BODIES: Partial<Record<PageId, () => ReactElement>> = {
  color: () => createElement(ColorTldr, specimen),
  phash: () => createElement(PhashTldr),
  vectors: () => createElement(VectorsTldr, specimen),
  siglip: () => createElement(EmbeddingTldr, { metric: "embedding-siglip", ...specimen }),
  dino: () => createElement(EmbeddingTldr, { metric: "embedding-dino", ...specimen }),
  gram: () => createElement(EmbeddingTldr, { metric: "embedding-gram", ...specimen }),
};

function guideCtx(page: PageId, desktop = true, extra: Partial<GuideContextValue> = {}): GuideContextValue {
  return {
    page,
    desktop,
    codeStep: null,
    openCode: () => {},
    goTo: () => {},
    copyStepLink: () => {},
    setStepShort: () => {},
    setAllShort: () => {},
    ...extra,
  };
}

function render(page: PageId, desktop = true, tldr = false): string {
  const body = (tldr ? TLDR_BODIES : LESSON_BODIES)[page]!;
  const tree = tldr ? createElement(VariantContext.Provider, { value: "short" }, body()) : body();
  return renderToStaticMarkup(createElement(GuideContext.Provider, { value: guideCtx(page, desktop) }, tree));
}

/**
 * Both versions mounted, as the Guide mounts them, with `short` steps
 * showing their short version. Without slots each Section renders in place,
 * so the short tree's steps come first.
 */
function renderMixed(page: PageId, short: (step: string) => boolean): string {
  const ctx = guideCtx(page, true, { stepShort: short });
  return renderToStaticMarkup(
    createElement(
      GuideContext.Provider,
      { value: ctx },
      createElement(VariantContext.Provider, { value: "short" }, TLDR_BODIES[page]!()),
      createElement(VariantContext.Provider, { value: "full" }, LESSON_BODIES[page]!())
    )
  );
}

function attrs(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]+)"`, "g"))].map((m) => m[1]);
}

describe("lesson steps", () => {
  for (const lesson of LESSONS) {
    it(`${lesson.id} renders exactly the steps the registry lists, in order`, () => {
      const html = render(lesson.id);
      expect(attrs(html, "data-step")).toEqual(lesson.steps.map((s) => s.id));
    });
  }

  it("numbers steps from the registry", () => {
    expect(stepNumber("siglip", "attention")).toBe(2);
    expect(stepNumber("gram", "arrows")).toBe(2);
    expect(stepNumber("gram", "attention")).toBe(0);
  });

  it("has unique step ids within each page", () => {
    for (const p of PAGES) expect(new Set(p.steps.map((s) => s.id)).size).toBe(p.steps.length);
  });

  it("walks the pages in rail order", () => {
    expect(neighbours("overview").prev).toBeNull();
    expect(neighbours("vectors").next?.id).toBe("siglip");
    expect(neighbours("glossary").next).toBeNull();
    expect(lessonForMetric("embedding-gram")).toBe("gram");
  });
});

describe("the short versions", () => {
  for (const lesson of LESSONS) {
    it(`${lesson.id} has one, with the full lesson's steps in order`, () => {
      expect(lesson.tldr, lesson.id).toBeDefined();
      expect(lesson.tldr!.minutes).toBeLessThan(lesson.minutes);
      const html = render(lesson.id, true, true);
      expect(attrs(html, "data-step")).toEqual(lesson.steps.map((s) => s.id));
    });
  }

  it("point each step at the full lesson instead of the code", () => {
    const html = render("color", true, true);
    expect(html).toContain("guide-more-btn");
    expect(html).not.toContain("&lt;/&gt; code");
  });

  it("can be mixed step by step: each step shows exactly one version", () => {
    for (const lesson of LESSONS) {
      const full = new Set([lesson.steps[0].id, lesson.steps[lesson.steps.length - 1].id]);
      const html = renderMixed(lesson.id, (step) => !full.has(step));
      const steps = attrs(html, "data-step");
      expect([...steps].sort(), lesson.id).toEqual(lesson.steps.map((s) => s.id).sort());
      // The short steps open in full; the full ones fold back.
      expect(html.match(/guide-more-btn" aria-expanded="false"/g)?.length, lesson.id).toBe(lesson.steps.length - full.size);
      expect(html.match(/guide-more-btn" aria-expanded="true"/g)?.length, lesson.id).toBe(full.size);
    }
  });

  it("refer to terms without defining them, so the full lesson stays their home", () => {
    for (const lesson of LESSONS) {
      const html = render(lesson.id, true, true);
      expect(attrs(html, "data-term-unknown"), lesson.id).toEqual([]);
      expect(attrs(html, "data-term-define"), lesson.id).toEqual([]);
    }
  });

  it("leave the overview and the glossary without one", () => {
    expect(pageDef("overview").tldr).toBeUndefined();
    expect(pageDef("glossary").tldr).toBeUndefined();
  });
});

describe("terms", () => {
  it("are introduced at a step that exists", () => {
    for (const c of CONCEPTS) {
      expect(pageDef(c.lesson).steps.some((s) => s.id === c.step), `${c.id} → ${c.lesson}#${c.step}`).toBe(true);
    }
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(CONCEPTS.length);
  });

  /** The pages whose text introduces terms: the lessons, and the overview for ideas they all use. */
  const TERM_PAGES: PageId[] = ["overview", ...LESSONS.map((l) => l.id)];

  it("are all spelt right in the lessons", () => {
    for (const page of TERM_PAGES) {
      expect(attrs(render(page), "data-term-unknown"), page).toEqual([]);
    }
  });

  // CLS and the scratch patches are introduced in figure text that loads
  // with the patch examples, so they can't be seen in a static render.
  const DEFINED_IN_LOADED_TEXT = new Set(["cls", "scratch"]);

  it("are each defined once, at home", () => {
    const defined = new Map<string, number>();
    for (const page of TERM_PAGES) {
      for (const id of attrs(render(page), "data-term-define")) {
        const c = CONCEPTS.find((x) => x.id === id)!;
        expect(c.lesson, id).toBe(page);
        defined.set(id, (defined.get(id) ?? 0) + 1);
      }
    }
    for (const c of CONCEPTS) {
      if (DEFINED_IN_LOADED_TEXT.has(c.id)) continue;
      expect(defined.get(c.id), c.id).toBe(1);
    }
  });

  it("put the definition beside the term on wide screens, behind a toggle on phones", () => {
    expect(render("vectors", true)).toContain("guide-sidenote");
    const phone = render("vectors", false);
    expect(phone).not.toContain("guide-sidenote");
    expect(phone).toContain("guide-note-toggle");
  });
});

describe("sources", () => {
  it("are listed for every lesson, beginner explainers and papers both, each linked and saying what it's for", () => {
    for (const lesson of LESSONS) {
      const groups = SOURCES[lesson.id as keyof typeof SOURCES];
      expect(groups.start.length, `${lesson.id} start`).toBeGreaterThanOrEqual(2);
      expect(groups.papers.length, `${lesson.id} papers`).toBeGreaterThanOrEqual(2);
      const all = [...groups.start, ...groups.papers];
      expect(new Set(all.map((s) => s.url)).size, lesson.id).toBe(all.length);
      for (const s of all) {
        expect(s.url, s.title).toMatch(/^https:\/\//);
        for (const field of [s.cite, s.title, s.venue, s.note]) expect(field.trim(), s.title).not.toBe("");
      }
    }
  });

  it("have anchors no lesson step uses, so the rail and the scroll spy can tell them apart", () => {
    for (const p of PAGES) for (const st of p.steps) expect(isSourceStep(st.id), `${p.id}#${st.id}`).toBe(false);
    for (const g of SOURCE_GROUPS) expect(isSourceStep(g.id)).toBe(true);
  });

  it("render as two groups at the end of a lesson, marked as the end of the reading", () => {
    const html = renderToStaticMarkup(createElement(LessonSources, { page: "phash" }));
    expect(html.match(/<li>/g)?.length).toBe(SOURCES.phash.start.length + SOURCES.phash.papers.length);
    expect(attrs(html, "data-step")).toEqual(SOURCE_GROUPS.map((g) => g.id));
    expect(html).toContain("data-progress-end");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(renderToStaticMarkup(createElement(LessonSources, { page: "overview" }))).toBe("");
    expect(renderToStaticMarkup(createElement(LessonSources, { page: "glossary" }))).toBe("");
  });
});

describe("reading progress", () => {
  it("runs to the bottom of the page when nothing marks the end", () => {
    expect(readingProgress(0, 2000, null, 800)).toBe(0);
    expect(readingProgress(1000, 2000, null, 800)).toBe(0.5);
    expect(readingProgress(2000, 2000, null, 800)).toBe(1);
  });

  it("is full once the sources reach the bottom of the view, and they don't add to it", () => {
    // Sources start 2400px down; with an 800px view, they're in sight at 1600.
    expect(readingProgress(800, 3000, 2400, 800)).toBe(0.5);
    expect(readingProgress(1600, 3000, 2400, 800)).toBe(1);
    expect(readingProgress(3000, 3000, 2400, 800)).toBe(1);
  });

  it("counts a page whose reading fits in one view as read", () => {
    expect(readingProgress(0, 0, null, 800)).toBe(1);
    expect(readingProgress(0, 400, 300, 800)).toBe(0);
    expect(readingProgress(10, 400, 300, 800)).toBe(1);
  });
});

describe("the overlay stack", () => {
  afterEach(resetOverlays);

  it("gives Escape to whatever opened last", () => {
    pushOverlay("guide");
    pushOverlay("figure");
    expect(isTopOverlay("figure")).toBe(true);
    expect(isTopOverlay("guide")).toBe(false);
    popOverlay("figure");
    expect(isTopOverlay("guide")).toBe(true);
  });

  it("tells the app's own layers when anything is over them", () => {
    expect(hasOverlays()).toBe(false);
    pushOverlay("guide");
    expect(hasOverlays()).toBe(true);
    popOverlay("guide");
    popOverlay("guide");
    expect(hasOverlays()).toBe(false);
  });

  it("moves a re-pushed entry to the top", () => {
    pushOverlay("a");
    pushOverlay("b");
    pushOverlay("a");
    expect(isTopOverlay("a")).toBe(true);
  });
});

describe("the worked example", () => {
  const panels = Array.from({ length: 30 }, (_, i) =>
    makePanel({ id: `p${i}`, phash: "ff00ff00ff00ff00", dominantColors: [lab(50, 0, 0)] })
  );

  it("leaves out excluded panels, covers and portraits", () => {
    const pool = specimenPool([
      ...panels.slice(0, 3),
      makePanel({ id: "hyde-street-10-1772390798" }),
      makePanel({ id: "c", cover: true }),
      makePanel({ id: "q", portrait: true }),
    ]);
    expect(pool.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("draws from the first half of the pool", () => {
    for (let i = 0; i < 20; i++) {
      const pick = pickAnchor(panels, [], null, () => i / 20)!;
      expect(Number(pick.id.slice(1))).toBeLessThan(15);
    }
  });

  it("doesn't draw the current anchor again on a shuffle", () => {
    const pick = pickAnchor(panels.slice(0, 3), [], "p0", () => 0)!;
    expect(pick.id).not.toBe("p0");
  });

  it("only draws panels every loaded model has a vector for", () => {
    const map = { p3: [1, 0], p4: [0, 1] };
    expect(isUsableAnchor(panels[3], [map])).toBe(true);
    expect(isUsableAnchor(panels[0], [map])).toBe(false);
    expect(isUsableAnchor(panels[0], [null])).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(["p3", "p4"]).toContain(pickAnchor(panels, [map], null, () => i / 10)!.id);
    }
  });
});
