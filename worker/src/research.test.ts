// research_description end to end against a scripted Gemini and a fake web:
// a sentence whose quote checks out is kept, one whose quote was invented is
// sent back once and then dropped, and only cited pages become references.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentParameters, GenerateContentResponse, Part } from "@google/genai";
import type { Env } from "./types";
import type { CollectionDocs } from "./rollup";

const generateContent = vi.fn<(req: GenerateContentParameters) => Promise<GenerateContentResponse>>();
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const { parseResearchCommand, parseSourceCommand, researchDescription, researchSources, resolveResearchKind } =
  await import("./research");
const { parseEditCommand } = await import("./edits");

const env = {
  GEMINI_API_KEY: "key",
  BOT_STATE: { get: async () => null, put: async () => {} },
} as unknown as Env;

const docs: CollectionDocs = {
  gallery: {
    panels: [
      {
        seq: 1, id: "a", title: "THB", slug: "thb", issue: 1, year: 1994, artist: "Paul Pope",
        image: "", notes: null, tags: [], postedBy: "j", addedAt: "",
      },
    ],
  },
  series: { series: [] },
  artists: {
    artists: [
      {
        id: "paul-pope",
        name: "Paul Pope",
        description: "Old text.",
        references: [{ name: "Metron", url: "https://metron.cloud/creator/9/" }],
      },
    ],
  },
  disambiguation: {},
};

const ARTICLE =
  "Paul Pope is an American cartoonist known for THB and Battling Boy. " +
  "Pope worked for the Japanese publisher Kodansha in the 1990s. ".repeat(3) +
  "Unrelated filler about the history of newsprint. ".repeat(10);
const OFF_TOPIC = "A page about gardening that never names the subject. ".repeat(10);
const pages: Record<string, { status: number; body: string }> = {
  "https://www.tcj.com/pope/": {
    status: 200,
    body: `<html><head><title>Paul Pope | The Comics Journal</title></head><body><article><p>${ARTICLE}</p></article></body></html>`,
  },
  "https://garden.example.com/": { status: 200, body: `<html><body><p>${OFF_TOPIC}</p></body></html>` },
  "https://blocked.example.com/": { status: 403, body: "" },
  "https://metron.cloud/creator/9/": { status: 200, body: `<html><body><p>${OFF_TOPIC}</p></body></html>` },
};
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const page = pages[url];
  if (!page) return new Response("missing", { status: 404 });
  return new Response(page.body, { status: page.status, headers: { "content-type": "text/html" } });
});

const json = (value: unknown) =>
  ({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(value) }] } }] }) as GenerateContentResponse;

const good = {
  text: "Paul Pope is an American cartoonist known for THB and Battling Boy.",
  citations: [{ source: 1, quote: "Paul Pope is an American cartoonist known for THB and Battling Boy" }],
};
const invented = {
  text: "He won three Eisner Awards.",
  citations: [{ source: 1, quote: "Pope won three Eisner Awards" }],
};

