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
