import { useEffect, useRef, useState } from "react";

/**
 * A second browser window holding nothing but the run.
 *
 * This exists for one job: putting the composition on a screen an audience is
 * looking at while the person driving it keeps the controls on another. So the
 * window it opens is deliberately empty — no chrome, no gallery, no stylesheet
 * from the site — because everything it can be made to show is something that
 * ends up projected. What it holds is the engine's own surface, portalled in
 * from the page that opened it; see `VisualizerOverlay`.
 *
 * The window is a real window rather than an iframe or a second copy of the app
 * on purpose. An iframe cannot be moved to another display; a second copy would
 * mean a second engine, a second texture pool, and a channel between them to
 * keep two runs in step, when what is wanted is one run seen from two places.
 * Portalling keeps a single engine in this page's JavaScript with its canvas in
 * the other window's document, which is all the separation the job needs.
 */

export interface ShowWindow {
  /** The window itself: keys, fullscreen and visibility all belong to it. */
  win: Window;
  /** Where the run's surface is portalled. */
  root: HTMLElement;
}

/** Reused rather than stacked: asking twice reopens the same window. */
const WINDOW_NAME = "comicSnapsShow";

/**
 * Roomy enough to be worth looking at before it is moved, small enough to be
 * grabbable by its title bar on whatever display it lands on. Every browser
 * clamps this to the screen anyway.
 */
const FEATURES = "popup=1,width=1280,height=720";

/**
 * The whole stylesheet the window gets. Black to the edges, no scrollbars, no
 * cursor — a pointer left resting over the projection is as much of a blemish
 * as a toolbar would be, and the window has nothing to point at.
 */
const SHOW_CSS = `
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  body { cursor: none; }
  #viz-show { position: fixed; inset: 0; overflow: hidden; }
  :fullscreen { background: #000; }
`;

export interface ShowWindowState {
  /** Null until the window is open, and again once it has gone. */
  show: ShowWindow | null;
  /** The open was refused — almost always a pop-up blocker. */
  blocked: boolean;
}

/**
 * Opens the window while `open` is true and hands back the root to portal into.
 *
 * `onClosed` fires only when the window goes away on its own — closed from its
 * own title bar, or taken with the browser. Closing it from here, by dropping
 * `open` or unmounting, is not a report: the caller already knows.
 */
export function useShowWindow(open: boolean, onClosed: () => void): ShowWindowState {
  const [show, setShow] = useState<ShowWindow | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Through a ref so a caller that rebuilds this handler every render does not
  // close and reopen the window underneath the run.
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (!open) {
      setBlocked(false);
      return;
    }

    // Allowed from an effect because it still runs inside the click that set
    // `open` — transient activation outlives the render. A launch that arrives
    // without one (a `?viz=1` cold load) is refused, which is what `blocked` is
    // for: the run carries on in this window and says so.
    const win = window.open("", WINDOW_NAME, FEATURES);
    if (!win) {
      setBlocked(true);
      return;
    }
    setBlocked(false);

    // Written rather than assembled node by node: an `about:blank` document can
    // still be replaced by the browser after `window.open` returns, and a
    // document.write is the one way of putting content there that every engine
    // treats as the document that survives.
    win.document.write(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>comic snaps</title>" +
        `<style>${SHOW_CSS}</style></head>` +
        '<body><div id="viz-show"></div></body></html>'
    );
    win.document.close();

    const root = win.document.getElementById("viz-show");
    if (!root) {
      win.close();
      setBlocked(true);
      return;
    }

    /** True once the close is ours, so our own teardown is not reported back. */
    let closing = false;
    let poll = 0;

    const handleGone = () => {
      if (closing) return;
      closing = true;
      window.clearInterval(poll);
      setShow(null);
      onClosedRef.current();
    };

    // Two ways of noticing, because neither is enough alone: `pagehide` is
    // immediate but is not fired by every engine on a window closed from the
    // OS chrome, and the poll always notices but only within its interval.
    win.addEventListener("pagehide", handleGone);
    poll = window.setInterval(() => {
      if (win.closed) handleGone();
    }, 400);

    // A projection outliving the page that drives it is a window nobody can
    // close from anywhere but the OS, so it goes when this page does.
    const closeWithOpener = () => {
      closing = true;
      win.close();
    };
    window.addEventListener("pagehide", closeWithOpener);

    setShow({ win, root });

    return () => {
      closing = true;
      window.clearInterval(poll);
      win.removeEventListener("pagehide", handleGone);
      window.removeEventListener("pagehide", closeWithOpener);
      setShow(null);
      win.close();
    };
  }, [open]);

  return { show, blocked };
}

/**
 * Whether this browser can say where the displays are. Chromium only, and only
 * over https — everywhere else the window is placed by hand, which is why
 * nothing here is required for the feature to work.
 */
export function canPlaceOnDisplay(): boolean {
  return typeof window !== "undefined" && "getScreenDetails" in window;
}

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

/**
 * Move the show window onto whichever display this one is not on, filling it.
 *
 * Called from a press, never on launch: the first call is what asks for the
 * window-management permission, and a permission prompt nobody went looking for
 * is worse than dragging a window. Resolves false when there is nowhere to send
 * it — one display, no support, or permission refused — and the window is left
 * exactly where it was.
 */
export async function placeOnOtherDisplay(win: Window): Promise<boolean> {
  const request = (window as Window & { getScreenDetails?: () => Promise<ScreenDetails> })
    .getScreenDetails;
  if (!request) return false;
  try {
    const details = await request.call(window);
    const current = details.currentScreen;
    const target = details.screens.find(
      (screen) =>
        screen !== current &&
        (screen.availLeft !== current.availLeft || screen.availTop !== current.availTop)
    );
    if (!target || win.closed) return false;
    // Moved before it is resized: a window sized to the far display while still
    // on this one can be clamped to this one's bounds on the way over.
    win.moveTo(target.availLeft, target.availTop);
    win.resizeTo(target.availWidth, target.availHeight);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the show window to fill its display.
 *
 * Fullscreen belongs to the document being filled, and the press that asks for
 * it is in *this* document, so browsers are within their rights to refuse —
 * hence the boolean rather than a promise of success. The window answers its
 * own `f` and double-click for the times they do (see `VisualizerOverlay`), and
 * the console says so when this comes back false.
 */
export async function requestShowFullscreen(win: Window): Promise<boolean> {
  const element = win.document.documentElement;
  if (win.document.fullscreenElement) return true;
  try {
    win.focus();
    await element.requestFullscreen?.({ navigationUI: "hide" });
    return Boolean(win.document.fullscreenElement);
  } catch {
    return false;
  }
}
