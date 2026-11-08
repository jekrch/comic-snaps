import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/** The way out, shared by the CSS (`.search-palette.is-leaving`) and the unmount. */
const EXIT_MS = 170;
/** A keystroke this soon after the last one is part of a burst… */
const BURST_GAP_MS = 300;
/** …and the gallery waits this long into the quiet before refiling for it. */
const SETTLE_MS = 240;

interface SearchPaletteProps {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  /** Panels that survive every active filter, the query included. */
  resultCount: number;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Ctrl/⌘+F on the wall or a shelf: one field floated over the page, writing
 * the same free-text query the filter card's search box does. The scrim only
 * darkens the band the field sits in, so the results refiling underneath stay
 * in view as the reader types — the page is the result list.
 *
 * The input is 16px on every device: below that, iOS zooms the page to the
 * field on focus.
 *
 * The field answers every keystroke, but the gallery doesn't: a lone keystroke
 * is applied at once, while a burst of them is held until the typing settles.
 * Refiling the page on each key of a fast word restarts its fade every few
 * frames and the browser falls behind, which reads as stutter; one refile at
 * the end of the word reads as the page keeping up.
 */
export default function SearchPalette({ open, query, onQueryChange, onClose, resultCount }: SearchPaletteProps) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Whatever had focus before, handed back on the way out. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** The first edit of an opening takes the page home, so the results are what's under the field. */
  const scrolledRef = useRef(false);
  /** What the field shows, ahead of what the gallery has been given. */
  const [draft, setDraft] = useState(query);
  const lastKeyAtRef = useRef(-Infinity);
  const settleRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const commit = (value: string) => {
    if (settleRef.current !== null) {
      window.clearTimeout(settleRef.current);
      settleRef.current = null;
    }
    pendingRef.current = null;
    onQueryChangeRef.current(value);
  };

  /** Anything still held back goes through — closing never drops a keystroke. */
  const flush = () => {
    if (pendingRef.current !== null) commit(pendingRef.current);
  };

  const handleInput = (value: string) => {
    setDraft(value);
    const now = performance.now();
    const inBurst = now - lastKeyAtRef.current < BURST_GAP_MS;
    lastKeyAtRef.current = now;
    if (!inBurst) {
      commit(value);
      return;
    }
    pendingRef.current = value;
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      if (pendingRef.current !== null) commit(pendingRef.current);
    }, SETTLE_MS);
  };

  // Each opening starts from the query as it stands; each closing — from here
  // or from the app — hands over whatever was still held.
  useEffect(() => {
    if (open) {
      setDraft(query);
      lastKeyAtRef.current = -Infinity;
      return;
    }
    flush();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    []
  );

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(
      () => {
        setMounted(false);
        setLeaving(false);
      },
      prefersReducedMotion() ? 0 : EXIT_MS
    );
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // Focus on the way in, with whatever was typed last time selected so a new
  // word replaces it and an arrow key keeps it.
  useEffect(() => {
    if (!open || !mounted) return;
    scrolledRef.current = false;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
    return () => {
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
      else inputRef.current?.blur();
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        flush();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  // The count describes the page, so it ticks when the gallery does, not per key.
  const trimmed = query.trim();
  const countLabel =
    resultCount === 0 ? "no matches" : `${resultCount} ${resultCount === 1 ? "panel" : "panels"}`;

  return (
    <div
      className={`search-palette${leaving ? " is-leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Search panels"
    >
      <div
        className="search-palette-scrim"
        onClick={() => {
          flush();
          onClose();
        }}
        aria-hidden="true"
      />
      <form
        role="search"
        className="search-palette-bar"
        onSubmit={(e) => {
          e.preventDefault();
          flush();
          onClose();
        }}
      >
        <Search size={16} strokeWidth={1.75} className="search-palette-icon shrink-0" />
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Search titles, artists, tags…"
          value={draft}
          onChange={(e) => {
            handleInput(e.target.value);
            if (!scrolledRef.current) {
              scrolledRef.current = true;
              if (window.scrollY > 0) {
                window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
              }
            }
          }}
          className="search-palette-input"
          aria-describedby="search-palette-count"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <span id="search-palette-count" className="search-palette-count" aria-live="polite">
          {trimmed && (
            <span key={resultCount} className={resultCount === 0 ? "is-empty" : undefined}>
              {countLabel}
            </span>
          )}
        </span>
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            className="search-palette-clear"
            onClick={() => {
              setDraft("");
              commit("");
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        ) : (
          <kbd className="search-palette-kbd">esc</kbd>
        )}
      </form>
    </div>
  );
}
