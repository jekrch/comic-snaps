/**
 * The metadata the director needs, measured in the browser.
 *
 * A gallery panel arrives with all of this precomputed by
 * `scripts/metadata/image_metadata.py`. An image off the reader's own disk has
 * never been through that, so it is measured here instead — deliberately the
 * same measurements, to the same 64px thumbnail and the same k, so the palette
 * maths downstream (`panelKey`, `levelsFor`, `paletteDistance`) behaves the
 * same whichever set the director was handed. Checked against the pipeline over
 * the whole gallery: colourfulness agrees exactly, and nine palettes in ten
 * agree within a ΔE nobody could see. The rest are images with no well
 * separated colours, where k-means has several minima and the two
 * implementations settle in different ones — this one usually the tighter, for
 * restarting where the pipeline's `n_init=1` does not.
 *
 * The perceptual hashes that script also computes are left out: nothing in the
 * visualizer reads them.
 *
 * Written to run in a worker or on the main thread — the only thing it needs
 * from either is a 2D canvas, and it takes whichever kind is there.
 */

/** Longest edge of the thumbnail every colour measurement is taken from. */
const THUMB_EDGE = 64;

/** Dominant colours extracted. Matches `NUM_DOMINANT_COLORS` in the pipeline;
 *  palettes are compared rank-by-rank, so this is not a free parameter. */
const CLUSTERS = 3;

/** Lloyd iterations. Converges long before this on 4k points and 3 centres —
 *  it is a ceiling, not a schedule. */
const MAX_ITERATIONS = 32;

/**
 * Seedings tried, best kept. k-means finds a local minimum, and on an image
 * with no strongly separated colours — most black-and-white art — which one it
 * finds is down to where the seeds landed. Four runs over three centres and a
 * few thousand points is still under a millisecond.
 */
const RESTARTS = 4;

export type Lab = [number, number, number];

export interface ImageDescription {
  width: number;
  height: number;
  dominantColors: Lab[];
  colorfulness: number;
}

/** Decode an image and measure it. Closes everything it decodes. */
export async function describeImage(blob: Blob): Promise<ImageDescription> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  if (width === 0 || height === 0) {
    bitmap.close?.();
    throw new Error("zero-sized image");
  }
  try {
    return { width, height, ...describePixels(await thumbnail(bitmap)) };
  } finally {
    bitmap.close?.();
  }
}

/**
 * The colour half, over raw thumbnail pixels.
 *
 * Split out from the decode so it can be checked against the pipeline it is
 * copying: hand both the same 64px thumbnail and the palettes should agree.
 */
export function describePixels(rgba: Uint8ClampedArray): Omit<ImageDescription, "width" | "height"> {
  const pixels = toLab(rgba);
  return { dominantColors: dominantColors(pixels), colorfulness: colorfulness(pixels) };
}

// --- Thumbnail --------------------------------------------------------------

function make2d(width: number, height: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (typeof OffscreenCanvas !== "undefined") {
    const context = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
    if (context) return context;
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) return context;
  }
  throw new Error("no 2d canvas available");
}

/**
 * Every pixel of a ≤64px thumbnail, as sRGB bytes.
 *
 * The reduction is the part worth care: a phone photo is a 60× downscale, and
 * `drawImage` straight to 64px point-samples a handful of pixels out of twelve
 * megapixels — the palette that comes back describes whatever those few pixels
 * happened to be. `createImageBitmap`'s resizer is a real resampler, so it is
 * asked first; the fallback halves repeatedly, which keeps every source pixel
 * contributing even when each step is only bilinear.
 */
async function thumbnail(bitmap: ImageBitmap): Promise<Uint8ClampedArray> {
  const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const context = make2d(width, height);
  let drawn = false;
  try {
    const thumb = await createImageBitmap(bitmap, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
    context.drawImage(thumb as unknown as CanvasImageSource, 0, 0);
    thumb.close?.();
    drawn = true;
  } catch {
    // Older Safari rejects the resize options.
  }
  if (!drawn) halve(context, bitmap, width, height);

  return context.getImageData(0, 0, width, height).data;
}

/** Successive halving down to the target, then one last draw into it. */
function halve(
  destination: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number
): void {
  let source: CanvasImageSource = bitmap as unknown as CanvasImageSource;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;

  while (sourceWidth > width * 2 && sourceHeight > height * 2) {
    const stepWidth = Math.max(width, Math.floor(sourceWidth / 2));
    const stepHeight = Math.max(height, Math.floor(sourceHeight / 2));
    const step = make2d(stepWidth, stepHeight);
    step.imageSmoothingQuality = "high";
    step.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, stepWidth, stepHeight);
    source = step.canvas as unknown as CanvasImageSource;
    sourceWidth = stepWidth;
    sourceHeight = stepHeight;
  }

  destination.imageSmoothingQuality = "high";
  destination.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
}

// --- Colour -----------------------------------------------------------------

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (t * 24389 / 27 + 16) / 116;
}

/** sRGB bytes to CIELAB under D65, flattened. Alpha is discarded, as the
 *  pipeline's `convert("RGB")` discards it. */
