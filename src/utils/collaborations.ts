import type { Artist, IssueCredits, Panel, Series } from "../types";

/**
 * Who made what with whom, read off the wall.
 *
 * The unit is the *work* — one issue of one series that has panels up — and a
 * person is on it when the panel names them as its artist or the issue credits
 * them in a role that shaped the pages. Editors, cover artists, designers and
 * the publisher's officers are on most Marvel and DC credit lists and would
 * connect everyone to everyone, so they are never counted: a connection here
 * means two people's hands are on the same pages.
 */

export type RoleFamily = "story" | "art" | "color" | "letters";

/** The families in the order they sit around the graph — also the order the
 *  family palette was validated in, since only neighbouring arcs touch. */
export const ROLE_FAMILIES: RoleFamily[] = ["story", "art", "color", "letters"];

/** Every creative role in the issue-credit vocabulary, by family. A role not
 *  listed is editorial or production and never makes a connection. */
export const CREATIVE_ROLES: Record<string, RoleFamily> = {
  Writer: "story",
  Artist: "art",
  Penciller: "art",
  Inker: "art",
  Illustrator: "art",
  Colorist: "color",
  "Color Assists": "color",
  Letterer: "letters",
};

export interface WorkCredit {
  key: string;
  name: string;
  /** Creative roles on this work, in the order the credits list them. */
  roles: string[];
  families: RoleFamily[];
}

export interface Work {
  /** `${slug}|${issue}` — the same key the issue credits are joined on. */
  key: string;
  slug: string;
  title: string;
  issue: number | string;
  year: number;
  panels: Panel[];
  people: Map<string, WorkCredit>;
}

export interface WorksIndex {
  works: Work[];
  /** Person key → the works they are on. */
  byPerson: Map<string, Work[]>;
  /** Resolve any spelling of a name (or one of its aliases) to its key. */
  keyOf: (name: string) => string;
}

/**
 * Identity for a name: case, accents and punctuation folded away, so the
 * panel's "Alvaro Martinez Bueno" and the credit's "Álvaro Martínez Bueno" are
 * one person rather than two collaborators of each other.
 */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function buildWorksIndex(
  panels: Panel[],
  issues: IssueCredits[],
  series: Series[],
  artists: Artist[],
): WorksIndex {
  // A curated alias ("Al Feldstein") is the same person as the record it is on.
  const aliasTo = new Map<string, string>();
  for (const a of artists) {
    const canonical = foldName(a.name);
    for (const alias of a.aliases ?? []) {
      const f = foldName(alias);
      if (f && f !== canonical && !aliasTo.has(f)) aliasTo.set(f, canonical);
    }
  }
  const keyOf = (name: string) => {
    const f = foldName(name);
    return aliasTo.get(f) ?? f;
  };

  const seriesById = new Map(series.map((s) => [s.id, s]));
  const isAnthology = (slug: string) => {
    const s = seriesById.get(slug);
    const parent = s?.parentSeries ? seriesById.get(s.parentSeries) : undefined;
    return !!(s?.anthology || parent?.anthology);
  };
  const creditsByKey = new Map(issues.map((i) => [`${i.series}|${i.issue}`, i]));

  // The display name for a key is the spelling the wall's own panels use —
  // it is what the profile's role rows and the gallery filters match on —
  // and otherwise the one it is credited under most, so a one-off variant in
  // a credit list doesn't rename anybody.
  const wallSpelling = new Map<string, string>();
  const spellings = new Map<string, Map<string, number>>();
  const sawSpelling = (key: string, name: string) => {
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    spellings.set(key, counts);
  };

  const works = new Map<string, Work>();
  const addCredit = (work: Work, name: string, role: string) => {
    const family = CREATIVE_ROLES[role];
    const key = keyOf(name);
    if (!family || !key) return;
    let credit = work.people.get(key);
    if (!credit) {
      credit = { key, name, roles: [], families: [] };
      work.people.set(key, credit);
      sawSpelling(key, name);
    }
    if (!credit.roles.includes(role)) credit.roles.push(role);
    if (!credit.families.includes(family)) credit.families.push(family);
  };

  for (const p of panels) {
    // Stand-ins (a series cover, a portrait, a reader's own image) carry no
    // bibliography to connect anyone by.
    if (p.cover || p.portrait || p.local) continue;
    const key = `${p.slug}|${p.issue}`;
    let work = works.get(key);
    if (!work) {
      work = { key, slug: p.slug, title: p.title, issue: p.issue, year: p.year, panels: [], people: new Map() };
      works.set(key, work);
      // An anthology's credits belong to stories other than this panel's — its
      // assigned artist is the only attribution that means anything there.
      const credits = isAnthology(p.slug) ? undefined : creditsByKey.get(key);
      for (const c of credits?.credits ?? []) {
        for (const role of c.roles) addCredit(work, c.name, role);
      }
    }
    work.panels.push(p);
    if (p.artist) {
      addCredit(work, p.artist, "Artist");
      if (!wallSpelling.has(keyOf(p.artist))) wallSpelling.set(keyOf(p.artist), p.artist);
    }
  }

  for (const work of works.values()) {
    for (const credit of work.people.values()) {
      const onWall = wallSpelling.get(credit.key);
      if (onWall) {
        credit.name = onWall;
        continue;
      }
      const counts = spellings.get(credit.key);
      if (!counts) continue;
      let best = credit.name;
      let bestN = -1;
      for (const [name, n] of counts) {
        if (n > bestN) {
          best = name;
          bestN = n;
        }
      }
      credit.name = best;
    }
  }

  const byPerson = new Map<string, Work[]>();
  for (const work of works.values()) {
    for (const key of work.people.keys()) {
      const list = byPerson.get(key);
      if (list) list.push(work);
      else byPerson.set(key, [work]);
    }
  }

  return { works: [...works.values()], byPerson, keyOf };
}

