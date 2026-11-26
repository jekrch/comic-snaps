import { createContext, useContext } from "react";

/**
 * What a lesson's figures need from the Guide that the dimensional
 * framework doesn't provide: the gallery's worked example. Everything else
 * (the page, depth, terms, code, links) comes from `DimDoc` (`useDoc`).
 */
export interface GuideContextValue {
  /** Draws a new anchor panel, when the page has one. */
  shuffleAnchor?: () => void;
}

export const GuideContext = createContext<GuideContextValue>({});

export function useGuide(): GuideContextValue {
  return useContext(GuideContext);
}
