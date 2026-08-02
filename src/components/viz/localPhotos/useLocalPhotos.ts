import { useCallback, useEffect, useRef, useState } from "react";
import { importPhotos, pickPhotos, releasePhotos } from "./index";
import type { ImportProgress, LocalPhotoSet, PickKind } from "./index";

export interface LocalPhotos {
  set: LocalPhotoSet | null;
  /** Non-null only while a selection is being read. */
  progress: ImportProgress | null;
  error: string | null;
  /** Open the picker — a whole directory, or images chosen by hand — and read
   *  in whatever comes back, replacing anything already held. */
  pick: (kind: PickKind) => void;
  clear: () => void;
}

/**
 * The reader's own images, held for as long as the tab is open.
 *
 * Owned up here rather than in the launch modal, which unmounts when it is
 * dismissed: the run holds the panels but not the object URLs' lifetime, so a
 * modal that released them on the way out would take the images out from under
 * a run that was still playing.
 */
export function useLocalPhotos(): LocalPhotos {
  const [set, setSet] = useState<LocalPhotoSet | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** What is on screen right now, for the unmount release — reading `set` there
   *  would close over whichever one was current when the effect was set up. */
  const setRef = useRef<LocalPhotoSet | null>(null);
  setRef.current = set;

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    setError(null);
    setSet((current) => {
      if (current) releasePhotos(current.panels);
      return null;
    });
  }, []);

  const pick = useCallback((kind: PickKind) => {
    void (async () => {
      const picked = await pickPhotos(kind);
      if (!picked) return;

      // Whatever was there is being replaced, including an import still running.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSet((current) => {
        if (current) releasePhotos(current.panels);
        return null;
      });
      setError(null);
      setProgress({ done: 0, total: picked.files.length });

      // An import that has been replaced still has files in flight, and their
      // counts belong to a selection nobody is waiting for any more.
      const report = (progress: ImportProgress) => {
        if (abortRef.current === controller) setProgress(progress);
      };

      try {
        const imported = await importPhotos(picked, report, controller.signal);
        if (controller.signal.aborted) return;
        setSet(imported);
        setError(
          imported.panels.length === 0
            ? kind === "directory"
              ? "Nothing in that folder could be read as an image."
              : "None of those files could be read as an image."
            : null
        );
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "Could not read those images.");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setProgress(null);
        }
      }
    })();
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (setRef.current) releasePhotos(setRef.current.panels);
    },
    []
  );

  return { set, progress, error, pick, clear };
}
