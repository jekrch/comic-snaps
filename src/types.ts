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
