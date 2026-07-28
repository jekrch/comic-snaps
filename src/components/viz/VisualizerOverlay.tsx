import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Panel } from "../../types";
import { VizEngine } from "./engine/Engine";
import { formatSeed, parseSeed, randomSeed } from "./engine/rng";
import { VIZ_SPEEDS, cloneConfig, nearestSpeed } from "./vizConfig";
import type { VizConfig } from "./vizConfig";
import VizAttributionBar, { ATTRIBUTION_BAR_HEIGHT } from "./VizAttributionBar";
import VizControls from "./VizControls";
import VizDebugPanel from "./VizDebugPanel";

const CONTROLS_IDLE_MS = 2000;

/** How far back the pinned label can step. Long enough to cover an unattended
 *  stretch, short enough that the panels stay in the browser's image cache. */
const TRAIL_MAX = 60;

interface VisualizerOverlayProps {
  panels: Panel[];
  /** Resolved by the launch modal (preset, possibly with a custom override). */
  config: VizConfig;
  /** Only requested when the launch explicitly asked for it. */
  fullscreen: boolean;
  /** Start with the attribution label pinned, as asked for at launch. */
  pinLabel?: boolean;
  /** Live speed changes, so the URL keeps describing what is actually running. */
  onSpeedChange?: (speed: number) => void;
  /** Leaves the run and hands the panel to the image viewer. */
  onOpenPanel?: (panel: Panel) => void;
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
  fullscreen,
  pinLabel = false,
  onSpeedChange,
  onOpenPanel,
  onClose,
}: VisualizerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VizEngine | null>(null);
  const idleTimerRef = useRef<number>(0);

  const [engine, setEngine] = useState<VizEngine | null>(null);
  const [feature, setFeature] = useState<Panel | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(pinLabel);
  const [trail, dispatchTrail] = useReducer(trailReducer, EMPTY_TRAIL);

  const { seed, showDebugDefault } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      seed: parseSeed(params.get("vizseed")) ?? randomSeed(),
      showDebugDefault: params.get("vizdebug") === "1",
    };
  }, []);
  const [showDebug, setShowDebug] = useState(showDebugDefault);

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

  // Every feature also lands in the trail, whether or not the label is pinned —
  // pinning it mid-run should show what has already been on screen, not start
  // an empty history.
  const handleFeature = useCallback((panel: Panel | null) => {
    setFeature(panel);
    if (panel) dispatchTrail({ type: "feature", panel });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPanels) return;

    const instance = new VizEngine(container, usableRef.current, configRef.current, seed);
    instance.onFeature = handleFeature;
    instance.start();
    engineRef.current = instance;
    setEngine(instance);

    return () => {
      instance.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [hasPanels, seed, handleFeature]);

  // Distinguishes "still loading" from "the filters really do match nothing".
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  // --- screensaver hygiene --------------------------------------------------

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

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
    idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    wakeChrome();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [wakeChrome]);

  const togglePause = useCallback(() => {
    setPaused((wasPaused) => {
      if (wasPaused) engineRef.current?.start();
      else engineRef.current?.stop();
      return !wasPaused;
    });
    wakeChrome();
  }, [wakeChrome]);

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

  const togglePinned = useCallback(() => {
    // Unpinning lets go of the trail as well: the transient credit line the bar
    // hands back to only ever describes what is on screen now.
    setPinned((wasPinned) => {
      if (wasPinned) dispatchTrail({ type: "live" });
      return !wasPinned;
    });
    wakeChrome();
  }, [wakeChrome]);

  /** Stepping the trail pins the label, so the arrow keys work from a bare run. */
  const stepTrail = useCallback(
    (delta: -1 | 1) => {
      setPinned(true);
      dispatchTrail({ type: "step", delta });
      wakeChrome();
    },
    [wakeChrome]
  );

  const openInViewer = useCallback(
    (panel: Panel) => {
      // The caller closes the run — a lightbox behind a fullscreen screensaver
      // would be no use to anyone.
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "q") {
        event.preventDefault();
        onClose();
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
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepTrail(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepTrail(1);
      } else {
        wakeChrome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, togglePause, toggleFullscreen, nudgeSpeed, togglePinned, stepTrail, wakeChrome]);

  // The bar is only worth its band once there is something to name in it.
  const labelled = trail.items[trail.cursor] ?? null;
  const barVisible = pinned && labelled !== null;
  const inset = barVisible ? ATTRIBUTION_BAR_HEIGHT : 0;

  return (
    <div
      className="fixed inset-0 z-100 bg-black overflow-hidden"
      style={{ cursor: chromeVisible ? "default" : "none" }}
      onPointerMove={wakeChrome}
      onPointerDown={wakeChrome}
    >
      {/* Inset rather than overlaid: the surface gives up the band so the label
          never sits on top of the art. The resize observer picks the new size
          up, so the aspect the director composes to follows it. */}
      <div ref={containerRef} className="absolute inset-0" style={{ bottom: inset }} />

      {usable.length === 0 && settled && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-display text-[11px] tracking-widest uppercase text-ink-muted">
            nothing to show
          </p>
        </div>
      )}

      <VizControls
        visible={chromeVisible}
        feature={feature}
        /* Pinned, the bar already says it — twice would just be noise. */
        showFeature={!barVisible}
        bottomInset={inset}
        seed={formatSeed(seed)}
        paused={paused}
        fullscreen={isFullscreen}
        pinned={pinned}
        speed={configRef.current.speed}
        onSpeedChange={setSpeed}
        onTogglePin={togglePinned}
        onClose={onClose}
        onToggleFullscreen={toggleFullscreen}
        onToggleDebug={() => setShowDebug((visible) => !visible)}
      />

      {barVisible && labelled && (
        <VizAttributionBar
          panel={labelled}
          behind={trail.items.length - 1 - trail.cursor}
          canStepBack={trail.cursor > 0}
          canStepForward={trail.cursor < trail.items.length - 1}
          onStep={stepTrail}
          onOpen={onOpenPanel ? openInViewer : undefined}
          onUnpin={togglePinned}
        />
      )}

      {showDebug && (
        <VizDebugPanel
          config={configRef.current}
          engine={engine}
          seed={formatSeed(seed)}
          onChange={bumpConfig}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  );
}
