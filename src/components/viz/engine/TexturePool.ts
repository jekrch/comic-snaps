import { Texture } from "ogl";
import type { OGLRenderingContext } from "ogl";
import type { Panel } from "../../../types";
import { panelImageUrl } from "../../../utils/imageUrl";

const MAX_CONCURRENT_DECODES = 2;

/**
 * How many times a panel that will not decode is asked for again.
 *
 * `request` is called every frame for everything the composition wants, and a
 * panel whose fetch failed is resident, pending and staged in none of the sets
 * that make that call cheap — so a single missing file was sixty fetches a
 * second for as long as the run kept wanting it. A couple of retries covers the
 * blip that a dropped connection actually is; past that the panel is missing,
 * and the frame that wanted it has already gone on without it.
 */
const MAX_DECODE_ATTEMPTS = 3;

/**
 * Anisotropic taps on the panel textures, where the device offers them.
 *
 * Paired with the mip chain in `insert`, and the reason the chain is affordable
 * at all. Trilinear alone picks its level off the *larger* of the two screen-space
 * derivatives, so a page seen at a grazing angle — the far end of a corridor, the
 * curl at the edge of a drape, which is most of what the spatial pass draws — is
 * blurred along the axis it is still sharp in. That is exactly the soft grey the
 * scenes are tuned to avoid. Sampling along the minor axis keeps those surfaces
 * at the level their detail actually warrants and leaves the blur to fragments
 * that really are minified in both directions.
 *
 * Four rather than the sixteen a desktop will report: the taps are spent only on
 * minified fragments, but they are spent per fragment, and the difference between
 * 4 and 16 on a page that is already a fraction of its native size is not
 * something the frame is going to show.
 */
const PANEL_ANISOTROPY = 4;

/**
 * Asked for explicitly rather than left to the default, which is "whatever the
 * source says".
 *
 * The gallery's own JPEGs are opaque and this changes nothing for them. What it
 * covers is the other source this pool decodes: a photo the reader picked off
 * their own disk. A PNG with an alpha channel would otherwise arrive
 * premultiplied, and the upload path does not un-premultiply it — the shader
 * reads `.rgb` and would get colour that has already been multiplied down at
 * every soft edge.
 *
 * Colour space conversion is deliberately *not* turned off here. It is the
 * faster path and correct for the gallery, whose files carry no ICC profile at
 * all — but a phone photo is usually Display P3 with a profile, and ignoring it
 * would render the reader's own pictures oversaturated. The decode is off the
 * main thread and metered two at a time, so what it would buy is not frame time.
 */
const DECODE_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: "none" };

interface Entry {
  texture: Texture;
  /** Monotonic counter, not wall clock — cheaper and immune to tab throttling. */
  lastUsed: number;
}

/**
 * A bounded LRU of GPU textures with an off-main-thread decode queue.
 *
 * The whole gallery at full resolution would be several hundred MB of VRAM and
 * iOS drops the context long before that, so residency is capped and decodes
 * are downscaled on the way in. Count the mip chain in that budget: a resident
 * panel is a third larger than its base level, which on the mobile cap is a few
 * megabytes across the whole pool. The bytes themselves are already in the
 * service worker's cache after a first visit, which makes a re-fetch for decode
 * effectively free — which is true only because the worker keys its cache off
 * the request's *path* rather than its destination. See `src/sw.ts`.
 */
export class TexturePool {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<string>();
  /**
   * Decoded and waiting for the GPU. The decode itself is off-thread, but the
   * `texImage2D` that follows it is not — a 768px RGBA panel is two megabytes
   * pushed across on the main thread, and two of those landing in the same task
   * is a dropped frame you can see. So the upload is separated from the decode
   * and metered by the frame loop instead of happening whenever the network
   * happens to answer.
   */
  private readonly staged = new Map<string, ImageBitmap>();
  private readonly queue: Panel[] = [];
  private readonly pinned = new Set<string>();
  /** Failed decodes per panel — see `MAX_DECODE_ATTEMPTS`. */
  private readonly failures = new Map<string, number>();
  private inflight = 0;
  private clock = 0;
  private disposed = false;

  /** Stand-in for unfilled sampler slots — the shader always binds all of them. */
  readonly blank: Texture;

  constructor(
    private readonly gl: OGLRenderingContext,
    private readonly capacity: number,
    private readonly maxEdge: number
  ) {
    this.blank = new Texture(gl, {
      image: new Uint8Array([0, 0, 0, 255]),
      width: 1,
      height: 1,
      generateMipmaps: false,
    });
  }

  /** Resident texture for a panel, or undefined if it still needs decoding. */
  get(panelId: string): Texture | undefined {
    const entry = this.entries.get(panelId);
    if (!entry) return undefined;
    entry.lastUsed = ++this.clock;
    return entry.texture;
  }

  has(panelId: string): boolean {
    return this.entries.has(panelId);
  }

  /** Queue a decode if the panel is not already resident or in flight. */
  request(panel: Panel): void {
    if (this.disposed) return;
    if (this.entries.has(panel.id) || this.pending.has(panel.id)) return;
    if (this.staged.has(panel.id)) return;
    if ((this.failures.get(panel.id) ?? 0) >= MAX_DECODE_ATTEMPTS) return;
    if (this.queue.some((p) => p.id === panel.id)) return;
    this.queue.push(panel);
    this.pump();
  }

