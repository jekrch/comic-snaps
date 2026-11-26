/**
 * Dimensional UI: a framework for rendering dimensional documents.
 *
 * - `core/`: the mechanisms, free of React (scroll spy, glide, reveal,
 *   overlay stack, route and storage adapters, idle cache).
 * - `parse/`: reads the published or authoring Markdown into the content
 *   model (`model.ts`).
 * - `react/`: the components (DimDoc, Page, Section, Layer, Term, Figure,
 *   Rail, DepthSwitch) and `markdownPage`, which maps a parsed document onto
 *   them.
 * - `styles/dimensional.css`: tokens and the stylesheet, in `@layer dd`.
 *
 * Imports nothing from the app it lives in; React and React DOM only.
 */
export * from "./model";
export { parseDimensional, slug } from "./parse/parse";
export { parseBlocks, parseInline } from "./parse/markdown";

export { hashRoute, localStore, memoryRoute, memoryStore, queryRoute } from "./core/adapters";
export type { Route, RouteAdapter, StorageAdapter } from "./core/adapters";
export { glide, glideDuration } from "./core/glide";
export { idleCache, imagePixels } from "./core/idleCache";
export type { IdleCache } from "./core/idleCache";
export { freezeLayers, placePopover } from "./core/layers";
export type { AppBehind } from "./core/layers";
export { MOTION, motionToken, prefersReducedMotion } from "./core/motion";
export { STOP_EVENTS, hasOverlays, isTopOverlay, popOverlay, pushOverlay, resetOverlays } from "./core/overlayStack";
export { observeReveal } from "./core/reveal";
export { createScrollSpy, holdPlace, offsetIn, readingProgress } from "./core/scroll";
export type { SpyState } from "./core/scroll";

export { DimDoc, DepthSwitch, Page } from "./react/DimDoc";
export type { DimDocProps, Host, PageProps, RailState, SourceGroupDef } from "./react/DimDoc";
export { Layer, Section } from "./react/Section";
export type { SectionProps } from "./react/Section";
export { Term } from "./react/Term";
export { Figure, Wide } from "./react/Figure";
export { Blocks, Inlines, MarkdownSection, markdownPage, shortVersion } from "./react/Markdown";
export type { LinkTarget, MarkdownOptions, MarkdownPageOptions } from "./react/Markdown";
export { useDoc, useDocState } from "./react/context";
export type { Facet, FigureProps, FigureRegistry, TermDef } from "./react/context";
export { useMediaQuery, useOverlay, usePresence, useReveal, useScrollSpy } from "./react/hooks";
