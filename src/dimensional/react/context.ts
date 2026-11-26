import { createContext, useContext, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";

/** A term's definition: what it's called, what it means, where it's introduced. */
export interface TermDef {
  label: string;
  body: ReactNode;
  /** The page and section that introduce it. */
  page: string;
  section: string;
  /** That section's title, for links back from other pages. */
  sectionTitle?: string;
  /** That page's name, for the way there from another page. */
  pageLabel?: string;
}

export interface FigureProps {
  /** The name the figure was asked for by. */
  id: string;
  /** What shows where the figure can't: an image or a caption. */
  fallback: ReactNode;
}

export type FigureRegistry = Record<string, ComponentType<FigureProps>>;

/** Something beside a section at any depth: its code, or another facet. */
export interface Facet {
  name: string;
  /** The pane's title. */
  title: string;
  body: ReactNode;
  /** The body brings its own scrolling and padding (a code viewer): the pane adds none. */
  bare?: boolean;
}

export interface OpenFacet extends Facet {
  section: string;
  /** "Section 3" (or the host's noun for it), for the way back. */
  sectionLabel: string;
}

/** A section as the rail and the depth switch see it. */
export interface SectionEntry {
  id: string;
  title: string;
  short?: string;
  /** How many layers it has: its switch offers only those. */
  layers: number;
  /** Words at each depth, when known, for reading times. */
  words?: number[];
  el: HTMLElement;
}

export interface DocContextValue {
  page: string;
  levels: string[];
  desktop: boolean;
  reduced: boolean;
  scroller: HTMLElement | null;
  /** The depth a section has been asked for, before clamping to its layers. */
  requestedDepth(section: string): number;
  /** One section to one depth, in place; `hold` is its box just before. */
  setSectionDepth(section: string, depth: number): void;
  /** Sections switched by hand since the page opened: their new content fades in. */
  swapped: ReadonlySet<string>;
  /** Section numbers, in reading order; 0 for one that isn't numbered. */
  sectionNumber(section: string): number;
  register(entry: SectionEntry): () => void;
  openFacet: OpenFacet | null;
  toggleFacet(section: string, facet: Facet): void;
  goTo(page: string, step?: string | null): void;
  copyLink(step: string): void;
  term(id: string): TermDef | null;
  figures: FigureRegistry;
  store: DocStore;
}

export const DocContext = createContext<DocContextValue | null>(null);

export function useDoc(): DocContextValue {
  const ctx = useContext(DocContext);
  if (!ctx) throw new Error("Dimensional components must sit inside <DimDoc>.");
  return ctx;
}

/** The section a piece of content sits in. */
export const SectionContext = createContext<string | null>(null);

// --- Shared state --------------------------------------------------------------

/**
 * State a document's figures share across sections and depths, such as
 * which example pair a lesson follows: a choice made in one section's L2
 * still holds when another section opens at L1.
 */
export interface DocStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  subscribe(key: string, fn: () => void): () => void;
}

export function createDocStore(): DocStore {
  const values = new Map<string, unknown>();
  const subs = new Map<string, Set<() => void>>();
  return {
    get: (key) => values.get(key),
    set(key, value) {
      if (Object.is(values.get(key), value)) return;
      values.set(key, value);
      subs.get(key)?.forEach((f) => f());
    },
    subscribe(key, fn) {
      let s = subs.get(key);
      if (!s) subs.set(key, (s = new Set()));
      s.add(fn);
      return () => s!.delete(fn);
    },
  };
}

const fallbackStore = createDocStore();

/** A piece of the document's shared state, like `useState` but shared by key. */
export function useDocState<T>(key: string, initial: T): [T, (v: T) => void] {
  const store = useContext(DocContext)?.store ?? fallbackStore;
  const value = useSyncExternalStore(
    (fn) => store.subscribe(key, fn),
    () => store.get(key),
  ) as T | undefined;
  return [value === undefined ? initial : value, (v: T) => store.set(key, v)];
}
