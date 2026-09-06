import type { Artist, Panel, Series } from "../types";

/**
 * One row of the artists view: a person's identity, gathered from the panels
 * they drew and whatever `artists.json` knows about them.
 *
 * The unit is the **name as the panel spells it**, not the `artists.json` id.
 * The gallery's `artist` field is the curated attribution the whole site keys
 * on — it is what the facet filters, what the search matches and what the
 * viewer prints — and every one of the 124 names on the wall resolves to a
 * record, so keying on the name loses nothing and keeps a person whose record
 * has not been ingested yet from vanishing out of the view.
 */
export interface ArtistRow {
  /** The grouping key, and what the row is labelled with. */
  name: string;
  /** The metadata record, when there is one. 111 of 124 carry a portrait. */
  artist: Artist | null;
  /** Filtered, in wall order; always at least one. */
  panels: Panel[];
  /** The books they are on here, most panels first — the rail shows two. */
  series: { slug: string; titles: string[]; title: string }[];
  /**
   * Cover dates of the panels on the wall, first to last. Not a career span:
   * it is the stretch of their work this gallery actually holds.
   */
  years: { from: number; to: number } | null;
  /** "1927–1981" / "b. 1970", when the record says so. */
  life: string | null;
  country: string | null;
  /**
   * The same person's other credits inside the filtered set. Counted rather
   * than listed: the row is about what they drew, and "also colours 4" is the
   * whole of what a second role has to say at this size.
   */
  alsoColorist: number;
  alsoLetterer: number;
  alsoCredited: number;
  /**
   * When their panels went up: the first and the last. `lastPostedAt` is the
   * default row sort, so the view opens agreeing with the wall and with the
   * series shelf beside it.
   */
  firstPostedAt: number;
  lastPostedAt: number;
}

export interface ArtistMeta {
  artists: Artist[];
  series: Series[];
}

/** How a person's name reads under their portrait: dates, then where from. */
function lifeSpan(artist: Artist | null): string | null {
  if (!artist) return null;
  if (artist.birthYear && artist.deathYear) return `${artist.birthYear}–${artist.deathYear}`;
  if (artist.birthYear) return `b. ${artist.birthYear}`;
  if (artist.deathYear) return `d. ${artist.deathYear}`;
  return null;
}

/**
 * Group already-filtered panels into one row per artist.
 *
 * A row is a view of *the filtered set*, exactly as a series row is: a filter
 * that matches one panel of a nine-panel artist shows that row with one panel,
 * and the panels keep the wall's active order inside the strip, so switching
 * the panel sort reorders every strip.
 */
