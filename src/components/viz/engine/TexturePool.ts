import { Texture } from "ogl";
import type { OGLRenderingContext } from "ogl";
import type { Panel } from "../../../types";

const MAX_CONCURRENT_DECODES = 2;

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
 * are downscaled on the way in. The bytes themselves are already in the
 * service worker's cache after a first visit, which makes a re-fetch for decode
 * effectively free.
 */
export class TexturePool {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<string>();
  private readonly queue: Panel[] = [];
  private readonly pinned = new Set<string>();
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
    if (this.queue.some((p) => p.id === panel.id)) return;
    this.queue.push(panel);
    this.pump();
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
    return this.pending.size + this.queue.length;
  }

  private pump(): void {
    while (!this.disposed && this.inflight < MAX_CONCURRENT_DECODES && this.queue.length > 0) {
      const panel = this.queue.shift()!;
      if (this.entries.has(panel.id) || this.pending.has(panel.id)) continue;
      this.pending.add(panel.id);
      this.inflight++;
      void this.decode(panel)
        .then((bitmap) => {
          if (this.disposed) {
            bitmap?.close?.();
            return;
          }
          if (bitmap) this.insert(panel.id, bitmap);
        })
        .catch(() => {
          /* a panel that will not decode is simply never selected again */
        })
        .finally(() => {
          this.pending.delete(panel.id);
          this.inflight--;
          if (!this.disposed) this.pump();
        });
    }
  }

  private async decode(panel: Panel): Promise<ImageBitmap | null> {
    const url = `${import.meta.env.BASE_URL}${panel.image}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const blob = await res.blob();

    const longest = Math.max(panel.width || 0, panel.height || 0);
    if (longest > this.maxEdge && panel.width && panel.height) {
      const scale = this.maxEdge / longest;
      try {
        return await createImageBitmap(blob, {
          resizeWidth: Math.round(panel.width * scale),
          resizeHeight: Math.round(panel.height * scale),
          resizeQuality: "high",
        });
      } catch {
        // Older Safari rejects the resize options; full-size decode still works.
      }
    }
    return createImageBitmap(blob);
  }

  private insert(panelId: string, bitmap: ImageBitmap): void {
    this.evictTo(this.capacity - 1);

    const texture = new Texture(this.gl, {
      // ImageBitmap is a valid texImage2D source; ogl's types predate it.
      image: bitmap as unknown as HTMLImageElement,
      generateMipmaps: false,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
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
    for (const entry of this.entries.values()) {
      this.gl.deleteTexture(entry.texture.texture);
    }
    this.entries.clear();
    this.gl.deleteTexture(this.blank.texture);
  }
}
