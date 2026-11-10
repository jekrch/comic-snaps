import type { Owner, OwnershipLink, Publisher } from "../types";
import type { PublisherIndex } from "./publishers";
import { yearSpan } from "./publishers";

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
