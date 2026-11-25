import type { MetricKey } from "../graph/similarityConfig";

/**
 * Every page of the Guide, in reading order, with its steps. This is the one
 * place step numbers, anchor ids and rail entries come from: a lesson's
 * `Section` names its step by id and looks the rest up here.
 *
 * Metadata only, no components, so the entry points (the Sort tab, the
 * graph) can name a lesson without pulling the lessons' code into the main
 * bundle.
 */

/** What the Guide is called, in the masthead and anywhere that links to it. */
export const GUIDE_NAME = "The Guide";
export const GUIDE_SUBTITLE = "How the gallery sorts";

export type LessonId = "color" | "phash" | "vectors" | "siglip" | "dino" | "gram";
export type PageId = "overview" | LessonId | "glossary";

export interface StepDef {
  id: string;
  title: string;
  /** Shorter label for the rail, when the title is long. */
  short?: string;
}

export interface PageDef {
  id: PageId;
  /** The rail's label. */
  label: string;
  /** The page heading. */
  title: string;
  /** Eyebrow above the title. */
  family: string;
  metric?: MetricKey;
  /**
   * The lesson brings its own worked example instead of the Guide's anchor
   * and its neighbours, so the anchor strip is left off this page.
   */
  ownExample?: boolean;
  buildsOn: LessonId[];
  /** Rough reading time. */
  minutes: number;
  /**
   * The lesson's short version: its reading time, and the one sentence that
   * stands in for the lede. Lessons only; the switch shows where it's set.
   */
  tldr?: { minutes: number; gist: string };
  steps: StepDef[];
}

const EMBEDDING_STEPS = (attention: boolean): StepDef[] => [
  { id: "prepare", title: "Prepare the image", short: "Prepare" },
  ...(attention ? [{ id: "attention", title: "Let the patches compare notes", short: "Attention" }] : []),
  { id: "arrows", title: "Turn each image into a direction", short: "Arrows" },
  { id: "angle", title: "Measure the angle between arrows", short: "Angle" },
  { id: "distance", title: "From similarity to distance", short: "Distance" },
];

