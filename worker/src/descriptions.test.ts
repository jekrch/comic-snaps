import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  buildAddSourcesCommand,
  buildDescribeCommand,
  mergeReferences,
  parseAddSourcesArgs,
  parseDescribeArgs,
  urlKey,
} from "./descriptions";
import { parseEditCommand } from "./edits";

describe("/describe_* command text", () => {
  it("round-trips paragraphs and sources through build and parse", () => {
    const command = buildDescribeCommand(
      "series",
      "100",
      ["100% is a miniseries by Paul Pope.", "Set in 2038 New York."],
      [
        { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/100%25_(comics)" },
        { name: "The Comics Journal", url: "https://www.tcj.com/x/", title: "Pope | an interview" },
      ]
    );
    expect(command).toContain("/describe_series 100\n100% is");
    expect(command).toContain("- The Comics Journal | https://www.tcj.com/x/ | Pope - an interview");
    expect(parseEditCommand(command)).toEqual({
      verb: "describe",
      kind: "series",
      ref: "100",
      paragraphs: ["100% is a miniseries by Paul Pope.", "Set in 2038 New York."],
      references: [
        { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/100%25_(comics)" },
        { name: "The Comics Journal", url: "https://www.tcj.com/x/", title: "Pope - an interview" },
      ],
    });
  });

  it("joins a paragraph's wrapped lines and needs no sources when typed", () => {
    const out = parseEditCommand("/describe_artist Jean Giraud\nA French\nartist.\n\nAlso Moebius.");
    expect(out).toMatchObject({ kind: "artist", ref: "Jean Giraud", paragraphs: ["A French artist.", "Also Moebius."], references: [] });
  });

  it("keeps a 'Sources:' line that isn't followed by source lines as prose", () => {
    const out = parseDescribeArgs("series", "saga\nSources:\nsay it began in 2012.");
    expect(out).toMatchObject({ paragraphs: ["Sources: say it began in 2012."], references: [] });
  });

  it("explains what's wrong with a bad command", () => {
    expect(parseDescribeArgs("series", "")).toHaveProperty("error");
    expect(parseDescribeArgs("series", "saga")).toMatchObject({ error: expect.stringContaining("No description") });
    expect(parseDescribeArgs("series", "saga\nText.\nSources:\n- Wikipedia | not-a-url")).toMatchObject({
      error: expect.stringContaining("Can't read source line"),
    });
    expect(parseDescribeArgs("series", `saga\n${"x".repeat(MAX_DESCRIPTION_CHARS + 1)}`)).toMatchObject({
      error: expect.stringContaining("limit"),
    });
  });
});

describe("/add_sources_* command text", () => {
  const refs = [
    { name: "Toons Mag", url: "https://www.toonsmag.com/charles-burns/", title: "Charles Burns | the artist" },
    { name: "Grand Comics Database", url: "https://www.comics.org/creator/2064/" },
  ];

  it("round-trips sources through build and parse, keeping a | out of the title", () => {
    const text = buildAddSourcesCommand("artist", "charles-burns", refs);
    expect(text).toBe(
      "/add_sources_artist charles-burns\n" +
        "- Toons Mag | https://www.toonsmag.com/charles-burns/ | Charles Burns - the artist\n" +
        "- Grand Comics Database | https://www.comics.org/creator/2064/"
    );
    expect(parseEditCommand(text)).toEqual({
      verb: "add_sources",
      kind: "artist",
      ref: "charles-burns",
      references: [{ ...refs[0], title: "Charles Burns - the artist" }, refs[1]],
    });
  });

  it("takes a typed Sources: header and blank lines", () => {
    expect(parseAddSourcesArgs("series", "saga\n\nSources:\n- Wikipedia | https://en.wikipedia.org/wiki/Saga_(comics)")).toEqual({
      verb: "add_sources",
      kind: "series",
      ref: "saga",
      references: [{ name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Saga_(comics)" }],
    });
  });

  it("explains what's wrong with a bad command", () => {
    expect(parseAddSourcesArgs("artist", "")).toEqual({ error: expect.stringContaining("Missing artist reference") });
    expect(parseAddSourcesArgs("artist", "charles-burns")).toEqual({ error: expect.stringContaining("No sources given") });
    expect(parseAddSourcesArgs("artist", "charles-burns\nsome prose")).toEqual({
      error: expect.stringContaining('Can\'t read source line "some prose"'),
    });
    expect(parseAddSourcesArgs("artist", "charles-burns\n- TCJ | not a url")).toEqual({
      error: expect.stringContaining("Can't read source line"),
    });
  });
});

describe("references", () => {
  it("treats scheme, www, case of host, trailing slash, fragment and escapes as the same page", () => {
    expect(urlKey("https://www.TCJ.com/a-b/#top")).toBe(urlKey("http://tcj.com/a-b"));
    expect(urlKey("https://en.wikipedia.org/wiki/100%25_(comics)")).toBe(urlKey("https://en.wikipedia.org/wiki/100%_(comics)"));
    expect(urlKey("https://x.com/Page")).not.toBe(urlKey("https://x.com/page"));
  });

  it("appends only the pages not already referenced", () => {
    const existing = [{ name: "Metron", url: "https://metron.cloud/series/1/" }];
    const added = mergeReferences(existing, [
      { name: "Metron", url: "https://metron.cloud/series/1" },
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Saga" },
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Saga#History" },
    ]);
    expect(added).toBe(1);
    expect(existing.map((r) => r.name)).toEqual(["Metron", "Wikipedia"]);
  });
});
