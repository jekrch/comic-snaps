/**
 * Patch maps for the explainer's transformer section: a few hand-picked
 * example panels, written by scripts/compute-patch-maps.py to
 * public/data/patch-examples.json.
 *
 * For each model and each recorded layer, every patch's token has been
 * reduced to `dims` int8 numbers (PCA within the panel). Cosine similarity
 * on those is a close stand-in for cosine on the full tokens, which is all
 * the figure needs: "which patches does this patch now resemble?"
 */

export type PatchModel = "dino" | "siglip";

interface RawModelMaps {
  cols: number;
  rows: number;
  /** One base64 (patches × dims) int8 block per layer. */
  tokens: string[];
  /** DINOv2 only: CLS attention per patch, base64 uint8 scaled to max 255. */
  summary?: string;
  /** Patches the model uses as scratch space; not shown as art. */
  scratch: number[];
  /** Where the figure starts. */
  focus: number;
}

interface RawExample {
  id: string;
  title: string;
  issue: number | null;
  image: string;
  dino: RawModelMaps;
  siglip: RawModelMaps;
}

interface RawExamplesFile {
  version: string;
  layers: number[];
  dims: number;
  examples: RawExample[];
}

/** One model's decoded patch data for one example panel. */
export interface ModelMaps {
  cols: number;
  rows: number;
  /** Layer numbers, parallel to `vectors`. */
  layers: number[];
  /** Per layer: unit-length vectors, patch-major (patches × dims). */
  vectors: Float32Array[];
  dims: number;
  summary: Float32Array | null;
  scratch: Set<number>;
  focus: number;
}

export interface PatchExample extends Record<PatchModel, ModelMaps> {
  id: string;
  title: string;
  issue: number | null;
  /** Gallery image path, as in gallery.json. */
  image: string;
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** int8 block → unit-length float vectors, so a dot product is a cosine. */
function unitVectors(b64: string, n: number, dims: number): Float32Array {
  const raw = new Int8Array(bytes(b64).buffer);
  const out = new Float32Array(n * dims);
  for (let p = 0; p < n; p++) {
    let norm = 0;
    for (let d = 0; d < dims; d++) norm += raw[p * dims + d] ** 2;
    const s = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let d = 0; d < dims; d++) out[p * dims + d] = raw[p * dims + d] * s;
  }
  return out;
}

/** A model's maps as stored → ready-to-use vectors and sets. */
function decode(raw: RawModelMaps, layers: number[], dims: number): ModelMaps {
  const n = raw.cols * raw.rows;
  return {
    cols: raw.cols,
    rows: raw.rows,
    layers,
    dims,
    vectors: raw.tokens.map((t) => unitVectors(t, n, dims)),
    summary: raw.summary ? Float32Array.from(bytes(raw.summary), (v) => v / 255) : null,
    scratch: new Set(raw.scratch),
    focus: raw.focus,
  };
}

let examples: Promise<PatchExample[]> | null = null;

/** The example panels, in display order; empty if the file can't be loaded. */
export function loadPatchExamples(): Promise<PatchExample[]> {
  if (!examples) {
    examples = fetch(`${import.meta.env.BASE_URL}data/patch-examples.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load patch examples: ${res.status}`);
        return res.json() as Promise<RawExamplesFile>;
      })
      .then((raw) =>
        raw.examples.map((e) => ({
          id: e.id,
          title: e.title,
          issue: e.issue,
          image: e.image,
          dino: decode(e.dino, raw.layers, raw.dims),
          siglip: decode(e.siglip, raw.layers, raw.dims),
        }))
      )
      .catch((err) => {
        console.error(err);
        examples = null;
        return [];
      });
  }
  return examples;
}

/** Cosine similarity of patch `focus` to every patch, at layer index `layer`. */
export function similarityMap(maps: ModelMaps, layer: number, focus: number): Float32Array {
  const v = maps.vectors[layer];
  const { dims } = maps;
  const n = maps.cols * maps.rows;
  const out = new Float32Array(n);
  const f = focus * dims;
  for (let p = 0; p < n; p++) {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += v[f + d] * v[p * dims + d];
    out[p] = dot;
  }
  return out;
}

/**
 * Similarities → 0..1 highlight strengths for display. The panel's median
 * patch maps to 0 and its best match (other than the focus itself) to 1,
 * so each layer's figure spends its contrast on the patches that stand out.
 * Scratch patches and the focus are left at 0; the figure marks them.
 */
export function highlight(sim: Float32Array, focus: number, skip: Set<number>): Float32Array {
  const rest: number[] = [];
  for (let i = 0; i < sim.length; i++) if (i !== focus && !skip.has(i)) rest.push(sim[i]);
  if (rest.length === 0) return new Float32Array(sim.length);
  rest.sort((a, b) => a - b);
  const hi = rest[rest.length - 1];
  let lo = rest[Math.floor((rest.length - 1) / 2)];
  // Half the patches tied with the best: stretch from the worst instead.
  if (hi - lo < 1e-6) lo = rest[0];
  const span = hi - lo;
  const out = new Float32Array(sim.length);
  for (let i = 0; i < sim.length; i++) {
    if (i === focus || skip.has(i)) continue;
    const t = span < 1e-6 ? 1 : Math.min(1, Math.max(0, (sim[i] - lo) / span));
    out[i] = t * t;
  }
  return out;
}