export const PAGES: PageDef[] = [
  {
    id: "overview",
    label: "Overview",
    title: GUIDE_SUBTITLE,
    family: GUIDE_NAME,
    buildsOn: [],
    minutes: 3,
    steps: [
      { id: "alike", title: "One anchor, five neighbours", short: "Five neighbours" },
      { id: "methods", title: "The five methods side by side", short: "Side by side" },
      { id: "start", title: "Where to start", short: "Start here" },
    ],
  },
  {
    id: "color",
    label: "Color",
    title: "Color Palette",
    family: "CIELAB dominant color",
    metric: "color",
    buildsOn: [],
    minutes: 6,
    tldr: {
      minutes: 2,
      gist: "Panels are lined up around the color wheel, and compared by how different their main colors look to a person.",
    },
    steps: [
      { id: "rgb", title: "Why not just use RGB?", short: "Why not RGB" },
      { id: "channels", title: "The three CIELAB channels", short: "CIELAB channels" },
      { id: "split", title: "Color vs. black-and-white", short: "Color vs. B&W" },
      { id: "hue", title: "Lining color panels up by hue angle", short: "Hue angle" },
      { id: "distance", title: "Measuring distance between neighbors", short: "Distance" },
      { id: "result", title: "Reading the result", short: "Reading it" },
    ],
  },
  {
    id: "phash",
    label: "pHash",
    title: "Perceptual Hash",
    family: "Luminance fingerprint",
    metric: "phash",
    ownExample: true,
    buildsOn: [],
    minutes: 7,
    tldr: {
      minutes: 2,
      gist: "A 64-bit fingerprint of where a panel is light and dark: good at spotting the same picture twice, weak at ranking different ones.",
    },
    steps: [
      { id: "pair", title: "One panel, two photos", short: "Two photos" },
      { id: "luma", title: "Keep only the brightness", short: "Luminance" },
      { id: "shrink", title: "Shrink to 32 × 32", short: "Shrink" },
      { id: "patterns", title: "Break it into patterns", short: "Patterns" },
      { id: "bits", title: "One bit per pattern", short: "Bits" },
      { id: "count", title: "Count the differences", short: "Hamming" },
      { id: "result", title: "Reading the result", short: "Reading it" },
    ],
  },
  {
    id: "vectors",
    label: "Vectors",
    title: "Vectors and cosine distance",
    family: "Shared by every model",
    buildsOn: [],
    minutes: 5,
    tldr: {
      minutes: 1,
      gist: "A model turns each panel into a long list of numbers, an arrow; two panels are alike when their arrows point the same way.",
    },
    steps: [
      { id: "arrows", title: "Numbers as an arrow", short: "Arrows" },
      { id: "normalize", title: "Same length, different directions", short: "Normalization" },
      { id: "dot", title: "Measure the angle between arrows", short: "Dot product" },
      { id: "distance", title: "From similarity to distance", short: "Distance" },
    ],
  },
  {
    id: "siglip",
    label: "SigLIP",
    title: "SigLIP",
    family: "Vision-language embedding",
    metric: "embedding-siglip",
    buildsOn: ["vectors"],
    minutes: 9,
    tldr: {
      minutes: 2,
      gist: "SigLIP learned from captions, so two panels sit close when they'd be described alike: same subject, mood or composition.",
    },
    steps: EMBEDDING_STEPS(true),
  },
  {
    id: "dino",
    label: "DINOv2",
    title: "DINOv2",
    family: "Self-supervised vision embedding",
    metric: "embedding-dino",
    buildsOn: ["vectors"],
    minutes: 9,
    tldr: {
      minutes: 2,
      gist: "DINOv2 learned from pictures alone, so two panels sit close when they look alike: shapes, layout and texture.",
    },
    steps: EMBEDDING_STEPS(true),
  },
  {
    id: "gram",
    label: "Gram",
    title: "VGG-16 Gram Matrix",
    family: "Style / texture embedding",
    metric: "embedding-gram",
    buildsOn: ["vectors"],
    minutes: 6,
    tldr: {
      minutes: 1,
      gist: "The Gram model ignores what's drawn and where, and compares how it's drawn: line, hatching and ink.",
    },
    steps: EMBEDDING_STEPS(false),
  },
  {
    id: "glossary",
    label: "Glossary",
    title: "Glossary",
    family: GUIDE_NAME,
    buildsOn: [],
    minutes: 4,
    steps: [],
  },
];

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));

export function pageDef(id: PageId): PageDef {
  return BY_ID.get(id)!;
}

export function isPageId(v: string | null | undefined): v is PageId {
  return !!v && BY_ID.has(v as PageId);
}

/** The lessons proper: what prev/next walks and the masthead counts. */
export const LESSONS: PageDef[] = PAGES.filter((p) => p.id !== "overview" && p.id !== "glossary");

/** 1-based step number within its page, or 0 if the page has no such step. */
export function stepNumber(page: PageId, step: string): number {
  return pageDef(page).steps.findIndex((s) => s.id === step) + 1;
}

export function stepDef(page: PageId, step: string): StepDef | undefined {
  return pageDef(page).steps.find((s) => s.id === step);
}

/** The page before and after this one, in rail order. */
export function neighbours(id: PageId): { prev: PageDef | null; next: PageDef | null } {
  const i = PAGES.findIndex((p) => p.id === id);
  return { prev: PAGES[i - 1] ?? null, next: PAGES[i + 1] ?? null };
}

const BY_METRIC: Record<MetricKey, LessonId> = {
  color: "color",
  phash: "phash",
  "embedding-siglip": "siglip",
  "embedding-dino": "dino",
  "embedding-gram": "gram",
};

export function lessonForMetric(metric: MetricKey): LessonId {
  return BY_METRIC[metric];
}
