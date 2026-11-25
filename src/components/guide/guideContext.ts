import { createContext, useContext } from "react";
import type { CodeRef } from "../explainer/code/snippets";
import type { PageId } from "./lessons";

/** What a lesson's building blocks need from the Guide around them. */
export interface GuideContextValue {
  page: PageId;
  /** The three-column layout (rail, column, margin) is in use. */
  desktop: boolean;
  /** The step whose code is open, if any. */
  codeStep: string | null;
  openCode: (step: string, ref: CodeRef) => void;
  goTo: (page: PageId, step?: string) => void;
  copyStepLink: (step: string) => void;
  /**
   * Whether a step shows its short version. Absent (tests, pages without a
   * short version): each Section shows whichever version rendered it.
   */
  stepShort?: (step: string) => boolean;
  /** Opens one step in full, or folds it back to its short version, in place. */
  setStepShort: (step: string, on: boolean) => void;
  /** The lesson-level switch: every step short, or every step full. */
  setAllShort: (on: boolean) => void;
  /**
   * Where a step's content goes: the Guide keeps one `<section>` per step,
   * in lesson order, and the full and short versions portal into it, so the
   * two can be mixed step by step. Absent: Sections render where they are.
   * Null for a step: its slot isn't in the page yet.
   */
  stepSlot?: (step: string) => HTMLElement | null;
  /** Steps switched by hand since the page opened; their new content fades in. */
  swapped?: ReadonlySet<string>;
  /** Draws a new anchor panel, when the page has one. */
  shuffleAnchor?: () => void;
}

const noop = () => {};

export const GuideContext = createContext<GuideContextValue>({
  page: "overview",
  desktop: false,
  codeStep: null,
  openCode: noop,
  goTo: noop,
  copyStepLink: noop,
  setStepShort: noop,
  setAllShort: noop,
});

export function useGuide(): GuideContextValue {
  return useContext(GuideContext);
}

/**
 * Which version of a lesson a tree of Sections belongs to, on pages with a
 * short version; null elsewhere.
 */
export const VariantContext = createContext<"full" | "short" | null>(null);

/** The step a piece of content sits in. */
export const StepContext = createContext<string | null>(null);
