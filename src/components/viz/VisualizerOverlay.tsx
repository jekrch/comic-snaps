import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Panel } from "../../types";
import { VizEngine } from "./engine/Engine";
import { AudioReactor } from "./engine/AudioReactor";
import { formatSeed, parseSeed, randomSeed } from "./engine/rng";
import { MODE_SWITCH_MS, VIZ_SPEEDS, cloneConfig, lerpConfigInto, nearestSpeed } from "./vizConfig";
import type { VizConfig } from "./vizConfig";
import { VIZ_PRESETS, presetConfig } from "./vizPresets";
import VizPanelStack, {
  PANEL_STACK_EXIT_MS,
  PANEL_STACK_ROW_HEIGHT,
} from "./VizPanelStack";
import { CAST_MAX } from "./engine/cast";
import VizControls from "./VizControls";
import VizDebugPanel, { TUNE_PANEL_EXIT_MS } from "./VizDebugPanel";
import VizPageBreak, { vizBreakMs } from "./VizPageBreak";
import VizShowConsole from "./VizShowConsole";
import { useUnmountDelay } from "./useUnmountDelay";
import { placeOnOtherDisplay, requestShowFullscreen, useShowWindow } from "./useShowWindow";

const CONTROLS_IDLE_MS = 2000;

/** How long a one-line notice stays up before it has said its piece. */
const NOTICE_MS = 7000;

const POPUP_BLOCKED_NOTICE =
  "the show window could not be opened — allow pop-ups for this site, then try again";
const FULLSCREEN_REFUSED_NOTICE =
  "the browser wants that asked for in the show window itself — press F there, or double-click it";

/** Longest the close will wait on a still of the run before going without one.
 *  The capture is a frame and an encode; this is only here so a wedged tab
 *  cannot leave the reader holding a run they have asked to leave. */
const FRAME_CAPTURE_MS = 400;

/** Backstop for the arrival fade (.viz-page-in, 620ms) reporting its own end.
 *  Comfortably past it: this is the deadline for calling the run covered, not
 *  the length of anything. */
const VIZ_PAGE_IN_MAX_MS = 1000;

/** How long the tuning panel has to be still before the run's config is handed
 *  up to the URL. A slider drag is a hundred changes; the address bar wants the
 *  value it was let go on. */
const CONFIG_SYNC_MS = 400;

/** How far back the pinned label can step. Long enough to cover an unattended
 *  stretch, short enough that the panels stay in the browser's image cache. */
const TRAIL_MAX = 60;

interface VisualizerOverlayProps {
  panels: Panel[];
  /** Resolved by the launch modal (preset, possibly with a custom override). */
  config: VizConfig;
  /** The running preset, or null while `config` is a pasted custom one. */
  presetId: string | null;
  /** Mode changes made mid-run, so the URL keeps describing what is running. */
  onPresetChange?: (presetId: string) => void;
  /** Only requested when the launch explicitly asked for it. */
  fullscreen: boolean;
  /**
   * Start with the run in a window of its own, leaving this one as the console
   * that drives it. Asked for at launch; also reachable from the chrome, and
   * reversible either way mid-run.
   */
  showWindow?: boolean;
  /** Start with the attribution label pinned, as asked for at launch. */
  pinLabel?: boolean;
  /** Live speed changes, so the URL keeps describing what is actually running. */
  onSpeedChange?: (speed: number) => void;
  /** Everything the tuning panel moves, debounced, for the same reason. */
  onConfigChange?: (config: VizConfig) => void;
  /** Hands the panel to the image viewer, which opens on top of the run. */
  onOpenPanel?: (panel: Panel) => void;
  /** True while that viewer is up: the run carries on, but unattended. */
  viewerOpen?: boolean;
  /**
   * The arrival fade has landed and the run is opaque over whatever it came up
   * on. Whatever it covered — the chooser it was started from — can stop being
   * drawn now, and not a frame before: taken away any earlier and the reader
   * watches it go instead of watching the run come up.
   */
  onCovered?: () => void;
  /**
   * The run has been asked to leave and the still of it is up. Everything the
   * reader is being handed back to should come back now, behind the break, so
   * the wall the shards open onto is the one they will be standing on when the
   * last of them is gone.
   */
  onLeaving?: () => void;
  onClose: () => void;
}

/**
 * The panels that have been through the frame, newest last, and where the
 * pinned label is pointing into them.
 */
interface Trail {
  items: Panel[];
  cursor: number;
}

type TrailAction =
  | { type: "feature"; panel: Panel }
  | { type: "step"; delta: number }
  | { type: "live" };

const EMPTY_TRAIL: Trail = { items: [], cursor: -1 };

function trailReducer(state: Trail, action: TrailAction): Trail {
  switch (action.type) {
    case "feature": {
      if (state.items[state.items.length - 1]?.id === action.panel.id) return state;
      // Only a label that was already following the run keeps following it —
      // a new feature must not yank someone out of the trail mid-read.
      const following = state.cursor >= state.items.length - 1;
      let items = [...state.items, action.panel];
      let cursor = following ? items.length - 1 : state.cursor;
      if (items.length > TRAIL_MAX) {
        const dropped = items.length - TRAIL_MAX;
        items = items.slice(dropped);
        cursor = Math.max(0, cursor - dropped);
      }
      return { items, cursor };
    }
    case "step": {
      if (state.items.length === 0) return state;
      const cursor = Math.min(state.items.length - 1, Math.max(0, state.cursor + action.delta));
      return cursor === state.cursor ? state : { ...state, cursor };
    }
    case "live":
      return state.items.length === 0 ? state : { ...state, cursor: state.items.length - 1 };
  }
}

