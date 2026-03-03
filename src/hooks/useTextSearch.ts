import { useState, useEffect, useRef } from "react";
import {
  initTextEncoder,
  isTextEncoderReady,
  encodeText,
  rankPanelsByTextQuery,
} from "../clipTextSearch";

export type TextSearchStatus =
  | "idle"       // no query, encoder not loaded
  | "loading"    // downloading / initializing the text encoder model
  | "ready"      // encoder loaded, waiting for input
  | "searching"  // encoding a query + ranking
  | "error";     // something went wrong

interface UseTextSearchOptions {
  /** Current search query string. Hook reacts to changes. */
  query: string;
  /** Image embeddings keyed by panel ID. Null if not yet loaded. */
  imageEmbeddings: Record<string, number[]> | null;
  /** Debounce interval in ms before triggering search after query changes. */
  debounceMs?: number;
  /** Minimum cosine similarity to include a result. */
  threshold?: number;
}

interface UseTextSearchReturn {
  /** Ordered array of panel IDs ranked by similarity, or null when inactive. */
  resultIds: string[] | null;
  /** Current status of the encoder / search pipeline. */
  status: TextSearchStatus;
  /** Download / init progress (0–100), available during "loading" status. */
  loadProgress: number;
  /** Error message if status is "error". */
  error: string | null;
}

/**
 * Declarative hook driven by the `query` prop.
 * Lazy-loads the SigLIP text encoder on first non-empty query,
 * debounces, encodes, and ranks panels by cosine similarity.
 * Returns result IDs sorted most-similar-first.
 */
export function useTextSearch({
  query,
  imageEmbeddings,
  debounceMs = 400,
  threshold = 0.01,
}: UseTextSearchOptions): UseTextSearchReturn {
  const [status, setStatus] = useState<TextSearchStatus>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultIds, setResultIds] = useState<string[] | null>(null);

  const embeddingsRef = useRef(imageEmbeddings);
  embeddingsRef.current = imageEmbeddings;

  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  // Track which query is "current" to discard stale results.
  const activeQueryRef = useRef("");

  useEffect(() => {
    const trimmed = query.trim();
    activeQueryRef.current = trimmed;

    // Empty query → clear results.
    if (!trimmed) {
      setResultIds(null);
      setError(null);
      if (isTextEncoderReady()) {
        setStatus("ready");
      } else {
        setStatus("idle");
      }
      return;
    }

    const timer = setTimeout(async () => {
      // Bail if query has changed during debounce.
      if (activeQueryRef.current !== trimmed) return;

      // Lazy-init the encoder.
      if (!isTextEncoderReady()) {
        setStatus("loading");
        setLoadProgress(0);
        try {
          await initTextEncoder((info) => {
            if (info.progress !== undefined) {
              setLoadProgress(Math.round(info.progress));
            }
          });
          setLoadProgress(100);
        } catch (err) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Failed to load text encoder");
          return;
        }
      }

      // Bail if query changed during init.
      if (activeQueryRef.current !== trimmed) return;

      const embs = embeddingsRef.current;
      if (!embs) return;

      setStatus("searching");
      try {
        const embedding = await encodeText(trimmed);
        // Bail if query changed during encoding.
        if (activeQueryRef.current !== trimmed) return;

        const results = rankPanelsByTextQuery(
          embedding,
          embs,
          thresholdRef.current,
        );
        setResultIds(results.map((r) => r.panelId));
        setStatus("ready");
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Search failed");
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, imageEmbeddings, debounceMs]);

  return { resultIds, status, loadProgress, error };
}