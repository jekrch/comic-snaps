import { useCallback, useState } from "react";

/** What the wall's cards show beyond the art, each off by default. */
export interface ViewOptions {
  /** The card's details (title, issue, artist, year, notes, tags) always up,
   *  rather than only on hover or the first tap. */
  details: boolean;
  /** A badge naming whoever is at the top of the panel's ownership chain. */
  owner: boolean;
  /** The artist's age in the year the issue came out. */
  age: boolean;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { details: false, owner: false, age: false };

/** The URL param, `show=details,owner,age`. Carried across filter and sort updates
 *  by `useFilterParams`, which rebuilds the rest of the query from scratch. */
export const VIEW_OPTIONS_PARAM = "show";

/** In the order they are written, so a link reads the same however it was set. */
const KEYS: (keyof ViewOptions)[] = ["details", "owner", "age"];

/** `"owner,age"` → both on. Unknown names are ignored. */
export function parseViewOptions(raw: string | null | undefined): ViewOptions {
  const on = new Set((raw ?? "").split(",").map((s) => s.trim()));
  return { details: on.has("details"), owner: on.has("owner"), age: on.has("age") };
}

/** Both on → `"owner,age"`; nothing on → `""`, and the param is dropped. */
export function formatViewOptions(options: ViewOptions): string {
  return KEYS.filter((k) => options[k]).join(",");
}

function readURL(): ViewOptions {
  return parseViewOptions(new URLSearchParams(window.location.search).get(VIEW_OPTIONS_PARAM));
}

function writeURL(options: ViewOptions) {
  const params = new URLSearchParams(window.location.search);
  const value = formatViewOptions(options);
  if (value) params.set(VIEW_OPTIONS_PARAM, value);
  else params.delete(VIEW_OPTIONS_PARAM);
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

/**
 * The wall's view options, kept in the URL like the sort and the filters, so
 * a link opens the wall labelled the way it was when it was copied. Read
 * from the URL on mount — the wall unmounts on a view switch, and the param
 * rides through the other views untouched — and written back on each change.
 */
export function useViewOptions(): [ViewOptions, (next: ViewOptions) => void] {
  const [options, setOptions] = useState<ViewOptions>(readURL);
  const update = useCallback((next: ViewOptions) => {
    setOptions(next);
    writeURL(next);
  }, []);
  return [options, update];
}
