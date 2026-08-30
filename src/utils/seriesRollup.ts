import type { IssueCredits, Panel, RatingsIndex, Series, TargetRatings } from "../types";
import { comparePersonNames } from "./names";
import { lookupRatings } from "./ratings";

/**
 * One row of the series view: a series' identity, gathered from four files that
 * each know a different part of it (docs/series-view-plan.md §2).
 *
 * The unit is the **slug**, not the title — the slug is what every other file
 * keys on, and one slug in `gallery.json` already carries two title spellings.
 */
export interface SeriesRow {
  slug: string;
  /** The newest panel's spelling of the title — what the row is labelled with. */
  title: string;
  /** Every distinct spelling on the wall, so a title click filters to all of them. */
  titles: string[];
  /** The metadata record, when there is one. */
  series: Series | null;
  parent: Series | null;
  /** Filtered, in wall order; always at least one. */
  panels: Panel[];
  covers: string[];
  writers: string[];
  artists: string[];
  year: number | null;
  publisher: string | null;
  rating: TargetRatings | null;
  /** Rolled up from this series' issue scores, and never averaged into `rating`. */
  issueRating: { avg: number; count: number } | null;
  /**
   * When the series' panels were posted: the first and the last.
   *
   * `lastPostedAt` — `max(addedAt)` — is the default row sort, so the view
   * opens agreeing with the wall. It is deliberately the *last* post rather
   * than the first: a series someone came back to this week is live, whatever
   * year the run started or when its first panel landed.
   */
  firstPostedAt: number;
  lastPostedAt: number;
}

export interface SeriesMeta {
  series: Series[];
  issues: IssueCredits[];
}

/**
 * Which series an `issue:` rating target belongs to.
 *
 * The id is `issue:{slug}-{issue}` with no separator that a slug cannot itself
 * contain, so a plain prefix match hands `issue:stray-bullets-sunshine-roses-1`
 * to `stray-bullets`. The longest known slug that prefixes the key is the right
 * owner — matching against the id set rather than splitting the string.
 */
function bucketIssueRatings(
  ratings: RatingsIndex | null,
  slugs: Set<string>,
): Map<string, number[]> {
  const byslug = new Map<string, number[]>();
  if (!ratings) return byslug;

  for (const [key, target] of Object.entries(ratings.targets)) {
    if (!key.startsWith("issue:") || target.avg === null || target.count === 0) continue;
    const id = key.slice("issue:".length);

    let owner: string | null = null;
    for (let cut = id.lastIndexOf("-"); cut > 0; cut = id.lastIndexOf("-", cut - 1)) {
      const candidate = id.slice(0, cut);
      if (slugs.has(candidate)) {
        owner = candidate;
        break;
      }
    }
    if (!owner) continue;

    const scores = byslug.get(owner);
    if (scores) scores.push(target.avg);
    else byslug.set(owner, [target.avg]);
  }

  return byslug;
}

/** Most-credited first, then by surname — the rail only has room for two. */
function rankNames(counts: Map<string, number>): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || comparePersonNames(a[0], b[0]))
    .map(([name]) => name);
}

function bump(counts: Map<string, number>, name: string) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

/**
 * Group already-filtered panels into rows.
 *
 * A row is a view of *the filtered set*: a filter that matches one panel of a
 * twelve-panel series shows that row with one panel. Panels keep the wall's
 * active order inside the strip, so switching the panel sort reorders every
 * strip (§1.6).
 */
export function buildSeriesRows(
  panels: Panel[],
  meta: SeriesMeta,
  ratings: RatingsIndex | null,
): SeriesRow[] {
  const seriesById = new Map<string, Series>();
  for (const s of meta.series) seriesById.set(s.id, s);

  // Every slug anything could be keyed on, so the issue-rating bucketing can
  // pick the longest match even for a series with no panel on the wall.
  const allSlugs = new Set<string>(seriesById.keys());
  for (const p of panels) allSlugs.add(p.slug);
  const issueScores = bucketIssueRatings(ratings, allSlugs);

  // Issue credits, bucketed once rather than re-scanned per row.
  const creditsBySeries = new Map<string, IssueCredits[]>();
  for (const i of meta.issues) {
    const bucket = creditsBySeries.get(i.series);
    if (bucket) bucket.push(i);
    else creditsBySeries.set(i.series, [i]);
  }

  const grouped = new Map<string, Panel[]>();
  for (const p of panels) {
    const bucket = grouped.get(p.slug);
    if (bucket) bucket.push(p);
    else grouped.set(p.slug, [p]);
  }

  const rows: SeriesRow[] = [];

  for (const [slug, rowPanels] of grouped) {
    const series = seriesById.get(slug) ?? null;
    const parent = series?.parentSeries ? seriesById.get(series.parentSeries) ?? null : null;

    let lastPostedAt = -Infinity;
    let firstPostedAt = Infinity;
    let title = rowPanels[0].title;
    let minYear = Infinity;
    const titles: string[] = [];
    const issuesOnWall = new Set<string>();
    const artistCounts = new Map<string, number>();

    for (const p of rowPanels) {
      const at = Date.parse(p.addedAt);
      // The row wears the newest panel's spelling — the same panel the strip
      // leads with under the default sort.
      if (Number.isFinite(at) && at > lastPostedAt) {
        lastPostedAt = at;
        title = p.title;
      }
      if (Number.isFinite(at) && at < firstPostedAt) firstPostedAt = at;
      if (!titles.includes(p.title)) titles.push(p.title);
      if (p.year && p.year < minYear) minYear = p.year;
      issuesOnWall.add(String(p.issue));
      bump(artistCounts, p.artist);
    }

    // Writers come from the issues that are actually on the wall. Unscoped, an
    // anthology or a long-running title reports every writer the metadata
    // pipeline ever ingested rather than the one behind the panel we are
    // showing (§2.3).
    const writerCounts = new Map<string, number>();
    if (!series?.anthology) {
      for (const issue of creditsBySeries.get(slug) ?? []) {
        if (!issuesOnWall.has(String(issue.issue))) continue;
        for (const credit of issue.credits) {
          if (credit.roles.includes("Writer")) bump(writerCounts, credit.name);
        }
      }
    }

    const scores = issueScores.get(slug) ?? [];
    const issueRating = scores.length
      ? {
          avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
          count: scores.length,
        }
      : null;

    rows.push({
      slug,
      title,
      titles,
      series,
      parent,
      panels: rowPanels,
      covers: series?.coverImages ?? [],
      writers: rankNames(writerCounts),
      artists: rankNames(artistCounts),
      year: series?.startYear ?? (Number.isFinite(minYear) ? minYear : null),
      publisher: series?.publisher ?? null,
      rating: lookupRatings(ratings, "series", slug),
      issueRating,
      firstPostedAt: Number.isFinite(firstPostedAt) ? firstPostedAt : 0,
      lastPostedAt: Number.isFinite(lastPostedAt) ? lastPostedAt : 0,
    });
  }

  return rows;
}
