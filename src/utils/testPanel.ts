import type { Panel } from "../types";

/**
 * A gallery panel with every required field filled in, so a test names only
 * the fields it is actually about.
 */
export function makePanel(over: Partial<Panel> = {}): Panel {
  return {
    id: "p1",
    title: "Saga",
    slug: "saga",
    issue: 1,
    year: 2012,
    artist: "Fiona Staples",
    image: "images/saga/issue-1.jpg",
    notes: null,
    tags: [],
    postedBy: "jek",
    addedAt: "2026-01-01T00:00:00.000Z",
    height: 1000,
    width: 750,
    phash: "0000000000000000",
    ahash: "0000000000000000",
    dhash: "0000000000000000",
    dominantColors: null,
    colorfulness: null,
    blur: null,
    blurStart: null,
    ...over,
  };
}
