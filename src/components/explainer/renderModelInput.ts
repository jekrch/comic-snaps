/**
 * Renders what a model is actually fed as a real image, for the explainer's
 * zoom viewer. The figures in the explainer are CSS composites (a stretched
 * <img>, an SVG grid, background-position tiles), which a lightbox can't
 * show; this draws the same thing into a canvas at the model's true input
 * size, then blows it up with nearest-neighbour scaling so zooming in shows
 * the model's actual pixels as hard blocks, with the patch grid on top.
 *
 * The downscale is the browser's high-quality resample, not the exact
 * bicubic/bilinear filter the Python pipeline uses, so individual pixel
 * values differ slightly; the size, shape, crop and grid are exact.
 */

export interface StageSpec {
  /** Model input size in model pixels. */
  width: number;
  height: number;
  /** Draw a patch grid every this many model pixels. */
  patch?: number;
  /** Rearrange the image into a tiles×tiles grid; `order[d]` is the source tile shown at position d. */
  scramble?: { tiles: number; order: number[] };
}

/** Output long side to aim for: big enough to zoom into, small enough to encode fast. */
const TARGET_LONG_SIDE = 2048;

export function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return img.decode().then(() => img);
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

/** Integer tile edge `i` of `tiles` across `size` px, so tiles abut with no gaps. */
const edge = (i: number, tiles: number, size: number) => Math.round((i * size) / tiles);

/**
 * Draw `img` as the model sees it and return an object URL for a PNG, or
 * null if the canvas can't be read back (a cross-origin image taints it).
 * The caller owns the URL and must revoke it.
 */
export async function renderStage(img: HTMLImageElement, spec: StageSpec): Promise<string | null> {
  const { width: w, height: h } = spec;

  // 1. Resample to the model's input size.
  const [small, sctx] = canvas(w, h);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(img, 0, 0, w, h);

  // 2. Optionally scramble tiles (the Gram illustration).
  let source: HTMLCanvasElement = small;
  if (spec.scramble) {
    const { tiles, order } = spec.scramble;
    const [mixed, mctx] = canvas(w, h);
    order.forEach((from, to) => {
      const sx = edge(from % tiles, tiles, w);
      const sy = edge(Math.floor(from / tiles), tiles, h);
      const sw = edge((from % tiles) + 1, tiles, w) - sx;
      const sh = edge(Math.floor(from / tiles) + 1, tiles, h) - sy;
      const dx = edge(to % tiles, tiles, w);
      const dy = edge(Math.floor(to / tiles), tiles, h);
      const dw = edge((to % tiles) + 1, tiles, w) - dx;
      const dh = edge(Math.floor(to / tiles) + 1, tiles, h) - dy;
      mctx.drawImage(small, sx, sy, sw, sh, dx, dy, dw, dh);
    });
    source = mixed;
  }

  // 3. Blow up with hard pixel edges, so each model pixel is a visible block.
  const k = Math.max(1, Math.floor(TARGET_LONG_SIDE / Math.max(w, h)));
  const [out, octx] = canvas(w * k, h * k);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(source, 0, 0, w * k, h * k);

  // 4. Patch grid, on patch boundaries in model pixels.
  if (spec.patch) {
    const step = spec.patch * k;
    const line = Math.max(1, Math.round(k / 3));
    octx.fillStyle = "rgba(255, 255, 255, 0.45)";
    for (let x = step; x < w * k; x += step) octx.fillRect(x - line / 2, 0, line, h * k);
    for (let y = step; y < h * k; y += step) octx.fillRect(0, y - line / 2, w * k, line);
  }

  try {
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null; // tainted canvas
  }
}
