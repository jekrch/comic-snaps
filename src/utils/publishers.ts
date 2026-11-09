import type { Panel, Publisher, PublisherLogo, Series } from "../types";

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

/**
 * The mark a publisher used in a given year: the logo whose span covers it,
 * the most recently introduced one where spans meet (a 2005 book gets the
 * logo that arrived in 2005). Null when the year is unknown or falls outside
 * every span, so callers fall back to `imageUrl`.
 */
export function publisherLogoFor(p: Publisher | null | undefined, year: number | null | undefined): PublisherLogo | null {
  if (!p?.logos?.length || !year) return null;
  let best: PublisherLogo | null = null;
  for (const logo of p.logos) {
    if ((logo.from ?? -Infinity) > year || (logo.until ?? Infinity) < year) continue;
    if (!best || (logo.from ?? -Infinity) >= (best.from ?? -Infinity)) best = logo;
  }
  return best;
}

/** "1977–2005", "since 2016", "until 2020", or "" when neither end is known. */
export function yearSpan(from: number | null | undefined, until: number | null | undefined): string {
  if (from && until) return from === until ? String(from) : `${from}–${until}`;
  if (from) return `since ${from}`;
  if (until) return `until ${until}`;
  return "";
}

export interface DecadeCount {
  decade: number;
  panels: Panel[];
}

/**
 * A publisher's panels by decade, every decade from the first to the last
 * filled in, so a gap reads as a gap rather than closing up.
 */
export function panelsByDecade(panels: Panel[]): DecadeCount[] {
  const byDecade = new Map<number, Panel[]>();
  for (const p of panels) {
    if (!(p.year > 0)) continue;
    const d = Math.floor(p.year / 10) * 10;
    const list = byDecade.get(d);
    if (list) list.push(p);
    else byDecade.set(d, [p]);
  }
  if (byDecade.size === 0) return [];
  const decades = [...byDecade.keys()];
  const out: DecadeCount[] = [];
  for (let d = Math.min(...decades); d <= Math.max(...decades); d += 10) {
    const list = byDecade.get(d) ?? [];
    list.sort((a, b) => a.year - b.year);
    out.push({ decade: d, panels: list });
  }
  return out;
}

export interface WallEvent {
  year: number;
  text: string;
  /** The house's display name, which the gallery's publisher filter takes. */
  publisher: string;
}

/**
 * Every milestone of every house with a panel on the wall (a publisher or an
 * imprint), in one chronology: by year, then by house, each house's own
 * order kept within a year.
 */
export function wallTimeline(panels: Panel[], publishers: Publisher[]): WallEvent[] {
  const onWall = new Set<string>();
  for (const p of panels) {
    if (p.publisher) onWall.add(p.publisher);
    if (p.imprint) onWall.add(p.imprint);
  }
  const out: WallEvent[] = [];
  for (const pub of publishers) {
    if (!onWall.has(pub.name)) continue;
    for (const e of pub.events ?? []) out.push({ year: e.year, text: e.text, publisher: pub.name });
  }
  // Array.prototype.sort is stable, so a house's same-year events keep their order.
  return out.sort((a, b) => a.year - b.year || a.publisher.localeCompare(b.publisher));
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
