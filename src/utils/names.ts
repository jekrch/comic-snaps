/**
 * Sorting helpers for person names (artists, colorists, letterers, credits).
 *
 * Facet lists read as directories, so they order by surname rather than by
 * the raw display string: "Jeff Lemire" files under L, "Leomacs" under L too.
 */

/** Nobiliary particles that belong with the surname, not the given name. */
const PARTICLES = new Set([
  "al",
  "bin",
  "da",
  "das",
  "de",
  "del",
  "della",
  "der",
  "des",
  "di",
  "do",
  "dos",
  "du",
  "el",
  "ibn",
  "la",
  "le",
  "van",
  "von",
  "ten",
  "ter",
  "y",
  "zu",
]);

/** Generational/honorific suffixes that never act as the sort key. */
const SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "v",
  "esq",
  "esq.",
  "phd",
  "md",
]);

/**
 * Split a display name into [surname, remainder] for sorting.
 *
 * Single-token names ("Moebius", "Leomacs") are their own surname. Multi-part
 * names use the trailing token, pulling in any preceding particle so
 * "Lorenzo de Felici" sorts under "de Felici" rather than "Felici".
 */
export function personSortKey(name: string): [string, string] {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return ["", ""];
  if (tokens.length === 1) return [tokens[0], ""];

  // ignore trailing suffixes when locating the surname, but keep at least
  // one token ahead of them so "Jr." alone never becomes the key
  let end = tokens.length;
  while (end > 1 && SUFFIXES.has(tokens[end - 1].toLowerCase())) end--;

  let start = end - 1;
  while (start > 1 && PARTICLES.has(tokens[start - 1].toLowerCase())) start--;

  const surname = tokens.slice(start, end).join(" ");
  const rest = tokens.slice(0, start).concat(tokens.slice(end)).join(" ");
  return [surname, rest];
}

/**
 * Compare two person names by surname, falling back to the rest of the name
 * so "Andy MacDonald" and "Andy Price" keep a stable relative order.
 *
 * Comparison ignores case and accents so "Lorenzo de Felici" and
 * "Lorenzo De Felici" land next to each other.
 */
export function comparePersonNames(a: string, b: string): number {
  const [surnameA, restA] = personSortKey(a);
  const [surnameB, restB] = personSortKey(b);
  const opts: Intl.CollatorOptions = { sensitivity: "base" };
  return (
    surnameA.localeCompare(surnameB, undefined, opts) ||
    restA.localeCompare(restB, undefined, opts) ||
    a.localeCompare(b, undefined, opts)
  );
}
