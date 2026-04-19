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
}

export interface Panel {
  id: string;
  title: string;
  slug: string;
  issue: number;
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
}

export interface Gallery {
  panels: Panel[];
}
