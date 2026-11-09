import { describe, expect, it } from "vitest";
import type { Panel, Publisher, Series } from "../types";
import {
  buildPublisherIndex,
  findPublisher,
  panelsByDecade,
  publisherKindLabel,
  publisherLogoFor,
  publisherYears,
  resolveSeriesPublisher,
  wallTimeline,
  yearSpan,
} from "./publishers";

function pub(over: Partial<Publisher> & { id: string; name: string }): Publisher {
  return {
    kind: "publisher",
    parent: null,
    aliases: [],
    description: "",
    imageUrl: null,
    references: [],
    ids: {},
    ...over,
  };
}

function series(over: Partial<Series> & { id: string }): Series {
  return { name: over.id, parentSeries: null, description: "", references: [], ...over };
}

const dc = pub({ id: "dc-comics", name: "DC Comics", aliases: ["DC"] });
const vertigo = pub({ id: "vertigo", name: "Vertigo", kind: "imprint", parent: "dc-comics" });
const index = buildPublisherIndex([dc, vertigo]);

describe("buildPublisherIndex", () => {
  it("finds an entry by name or alias, ignoring case", () => {
    expect(findPublisher(index, "dc")).toBe(dc);
    expect(findPublisher(index, "VERTIGO")).toBe(vertigo);
    expect(findPublisher(index, "Marvel")).toBeNull();
  });

  it("lists a publisher's imprints", () => {
    expect(index.imprintsOf.get("dc-comics")).toEqual([vertigo]);
  });
});

describe("resolveSeriesPublisher", () => {
  it("takes the registry's names for linked ids", () => {
    const s = series({ id: "sandman", publisher: "DC", publisherId: "dc-comics", imprintId: "vertigo" });
    const out = resolveSeriesPublisher(s, null, index);
    expect(out.publisher).toBe("DC Comics");
    expect(out.imprint).toBe("Vertigo");
    expect(out.imprintEntry).toBe(vertigo);
  });

  it("falls back to the series' own string when it isn't in the registry", () => {
    const out = resolveSeriesPublisher(series({ id: "x", publisher: "Tiny Press" }), null, index);
    expect(out.publisher).toBe("Tiny Press");
    expect(out.publisherEntry).toBeNull();
  });

  it("borrows a parent series' publisher when the child has none", () => {
    const parent = series({ id: "p", publisherId: "dc-comics" });
    const child = series({ id: "c", parentSeries: "p" });
    expect(resolveSeriesPublisher(child, parent, index).publisher).toBe("DC Comics");
  });

  it("ignores a URL left in the publisher field", () => {
    const s = series({ id: "x", publisher: "https://www.comics.org/api/publisher/54/" });
    expect(resolveSeriesPublisher(s, null, index).publisher).toBeNull();
  });
});

describe("publisherYears", () => {
  it("prefers the founding year", () => {
    expect(publisherYears(pub({ id: "f", name: "F", foundedYear: 1976, activeFrom: 1972 }))).toBe("Founded 1976");
  });

  it("falls back to the span of its books", () => {
    expect(publisherYears(pub({ id: "k", name: "K", activeFrom: 1969, activeUntil: 1999 }))).toBe("1969–1999");
    expect(publisherYears(pub({ id: "d", name: "D", activeFrom: 1986, activeUntil: null }))).toBe("1986–");
    expect(publisherYears(pub({ id: "y", name: "Y", activeFrom: 1971, activeUntil: 1971 }))).toBe("1971");
    expect(publisherYears(pub({ id: "n", name: "N" }))).toBeNull();
  });
});

describe("publisherKindLabel", () => {
  it("names an imprint's parent", () => {
    expect(publisherKindLabel(vertigo, index)).toBe("Imprint of DC Comics");
    expect(publisherKindLabel(dc, index)).toBe("Publisher");
    expect(publisherKindLabel(pub({ id: "s", name: "S", kind: "self-published" }), index)).toBe("Self-published");
  });
});