beforeEach(() => {
  generateContent.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("researchDescription", () => {
  it("keeps verified sentences, drops invented ones after one repair, and cites only what was used", async () => {
    generateContent
      // 1. search: grounding found three pages
      .mockResolvedValueOnce({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "summary" }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://garden.example.com/" } },
                { web: { uri: "https://www.tcj.com/pope/" } },
                { web: { uri: "https://www.amazon.com/dp/1" } },
              ],
            },
          },
        ],
      } as GenerateContentResponse)
      // 2. draft: one real quote, one invented
      .mockResolvedValueOnce(json({ paragraphs: [{ sentences: [good, invented] }], notes: "" }))
      // 3. fact-check of the sentence whose quote was found
      .mockResolvedValueOnce(json({ results: [{ id: 1, supported: true }] }))
      // 4. repair: the writer keeps the invented sentence
      .mockResolvedValueOnce(json({ paragraphs: [{ sentences: [good, invented] }], notes: "Awards unclear." }));

    const result = await researchDescription(env, docs, {
      kind: "artist",
      ref: "paul pope",
      instructions: "focus on his manga work",
      urls: ["https://blocked.example.com/"],
    });

    // Search, write, check, repair; the unchanged good sentence isn't re-checked.
    expect(generateContent).toHaveBeenCalledTimes(4);
    expect(generateContent.mock.calls[0][0].config?.tools).toEqual([{ googleSearch: {} }]);
    const brief = JSON.stringify(generateContent.mock.calls[1][0].contents);
    expect(brief).toContain("focus on his manga work");
    expect(brief).toContain("tcj.com/pope");
    expect(brief).not.toContain("gardening");
    expect(JSON.stringify(generateContent.mock.calls[3][0].contents)).toContain("isn't in source 1 word for word");
    // Amazon is never fetched; the user's link is, even though it fails.
    const fetched = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetched).toContain("https://blocked.example.com/");
    expect(fetched).not.toContain("https://www.amazon.com/dp/1");

    expect(result.key).toBe("artist:paul-pope");
    const proposal = result.proposal!;
    expect(parseEditCommand(proposal.command)).toEqual({
      verb: "describe",
      kind: "artist",
      ref: "paul-pope",
      paragraphs: [good.text],
      references: [{ name: "The Comics Journal", url: "https://www.tcj.com/pope/", title: "Paul Pope" }],
    });
    expect(proposal.display).toContain(`${good.text} [1]`);
    expect(proposal.display).toContain("Left out, couldn't verify:");
    expect(proposal.display).toContain("He won three Eisner Awards.");
    expect(proposal.display).toContain("https://blocked.example.com/ (HTTP 403)");
    expect(proposal.display).toContain("replaces the current 9-character one");
    expect(result.spend).toHaveLength(4);
  });

  it("drops a sentence the fact-check says overreaches its quote", async () => {
    const overreach = {
      text: "Pope worked for Kodansha for a decade.",
      citations: [{ source: 1, quote: "Pope worked for the Japanese publisher Kodansha in the 1990s" }],
    };
    generateContent
      .mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts: [{ text: "" }] } }] } as GenerateContentResponse)
      .mockResolvedValueOnce(json({ paragraphs: [{ sentences: [good] }, { sentences: [overreach] }], notes: "" }))
      .mockResolvedValueOnce(
        json({ results: [{ id: 1, supported: true }, { id: 2, supported: false, problem: "'a decade' isn't stated" }] })
      )
      .mockResolvedValueOnce(json({ paragraphs: [{ sentences: [good] }], notes: "" }));

    const result = await researchDescription(env, docs, {
      kind: "artist",
      ref: "Paul Pope",
      instructions: "",
      urls: ["https://www.tcj.com/pope/"],
    });
    expect(JSON.stringify(generateContent.mock.calls[3][0].contents)).toContain("'a decade' isn't stated");
    expect(parseEditCommand(result.proposal!.command)).toMatchObject({ paragraphs: [good.text] });
    expect(result.proposal!.display).not.toContain("Left out");
  });

  it("proposes nothing without readable sources, and says so", async () => {
    generateContent.mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts: [] as Part[] } }] } as GenerateContentResponse);
    const result = await researchDescription(env, docs, {
      kind: "artist",
      ref: "Paul Pope",
      instructions: "",
      urls: ["https://blocked.example.com/"],
    });
    expect(result.proposal).toBeNull();
    expect(result.toolResult).toContain("Couldn't find readable sources");
    expect(result.toolResult).toContain("HTTP 403");
  });

  it("refuses an entry that isn't in the data, without calling the model", async () => {
    const result = await researchDescription(env, docs, { kind: "series", ref: "thb", instructions: "", urls: [] });
    expect(result.proposal).toBeNull();
    expect(result.toolResult).toContain('No series matching "thb"');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("stops before the next model call once the run is abandoned", async () => {
    await expect(
      researchDescription(env, docs, { kind: "artist", ref: "Paul Pope", instructions: "", urls: [] }, () => false)
    ).rejects.toThrow(/abandoned/);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("researchSources", () => {
  const sourced: CollectionDocs = {
    ...docs,
    artists: {
      artists: [
        {
          id: "paul-pope",
          name: "Paul Pope",
          description: "Paul Pope is an American cartoonist.",
          references: [{ name: "The Comics Journal", url: "https://www.tcj.com/old/" }],
        },
      ],
    },
  };
  const searchHit = {
    candidates: [
      {
        content: { role: "model", parts: [{ text: "summary" }] },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: "https://www.tcj.com/old/" } },
            { web: { uri: "https://garden.example.com/" } },
            { web: { uri: "https://www.tcj.com/pope/" } },
            { web: { uri: "https://www.amazon.com/dp/1" } },
          ],
        },
      },
    ],
  } as GenerateContentResponse;

  it("adds the pages the picker chose, with its notes shown but not saved, and never touches the description", async () => {
    generateContent
      .mockResolvedValueOnce(searchHit)
      // Page 9 doesn't exist and page 1 is picked twice; both are ignored.
      .mockResolvedValueOnce(
        json({
          picks: [
            { source: 1, about: "Profile covering THB and his Kodansha years." },
            { source: 9, about: "made up" },
            { source: 1, about: "again" },
          ],
        })
      );

    const result = await researchSources(env, sourced, {
      kind: "artist",
      ref: "Paul Pope",
      instructions: "interviews",
      urls: [],
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[0][0].contents)).toContain("interviews");
    const brief = JSON.stringify(generateContent.mock.calls[1][0].contents);
    expect(brief).toContain("Paul Pope is an American cartoonist.");
    expect(brief).toContain("[1] Paul Pope | The Comics Journal");
    // The off-topic page never reaches the picker; a listed page is never fetched.
    expect(brief).not.toContain("gardening");
    const fetched = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetched).not.toContain("https://www.tcj.com/old/");
    expect(fetched).not.toContain("https://www.amazon.com/dp/1");

    expect(result.key).toBe("sources:artist:paul-pope");
    expect(parseEditCommand(result.proposal!.command)).toEqual({
      verb: "add_sources",
      kind: "artist",
      ref: "paul-pope",
      references: [{ name: "The Comics Journal", url: "https://www.tcj.com/pope/", title: "Paul Pope" }],
    });
    expect(result.proposal!.command).not.toContain("Kodansha");
    const display = result.proposal!.display!;
    expect(display).toContain("The description isn't changed");
    expect(display).toContain("https://www.tcj.com/pope/\n    Profile covering THB and his Kodansha years.");
    expect(display).toContain("Picked 1 of 1 new page(s) read.");
    expect(display).toContain("1 page(s) never named the subject");
    expect(result.message).toContain("Found 1 page(s) worth adding");
  });

  it("proposes nothing when the picker finds nothing worth adding", async () => {
    generateContent.mockResolvedValueOnce(searchHit).mockResolvedValueOnce(json({ picks: [] }));
    const result = await researchSources(env, sourced, { kind: "artist", ref: "Paul Pope", instructions: "", urls: [] });
    expect(result.proposal).toBeNull();
    expect(result.message).toContain("none looked worth adding");
  });

  it("always adds a page the user gave, says when one is already listed, and works without a description", async () => {
    const empty: CollectionDocs = {
      ...docs,
      artists: {
        artists: [
          { id: "paul-pope", name: "Paul Pope", description: "", references: [{ name: "Metron", url: "https://metron.cloud/creator/9/" }] },
        ],
      },
    };
    generateContent
      .mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts: [] as Part[] } }] } as GenerateContentResponse)
      .mockResolvedValueOnce(json({ picks: [] }));
    const result = await researchSources(env, empty, {
      kind: "artist",
      ref: "Paul Pope",
      instructions: "",
      urls: ["https://www.tcj.com/pope/", "https://metron.cloud/creator/9"],
    });
    expect(JSON.stringify(generateContent.mock.calls[1][0].contents)).not.toContain("already has");
    expect(parseEditCommand(result.proposal!.command)).toMatchObject({
      references: [{ url: "https://www.tcj.com/pope/" }],
    });
    expect(result.proposal!.display).toContain("https://metron.cloud/creator/9 (already in its sources)");
  });
});

