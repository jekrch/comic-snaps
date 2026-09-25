import { describe, expect, it } from "vitest";
import { buildNetwork, buildWorksIndex, foldName, worksWithAll } from "./collaborations";
import type { Artist, IssueCredits, Series } from "../types";
import { makePanel } from "./testPanel";

function issue(series: string, n: number, credits: [string, string[]][]): IssueCredits {
  return {
    id: `${series}-${n}`,
    series,
    issue: n,
    credits: credits.map(([name, roles]) => ({ artistId: null, name, roles })),
  };
}

function series(over: Partial<Series> & { id: string }): Series {
  return { name: over.id, parentSeries: null, description: "", references: [], ...over };
}

function artist(name: string, aliases: string[]): Artist {
  return { id: name, name, description: "", references: [], aliases };
}

describe("foldName", () => {
  it("folds case, accents and punctuation", () => {
    expect(foldName("Álvaro Martínez Bueno")).toBe(foldName("alvaro martinez bueno"));
    expect(foldName("C. B. Cebulski")).toBe("c b cebulski");
  });
});

describe("buildNetwork", () => {
  const panels = [
    makePanel({ id: "a", slug: "saga", title: "Saga", issue: 1, year: 2012, artist: "Fiona Staples" }),
    makePanel({ id: "b", slug: "saga", title: "Saga", issue: 1, year: 2012, artist: "Fiona Staples" }),
    makePanel({ id: "c", slug: "saga", title: "Saga", issue: 2, year: 2012, artist: "Fiona Staples" }),
    makePanel({ id: "d", slug: "paper", title: "Paper Girls", issue: 1, year: 2015, artist: "Cliff Chiang" }),
  ];
  const issues = [
    issue("saga", 1, [
      ["Brian K. Vaughan", ["Writer"]],
      ["Fonografiks", ["Letterer", "Designer"]],
      ["Eric Stephenson", ["Publisher"]],
      ["Somebody", ["Cover"]],
    ]),
    issue("saga", 2, [["Brian K. Vaughan", ["Writer"]]]),
    issue("paper", 1, [
      ["Brian K. Vaughan", ["Writer"]],
      ["Matt Wilson", ["Colorist"]],
      ["Jared K. Fletcher", ["Letterer"]],
    ]),
  ];

  it("connects only creative roles, counting each shared issue once", () => {
    const net = buildNetwork(buildWorksIndex(panels, issues, [], []), "Brian K. Vaughan");
    expect(net.works.map((w) => w.key)).toEqual(["saga|1", "saga|2", "paper|1"]);
    const names = Object.fromEntries(net.collaborators.map((c) => [c.name, c.shared]));
    expect(names).toEqual({ "Fiona Staples": 2, "Cliff Chiang": 1, "Matt Wilson": 1, Fonografiks: 1, "Jared K. Fletcher": 1 });
  });

  it("orders collaborators by family, then by how much they share", () => {
    const net = buildNetwork(buildWorksIndex(panels, issues, [], []), "Brian K. Vaughan");
    expect(net.collaborators.map((c) => c.family)).toEqual(["art", "art", "color", "letters", "letters"]);
    expect(net.collaborators[0].name).toBe("Fiona Staples");
  });

  it("merges accent and alias spellings into one person", () => {
    const net = buildNetwork(
      buildWorksIndex(
        [makePanel({ slug: "x", issue: 1, artist: "Alvaro Martinez Bueno" })],
        [issue("x", 1, [["Álvaro Martínez Bueno", ["Artist"]], ["Al Feldstein", ["Writer"]]])],
        [],
        [artist("Albert Feldstein", ["Al Feldstein"])],
      ),
      "Albert Feldstein",
    );
    expect(net.collaborators).toHaveLength(1);
    expect(net.collaborators[0].roles).toEqual(["Artist"]);
    // The wall's spelling wins, since the profile and filters match on it.
    expect(net.collaborators[0].name).toBe("Alvaro Martinez Bueno");
  });

  it("ignores issue credits on an anthology", () => {
    const net = buildNetwork(
      buildWorksIndex(
        [makePanel({ slug: "heavy-metal", issue: 1, artist: "Moebius" })],
        [issue("heavy-metal", 1, [["Richard Corben", ["Artist"]]])],
        [series({ id: "heavy-metal", anthology: true })],
        [],
      ),
      "Moebius",
    );
    expect(net.works).toHaveLength(0);
    expect(net.collaborators).toHaveLength(0);
  });

  it("ties two collaborators who share work the centre isn't on", () => {
    const net = buildNetwork(
      buildWorksIndex(
        [
          makePanel({ id: "1", slug: "x", issue: 1, artist: "A" }),
          makePanel({ id: "2", slug: "y", issue: 1, artist: "A" }),
        ],
        [issue("x", 1, [["Self", ["Writer"]], ["B", ["Colorist"]]]), issue("y", 1, [["B", ["Colorist"]]])],
        [],
        [],
      ),
      "Self",
    );
    expect(net.ties).toEqual([{ a: "a", b: "b", elsewhere: 1 }]);
  });

  it("narrows to the works every selected collaborator is on", () => {
    const index = buildWorksIndex(panels, issues, [], []);
    const net = buildNetwork(index, "Brian K. Vaughan");
    const key = index.keyOf;
    expect(worksWithAll(net, [key("Fiona Staples")]).map((w) => w.key)).toEqual(["saga|1", "saga|2"]);
    expect(worksWithAll(net, [key("Fiona Staples"), key("Fonografiks")]).map((w) => w.key)).toEqual(["saga|1"]);
    expect(worksWithAll(net, [key("Fiona Staples"), key("Matt Wilson")])).toEqual([]);
  });
});
