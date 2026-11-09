import type { Publisher, Series } from "../types";

export interface PublisherIndex {
  byId: Map<string, Publisher>;
  /** Lowercased names and aliases. */
  byName: Map<string, Publisher>;
  /** Each publisher's imprints, by the parent's id. */
  imprintsOf: Map<string, Publisher[]>;
}

export const EMPTY_PUBLISHER_INDEX: PublisherIndex = {
  byId: new Map(),
  byName: new Map(),
  imprintsOf: new Map(),
};

export function buildPublisherIndex(publishers: Publisher[]): PublisherIndex {
  const byId = new Map<string, Publisher>();
  const byName = new Map<string, Publisher>();
  const imprintsOf = new Map<string, Publisher[]>();
  for (const p of publishers) {
    byId.set(p.id, p);
    for (const name of [p.name, ...(p.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, p);
    }
  }
  for (const p of publishers) {
    if (p.kind !== "imprint" || !p.parent) continue;
    const list = imprintsOf.get(p.parent);
    if (list) list.push(p);
    else imprintsOf.set(p.parent, [p]);
  }
  return { byId, byName, imprintsOf };
}

/** Find a registry entry by its display name or one of its aliases. */
export function findPublisher(index: PublisherIndex, name: string | null | undefined): Publisher | null {
  if (!name) return null;
  return index.byName.get(name.toLowerCase()) ?? null;
}

export interface SeriesPublisher {
  /** The parent publisher's display name. */
  publisher: string | null;
  imprint: string | null;
  /** The registry entries, when the series is linked to them. */
  publisherEntry: Publisher | null;
  imprintEntry: Publisher | null;
}

const NO_PUBLISHER: SeriesPublisher = {
  publisher: null,
  imprint: null,
  publisherEntry: null,
  imprintEntry: null,
};

/** Some old pipeline runs left a comics.org API URL in the publisher field. */
const usable = (name: string | null | undefined): string | null =>
  name && !/^https?:\/\//.test(name) ? name : null;

/**
 * Who published a series. A child series with no publisher of its own takes
 * its parent's. The display name comes from the registry when the series is
 * linked, so a renamed publisher reads the same everywhere, and falls back to
 * the series' own string when it isn't.
 */
export function resolveSeriesPublisher(
  series: Series | null | undefined,
  parent: Series | null | undefined,
  index: PublisherIndex,
): SeriesPublisher {
  const own = series && (series.publisherId || usable(series.publisher)) ? series : null;
  const source = own ?? (parent && (parent.publisherId || usable(parent.publisher)) ? parent : null);
  if (!source) return NO_PUBLISHER;

  const publisherEntry =
    (source.publisherId ? index.byId.get(source.publisherId) : undefined) ??
    findPublisher(index, usable(source.publisher));
  const imprintEntry =
    (source.imprintId ? index.byId.get(source.imprintId) : undefined) ??
    findPublisher(index, source.imprint);

  return {
    publisher: publisherEntry?.name ?? usable(source.publisher),
    imprint: imprintEntry?.name ?? source.imprint ?? null,
    publisherEntry: publisherEntry ?? null,
    imprintEntry: imprintEntry ?? null,
  };
}

/**
 * The years line for a publisher: "Founded 1976", or the span of its books
 * when that is all there is ("1969–1999", "1986–"). Null when neither is known.
 */
export function publisherYears(p: Publisher): string | null {
  if (p.foundedYear) {
    if (p.activeUntil) return `${p.foundedYear}–${p.activeUntil}`;
    return `Founded ${p.foundedYear}`;
  }
  if (p.activeFrom) {
    if (p.activeUntil === p.activeFrom) return String(p.activeFrom);
    return `${p.activeFrom}–${p.activeUntil ?? ""}`;
  }
  return null;
}

/** What kind of label this is, for the small caps over its name. */
export function publisherKindLabel(p: Publisher, index: PublisherIndex): string {
  if (p.kind === "imprint") {
    const parent = p.parent ? index.byId.get(p.parent) : null;
    return parent ? `Imprint of ${parent.name}` : "Imprint";
  }
  if (p.kind === "self-published") return "Self-published";
  return "Publisher";
}
