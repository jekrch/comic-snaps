import type { Artist } from "../types";

// Ages outside this range are bad birth-year records, not prodigies
const MIN_PLAUSIBLE_AGE = 12;
const MAX_PLAUSIBLE_AGE = 100;

/** Width of an age bracket, in years — the stats chart's bars and the filter's values. */
export const AGE_BIN = 5;

/**
 * How old the artist was in the panel's publication year, or null when it
 * can't be said: no birth year on record, no publication year, an age outside
 * the plausible range, or a year after their death — a posthumous printing or
 * a reprint, so the year isn't when they drew it.
 */
export function artistAgeAt(year: number, artist: Artist | undefined): number | null {
  if (!artist?.birthYear || !(year > 0)) return null;
  if (artist.deathYear && year > artist.deathYear) return null;
  const age = year - artist.birthYear;
  if (age < MIN_PLAUSIBLE_AGE || age > MAX_PLAUSIBLE_AGE) return null;
  return age;
}

/** First age of the bracket `age` falls in. */
export const ageBinStart = (age: number) => Math.floor(age / AGE_BIN) * AGE_BIN;

/** The bracket's filter value, e.g. "30-34" — plain hyphen so it sits cleanly in a URL. */
export const ageBinKey = (start: number) => `${start}-${start + AGE_BIN - 1}`;

/** The bracket a panel's age files it under, as a filter value. */
export const ageBinOf = (age: number) => ageBinKey(ageBinStart(age));

/** A filter value as shown to the reader, e.g. "30–34". */
export const formatAgeBin = (key: string) => key.replace("-", "–");

/** Lower bound of a filter value, for ordering brackets numerically. */
export const ageBinOrder = (key: string) => parseInt(key, 10);