describe("publisherLogoFor", () => {
  const marks = pub({
    id: "dc-comics",
    name: "DC Comics",
    logos: [
      { url: "bullet", from: 1977, until: 2005 },
      { url: "circle", from: 2016, until: 2024 },
      { url: "bullet-again", from: 2024 },
    ],
  });

  it("picks the logo whose span covers the year", () => {
    expect(publisherLogoFor(marks, 1986)?.url).toBe("bullet");
    expect(publisherLogoFor(marks, 2019)?.url).toBe("circle");
    expect(publisherLogoFor(marks, 2026)?.url).toBe("bullet-again");
  });

  it("gives the newer logo the year two spans share", () => {
    expect(publisherLogoFor(marks, 2024)?.url).toBe("bullet-again");
  });

  it("is null in a gap, before the first, or with no year or logos", () => {
    expect(publisherLogoFor(marks, 2010)).toBeNull();
    expect(publisherLogoFor(marks, 1950)).toBeNull();
    expect(publisherLogoFor(marks, 0)).toBeNull();
    expect(publisherLogoFor(dc, 1986)).toBeNull();
  });

  it("treats a missing start as open", () => {
    const idw = pub({ id: "idw", name: "IDW", logos: [{ url: "old", until: 2024 }, { url: "new", from: 2024 }] });
    expect(publisherLogoFor(idw, 2001)?.url).toBe("old");
    expect(publisherLogoFor(idw, 2025)?.url).toBe("new");
  });
});

describe("yearSpan", () => {
  it("reads both ends, one end, or neither", () => {
    expect(yearSpan(1977, 2005)).toBe("1977–2005");
    expect(yearSpan(2016, null)).toBe("since 2016");
    expect(yearSpan(null, 2020)).toBe("until 2020");
    expect(yearSpan(1975, 1975)).toBe("1975");
    expect(yearSpan(null, undefined)).toBe("");
  });
});

describe("panelsByDecade", () => {
  const panel = (id: string, year: number) => ({ id, year }) as Panel;

  it("fills empty decades between the first and last and sorts within each", () => {
    const rows = panelsByDecade([panel("a", 1999), panel("b", 1971), panel("c", 1992), panel("d", 0)]);
    expect(rows.map((r) => r.decade)).toEqual([1970, 1980, 1990]);
    expect(rows.map((r) => r.panels.map((p) => p.id))).toEqual([["b"], [], ["c", "a"]]);
  });

  it("is empty when no panel is dated", () => {
    expect(panelsByDecade([panel("a", 0)])).toEqual([]);
  });
});

describe("wallTimeline", () => {
  const panel = (publisher: string, imprint?: string) => ({ publisher, imprint }) as Panel;
  const withEvents = [
    pub({ id: "dc-comics", name: "DC Comics", events: [{ year: 1938, text: "Superman" }, { year: 1993, text: "Vertigo" }] }),
    pub({
      id: "vertigo",
      name: "Vertigo",
      kind: "imprint",
      parent: "dc-comics",
      events: [{ year: 1993, text: "Launch" }, { year: 1993, text: "Sandman moves" }],
    }),
    pub({ id: "absent", name: "Absent", events: [{ year: 1950, text: "Not on the wall" }] }),
  ];

  it("keeps only houses with panels, publishers and imprints alike, in year order", () => {
    const out = wallTimeline([panel("DC Comics", "Vertigo")], withEvents);
    expect(out.map((e) => `${e.year} ${e.publisher}: ${e.text}`)).toEqual([
      "1938 DC Comics: Superman",
      "1993 DC Comics: Vertigo",
      "1993 Vertigo: Launch",
      "1993 Vertigo: Sandman moves",
    ]);
  });

  it("is empty when nothing on the wall has events", () => {
    expect(wallTimeline([panel("Absent2")], withEvents)).toEqual([]);
  });
});
