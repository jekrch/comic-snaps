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
}

export interface Gallery {
  panels: Panel[];
}
