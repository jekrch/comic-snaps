import type { Panel, RatingsIndex, TargetRatings } from "../types";

/**
 * Ratings are a static data file like every other — the bot commits
 * `public/data/ratings.json` and the site rebuilds, so a tap shows up on the
 * wall a build later (docs/ratings-plan.md §3). Nothing here talks to the
 * worker; the running tally in the chat is the bot's job.
 */
const RATINGS_URL = `${import.meta.env.BASE_URL}data/ratings.json`;

const EMPTY: RatingsIndex = { generatedAt: "", targets: {} };

let cached: RatingsIndex | null = null;
let pending: Promise<RatingsIndex> | null = null;

/** Mirrors the worker's `slugify` so target ids line up on both sides. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A panel is a *handle* for its issue, not its own rating target — two panels
 * from one issue collapse onto the same id (§1.6, §2.1).
 */
export function issueTargetId(panel: Panel): string {
  return `${panel.slug}-${slugify(String(panel.issue))}`;
}

export function seriesTargetId(panel: Panel): string {
  return panel.slug;
}

async function fetchIndex(url: string): Promise<RatingsIndex> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ratings ${res.status}`);
  const data = (await res.json()) as Partial<RatingsIndex>;
  return { generatedAt: data.generatedAt ?? "", targets: data.targets ?? {} };
}

/** Load once per session, the way the other metadata files are loaded. */
export async function loadRatings(): Promise<RatingsIndex> {
  if (cached) return cached;
  if (pending) return pending;

  pending = (async () => {
    try {
      return await fetchIndex(RATINGS_URL);
    } catch {
      // The file may not exist until the first rating is cast.
      return EMPTY;
    }
  })();

  try {
    cached = await pending;
    return cached;
  } finally {
    pending = null;
  }
}

export function getCachedRatings(): RatingsIndex | null {
  return cached;
}

export function lookupRatings(
  index: RatingsIndex | null,
  type: "issue" | "series",
  id: string,
): TargetRatings | null {
  return index?.targets[`${type}:${id}`] ?? null;
}
