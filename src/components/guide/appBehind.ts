/**
 * The app behind the Guide: kept mounted, so the gallery's scroll, filters,
 * an open viewer or info tab are all exactly as left, but taken out of reach
 * and, once covered, out of the compositor.
 *
 * Sliding it aside moves each of the app's top-level layers (the header, the
 * page, the info modal, the viewer) rather than the app's root. A transform
 * on the root would make it the containing block for the `position: fixed`
 * layers inside it, and since the root is as tall as the whole page, a
 * scrolled page would carry the info modal and the viewer up off the screen
 * for the length of the slide. A transform on a fixed layer itself leaves it
 * where it is. The window keeps its scroll; nothing is re-laid out.
 */

/** How far the app moves aside as the Guide comes in, as a share of the viewport. */
export const APP_SHIFT = 0.25;
/** How dark the app gets under the Guide's scrim. */
export const APP_DIM = 0.6;

export interface AppBehind {
  /** Move the app aside by `progress` (0 = in place, 1 = fully aside). */
  shift(progress: number, transition: string | null): void;
  /** Stop painting it once it's fully covered. */
  hide(): void;
  /** Paint it again, before anything underneath measures layout. */
  show(): void;
  /** Hand it back exactly as it was. */
  restore(): void;
}

export function freezeApp(): AppBehind {
  const root = document.getElementById("root");
  if (!root) {
    const none = () => {};
    return { shift: none, hide: none, show: none, restore: none };
  }

  // The app's own layers: the children of its top element.
  const appEl = root.firstElementChild as HTMLElement | null;
  const layers = appEl ? (Array.from(appEl.children) as HTMLElement[]) : [];
  const saved = layers.map((el) => ({ el, transform: el.style.transform, transition: el.style.transition }));
  const savedVisibility = root.style.visibility;
  const prevActive = document.activeElement as HTMLElement | null;

  root.inert = true;
  root.setAttribute("aria-hidden", "true");

  return {
    shift(progress, transition) {
      const px = -APP_SHIFT * window.innerWidth * progress;
      for (const { el } of saved) {
        el.style.transition = transition ?? "none";
        el.style.transform = progress === 0 ? "" : `translate3d(${px}px, 0, 0)`;
      }
    },
    hide() {
      root.style.visibility = "hidden";
    },
    show() {
      root.style.visibility = savedVisibility;
    },
    restore() {
      for (const { el, transform, transition } of saved) {
        el.style.transform = transform;
        el.style.transition = transition;
      }
      root.style.visibility = savedVisibility;
      root.inert = false;
      root.removeAttribute("aria-hidden");
      // Back to where the reader was: the "how it works" link they followed.
      if (prevActive && document.contains(prevActive)) prevActive.focus({ preventScroll: true });
    },
  };
}