describe("parseSourceCommand", () => {
  it("reads like /research, and isn't /research", () => {
    expect(parseSourceCommand("/source series saga https://a.example/x // interviews")).toEqual({
      kind: "series",
      ref: "saga",
      instructions: "interviews",
      urls: ["https://a.example/x"],
    });
    expect(parseSourceCommand("/research saga")).toBeNull();
    expect(parseSourceCommand("/sources saga")).toBeNull();
    expect(parseSourceCommand("/source")).toEqual({ error: expect.stringContaining("Usage: /source") });
  });
});

describe("parseResearchCommand", () => {
  it("isn't /research for other verbs", () => {
    expect(parseResearchCommand("/researcher x")).toBeNull();
    expect(parseResearchCommand("/ask research Paul Pope")).toBeNull();
  });

  it("takes a bare name, leaving the kind to the data", () => {
    expect(parseResearchCommand("/research Charles Burns")).toEqual({
      kind: null,
      ref: "Charles Burns",
      instructions: "",
      urls: [],
    });
  });

  it("takes a kind, directions after //, and URLs from anywhere", () => {
    expect(
      parseResearchCommand(
        "/research@comicbot Series saga https://a.example/saga // the publishing history, see https://b.example/x."
      )
    ).toEqual({
      kind: "series",
      ref: "saga",
      instructions: "the publishing history, see",
      urls: ["https://a.example/saga", "https://b.example/x"],
    });
  });

  it("answers with usage when there's no name", () => {
    for (const text of ["/research", "/research artist", "/research // focus on X"]) {
      expect(parseResearchCommand(text)).toEqual({ error: expect.stringContaining("Usage: /research") });
    }
  });
});

describe("resolveResearchKind", () => {
  const both: CollectionDocs = {
    ...docs,
    series: { series: [{ id: "paul-pope", name: "Paul Pope" } as CollectionDocs["series"]["series"][number]] },
  };

  it("finds the artist or series a bare name means", () => {
    expect(resolveResearchKind(docs, "paul pope")).toEqual({ kind: "artist" });
  });

  it("asks which, when the name is both, in the command that was used", () => {
    expect(resolveResearchKind(both, "Paul Pope")).toEqual({ error: expect.stringContaining("/research artist Paul Pope") });
    expect(resolveResearchKind(both, "Paul Pope", "source")).toEqual({ error: expect.stringContaining("/source artist Paul Pope") });
  });

  it("says when it's neither", () => {
    expect(resolveResearchKind(docs, "Moebius")).toEqual({ error: expect.stringContaining('No artist or series matching "Moebius"') });
  });
});
