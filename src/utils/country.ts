/**
 * One name per country for creator records.
 *
 * artists.json is assembled from several sources (Comic Vine, Metron,
 * Wikipedia, hand edits), and each spells a country its own way: the United
 * States arrives as "United States", "USA", "U.S.A.", "U.S." and "United States
 * of America"; Britain as "UK", "England, United Kingdom" and "Scotland, United
 * Kingdom". Counting those raw would split one country across six bars.
 */

const ALIASES: Record<string, string> = {
  "united states": "United States",
  "united states of america": "United States",
  usa: "United States",
  us: "United States",
  america: "United States",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  "northern ireland": "United Kingdom",
  phillipines: "Philippines",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
};

/**
 * Canonical country name for a raw record value, or null when there is none.
 *
 * A "Place, Country" value keeps only the last part, so a city or constituent
 * country in front of the nation doesn't make a bar of its own. Punctuation in
 * abbreviations is ignored ("U.S.A" and "USA" are the same key). Anything not
 * in the alias table is passed through trimmed, since an unrecognised name is
 * still more useful than a guess.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const last = raw.split(",").pop()!.trim();
  if (!last) return null;
  const key = last.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return ALIASES[key] ?? last;
}
