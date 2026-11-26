/**
 * Heavy work for figures, done once and off the critical path.
 *
 * Opening a section remounts its figures while the glide animates height on
 * the main thread. A figure that reads full-size images into canvases on
 * mount makes the glide stall and jump. So figures defer that work to idle
 * time and cache it by source, and a remount reads the cache synchronously
 * and does nothing.
 */
export interface IdleCache<K, V> {
  /** The value if it's ready, without starting any work. */
  peek(key: K): V | undefined;
  /** The value, computed in idle time the first time it's asked for. */
  get(key: K): Promise<V>;
}

const idle: (cb: () => void) => void =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (cb) => window.requestIdleCallback(() => cb(), { timeout: 600 })
    : (cb) => setTimeout(cb, 1);

export function idleCache<K, V>(compute: (key: K) => V | Promise<V>): IdleCache<K, V> {
  const done = new Map<K, V>();
  const pending = new Map<K, Promise<V>>();
  return {
    peek: (key) => done.get(key),
    get(key) {
      if (done.has(key)) return Promise.resolve(done.get(key)!);
      let p = pending.get(key);
      if (!p) {
        p = new Promise<V>((resolve, reject) =>
          idle(() => {
            Promise.resolve()
              .then(() => compute(key))
              .then((v) => {
                done.set(key, v);
                pending.delete(key);
                resolve(v);
              }, (e) => {
                pending.delete(key);
                reject(e);
              });
          }),
        );
        pending.set(key, p);
      }
      return p;
    },
  };
}

/**
 * The commonest case: an image's pixels, read once at a reduced size. Null
 * when the image can't be read (it failed, or it's cross-origin).
 */
export const imagePixels = idleCache<string, ImageData | null>(
  (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(ctx.getImageData(0, 0, w, h));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    }),
);
