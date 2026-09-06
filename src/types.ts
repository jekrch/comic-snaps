export interface Reference {
  name: string;
  url: string;
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
  publisher?: string | null;
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
