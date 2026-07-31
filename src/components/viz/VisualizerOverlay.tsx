import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Panel } from "../../types";
import { VizEngine } from "./engine/Engine";
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
import { useUnmountDelay } from "./useUnmountDelay";

const CONTROLS_IDLE_MS = 2000;

/** Longest the close will wait on a still of the run before going without one.
 *  The capture is a frame and an encode; this is only here so a wedged tab
 *  cannot leave the reader holding a run they have asked to leave. */
const FRAME_CAPTURE_MS = 400;

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
  pinLabel = false,
  onPresetChange,
  onSpeedChange,
  onConfigChange,
  onOpenPanel,
  viewerOpen = false,
  onLeaving,
  onClose,
}: VisualizerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VizEngine | null>(null);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPanels) return;

    const instance = new VizEngine(container, usableRef.current, configRef.current, seed);
    instance.onCast = handleCast;
    instance.start();
    engineRef.current = instance;
    setEngine(instance);

    return () => {
      instance.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [hasPanels, seed, handleCast]);

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
  const requestClose = useCallback(() => {
    // Marked here rather than in the effect, so a second Escape while the
    // capture is in flight is a no-op rather than a second capture.
    if (closingRef.current) return;
    closingRef.current = true;
    setChromeVisible(false);
    window.clearTimeout(idleTimerRef.current);

    const engine = engineRef.current;
    void Promise.race([
      engine?.captureStill() ?? Promise.resolve(null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), FRAME_CAPTURE_MS)),
    ]).then((blob) => {
      const still = blob ? URL.createObjectURL(blob) : null;
      frameStillRef.current = still;
      setFrameStill(still);
      // Stopped only now: the still it hands back has to be a frame it drew.
      // Nothing is watching the surface after this — the still is standing in
      // front of it — so the run has no reason to carry on rendering.
      engine?.stop();
      setClosing(true);
      onLeaving?.();
    });
  }, [onLeaving]);

  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(onClose, vizBreakMs());
    return () => window.clearTimeout(id);
  }, [closing, onClose]);

  // --- screensaver hygiene --------------------------------------------------

  // Given back when the break starts rather than at unmount, which is a second
  // later: dropping the gutter widens the page under the overlay, and the wall
  // coming up through the gutters has to be the one the reader is going to be
  // left standing on. Behind the still, which is whole at that instant, the
  // reflow is not visible; a second later, through the seams, it would be.
  useEffect(() => {
    if (closing) return;
    const root = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    // `html { scrollbar-gutter: stable }` reserves a strip outside the layout
    // viewport that a fixed inset-0 overlay cannot cover, so it shows through as
    // a light bar down the right edge. Drop the gutter while the viz is up.
    const previousGutter = root.style.scrollbarGutter;
    document.body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "auto";
    return () => {
      document.body.style.overflow = previousOverflow;
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousGutter;
    };
  }, [closing]);

  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    // Fullscreen can also be left by Esc or the browser's own chrome, so the
    // button state follows the document rather than our own requests.
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    // The request only succeeds while the launch click is still the active user
    // gesture, so a `?viz=1` cold load stays windowed however this is set.
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" })?.catch(() => undefined);
  }, [fullscreen]);

  // Unconditional: fullscreen may have been entered from the button, not the launch.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        if (released) void sentinel?.release();
      } catch {
        /* denied or unsupported — the visualizer still runs */
      }
    };
    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !released) void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  // Pause when the tab is hidden. The engine also clamps dt, so a long absence
  // resumes smoothly rather than lurching the composition forward.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) engineRef.current?.stop();
      else if (!paused) engineRef.current?.start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [paused]);

  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(idleTimerRef.current);
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

  useEffect(() => {
    wakeChrome();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [wakeChrome]);

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

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else
      void document.documentElement
        .requestFullscreen?.({ navigationUI: "hide" })
        ?.catch(() => undefined);
    wakeChrome();
  }, [wakeChrome]);

  // The viewer on top owns the keyboard while it is open: Escape has to close
  // the panel rather than the run beneath it, and the arrows have to page the
  // lightbox rather than walk the trail.
  // Also dead while the page is sealing: the run is on its way out and the keys
  // would be acting on something the reader can no longer see.
  useEffect(() => {
    if (viewerOpen || closing) return;

    const onKey = (event: KeyboardEvent) => {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    requestClose,
    togglePause,
    toggleFullscreen,
    nudgeSpeed,
    cycleMode,
    togglePinned,
    stepPanel,
    toggleHold,
    wakeChrome,
    viewerOpen,
    closing,
  ]);

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
            the composition is never reframed by a caption. */}
        <div ref={containerRef} className="absolute inset-0" />

        {usable.length === 0 && settled && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-display text-[11px] tracking-widest uppercase text-ink-muted">
              nothing to show
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
          onPresetChange={switchMode}
          onHoldChange={holdChrome}
          onSpeedChange={setSpeed}
          onStep={stepPanel}
          onToggleHold={toggleHold}
          onTogglePin={togglePinned}
          onClose={requestClose}
          onToggleFullscreen={toggleFullscreen}
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
            seed={formatSeed(seed)}
            leaving={debugPanel.leaving}
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
