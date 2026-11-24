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
}

const noop = () => {};

export const GuideContext = createContext<GuideContextValue>({
  page: "overview",
  desktop: false,
  codeStep: null,
  openCode: noop,
  goTo: noop,
  copyStepLink: noop,
});

export function useGuide(): GuideContextValue {
  return useContext(GuideContext);
}

/** The step a piece of content sits in. */
export const StepContext = createContext<string | null>(null);