export function buildArtistRows(panels: Panel[], meta: ArtistMeta): ArtistRow[] {
  const artistByName = new Map<string, Artist>();
  for (const a of meta.artists) artistByName.set(a.name, a);
  const seriesById = new Map<string, Series>();
  for (const s of meta.series) seriesById.set(s.id, s);

  // The other two roles, counted over the same filtered set the rows come from
  // — a person's colouring credits outside the current filters are not part of
  // what this view is showing.
  const coloristCounts = new Map<string, number>();
  const lettererCounts = new Map<string, number>();
  const creditCounts = new Map<string, number>();
  for (const p of panels) {
    for (const c of p.colorists ?? []) coloristCounts.set(c, (coloristCounts.get(c) ?? 0) + 1);
    for (const l of p.letterers ?? []) lettererCounts.set(l, (lettererCounts.get(l) ?? 0) + 1);
    // Only panels somebody *else* drew: a name in the credits of a panel it is
    // already the artist of is the row's own strip restated. Counted here
    // rather than subtracted afterwards, because the artist attribution is
    // curated and the issue credits are ingested — the two disagree often
    // enough that the arithmetic would come out wrong in both directions.
    for (const n of p.credits ?? []) {
      if (n !== p.artist) creditCounts.set(n, (creditCounts.get(n) ?? 0) + 1);
    }
  }

  const grouped = new Map<string, Panel[]>();
  for (const p of panels) {
    if (!p.artist) continue;
    const bucket = grouped.get(p.artist);
    if (bucket) bucket.push(p);
    else grouped.set(p.artist, [p]);
  }

  const rows: ArtistRow[] = [];

  for (const [name, rowPanels] of grouped) {
    const artist = artistByName.get(name) ?? null;

    let lastPostedAt = -Infinity;
    let firstPostedAt = Infinity;
    let minYear = Infinity;
    let maxYear = -Infinity;

    // Which books, and how many panels from each — the rail shows the two the
    // person is most present in here, which is the honest ranking when a name
    // spans nine series and there is room for two.
    const seriesCounts = new Map<string, number>();
    const seriesTitles = new Map<string, string[]>();

    for (const p of rowPanels) {
      const at = Date.parse(p.addedAt);
      if (Number.isFinite(at)) {
        if (at > lastPostedAt) lastPostedAt = at;
        if (at < firstPostedAt) firstPostedAt = at;
      }
      if (p.year) {
        if (p.year < minYear) minYear = p.year;
        if (p.year > maxYear) maxYear = p.year;
      }
      seriesCounts.set(p.slug, (seriesCounts.get(p.slug) ?? 0) + 1);
      // Every spelling the slug carries on the wall, so a click on the title
      // filters to all of them rather than to a subset of itself (§9).
      const spellings = seriesTitles.get(p.slug);
      if (spellings) {
        if (!spellings.includes(p.title)) spellings.push(p.title);
      } else {
        seriesTitles.set(p.slug, [p.title]);
      }
    }

    const series = Array.from(seriesCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([slug]) => {
        const titles = seriesTitles.get(slug) ?? [];
        return {
          slug,
          titles,
          // The metadata's spelling when there is one, since it is the name on
          // the book; the wall's otherwise.
          title: seriesById.get(slug)?.name ?? titles[0] ?? slug,
        };
      });

    rows.push({
      name,
      artist,
      panels: rowPanels,
      series,
      years:
        Number.isFinite(minYear) && Number.isFinite(maxYear)
          ? { from: minYear, to: maxYear }
          : null,
      life: lifeSpan(artist),
      country: artist?.country ?? null,
      // Their own panels already say they drew these, so the artist count is
      // never the "also" line; the other three are what the row would
      // otherwise not mention at all.
      alsoColorist: coloristCounts.get(name) ?? 0,
      alsoLetterer: lettererCounts.get(name) ?? 0,
      alsoCredited: creditCounts.get(name) ?? 0,
      firstPostedAt: Number.isFinite(firstPostedAt) ? firstPostedAt : 0,
      lastPostedAt: Number.isFinite(lastPostedAt) ? lastPostedAt : 0,
    });
  }

  return rows;
}

/**
 * What a portrait's `issue` says, since it has no number of its own. The
 * viewer prints a panel's title and issue together, so this reads as
 * "Wally Wood Portrait" in the header, the alt text and the search link —
 * the same trick `COVER_ISSUE` plays for a series' cover.
 */
export const PORTRAIT_ISSUE = "Portrait";

/**
 * A creator's portrait, as a panel the viewer can open.
 *
 * The same standing-in the covers do: the rail's face and the strip's tile are
 * a 84px crop of a photograph that is usually far bigger, and a reader who
 * wants to look at the person rather than at the thumbnail of them has nowhere
 * to go unless it opens like everything else on the row does.
 *
 * `artist` is the person's own name — the one field a portrait can honestly
 * fill, and what the info drawer resolves their card from — while everything
 * that records a posting is left empty, because nobody posted it. Dimensions
 * are declared square rather than left at zero: the strip's tile is a square
 * crop by design (see `ArtistRow`), and the aspect is what sizes it.
 */
export function buildPortraitPanel(row: ArtistRow): Panel | null {
  const image = row.artist?.imageUrl;
  if (!image) return null;
  return {
    id: `portrait:${row.artist?.id ?? row.name}`,
    title: row.name,
    slug: "",
    issue: PORTRAIT_ISSUE,
    year: 0,
    artist: row.name,
    image,
    notes: null,
    tags: [],
    postedBy: "",
    addedAt: "",
    height: 1,
    width: 1,
    phash: "",
    ahash: "",
    dhash: "",
    dominantColors: null,
    colorfulness: null,
    blur: null,
    blurStart: null,
    portrait: true,
  };
}