/**
 * Fullscreen shell for the visualizer: owns the surface, the screensaver
 * hygiene (fullscreen, wake lock, idle cursor, pause when hidden) and the
 * lifecycle of the engine. All choreography lives below this in the engine.
 */
export default function VisualizerOverlay({
  panels,
  config,
  presetId,
  fullscreen,
  showWindow = false,
  pinLabel = false,
  onPresetChange,
  onSpeedChange,
  onConfigChange,
  onOpenPanel,
  viewerOpen = false,
  onCovered,
  onLeaving,
  onClose,
}: VisualizerOverlayProps) {
  /**
   * The element the engine draws in, held as state rather than a ref because it
   * can move house: when the run is sent to its own window the surface is
   * portalled there, which builds a new element in a new document, and the
   * engine has to be rebuilt around it. See the engine lifecycle below.
   */
  const [surfaceEl, setSurfaceEl] = useState<HTMLDivElement | null>(null);
  const engineRef = useRef<VizEngine | null>(null);
  /**
   * The listener, if the run has been asked to listen. Held here rather than in
   * the engine because it has to outlive one: the engine is rebuilt whenever
   * the surface changes windows, and a microphone permission that had to be
   * granted again on every `w` keypress would be intolerable. Constructed at
   * mount and inert until an explicit gesture reaches `start()` — building it
   * opens no context and asks for no device.
   */
  const reactorRef = useRef<AudioReactor | null>(null);
  if (reactorRef.current === null) reactorRef.current = new AudioReactor();
  const idleTimerRef = useRef<number>(0);
  const rampRef = useRef<number>(0);
  const configSyncRef = useRef<number>(0);
  /** True while something on the chrome — the mode menu — is open under it. */
  const chromeHeldRef = useRef(false);

  const [engine, setEngine] = useState<VizEngine | null>(null);
  /** Everything carrying the frame, most prominent first. */
  const [cast, setCast] = useState<Panel[]>([]);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(pinLabel);
  const [trail, dispatchTrail] = useReducer(trailReducer, EMPTY_TRAIL);
  /**
   * Whether the run is parked on the panel the trail is pointing at, rather
   * than choosing its own. Distinct from `paused`, which stops the clock: a
   * held run keeps drifting and cycling, it just stops changing what it is
   * drifting.
   */
  const [held, setHeld] = useState(false);
  const heldRef = useRef(held);
  heldRef.current = held;
  const trailRef = useRef(trail);
  trailRef.current = trail;

  // --- where the run is being drawn ----------------------------------------

  /**
   * The run has been sent to a window of its own. What is left here is the
   * console: the same controls, pinned open instead of fading out, driving a
   * composition on another screen.
   *
   * Two states, not one — the run is only *projecting* once the window is
   * actually open, and a blocked pop-up has to land back here rather than
   * leaving the run drawn nowhere. See the blocked handler below.
   */
  const [detached, setDetached] = useState(showWindow);
  const detachedRef = useRef(detached);
  detachedRef.current = detached;

  /** Anything the run needs to say to whoever is driving it, one line at a time. */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef(0);
  const say = useCallback((message: string | null) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    if (message) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  /**
   * Closed from its own title bar. That is a way of ending the run — it is the
   * only thing in that window, and the whole point of putting it there was that
   * closing it takes the run with it and shows the audience nothing else.
   *
   * Declared before the close path it calls into, so it is passed by ref.
   */
  const showClosedRef = useRef<() => void>(() => undefined);
  const { show, blocked } = useShowWindow(detached, () => showClosedRef.current());
  const showWin = show?.win ?? null;
  const showRef = useRef(show);
  showRef.current = show;

  /** True only while there is a second window with the run in it. */
  const projecting = show !== null;
  const projectingRef = useRef(projecting);
  projectingRef.current = projecting;

  /**
   * The window the run is actually in. Everything that belongs to a *surface*
   * rather than to the page — the frame clock's throttling, fullscreen, the
   * wake lock — is asked of this rather than of the global.
   */
  const hostWin = showWin ?? window;
  const hostDoc = hostWin.document;

  // A refused pop-up puts the run back in this window rather than leaving it
  // nowhere. `detached` going false is what re-arms the chrome's own button, so
  // the reader's next press is a fresh gesture — which is what the browser was
  // asking for.
  useEffect(() => {
    if (!blocked) return;
    setDetached(false);
    say(POPUP_BLOCKED_NOTICE);
  }, [blocked, say]);

  const { seed, showDebugDefault } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      seed: parseSeed(params.get("vizseed")) ?? randomSeed(),
      showDebugDefault: params.get("vizdebug") === "1",
    };
  }, []);
  const [showDebug, setShowDebug] = useState(showDebugDefault);
  // The panel is dismissed from three places — its own button, the chrome, and
  // the `d` key — so the slide out is driven off this flag rather than off any
  // one of them.
  const debugPanel = useUnmountDelay(showDebug, TUNE_PANEL_EXIT_MS);

  // The console exists to be tuned from, so it comes up with the panel already
  // open. Dismissable from there like any other time — this only fires on the
  // arrival of a show window, not on every render behind one.
  useEffect(() => {
    if (showWin) setShowDebug(true);
  }, [showWin]);

  // Cloned, then mutated in place: the engine reads it every frame so the debug
  // sliders take effect without a remount, and the caller's object is left alone.
  const configRef = useRef(cloneConfig(config));

  // The live config is the single source of truth for speed — the chrome and
  // the tuning panel both write into it — so the chrome renders from it and
  // this only exists to schedule the repaint.
  const [, bumpConfig] = useReducer((n: number) => n + 1, 0);

  const usable = useMemo(() => panels.filter((panel) => !panel.blur), [panels]);
  const usableRef = useRef(usable);
  usableRef.current = usable;

  // --- engine lifecycle -----------------------------------------------------

  // A `?viz=1` cold load arrives before the asynchronous sort has produced a
  // panel set, so the engine waits for the first non-empty list rather than
  // starting against nothing. After that the set is fixed: the run reflects the
  // wall as it was filtered when the visualizer opened.
  const hasPanels = usable.length > 0;

  // The head of the cast is the feature — what the credit line has always
  // named. It also lands in the trail, whether or not the label is pinned:
  // pinning it mid-run should show what has already been on screen, not start
  // an empty history. The rest of the cast is live only; a panel that has left
  // the frame is history, and history is what the trail is.
  //
  // Held, the run is carrying whatever the trail is already pointing at, so
  // there is nothing new to record — and recording it would append a panel the
  // reader had stepped *back* to onto the end of their own history.
  const handleCast = useCallback((panels: Panel[]) => {
    setCast(panels);
    if (!heldRef.current && panels.length > 0) {
      dispatchTrail({ type: "feature", panel: panels[0] });
    }
  }, []);

  // Rebuilt when the surface moves between windows: a WebGL context belongs to
  // the canvas it was made on, and that canvas belongs to a document, so there
  // is no moving one across. The seed and the working config both outlive the
  // move, so what comes back is the same run from the top rather than a
  // different one — which is why sending the run to its own window is something
  // to do before an audience is watching rather than during.
  useEffect(() => {
    if (!surfaceEl || !hasPanels) return;

    const instance = new VizEngine(surfaceEl, usableRef.current, configRef.current, seed);
    instance.onCast = handleCast;
    // Re-attached rather than rebuilt: a run that was listening before the
    // surface changed windows is still listening after it, and to the same
    // stream — the analysis state carries across with it.
    instance.setAudioReactor(reactorRef.current);
    instance.start();
    engineRef.current = instance;
    setEngine(instance);

    return () => {
      instance.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [surfaceEl, hasPanels, seed, handleCast]);

  // The capture belongs to the overlay's lifetime, not the engine's. Closed
  // here so leaving the run always releases the device — and the recording
  // indicator with it.
  useEffect(() => {
    const reactor = reactorRef.current;
    return () => reactor?.dispose();
  }, []);

  // Distinguishes "still loading" from "the filters really do match nothing".
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  // --- arrival and departure ------------------------------------------------

  /**
   * The run fades up over the wall and leaves by breaking apart over it.
   *
   * The two are deliberately not symmetrical. Arriving, there is nothing to
   * take apart yet — the composition has not started and a break would be
   * cutting up a screen the reader is in the middle of leaving anyway — so it
   * simply comes up. Leaving, there is a frame worth keeping hold of for a
   * second longer, and that is what the break is for.
   */
  const [closing, setClosing] = useState(false);
  // Read by the close path, which must not depend on a render having landed.
  const closingRef = useRef(false);

  /**
   * The end of the arrival fade, reported once. Taken from the animation itself
   * rather than from a duration held here, so reduced motion's shorter fade is
   * answered at its own end and nothing has to know which one ran. The timer
   * only stands in for the cases where the animation never reports its end — a
   * tab backgrounded through the fade, or a close that pulls the class off
   * before it finishes — where the run is over the wall regardless.
   */
  const coveredRef = useRef(false);
  // Through the ref so the deadline below is set once on mount: hung off the
  // prop, an unmemoised handler would restart the timer on every render the
  // caller does, and the run syncs its config up there while it plays.
  const onCoveredRef = useRef(onCovered);
  onCoveredRef.current = onCovered;
  const markCovered = useCallback(() => {
    if (coveredRef.current) return;
    coveredRef.current = true;
    onCoveredRef.current?.();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(markCovered, VIZ_PAGE_IN_MAX_MS);
    return () => window.clearTimeout(id);
  }, [markCovered]);

  /** The run's own last frame, for the break that closes over it. */
  const [frameStill, setFrameStill] = useState<string | null>(null);
  const frameStillRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (frameStillRef.current) URL.revokeObjectURL(frameStillRef.current);
      frameStillRef.current = null;
    },
    []
  );

  /**
   * Every way out of the run goes through here. The run is photographed, the
   * still goes up over it, and then it breaks apart onto the wall underneath —
   * so what shatters is the composition the reader was actually watching, down
   * to the frame they asked to leave on.
   */
  const requestClose = useCallback((capture = true) => {
    // Marked here rather than in the effect, so a second Escape while the
    // capture is in flight is a no-op rather than a second capture.
    if (closingRef.current) return;
    closingRef.current = true;
    setChromeVisible(false);
    window.clearTimeout(idleTimerRef.current);

    const engine = engineRef.current;
    void Promise.race([
      capture ? engine?.captureStill() ?? Promise.resolve(null) : Promise.resolve(null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), FRAME_CAPTURE_MS)),
    ]).then((blob) => {
      const still = blob ? URL.createObjectURL(blob) : null;
      frameStillRef.current = still;
      setFrameStill(still);
      // Stopped only now: the still it hands back has to be a frame it drew.
      // Nothing is watching the surface after this — the still is standing in
      // front of it — so the run has no reason to carry on rendering.
      engine?.stop();
      // And the audience's screen goes at the head of the exit rather than the
      // end of it: the frame worth holding onto has been photographed, and what
      // that window would hold for the length of the break is a frozen one. The
      // report this triggers lands on a close already in flight and does nothing.
      showRef.current?.win.close();
      setClosing(true);
      onLeaving?.();
    });
  }, [onLeaving]);

  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(onClose, vizBreakMs());
    return () => window.clearTimeout(id);
  }, [closing, onClose]);

  /**
   * The show window went on its own. There is no frame left to photograph — the
   * canvas closed with the document — so the break plays on a black page, which
   * is what the console was showing anyway. The run itself is over: that window
   * held nothing else, and closing it is how you end a show.
   *
   * `detached` is deliberately left alone. Clearing it would put the surface
   * back in this window for the length of the break, which means building a
   * whole engine to draw one frame nobody is looking at.
   */
  showClosedRef.current = useCallback(() => requestClose(false), [requestClose]);

  // --- screensaver hygiene --------------------------------------------------

  /**
   * The run takes the whole window, gutter included: the strip `html {
   * scrollbar-gutter: stable }` keeps clear is outside the layout viewport, so a
   * fixed inset-0 overlay stops short of it and it shows down the right edge of
   * the run — as the page's own background, or as black once the overlay is
   * stretched over it. Neither belongs in a run, so the gutter is given up for
   * the duration.
   *
   * Giving it up widens the page underneath by a scrollbar, though, and that
   * reflow is the whole visible cost: the wall, and the chooser the run is
   * fading up over, both slide sideways as it starts and slide back as it ends.
   * So everything it moves is moved back by the same amount in the same style
   * flush — flow content by a padding on the body, and the one fixed thing that
   * can be behind a run, the chooser, by `--viz-scroll-comp`. Nothing is left
   * that can be seen to move.
   *
   * Held to the end rather than given back when the break starts: the shards
   * have to tile the frame the run was drawn in, and at the end the wall is
   * already whole and nothing is going to shift under it anyway.
   */
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousGutter = root.style.scrollbarGutter;
    const previousPadding = body.style.paddingRight;

    // What the page is holding clear on the right now — a reserved gutter, or a
    // live scrollbar on an engine too old to reserve one.
    const before = window.innerWidth - root.clientWidth;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "auto";
    // Whatever is left of it, which should be nothing. Measured rather than
    // assumed so that a browser which keeps holding something back is answered
    // with the difference it actually made rather than with a number from here.
    const after = window.innerWidth - root.clientWidth;
    const comp = Math.max(0, before - after);
    if (comp) {
      body.style.paddingRight = `${comp}px`;
      // Read by anything positioned against the viewport rather than laid out in
      // the body, which the padding above cannot reach.
      root.style.setProperty("--viz-scroll-comp", `${comp}px`);
    }

    return () => {
      body.style.overflow = previousOverflow;
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousGutter;
      body.style.paddingRight = previousPadding;
      root.style.removeProperty("--viz-scroll-comp");
    };
  }, []);

  // Whether the *run's* window is filling its screen, which while the run is
  // being projected is not this one.
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    // Fullscreen can also be left by Esc or the browser's own chrome, so the
    // button state follows the document rather than our own requests.
    const onChange = () => setIsFullscreen(Boolean(hostDoc.fullscreenElement));
    onChange();
    hostDoc.addEventListener("fullscreenchange", onChange);
    return () => hostDoc.removeEventListener("fullscreenchange", onChange);
  }, [hostDoc]);

  useEffect(() => {
    if (!fullscreen || detached) return;
    // The request only succeeds while the launch click is still the active user
    // gesture, so a `?viz=1` cold load stays windowed however this is set.
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" })?.catch(() => undefined);
  }, [fullscreen, detached]);

  /**
   * A launch that asked for both fullscreen and a window of its own: the show
   * window fills the display it opened on as soon as it exists. Browsers are
   * entitled to refuse — the press that asked was in this document, not that one
   * — so a refusal says how to do it by hand rather than failing silently. Once
   * only, hence the ref: after the first attempt, fullscreen is the button's.
   */
  const autoFullscreenRef = useRef(fullscreen && showWindow);
  useEffect(() => {
    if (!showWin || !autoFullscreenRef.current) return;
    autoFullscreenRef.current = false;
    void requestShowFullscreen(showWin).then((ok) => {
      if (!ok) say(FULLSCREEN_REFUSED_NOTICE);
    });
  }, [showWin, say]);

  // Unconditional: fullscreen may have been entered from the button, not the
  // launch. Only this window's — the show window takes its own with it.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  // Held on the window the art is in. A lock taken out here would be released
  // the moment this one was minimised, which — with the show on another display
  // — is a perfectly ordinary thing to do to a console.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        sentinel = (await hostWin.navigator.wakeLock?.request("screen")) ?? null;
        if (released) void sentinel?.release();
      } catch {
        /* denied or unsupported — the visualizer still runs */
      }
    };
    void acquire();

    const onVisibility = () => {
      if (hostDoc.visibilityState === "visible" && !released) void acquire();
    };
    hostDoc.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      hostDoc.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [hostWin, hostDoc]);

  // Pause when the run's own window is hidden. The engine also clamps dt, so a
  // long absence resumes smoothly rather than lurching the composition forward.
  // Scoped to that window rather than this one for the same reason as the lock:
  // a console put behind another app must not stop the show.
  useEffect(() => {
    const onVisibility = () => {
      if (hostDoc.hidden) engineRef.current?.stop();
      else if (!paused) engineRef.current?.start();
    };
    hostDoc.addEventListener("visibilitychange", onVisibility);
    return () => hostDoc.removeEventListener("visibilitychange", onVisibility);
  }, [hostDoc, paused]);

  const wakeChrome = useCallback(() => {
    // Nothing wakes a run that is already leaving. The chrome went down with the
    // first frame of the exit and putting it back up over the break — because a
    // window closed, or a projection ended — would be answering a control the
    // reader can no longer use.
    if (closingRef.current) return;
    setChromeVisible(true);
    window.clearTimeout(idleTimerRef.current);
    // Nothing fades out on a console. The chrome hides itself because it is
    // sitting on the art; once the art is on another screen it is not in the
    // way of anything, and controls that vanish two seconds into a show are the
    // opposite of what this window is now for.
    if (projectingRef.current) return;
    // An open menu would otherwise fade out from under the finger that opened it.
    if (chromeHeldRef.current) return;
    idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), CONTROLS_IDLE_MS);
  }, []);

  /** Closing whatever was held also re-arms the idle timer it suspended. */
  const holdChrome = useCallback(
    (held: boolean) => {
      chromeHeldRef.current = held;
      wakeChrome();
    },
    [wakeChrome]
  );

  // Also on the way into and out of a projection: one direction has to cancel a
  // timer that would hide a console's controls, the other has to re-arm it.
  useEffect(() => {
    wakeChrome();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [wakeChrome, projecting]);

  // The viewer covers the run, so the chrome under it is only in the way: drop
  // it (and its idle timer) for the duration, then bring it back on the way out
  // as the cue that the controls are live again.
  useEffect(() => {
    if (!viewerOpen) return;
    window.clearTimeout(idleTimerRef.current);
    setChromeVisible(false);
    return () => wakeChrome();
  }, [viewerOpen, wakeChrome]);

  const togglePause = useCallback(() => {
    setPaused((wasPaused) => {
      if (wasPaused) engineRef.current?.start();
      else engineRef.current?.stop();
      return !wasPaused;
    });
    wakeChrome();
  }, [wakeChrome]);

  /**
   * The tuning panel moved something. The working config is already live — the
   * engine reads it every frame — so all this does is repaint the chrome that
   * shows the same values and, once the hand comes off, hand a copy up for the
   * URL. Copied rather than passed by reference: what goes in the address bar
   * has to be the state at that instant, not an object that keeps changing.
   */
  const handleTuned = useCallback(() => {
    bumpConfig();
    if (!onConfigChange) return;
    window.clearTimeout(configSyncRef.current);
    configSyncRef.current = window.setTimeout(
      () => onConfigChange(cloneConfig(configRef.current)),
      CONFIG_SYNC_MS
    );
  }, [onConfigChange]);

  useEffect(() => () => window.clearTimeout(configSyncRef.current), []);

  const setSpeed = useCallback(
    (speed: number) => {
      configRef.current.speed = speed;
      bumpConfig();
      onSpeedChange?.(speed);
      wakeChrome();
    },
    [onSpeedChange, wakeChrome]
  );

  /** Keyboard equivalent of the pills: step one rung along the ladder. */
  const nudgeSpeed = useCallback(
    (direction: 1 | -1) => {
      const current = nearestSpeed(configRef.current.speed);
      const index = VIZ_SPEEDS.findIndex((rung) => rung === current);
      const next = Math.min(VIZ_SPEEDS.length - 1, Math.max(0, index + direction));
      setSpeed(VIZ_SPEEDS[next]);
    },
    [setSpeed]
  );

  /**
   * Switch mode without restarting the run: the working config is eased across
   * to the new preset in place, so the same seed, the same layers already in
   * flight and the same trail carry on under the new parameters. A hard cut
   * would be both a jolt and, for the effects that move whole-frame luminance,
   * exactly the step change §7 rules out.
   */
  const switchMode = useCallback(
    (id: string) => {
      const from = cloneConfig(configRef.current);
      const to = presetConfig(id);
      window.cancelAnimationFrame(rampRef.current);
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / MODE_SWITCH_MS);
        // Smoothstep, so the crossing eases out of the old mode and into the
        // new one rather than starting and stopping abruptly.
        lerpConfigInto(configRef.current, from, to, t * t * (3 - 2 * t));
        bumpConfig();
        rampRef.current = t < 1 ? window.requestAnimationFrame(step) : 0;
      };
      rampRef.current = window.requestAnimationFrame(step);
      onPresetChange?.(id);
      wakeChrome();
    },
    [onPresetChange, wakeChrome]
  );

  useEffect(() => () => window.cancelAnimationFrame(rampRef.current), []);

  /** Keyboard equivalent of the menu: step along the preset list. */
  const cycleMode = useCallback(
    (direction: 1 | -1) => {
      const index = VIZ_PRESETS.findIndex((preset) => preset.id === presetId);
      // A custom config sits at no index, so it steps onto whichever end of the
      // list the direction is walking toward rather than staying put.
      const start = index === -1 ? (direction === 1 ? -1 : 0) : index;
      const next = (start + direction + VIZ_PRESETS.length) % VIZ_PRESETS.length;
      switchMode(VIZ_PRESETS[next].id);
    },
    [presetId, switchMode]
  );

  const togglePinned = useCallback(() => {
    // Unpinning lets go of the trail as well: the transient credit line the bar
    // hands back to only ever describes what is on screen now. Not while the run
    // is held, though — there the cursor is not a reading position, it is the
    // panel being held, and dropping the label must not move the composition.
    setPinned((wasPinned) => {
      if (wasPinned && !heldRef.current) dispatchTrail({ type: "live" });
      return !wasPinned;
    });
    wakeChrome();
  }, [wakeChrome]);

  /**
   * Move the run on by a panel.
   *
   * Stepping holds it. A step that let the run carry on would be over before
   * the panel it landed on had finished arriving — the composition would have
   * chosen its own next layer within a beat — so the arrows and the transport
   * are one control: they step, and stepping parks.
   *
   * Forward from the newest panel seen takes the director's own next choice
   * rather than a random one, so stepping ahead is the run brought forward
   * rather than a jump to somewhere it was never going. Backward walks the
   * trail, which is the history the pinned label was already showing.
   */
  const stepPanel = useCallback(
    (delta: -1 | 1) => {
      const { items, cursor } = trailRef.current;
      if (delta === 1 && cursor >= items.length - 1) {
        const panel = engineRef.current?.nextPanel();
        if (panel) dispatchTrail({ type: "feature", panel });
      } else {
        dispatchTrail({ type: "step", delta });
      }
      setHeld(true);
      setPinned(true);
      wakeChrome();
    },
    [wakeChrome]
  );

  /**
   * Park the run on the panel it is carrying, or let it go again. Releasing
   * snaps the label back to the live head, so the trail resumes recording from
   * the run rather than staying where it was let go.
   */
  const toggleHold = useCallback(() => {
    const next = !heldRef.current;
    setHeld(next);
    if (next) setPinned(true);
    else dispatchTrail({ type: "live" });
    wakeChrome();
  }, [wakeChrome]);

  /**
   * What the run is locked onto: the panel the trail is pointing at while it is
   * held, and nothing while it is not. Handed down declaratively rather than
   * stepped imperatively, so holding and walking the trail come out as the same
   * thing — a panel the composition should be carrying — and there is one place
   * that says so.
   */
  const focusPanel = held ? trail.items[trail.cursor] ?? null : null;
  useEffect(() => {
    engine?.setFocus(focusPanel);
  }, [engine, focusPanel]);

  const openInViewer = useCallback(
    (panel: Panel) => {
      // The viewer opens on top of the run rather than in place of it: the
      // composition keeps playing behind the lightbox and is still there when
      // the panel is closed.
      onOpenPanel?.(panel);
    },
    [onOpenPanel]
  );

  /**
   * Fill the screen the run is on, which while it is being projected is the
   * other one. Leaving works from anywhere; entering is the browser's call —
   * the press is in this document and the window being filled is another — so a
   * refusal is answered with the two ways of doing it from over there.
   */
  const toggleFullscreen = useCallback(() => {
    const win = showRef.current?.win ?? window;
    if (win.document.fullscreenElement) {
      void win.document.exitFullscreen().catch(() => undefined);
    } else if (win === window) {
      void document.documentElement
        .requestFullscreen?.({ navigationUI: "hide" })
        ?.catch(() => undefined);
    } else {
      void requestShowFullscreen(win).then((ok) => {
        if (!ok) say(FULLSCREEN_REFUSED_NOTICE);
      });
    }
    wakeChrome();
  }, [say, wakeChrome]);

  /**
   * Send the run to a window of its own, or bring it back.
   *
   * A console that is itself filling the screen cannot be dragged off it or put
   * beside anything, and a run about to leave this window has no use for it, so
   * going out drops fullscreen here on the way.
   */
  const toggleDetached = useCallback(() => {
    const next = !detachedRef.current;
    if (next && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setDetached(next);
    say(null);
    wakeChrome();
  }, [say, wakeChrome]);

  /**
   * Put the show window on the display this one is not on. Asked for from a
   * press, never on launch: the first call is what raises the permission prompt
   * for reading the display layout, and one nobody went looking for is worse
   * than dragging a window across by hand — which remains the way this works on
   * every browser that has no such API.
   */
  const placeShow = useCallback(() => {
    const win = showRef.current?.win;
    if (!win) return;
    void placeOnOtherDisplay(win).then((ok) => {
      if (!ok) say("no second display to send it to — drag the window across instead");
    });
    wakeChrome();
  }, [say, wakeChrome]);

  // The viewer on top owns the keyboard while it is open: Escape has to close
  // the panel rather than the run beneath it, and the arrows have to page the
  // lightbox rather than walk the trail.
  // Also dead while the page is sealing: the run is on its way out and the keys
  // would be acting on something the reader can no longer see.
  //
  // Bound in both windows while the run is projected. The show window has no
  // controls on it by design, so the keys are all it answers to — and `f` and
  // Escape pressed *there* are worth more than the same keys here, since a
  // fullscreen request from the window being filled is one no browser argues
  // with.
  useEffect(() => {
    if (viewerOpen || closing) return;

    const onKey = (event: KeyboardEvent) => {
      // A held modifier means the press belongs to the browser, not to the run.
      // Ctrl/Cmd-W is the one that made this worth stating: it closes a window,
      // and answering it by also moving the run into or out of one would be the
      // run acting on its own way out.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Escape belongs to the open menu first — it closes that, not the run.
      if (event.key === "Escape" && chromeHeldRef.current) {
        return;
      } else if (event.key === "Escape" || event.key === "q") {
        event.preventDefault();
        requestClose();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        cycleMode(event.shiftKey ? -1 : 1);
      } else if (event.key === " ") {
        event.preventDefault();
        togglePause();
      } else if (event.key === "d") {
        setShowDebug((visible) => !visible);
        wakeChrome();
      } else if (event.key === "w") {
        event.preventDefault();
        toggleDetached();
      } else if (event.key === "f") {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === "[" || event.key === "-") {
        event.preventDefault();
        nudgeSpeed(-1);
      } else if (event.key === "]" || event.key === "+" || event.key === "=") {
        event.preventDefault();
        nudgeSpeed(1);
      } else if (event.key === "l") {
        togglePinned();
      } else if (event.key === "h") {
        event.preventDefault();
        toggleHold();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepPanel(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepPanel(1);
      } else {
        wakeChrome();
      }
    };
    const listeners: Window[] = showWin ? [window, showWin] : [window];
    for (const target of listeners) target.addEventListener("keydown", onKey);
    return () => {
      for (const target of listeners) target.removeEventListener("keydown", onKey);
    };
  }, [
    requestClose,
    togglePause,
    toggleFullscreen,
    toggleDetached,
    nudgeSpeed,
    cycleMode,
    togglePinned,
    stepPanel,
    toggleHold,
    wakeChrome,
    viewerOpen,
    closing,
    showWin,
  ]);

  /**
   * Double-click fills the screen, in the one window where that gesture is not
   * competing with anything. It is the affordance for a show window someone has
   * just dragged onto a projector and does not want to walk back to the console
   * to finish setting up — and the same click brings it out again.
   */
  useEffect(() => {
    if (!showWin) return;
    const onDoubleClick = () => {
      const doc = showWin.document;
      if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => undefined);
      else void doc.documentElement.requestFullscreen?.({ navigationUI: "hide" })?.catch(() => undefined);
    };
    showWin.addEventListener("dblclick", onDoubleClick);
    return () => showWin.removeEventListener("dblclick", onDoubleClick);
  }, [showWin]);

  // The stack is only worth showing once there is something to name in it.
  const labelled = trail.items[trail.cursor] ?? null;
  const stackVisible = pinned && labelled !== null;
  const stackMount = useUnmountDelay(stackVisible, PANEL_STACK_EXIT_MS);

  /**
   * What the stack lists, most prominent first.
   *
   * Live, that is the cast: every panel currently carrying the frame, which is
   * the thing a single credit line could never say. Stepped back into the
   * trail, there is no live cast to rank — the moment being named has passed —
   * so it lists what was on screen around it instead, newest first. Either way
   * the head of the list is the panel the label is naming.
   */
  const stack = useMemo<Panel[]>(() => {
    if (!labelled) return [];
    // Whatever the cursor says, if the cast's head is the panel being named then
    // the cast is what is on screen — which is the case for a held run as much
    // as a live one, since holding is how a stepped-back panel gets back on it.
    if (cast[0]?.id === labelled.id) return cast;
    // Walked back rather than sliced: a panel can come round again, and a list
    // that named it twice would say the wall is smaller than it is.
    const seen = new Set<string>();
    const recent: Panel[] = [];
    for (let i = trail.cursor; i >= 0 && recent.length < CAST_MAX; i--) {
      const entry = trail.items[i];
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      recent.push(entry);
    }
    return recent;
  }, [cast, labelled, trail.cursor, trail.items]);

  // Measured rather than assumed: the stack is a fixed row until it is opened,
  // and then it is however many panels are on screen. Held for the slide out as
  // well as the slide in, so the chrome only comes back down once the stack has
  // finished travelling.
  const [stackHeight, setStackHeight] = useState(PANEL_STACK_ROW_HEIGHT);
  useEffect(() => {
    // The next stack opens collapsed, so it must not be born at the height the
    // last one was left open at.
    if (!stackMount.mounted) setStackHeight(PANEL_STACK_ROW_HEIGHT);
  }, [stackMount.mounted]);
  const inset = stackMount.mounted ? stackHeight : 0;
  const lift = stackMount.mounted ? (stackMount.leaving ? "viz-lift-out" : "viz-lift-in") : "";

  /**
   * The engine's surface, wherever it is being drawn.
   *
   * Styled inline rather than in classes because the show window is given a
   * stylesheet of four rules and nothing else — no Tailwind, no site CSS, and
   * nothing that could put a pixel of this site on a screen an audience is
   * looking at.
   */
  const surface = (
    <div
      key="viz-surface"
      ref={setSurfaceEl}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    />
  );

  return (
    <div
      className={`fixed inset-0 z-100 overflow-hidden ${
        // Closing, the still of the run is the only thing left standing over the
        // wall: the overlay stops painting a ground and everything under it is
        // put away, so what comes up through the widening gutters is the gallery
        // itself rather than a black field that has to be got rid of afterwards.
        closing ? "pointer-events-none" : "bg-black viz-page-in"
      }`}
      style={
        {
          cursor: chromeVisible ? "default" : "none",
          // How far the stack and the chrome above it travel on their way in
          // and out. Inherited rather than set per element so the two cannot
          // disagree about it.
          "--viz-band": `${inset}px`,
        } as React.CSSProperties
      }
      onPointerMove={wakeChrome}
      onPointerDown={wakeChrome}
      // Only this element's own animation is the arrival; everything inside it
      // is running its own and bubbles through here.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) markCovered();
      }}
    >
      {/* The run and everything hung on it, put away in one move once the still
          is up. Held in the tree rather than unmounted: the engine's teardown
          belongs to the overlay's own unmount, at the end of the break, not to
          the first frame of it. */}
      <div className="absolute inset-0" style={{ visibility: closing ? "hidden" : "visible" }}>
        {/* The whole frame, always. The label used to be given a letterbox band
            cut out of this, which kept it off the art at the cost of a black bar
            across the bottom of every run and a resize of every render target
            each time it was pinned. It floats over the surface now instead, so
            the composition is never reframed by a caption.

            Three places it can be: here, in the show window, or — while a run is
            detached but its window has gone — nowhere at all, which is the state
            the console is drawn for. */}
        {show ? createPortal(surface, show.root) : detached ? null : surface}

        {projecting && (
          <VizShowConsole
            /* The tuning panel opens with the console and is the widest thing
               on this screen; kept in step with `.viz-tune-panel`'s own w-72. */
            leftInset={debugPanel.mounted && !debugPanel.leaving ? 288 : 0}
            onFocusShow={() => show?.win.focus()}
            onFullscreenShow={toggleFullscreen}
            onPlaceShow={placeShow}
            onAttach={toggleDetached}
          />
        )}

        {usable.length === 0 && settled && !projecting && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-display text-[11px] tracking-widest uppercase text-ink-muted">
              nothing to show
            </p>
          </div>
        )}

        {/* One line, top centre, for the handful of things the browser decides
            rather than we do — a blocked pop-up, a refused fullscreen. Clear of
            the corner buttons and out of the way of the art, since it can also
            come up on a run that is still in this window. */}
        {notice && (
          <div
            className="absolute top-0 left-0 right-0 flex justify-center px-16 pt-3.5 z-30
                       pointer-events-none"
            role="status"
          >
            <p
              className="max-w-136 text-center rounded-sm px-3 py-1.5 bg-black/70
                         font-display text-[10px] leading-relaxed tracking-widest uppercase
                         text-white/70"
              style={{ animation: "scrimIn 300ms ease-out" }}
            >
              {notice}
            </p>
          </div>
        )}

        <VizControls
          visible={chromeVisible}
          feature={cast[0] ?? null}
          /* Pinned, the bar already says it — twice would just be noise. Held
             until the bar has finished leaving, so the two never overlap. */
          showFeature={!stackMount.mounted}
          bottomInset={inset}
          /* Only the bottom cluster takes this. The buttons in the top corner sit
             where they sat. */
          lift={lift}
          seed={formatSeed(seed)}
          paused={paused}
          held={held}
          fullscreen={isFullscreen}
          pinned={pinned}
          speed={configRef.current.speed}
          presetId={presetId}
          projecting={projecting}
          onPresetChange={switchMode}
          onHoldChange={holdChrome}
          onSpeedChange={setSpeed}
          onStep={stepPanel}
          onToggleHold={toggleHold}
          onTogglePin={togglePinned}
          onClose={() => requestClose()}
          onToggleFullscreen={toggleFullscreen}
          onToggleDetached={toggleDetached}
          onToggleDebug={() => setShowDebug((visible) => !visible)}
        />

        {stackMount.mounted && stack.length > 0 && (
          <VizPanelStack
            stack={stack}
            behind={trail.items.length - 1 - trail.cursor}
            held={held}
            canStepBack={trail.cursor > 0}
            leaving={stackMount.leaving}
            onStep={stepPanel}
            onOpen={onOpenPanel ? openInViewer : undefined}
            onUnpin={togglePinned}
            onHeightChange={setStackHeight}
          />
        )}

        {debugPanel.mounted && (
          <VizDebugPanel
            config={configRef.current}
            engine={engine}
            reactor={reactorRef.current}
            seed={formatSeed(seed)}
            leaving={debugPanel.leaving}
            /* On a console there is no run behind this panel to press back to,
               so a press outside it is not a press away from tuning — it is a
               press on an empty black rectangle, and putting the sliders away
               would be the last thing it should mean. */
            sticky={projecting}
            onChange={handleTuned}
            onClose={() => setShowDebug(false)}
          />
        )}
      </div>

      {/* Last, and over everything: while the page is up, it is all there is. */}
      {closing && <VizPageBreak still={frameStill} />}
    </div>
  );
}