export interface Collaborator {
  key: string;
  name: string;
  /** Works shared with the person the network is about. */
  shared: number;
  /** Their families across the shared works, most frequent first. */
  families: RoleFamily[];
  /** Where they sit on the graph: the family they most often worked in. */
  family: RoleFamily;
  /** Their roles across the shared works, most frequent first. */
  roles: string[];
}

/** Two collaborators who also made something together that the person the
 *  network is about is not on — the lead for the next profile to open. */
export interface Tie {
  a: string;
  b: string;
  /** Works they share without the centre person. */
  elsewhere: number;
}

export interface Network {
  selfKey: string;
  /** The centre's works that have at least one collaborator, oldest first. */
  works: Work[];
  collaborators: Collaborator[];
  ties: Tie[];
}

const byFrequency = <T,>(counts: Map<T, number>, order: T[]) =>
  [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || order.indexOf(x[0]) - order.indexOf(y[0]))
    .map(([v]) => v);

const compareWorks = (a: Work, b: Work) =>
  a.year - b.year ||
  a.title.localeCompare(b.title) ||
  String(a.issue).localeCompare(String(b.issue), undefined, { numeric: true });

export function buildNetwork(index: WorksIndex, name: string): Network {
  const selfKey = index.keyOf(name);
  const works = (index.byPerson.get(selfKey) ?? []).filter((w) => w.people.size > 1).sort(compareWorks);

  const tallies = new Map<
    string,
    { name: string; shared: number; families: Map<RoleFamily, number>; roles: Map<string, number> }
  >();
  for (const work of works) {
    for (const credit of work.people.values()) {
      if (credit.key === selfKey) continue;
      let t = tallies.get(credit.key);
      if (!t) {
        t = { name: credit.name, shared: 0, families: new Map(), roles: new Map() };
        tallies.set(credit.key, t);
      }
      t.shared++;
      for (const f of credit.families) t.families.set(f, (t.families.get(f) ?? 0) + 1);
      for (const r of credit.roles) t.roles.set(r, (t.roles.get(r) ?? 0) + 1);
    }
  }

  const roleOrder = Object.keys(CREATIVE_ROLES);
  const collaborators: Collaborator[] = [...tallies.entries()].map(([key, t]) => {
    const families = byFrequency(t.families, ROLE_FAMILIES);
    return { key, name: t.name, shared: t.shared, families, family: families[0], roles: byFrequency(t.roles, roleOrder) };
  });
  collaborators.sort(
    (a, b) =>
      ROLE_FAMILIES.indexOf(a.family) - ROLE_FAMILIES.indexOf(b.family) ||
      b.shared - a.shared ||
      a.name.localeCompare(b.name),
  );

  const ties: Tie[] = [];
  const inNetwork = new Set(tallies.keys());
  const pairCounts = new Map<string, number>();
  for (const key of inNetwork) {
    for (const work of index.byPerson.get(key) ?? []) {
      if (work.people.has(selfKey)) continue;
      for (const other of work.people.keys()) {
        // Each pair once, from its lesser key's side.
        if (other <= key || !inNetwork.has(other)) continue;
        const pair = `${key}\u0000${other}`;
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
  }
  for (const [pair, elsewhere] of pairCounts) {
    const [a, b] = pair.split("\u0000");
    ties.push({ a, b, elsewhere });
  }

  return { selfKey, works, collaborators, ties };
}

/** The centre's works that every selected collaborator is also on. */
export function worksWithAll(network: Network, selected: Iterable<string>): Work[] {
  const keys = [...selected];
  return network.works.filter((w) => keys.every((k) => w.people.has(k)));
}
