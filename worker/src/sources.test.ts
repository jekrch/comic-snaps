import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  findQuote,
  htmlToText,
  isSkippedSource,
  normalizeWithMap,
  quoteContext,
  referenceFor,
} from "./sources";

const PAGE = `<!doctype html><html><head><title>Paul Pope interview | The Comics Journal</title>
<meta property="og:site_name" content="The Comics Journal"><script>var x = "<p>nope</p>";</script></head>
<body><nav><a href="/">Home</a> Menu Menu</nav>
<article><h1>Paul Pope</h1><p>Paul Pope is an American cartoonist&nbsp;from Philadelphia.[3]</p>
<p>He drew <em>THB</em> and <i>Battling Boy</i> &mdash; and won Eisner Awards.</p>${"<p>Filler sentence about comics.</p>".repeat(20)}</article>
<footer>Copyright</footer></body></html>`;

describe("htmlToText", () => {
  it("keeps the article's text and drops scripts, navigation and citation marks", () => {
    const out = htmlToText(PAGE);
    expect(out.title).toBe("Paul Pope interview | The Comics Journal");
    expect(out.siteName).toBe("The Comics Journal");
    expect(out.text).toContain("Paul Pope is an American cartoonist from Philadelphia.");
    expect(out.text).toContain("He drew THB and Battling Boy — and won Eisner Awards.");
    expect(out.text).not.toMatch(/nope|Menu|Copyright|\[3\]/);
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("Moebius &amp; Jodorowsky&#8217;s &#x201C;Incal&#x201D; &bogus;")).toBe(
      "Moebius & Jodorowsky’s “Incal” &bogus;"
    );
  });
});

describe("findQuote", () => {
  const text = "Javier Rodríguez drew it. Absolute Martian Manhunter — written by Deniz Camp — began in 2025.";
  const index = normalizeWithMap(text);

  it("ignores case, punctuation, dashes and diacritics", () => {
    const m = findQuote(index, "absolute martian manhunter, written by deniz camp");
    expect(m && text.slice(m.start, m.end)).toBe("Absolute Martian Manhunter — written by Deniz Camp");
    expect(findQuote(index, "Javier Rodriguez drew it")).not.toBeNull();
  });

  it("joins pieces around an ellipsis only in order", () => {
    expect(findQuote(index, "Absolute Martian Manhunter ... began in 2025")).not.toBeNull();
    expect(findQuote(index, "began in 2025 ... Absolute Martian Manhunter")).toBeNull();
  });

  it("rejects invented words, partial words and quotes too short to pin a claim", () => {
    expect(findQuote(index, "written by Deniz Camp and Jeff Lemire")).toBeNull();
    expect(findQuote(index, "olute Martian Manhunter")).toBeNull();
    expect(findQuote(index, "in 2025")).toBeNull();
  });

  it("gives the surrounding text for the fact-check", () => {
    const m = findQuote(index, "written by Deniz Camp")!;
    expect(quoteContext(text, m, 10)).toBe("…nhunter — written by Deniz Camp — began i…");
  });
});

describe("referenceFor and isSkippedSource", () => {
  const doc = (url: string, title: string, siteName: string | null = null) => ({ url, title, siteName, text: "" });

  it("names references the way the data files do", () => {
    expect(referenceFor(doc("https://en.wikipedia.org/wiki/Paul_Pope", "Paul Pope"), "Paul Pope")).toEqual({
      name: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Paul_Pope",
    });
    expect(referenceFor(doc("https://en.wikipedia.org/wiki/Vertigo", "Vertigo Comics"), "Paul Pope").name).toBe(
      "Wikipedia: Vertigo Comics"
    );
    expect(referenceFor(doc("https://fr.wikipedia.org/wiki/Moebius", "Moebius"), "Moebius").name).toBe("Wikipedia (FR)");
    expect(referenceFor(doc("https://www.lambiek.net/artists/p/pope.htm", "Paul Pope"), "Paul Pope")).toEqual({
      name: "Comiclopedia",
      url: "https://www.lambiek.net/artists/p/pope.htm",
    });
    expect(referenceFor(doc("https://www.tcj.com/pope/", "Paul Pope interview | The Comics Journal"), "Paul Pope")).toEqual({
      name: "The Comics Journal",
      url: "https://www.tcj.com/pope/",
      title: "Paul Pope interview",
    });
    expect(referenceFor(doc("https://blog.example.org/p", "On Pope", "Example Blog"), "Paul Pope")).toEqual({
      name: "Example Blog",
      url: "https://blog.example.org/p",
      title: "On Pope",
    });
  });

  it("skips shops, social media and fan wikis", () => {
    expect(isSkippedSource("https://www.amazon.co.uk/dp/1")).toBe(true);
    expect(isSkippedSource("https://dc.fandom.com/wiki/X")).toBe(true);
    expect(isSkippedSource("https://x.com/someone")).toBe(true);
    expect(isSkippedSource("https://www.tcj.com/x")).toBe(false);
    expect(isSkippedSource("https://box.com/x")).toBe(false);
    expect(isSkippedSource("not a url")).toBe(true);
  });
});
