import type { Owner, OwnershipLink, Publisher } from "../types";
import type { PublisherIndex } from "./publishers";
import { publisherLogoFor, yearSpan } from "./publishers";

/** owners.json, indexed: each company by id, and who holds each registry house. */
export interface OwnershipIndex {
  byId: Map<string, Owner>;
  /** The owner directly above a registry house, and how it holds it. */
  heldBy: Map<string, { owner: Owner; link: OwnershipLink }>;
}

export const EMPTY_OWNERSHIP_INDEX: OwnershipIndex = { byId: new Map(), heldBy: new Map() };

export function buildOwnershipIndex(owners: Owner[]): OwnershipIndex {
  const byId = new Map<string, Owner>();
  const heldBy = new Map<string, { owner: Owner; link: OwnershipLink }>();
  for (const o of owners) {
    byId.set(o.id, o);
    for (const link of o.publishers ?? []) {
      if (!heldBy.has(link.id)) heldBy.set(link.id, { owner: o, link });
    }
  }
  return { byId, heldBy };
}

/**
 * One rung of the ladder from the top of a house's ownership down to the
 * house itself: a company from owners.json, or a registry house (the page's
 * own, or the publisher an imprint belongs to).
 */
export interface OwnershipStep {
  key: string;
  owner: Owner | null;
  publisher: Publisher | null;
  /** How the step above holds this one. Null at the top, and for an imprint,
   *  which simply belongs to its publisher. */
  link: OwnershipLink | null;
  /** Other houses in the registry under this step, off the line down to the
   *  page's own: what else on the wall shares this owner. Empty on the last step. */
  siblings: Publisher[];
}

type Rung = Omit<OwnershipStep, "siblings">;

/** Top first: owners, then the house's publisher if it is an imprint, then the house. */
function ladder(publisher: Publisher, publishers: PublisherIndex, ownership: OwnershipIndex): Rung[] {
  const houses: Publisher[] = [publisher];
  const seen = new Set([publisher.id]);
  let top = publisher;
  // An imprint with an owner of its own (a studio publishing through a house,
  // like Skybound at Image) stops there rather than taking the house's.
  while (top.kind === "imprint" && top.parent && !ownership.heldBy.has(top.id)) {
    const parent = publishers.byId.get(top.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    houses.unshift(parent);
    top = parent;
  }
  const rungs: Rung[] = houses.map((p) => ({ key: `p:${p.id}`, owner: null, publisher: p, link: null }));

  const held = ownership.heldBy.get(top.id);
  if (!held) return rungs;
  rungs[0].link = held.link;

  const owners: Rung[] = [];
  const seenOwners = new Set<string>();
  let o: Owner | undefined = held.owner;
  while (o && !seenOwners.has(o.id)) {
    seenOwners.add(o.id);
    const parent: Owner | undefined = o.parent ? ownership.byId.get(o.parent) : undefined;
    owners.unshift({ key: `o:${o.id}`, owner: o, publisher: null, link: parent ? o : null });
    o = parent;
  }
  return [...owners, ...rungs];
}

/**
 * The chain of ownership above a house, top first and ending at the house,
 * with the other registry houses each rung also holds. Null when nothing in
 * owners.json sits above it — an independent, or an imprint of one.
 */
export function ownershipChain(
  publisher: Publisher,
  publishers: PublisherIndex,
  ownership: OwnershipIndex,
): OwnershipStep[] | null {
  const chain = ladder(publisher, publishers, ownership);
  if (!chain.some((r) => r.owner)) return null;

  const onChain = new Set(chain.map((r) => r.key));
  const paths = [...publishers.byId.values()]
    .filter((p) => !onChain.has(`p:${p.id}`))
    .map((p) => ({ publisher: p, keys: new Set(ladder(p, publishers, ownership).map((r) => r.key)) }));

  return chain.map((rung, i): OwnershipStep => {
    const next = chain[i + 1];
    if (!next) return { ...rung, siblings: [] };
    const under = paths.filter(({ keys }) => keys.has(rung.key) && !keys.has(next.key)).map((x) => x.publisher);
    // An imprint is reached through its publisher, so it isn't listed beside it.
    const ids = new Set(under.map((p) => p.id));
    const siblings = under
      .filter((p) => !(p.kind === "imprint" && p.parent && ids.has(p.parent)))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...rung, siblings };
  });
}

/**
 * The people behind an independent house, which carry a `status`
 * ("Independent", "Self-published") or a `people` list. A family controlling
 * a corporate chain (the Ellisons over Skydance, the Jonases over IDW) is not
 * one of these: it is the chain's owner, and the badge names it.
 */
export function isIndependentOwner(o: Owner): boolean {
  return !!o.status || !!o.people?.length;
}

/** The ownership type of a house with a company anywhere above it. */
export const CORPORATE_OWNERSHIP = "Corporate-owned";

/**
 * What kind of ownership a house is under, for the filter: the people-owner's
 * `status` ("Independent", "Partner-owned", "Self-published"…) when people
 * own it outright, "Corporate-owned" when a company sits anywhere above it
 * (a family controlling the company included), or null when owners.json
 * says nothing about it.
 */
export function ownershipType(
  house: Publisher,
  publishers: PublisherIndex,
  ownership: OwnershipIndex,
): string | null {
  const rungs = ladder(house, publishers, ownership);
  const top = rungs[0].owner;
  if (!top) return null;
  if (top.status) return top.status;
  return rungs.some((r) => r.owner && !isIndependentOwner(r.owner)) ? CORPORATE_OWNERSHIP : null;
}

