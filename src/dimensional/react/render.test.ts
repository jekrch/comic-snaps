import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { memoryRoute } from "../core/adapters";
import { parseDimensional } from "../parse/parse";
import { DimDoc, Page } from "./DimDoc";
import { markdownPage } from "./Markdown";
import { Layer, Section } from "./Section";
import { Term } from "./Term";

/**
 * Server rendering, without a DOM: what a docs site would send before
 * scripts load. Effects don't run, so sections haven't registered and the
 * rail is empty; the page, its sections at the default depth, and the
 * prose must all be there.
 */
function render(children: React.ReactNode, page = "") {
  return renderToStaticMarkup(
    createElement(DimDoc, { title: "Docs", levels: ["Essentials", "In depth"], route: memoryRoute({ page, step: null }), children }),
  );
}

describe("DimDoc on the server", () => {
  it("renders a page's sections at the first level, with their switches", () => {
    const html = render(
      createElement(
        Page,
        { id: "a", title: "A page", gist: "The gist." },
        createElement(
          Section,
          { id: "one", title: "The first section says one thing", code: { title: "f", body: "code" } },
          createElement(Layer, null, "Short ", createElement(Term, { id: "x", first: true }, "word"), "."),
          createElement(Layer, null, "Long."),
        ),
      ),
    );
    expect(html).toContain("A page");
    expect(html).toContain("The gist.");
    expect(html).toContain("The first section says one thing");
    expect(html).toContain("Short ");
    expect(html).not.toContain("Long.");
    expect(html).toContain("In depth");
    expect(html).toContain("&lt;/&gt; code");
    // An undefined term still renders its words, marked.
    expect(html).toContain('data-term-unknown="x"');
  });

  it("shows the route's page", () => {
    const pages = [createElement(Page, { key: "a", id: "a", title: "Alpha" }), createElement(Page, { key: "b", id: "b", title: "Beta" })];
    expect(render(pages, "b")).toContain("<h1 class=\"dd-title\">Beta</h1>");
    expect(render(pages, "nope")).toContain("<h1 class=\"dd-title\">Alpha</h1>");
  });
});

const PHASH = "docs/dimensional-docs/phash.md";
describe.runIf(existsSync(PHASH))("phash.md through markdownPage", () => {
  const doc = parseDimensional(readFileSync(PHASH, "utf8"));
  const html = render(markdownPage(doc, { id: "phash", resolveUrl: (s) => `/x/${s.split("/").pop()}` }), "phash");

  it("renders every section heading, the L1 prose and the sources", () => {
    for (const s of doc.sections) expect(html).toContain(s.heading);
    expect(html).toContain("Start here");
    expect(html).toContain("Hamming (1950)");
  });

  it("shows figure fallbacks with resolved images, and terms as definitions", () => {
    expect(html).toContain('data-figure="phash-pair"');
    expect(html).toContain('src="/x/bijou-funnies-6-1792968043-before.jpg"');
    expect(html).toContain('data-term-define="hamming"');
    expect(html).toContain("Numbers as of 2026-11-23");
  });
});
