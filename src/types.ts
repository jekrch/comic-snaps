export interface Reference {
  name: string;
  url: string;
  /** Set when the reference is one article rather than a whole database entry
   *  (a Comics Journal interview, say) — the row only has room for the source,
   *  so the title is rendered under it. */
  title?: string;
}

export interface Artist {
  id: string;
  name: string;
  description: string;
  imageUrl?: string | null;
  references: Reference[];
  birthYear?: number | null;
  deathYear?: number | null;
  country?: string | null;
  /** Where they're from: the town they grew up in when a source says so,
   *  otherwise where they were born. "City, State/Province" in the US and
   *  Canada, the bare city elsewhere; it names a country only when that
   *  differs from `country`. */
  hometown?: string | null;
  aliases?: string[] | null;
  tags?: string[] | null;
}

export interface Series {
  id: string;
  name: string;
  parentSeries: string | null;
  description: string;
  imageUrl?: string | null;
  references: Reference[];
  startYear?: number | null;
  /** Display name of the parent publisher. The registry entry it names is
   *  `publisherId` in publishers.json; the pipeline keeps the two in line. */
  publisher?: string | null;
  publisherId?: string | null;
  /** Set when the series came out under an imprint (Vertigo, Skybound):
   *  its publishers.json id and display name. */
  imprintId?: string | null;
  imprint?: string | null;
  issueCount?: number | null;
  /** issueCount was raised to the highest issue we own a panel from, because
   *  the count recorded when the series was first looked up went stale. It is
   *  a floor, not a verified total — shown as "N+ issues". */
  issueCountInferred?: boolean;
  aliases?: string[] | null;
  coverImages?: string[] | null;
  tags?: string[] | null;
  /** Manually marked: a multi-creator anthology, where the panel's assigned
   *  artist is the only meaningful attribution. Suppresses issue credits. */
  anthology?: boolean;
}

/** One entry in publishers.json: a publisher, an imprint, or a
 *  self-publishing label. See scripts/metadata/publishers.py. */
export interface Publisher {
  id: string;
  name: string;
  kind: "publisher" | "imprint" | "self-published";
  /** An imprint's publisher id. */
  parent: string | null;
  aliases: string[];
  description: string;
  imageUrl: string | null;
  /** When the company was founded (Metron). */
  foundedYear?: number | null;
  /** The span of its books in the Grand Comics Database, which can start
   *  before the founding. activeUntil is null while it is still publishing. */
  activeFrom?: number | null;
  activeUntil?: number | null;
  country?: string | null;
  location?: string | null;
  website?: string | null;
  founders?: { artistId: string | null; name: string }[];
  /** Editors and publishers who shaped the line, apart from its founders.
   *  Hand-researched, like `events` and `logos`. */
  editors?: PublisherPerson[];
  /** Milestones in the company's history, oldest first. */
  events?: PublisherEvent[];
  /** Marks the company has used, each with the years it was in use, so a
   *  panel can show the one on its cover's era. Only set when there is more
   *  than one; `imageUrl` stays the current mark. */
  logos?: PublisherLogo[];
  references: Reference[];
  /** Source ids: Metron, Comic Vine and GCD. */
  ids: Partial<Record<"metron" | "comicvine" | "gcd", number>>;
  tags?: string[] | null;
}

export interface PublisherEvent {
  year: number;
  text: string;
}

export interface PublisherPerson {
  artistId: string | null;
  name: string;
  role: string;
  from?: number | null;
  until?: number | null;
}

export interface PublisherLogo {
  url: string;
  /** First and last years in use; open-ended when absent. */
  from?: number | null;
  until?: number | null;
  /** The file's description page, for attribution. */
  source?: string;
}

export interface IssueCredit {
  artistId: string | null;
  name: string;
  roles: string[];
}

export interface IssueCredits {
  id: string;
  series: string;
  issue: number;
  credits: IssueCredit[];
  references?: Reference[];
}

/**
 * One person's score and/or review of an issue or series. Ratings are the
 * group's by default — "our rating", with no name — so `user` is only set when
 * the rater signed it (`/rate ... --me`). See docs/ratings-plan.md §1.8.
 */
export interface Rating {
  user: string | null;
  attributed?: boolean;
  score: number | null;
  review: string | null;
  updatedAt: string;
}

export interface TargetRatings {
  label: string;
  /** Mean of the scores on this target alone, to one decimal. Null when unrated. */
  avg: number | null;
  /** How many people scored it — always shown next to the average (§8). */
  count: number;
  ratings: Rating[];
}

export interface RatingsIndex {
  generatedAt: string;
  /** Keyed `issue:{series}-{issue}` / `series:{series}`. */
  targets: Record<string, TargetRatings>;
}

export interface Panel {
  id: string;
  title: string;
  slug: string;
  issue: number | string;
  year: number;
  artist: string;
  image: string;
  notes: string | null;
  tags: string[];
  postedBy: string;
  addedAt: string;
  height: number;
  width: number;
  phash: string;
  ahash: string;
  dhash: string;
  dominantColors: [number, number, number][] | null;
  colorfulness: number | null;
  blur: "ew" | "nsfw" | null;
  blurStart: "all" | "top" | "bottom" | "right" | "left" | null;
  colorists?: string[];
  letterers?: string[];
  /** Every person credited on this panel's issue, in any role. */
  credits?: string[];
  /**
   * The parent publisher's display name, and the imprint's when the series
   * came out under one. Derived at load from series.json and publishers.json
   * (see `resolveSeriesPublisher`). Absent when unknown.
   */
  publisher?: string;
  imprint?: string;
  /**
   * The artist's age in the publication year, derived at load from their
   * birth year in `artists.json` (see `artistAgeAt`). Absent when unknown.
   */
  artistAge?: number;
  /** Manual override for masonry column span; omit to fall back to aspect-ratio detection. */
  columnSpan?: 1 | 2;
  /**
   * Not from the gallery: a series' cover art, standing in the panel viewer as
   * a panel so a strip can be paged end to end. Its `image` is a cover path
   * from `series.json`, and it carries none of a panel's bibliography — no
   * issue, no artist, no posting — because a cover was never posted to the
   * wall by anyone.
   */
  cover?: boolean;
  /**
   * Not from the gallery: a creator's portrait from `artists.json`, standing in
   * the panel viewer as a panel so an artist row's strip can be paged end to
   * end. Its `image` is the record's `imageUrl` and its `artist` is the person
   * it is of — which is the one piece of bibliography a portrait does have, and
   * what the info drawer resolves their card from. Everything a panel is posted
   * with is empty: nobody put a portrait on the wall.
   */
  portrait?: boolean;
  /**
   * Not from the gallery: an image the reader chose off their own disk to feed
   * a visualizer run. Its `image` is a `blob:` URL that lives only as long as
   * the tab, nothing is uploaded, and it never reaches the wall or the viewer —
   * so everything that would name a panel has nothing to say about it beyond
   * its filename, and says nothing.
   */
  local?: boolean;
}

export interface Gallery {
  panels: Panel[];
}
