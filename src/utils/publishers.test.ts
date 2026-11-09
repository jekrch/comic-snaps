import { describe, expect, it } from "vitest";
import type { Publisher, Series } from "../types";
import {
  buildPublisherIndex,
  findPublisher,
  publisherKindLabel,
  publisherYears,
  resolveSeriesPublisher,
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