function toLab(rgba: Uint8ClampedArray): Float64Array {
  const count = rgba.length / 4;
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = linearize(rgba[i * 4]);
    const g = linearize(rgba[i * 4 + 1]);
    const b = linearize(rgba[i * 4 + 2]);

    const x = labF((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
    const y = labF(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
    const z = labF((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);

    out[i * 3] = 116 * y - 16;
    out[i * 3 + 1] = 500 * (x - y);
    out[i * 3 + 2] = 200 * (y - z);
  }
  return out;
}

/** RMS of the a* and b* standard deviations: how much chroma *varies*, which is
 *  near zero for line art on yellowed paper however warm its mean is. */
function colorfulness(pixels: Float64Array): number {
  const count = pixels.length / 3;
  if (count === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < count; i++) {
    sumA += pixels[i * 3 + 1];
    sumB += pixels[i * 3 + 2];
  }
  const meanA = sumA / count;
  const meanB = sumB / count;

  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < count; i++) {
    varianceA += (pixels[i * 3 + 1] - meanA) ** 2;
    varianceB += (pixels[i * 3 + 2] - meanB) ** 2;
  }
  return round1(Math.sqrt(varianceA / count + varianceB / count));
}

/** Deterministic, so re-importing the same directory describes it the same way. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance2(pixels: Float64Array, i: number, centers: Float64Array, c: number): number {
  const dL = pixels[i * 3] - centers[c * 3];
  const da = pixels[i * 3 + 1] - centers[c * 3 + 1];
  const db = pixels[i * 3 + 2] - centers[c * 3 + 2];
  return dL * dL + da * da + db * db;
}

interface Clustering {
  centers: Float64Array;
  sizes: Int32Array;
  /** Sum of squared distance to the assigned centre — how good this minimum is. */
  inertia: number;
}

/** One seeded run of Lloyd's algorithm to convergence. */
function cluster(pixels: Float64Array, count: number, k: number, seed: number): Clustering {
  const random = mulberry32(seed);
  const centers = new Float64Array(k * 3);
  const nearest = new Float64Array(count).fill(Infinity);

  // k-means++: spread the seeds by squared distance rather than taking three at
  // random, which on a photo that is nine tenths sky lands all three in it.
  for (let c = 0; c < k; c++) {
    let chosen = 0;
    if (c === 0) {
      chosen = Math.floor(random() * count);
    } else {
      let total = 0;
      for (let i = 0; i < count; i++) total += nearest[i];
      let target = random() * total;
      for (let i = 0; i < count; i++) {
        target -= nearest[i];
        if (target <= 0) {
          chosen = i;
          break;
        }
      }
    }
    centers[c * 3] = pixels[chosen * 3];
    centers[c * 3 + 1] = pixels[chosen * 3 + 1];
    centers[c * 3 + 2] = pixels[chosen * 3 + 2];
    for (let i = 0; i < count; i++) {
      nearest[i] = Math.min(nearest[i], distance2(pixels, i, centers, c));
    }
  }

  const assignment = new Int32Array(count).fill(-1);
  const sums = new Float64Array(k * 3);
  const sizes = new Int32Array(k);
  let inertia = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let moved = false;
    sums.fill(0);
    sizes.fill(0);
    inertia = 0;

    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < k; c++) {
        const d = distance2(pixels, i, centers, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
      inertia += bestDistance;
      sums[best * 3] += pixels[i * 3];
      sums[best * 3 + 1] += pixels[i * 3 + 1];
      sums[best * 3 + 2] += pixels[i * 3 + 2];
      sizes[best]++;
    }

    if (!moved) break;

    for (let c = 0; c < k; c++) {
      if (sizes[c] === 0) continue;
      centers[c * 3] = sums[c * 3] / sizes[c];
      centers[c * 3 + 1] = sums[c * 3 + 1] / sizes[c];
      centers[c * 3 + 2] = sums[c * 3 + 2] / sizes[c];
    }
  }

  return { centers, sizes, inertia };
}

/**
 * The dominant colours in Lab, ordered by cluster size — the order matters as
 * much as the colours do, since `paletteDistance` pairs two palettes rank by
 * rank and `panelKey` weights the first hardest.
 */
function dominantColors(pixels: Float64Array): Lab[] {
  const count = pixels.length / 3;
  if (count === 0) return [];
  const k = Math.min(CLUSTERS, count);

  let best = cluster(pixels, count, k, 42);
  for (let restart = 1; restart < RESTARTS; restart++) {
    const attempt = cluster(pixels, count, k, 42 + restart * 7919);
    if (attempt.inertia < best.inertia) best = attempt;
  }
  const { centers, sizes } = best;

  const ranked: { color: Lab; size: number }[] = [];
  for (let c = 0; c < k; c++) {
    // An empty cluster is not a colour the image contains — it is a seed that
    // lost every pixel it started with, and its centre is still sitting wherever
    // the seeding put it.
    if (sizes[c] === 0) continue;
    ranked.push({
      color: [round1(centers[c * 3]), round1(centers[c * 3 + 1]), round1(centers[c * 3 + 2])],
      size: sizes[c],
    });
  }
  ranked.sort((a, b) => b.size - a.size);
  return ranked.map((entry) => entry.color);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
