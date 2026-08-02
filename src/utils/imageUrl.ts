/**
 * Where a panel's image actually lives.
 *
 * A gallery panel carries a path relative to the deployment root and has to be
 * prefixed. A photo the reader picked off their own disk for a visualizer run
 * carries a `blob:` URL instead — the bytes never leave the page, and there is
 * nothing to prefix. Everything downstream treats the two the same: `fetch`,
 * `createImageBitmap` and `<img src>` all accept either.
 */
const SELF_CONTAINED = /^(?:blob:|data:|https?:\/\/)/i;

export function panelImageUrl(image: string): string {
  return SELF_CONTAINED.test(image) ? image : `${import.meta.env.BASE_URL}${image}`;
}
