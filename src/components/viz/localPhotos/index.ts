import type { Panel } from "../../../types";
import { describeImage } from "./analyze";
import type { ImageDescription } from "./analyze";
import type { DescribeRequest, DescribeResponse } from "./worker";

/**
 * How the reader chose the images: a whole directory at once, or the ones they
 * picked out of one by hand. Nothing downstream cares which — it only changes
 * the dialog that is opened and what there is to call the set afterwards.
 */
export type PickKind = "directory" | "files";

/**
 * A set of the reader's own images, standing in for the gallery for the length
 * of a run.
 *
 * Nothing here is uploaded and nothing is written down. The files are read by
 * the page, described in a worker, and handed to the engine as `blob:` URLs
 * that die with the tab — which is also why the set does not survive a reload
 * and has to be chosen again each session.
 */
export interface LocalPhotoSet {
  panels: Panel[];
  kind: PickKind;
  /** The directory, when one was chosen. Files picked by hand carry no path,
   *  so there is nothing to name the set after. */
  name: string | null;
  /** Files that were not images, or would not decode — HEIC, mostly. */
  skipped: number;
}

export interface ImportProgress {
  done: number;
  total: number;
}

/**
 * How many images are decoded at once. Each one holds a full-size bitmap while
 * it is measured — a 12MP photo is 48MB of RGBA — so this is a memory ceiling
 * as much as a throughput one, and the answer is small however many cores there
 * are.
 */
const CONCURRENCY = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));

/** Anything the browser is willing to call an image. Whether it can actually
 *  decode it is the decoder's answer, not ours — Safari reads HEIC and nothing
 *  else does, and an allowlist here would be wrong on one of them. */
function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

// --- Picking ----------------------------------------------------------------

export interface PickedImages {
  files: File[];
  kind: PickKind;
  name: string | null;
}

/**
 * Ask for images: a whole directory, or a hand-picked few.
 *
 * A plain file input either way, rather than `showDirectoryPicker` — that
 * exists only on Chromium, this is the path every browser has, `webkitdirectory`
 * recurses on its own, and — the point of the exercise — it hands over `File`
 * objects without the page ever being able to send them anywhere.
 *
 * Resolves null if the reader backs out. On the browsers that do not fire
 * `cancel` it simply never resolves, which is why nothing upstream shows a
 * pending state until files actually arrive.
 */
export function pickPhotos(kind: PickKind): Promise<PickedImages | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (kind === "directory") {
      input.webkitdirectory = true;
    } else {
      // Only narrows the dialog, and only where the browser honours it — the
      // reader can still force any file through, which is why the import
      // filters again on the way in.
      input.accept = "image/*";
    }
    input.style.display = "none";

    const settle = (value: PickedImages | null) => {
      input.remove();
      resolve(value);
    };

    input.addEventListener("cancel", () => settle(null));
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return settle(null);
      // A directory pick reports paths relative to what was chosen, so the
      // directory's own name is the first segment of any of them. Files picked
      // by hand have no path at all.
      const name =
        kind === "directory" ? files[0].webkitRelativePath?.split("/")[0] || "photos" : null;
      settle({ files, kind, name });
    });

    document.body.appendChild(input);
    input.click();
  });
}

// --- Describing -------------------------------------------------------------

interface Runner {
  describe(file: Blob): Promise<ImageDescription>;
  dispose(): void;
}

/** A worker that handles one image at a time, so a request needs no id to be
 *  matched to its answer. */