  /**
   * Upload up to `budget` decoded panels. Called once per frame by the backend,
   * which is the whole point: the cost lands on a frame that chose to pay it
   * rather than on whichever frame a fetch happened to resolve under.
   *
   * A panel that has decoded but not yet uploaded simply isn't `has()` yet, so
   * it is skipped by the frame that wanted it and drawn by the next one — the
   * same one-frame wait the decode queue already imposes.
   */
  flush(budget: number): void {
    if (this.disposed) return;
    let left = Math.max(0, budget);
    while (left > 0 && this.staged.size > 0) {
      const [panelId, bitmap] = this.staged.entries().next().value!;
      this.staged.delete(panelId);
      this.insert(panelId, bitmap);
      left--;
    }
  }

  /**
   * Mark the panels drawn this frame as ineligible for eviction. Without this
   * a prefetch can evict a texture that is mid-crossfade on screen.
   */
  setPinned(panelIds: Iterable<string>): void {
    this.pinned.clear();
    for (const id of panelIds) this.pinned.add(id);
  }

  get residentCount(): number {
    return this.entries.size;
  }

  get pendingCount(): number {
    return this.pending.size + this.queue.length + this.staged.size;
  }

  private pump(): void {
    while (!this.disposed && this.inflight < MAX_CONCURRENT_DECODES && this.queue.length > 0) {
      const panel = this.queue.shift()!;
      if (this.entries.has(panel.id) || this.pending.has(panel.id)) continue;
      if (this.staged.has(panel.id)) continue;
      this.pending.add(panel.id);
      this.inflight++;
      void this.decode(panel)
        .then((bitmap) => {
          if (this.disposed || !bitmap) {
            bitmap?.close?.();
            return;
          }
          // Held, not uploaded — `flush` decides which frame pays for it.
          this.staged.set(panel.id, bitmap);
          this.failures.delete(panel.id);
        })
        .catch(() => {
          // A panel that will not decode is skipped by every frame that wants
          // it, and asked for a couple more times before being given up on.
          this.failures.set(panel.id, (this.failures.get(panel.id) ?? 0) + 1);
        })
        .finally(() => {
          this.pending.delete(panel.id);
          this.inflight--;
          if (!this.disposed) this.pump();
        });
    }
  }

  private async decode(panel: Panel): Promise<ImageBitmap | null> {
    const url = panelImageUrl(panel.image);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const blob = await res.blob();

    const longest = Math.max(panel.width || 0, panel.height || 0);
    if (longest > this.maxEdge && panel.width && panel.height) {
      const scale = this.maxEdge / longest;
      try {
        return await createImageBitmap(blob, {
          ...DECODE_OPTIONS,
          resizeWidth: Math.round(panel.width * scale),
          resizeHeight: Math.round(panel.height * scale),
          resizeQuality: "high",
        });
      } catch {
        // Older Safari rejects the resize options; full-size decode still works.
      }
    }
    return createImageBitmap(blob, DECODE_OPTIONS);
  }

  private insert(panelId: string, bitmap: ImageBitmap): void {
    this.evictTo(this.capacity - 1);

    const texture = new Texture(this.gl, {
      // ImageBitmap is a valid texImage2D source; ogl's types predate it.
      image: bitmap as unknown as HTMLImageElement,
      /*
       * The spatial pass minifies these hard — a page at the far end of a
       * corridor, or on the curl of a drape, is a thousand texels landing in a
       * couple of hundred pixels. A single bilinear tap of that is two things at
       * once: it is aliased, so the page boils as the formation turns; and it is
       * the worst access pattern a tiler has, since neighbouring fragments reach
       * into unrelated cache lines and every one of them misses.
       *
       * The chain costs a third more memory per resident panel and one
       * `generateMipmap` per upload — and the uploads are already metered to one
       * a frame, so that is a fixed cost on a frame that chose to pay it rather
       * than a stall that lands wherever a fetch resolved.
       *
       * Paired with anisotropy, without which this would trade the boil for a
       * blur on exactly the surfaces the scenes are built around — see
       * PANEL_ANISOTROPY.
       */
      generateMipmaps: true,
      minFilter: this.gl.LINEAR_MIPMAP_LINEAR,
      magFilter: this.gl.LINEAR,
      anisotropy: PANEL_ANISOTROPY,
      wrapS: this.gl.CLAMP_TO_EDGE,
      wrapT: this.gl.CLAMP_TO_EDGE,
    });
    // Upload now so the first frame that uses it does not stall mid-fade.
    texture.update();
    bitmap.close?.();

    this.entries.set(panelId, { texture, lastUsed: ++this.clock });
  }

  private evictTo(target: number): void {
    while (this.entries.size > Math.max(0, target)) {
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [id, entry] of this.entries) {
        if (this.pinned.has(id)) continue;
        if (entry.lastUsed < oldest) {
          oldest = entry.lastUsed;
          oldestId = id;
        }
      }
      // Everything resident is on screen — grow past the cap rather than
      // yanking a texture out from under a live crossfade.
      if (!oldestId) return;
      const entry = this.entries.get(oldestId)!;
      this.gl.deleteTexture(entry.texture.texture);
      this.entries.delete(oldestId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const bitmap of this.staged.values()) bitmap.close?.();
    this.staged.clear();
    for (const entry of this.entries.values()) {
      this.gl.deleteTexture(entry.texture.texture);
    }
    this.entries.clear();
    this.gl.deleteTexture(this.blank.texture);
  }
}