/**
 * The company at the very top of a corporate-owned house's chain, a family
 * controlling it included ("Larry Ellison" over DC, "The Walt Disney Company"
 * over Marvel), for the ownership filter's rows under "Corporate-owned". Null
 * for any house that isn't corporate-owned.
 */
export function topCorporateOwner(
  house: Publisher,
  publishers: PublisherIndex,
  ownership: OwnershipIndex,
): string | null {
  if (ownershipType(house, publishers, ownership) !== CORPORATE_OWNERSHIP) return null;
  return ladder(house, publishers, ownership)[0].owner?.name ?? null;
}

/** What the wall's owner badge says for one panel. */
export interface OwnerBadge {
  /** The house the panel came out under: its imprint, or its publisher. */
  house: Publisher;
  /**
   * The top of the chain, a family that controls it included. For an
   * independent it is the house (or the publisher an imprint belongs to)
   * itself, with the people who own it given as `status`.
   */
  name: string;
  /** Its mark, if there is one: an owner's `logo` or, for a person, their
   *  `portrait`; or a house's logo for the year. */
  logo: OwnerMark | null;
  /** Set when people own it outright: the top owner's "Independent", "Self-published". */
  status: string | null;
}

/**
 * Who owns a panel's house, for the badge on its card: the top of its
 * ownership chain, with that company's mark. `year` picks the house's logo
 * when the house is the top company, so the mark matches the book's era.
 */
export function ownerBadge(
  house: Publisher,
  year: number | null | undefined,
  publishers: PublisherIndex,
  ownership: OwnershipIndex,
): OwnerBadge {
  const rungs = ladder(house, publishers, ownership);
  // The ladder always ends at the house, so a company is always found.
  const top = rungs.find((r) => r.publisher || (r.owner && !isIndependentOwner(r.owner))) ?? rungs[rungs.length - 1];
  const status = rungs[0].owner?.status ?? null;

  if (top.owner) return { house, name: top.owner.name, logo: ownerMark(top.owner), status: null };
  const p = top.publisher ?? house;
  return { house, name: p.name, logo: houseMark(p, year), status };
}

/** An image standing for a rung of the chain: a company's logo, or a person's photo. */
export interface OwnerMark {
  url: string;
  /** A light mark, which needs a dark ground. */
  onDark: boolean;
  /** A photo of a person rather than a logo. */
  portrait?: boolean;
  /** Whose it is, when that isn't the rung's own name: one of several people. */
  name?: string;
  /** Where the image came from, for attribution. */
  source?: string | null;
}

/** A company's logo, or the portrait of an owner that is a person. */
export function ownerMark(o: Owner): OwnerMark | null {
  if (o.logo) return { url: o.logo.url, onDark: !!o.logo.onDark, source: o.logo.source };
  if (o.portrait) return { url: o.portrait.url, onDark: false, portrait: true, source: o.portrait.source };
  return null;
}

/** A house's logo for the year, or its current one. */
export function houseMark(p: Publisher, year?: number | null): OwnerMark | null {
  const logo = publisherLogoFor(p, year);
  const url = logo?.url ?? p.imageUrl;
  return url ? { url, onDark: false, source: logo?.source } : null;
}

/** A rendered SVG: a bare mark on a clear ground, which needs a margin
 *  around it that a photo, or a card with its own ground, doesn't. */
export const isBareMark = (url: string) => /\.svg\b/i.test(url);

/**
 * The images for one rung of the ladder: the company's logo or the owner's
 * portrait, a house's logo, or for the people behind an independent, each
 * one's photo that can be found — their own in owners.json, else the one on
 * their artist record. Empty when there is nothing to show.
 */
export function stepMarks(
  step: Pick<OwnershipStep, "owner" | "publisher">,
  portraitOf: (artistId: string) => string | null | undefined,
  year?: number | null,
): OwnerMark[] {
  const { owner, publisher } = step;
  if (publisher) {
    const mark = houseMark(publisher, year);
    return mark ? [mark] : [];
  }
  if (!owner) return [];
  const own = ownerMark(owner);
  if (own) return [own];
  return (owner.people ?? []).flatMap((p) => {
    const url = p.portrait?.url ?? (p.artistId ? portraitOf(p.artistId) : null);
    return url ? [{ url, onDark: false, portrait: true, name: p.name, source: p.portrait?.source }] : [];
  });
}

/** "majority stake since 2025 · $500 million", "1992–1998", or "" for an in-house division. */
export function describeLink(link: OwnershipLink | null): string {
  if (!link) return "";
  const span = yearSpan(link.since, link.until);
  const head = link.stake ? [`${link.stake} stake`, span].filter(Boolean).join(" ") : span;
  return [head, link.price].filter(Boolean).join(" · ");
}

let cached: Owner[] | null = null;
let pending: Promise<Owner[]> | null = null;

export function getCachedOwners(): Owner[] | null {
  return cached;
}

/** owners.json, loaded once. Missing or unreadable reads as empty: profiles
 *  just go without the ownership section. */
export function loadOwners(): Promise<Owner[]> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetch(`${import.meta.env.BASE_URL}data/owners.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((data: { owners?: unknown }) => {
      cached = Array.isArray(data?.owners) ? (data.owners as Owner[]) : [];
      return cached;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