function spawnRunner(): Runner {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    // No module workers: the same work, on the thread that asked for it.
    return { describe: describeImage, dispose: () => {} };
  }

  let pending: { resolve: (value: ImageDescription) => void; reject: (error: Error) => void } | null =
    null;

  worker.onmessage = (event: MessageEvent<DescribeResponse>) => {
    const settle = pending;
    pending = null;
    if (!settle) return;
    if (event.data.ok) {
      const { ok: _ok, ...description } = event.data;
      settle.resolve(description);
    } else {
      settle.reject(new Error(event.data.error));
    }
  };
  worker.onerror = () => {
    const settle = pending;
    pending = null;
    settle?.reject(new Error("worker failed"));
  };

  return {
    describe: (file) =>
      new Promise<ImageDescription>((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage({ file } satisfies DescribeRequest);
      }),
    dispose: () => {
      pending?.reject(new Error("cancelled"));
      pending = null;
      worker.terminate();
    },
  };
}

function baseName(fileName: string): string {
  const cut = fileName.lastIndexOf(".");
  return cut > 0 ? fileName.slice(0, cut) : fileName;
}

/**
 * A described file as the engine wants it.
 *
 * Most of `Panel` is bibliography — issue, artist, credits, hashes — and none of
 * it applies to somebody's photograph, so it is left empty rather than invented.
 * What the visualizer actually reads is the four fields below the filename:
 * the dimensions every scene crops against, the palette the director picks and
 * levels by, and `blur`, which is a gallery content gate and is nothing here.
 */
function toPanel(index: number, file: File, url: string, described: ImageDescription): Panel {
  return {
    id: `local:${index}:${file.name}`,
    title: baseName(file.name),
    slug: "",
    issue: "",
    year: new Date(file.lastModified).getFullYear(),
    artist: "",
    image: url,
    notes: null,
    tags: [],
    postedBy: "",
    addedAt: new Date(file.lastModified).toISOString(),
    width: described.width,
    height: described.height,
    phash: "",
    ahash: "",
    dhash: "",
    dominantColors: described.dominantColors,
    colorfulness: described.colorfulness,
    blur: null,
    blurStart: null,
    local: true,
  };
}

/**
 * Read, measure and describe what was picked. Reports after every file, so the
 * count on screen is the number actually finished rather than an estimate.
 *
 * Aborting revokes everything already handed out — a set that is not going to
 * be watched should not keep its files alive.
 */
export async function importPhotos(
  picked: PickedImages,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal
): Promise<LocalPhotoSet> {
  // A directory arrives in whatever order the filesystem gave it; by path it is
  // at least the order the reader sees in their own file browser. A hand-picked
  // selection has no paths, and sorts by name for the same reason.
  const images = picked.files
    .filter(isImage)
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));

  const total = images.length;
  onProgress({ done: 0, total });
  if (total === 0) {
    return { panels: [], kind: picked.kind, name: picked.name, skipped: picked.files.length };
  }

  const panels = new Array<Panel | null>(total).fill(null);
  const runners = Array.from({ length: Math.min(CONCURRENCY, total) }, spawnRunner);
  let next = 0;
  let done = 0;

  try {
    await Promise.all(
      runners.map(async (runner) => {
        while (next < total && !signal.aborted) {
          const index = next++;
          const file = images[index];
          const url = URL.createObjectURL(file);
          try {
            panels[index] = toPanel(index, file, url, await runner.describe(file));
          } catch {
            // A file that will not decode is simply not in the set. Nothing is
            // worth interrupting an import of five hundred over.
            URL.revokeObjectURL(url);
          }
          onProgress({ done: ++done, total });
        }
      })
    );
  } finally {
    for (const runner of runners) runner.dispose();
  }

  const usable = panels.filter((panel): panel is Panel => panel !== null);

  if (signal.aborted) {
    releasePhotos(usable);
    throw new DOMException("Import cancelled", "AbortError");
  }

  return {
    panels: usable,
    kind: picked.kind,
    name: picked.name,
    skipped: picked.files.length - usable.length,
  };
}

/** Hand the files back. Every URL here is dead afterwards, so nothing that is
 *  still on screen may be released. */
export function releasePhotos(panels: Panel[]): void {
  for (const panel of panels) {
    if (panel.local) URL.revokeObjectURL(panel.image);
  }
}
