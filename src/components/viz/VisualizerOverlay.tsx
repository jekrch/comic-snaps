import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Panel } from "../../types";
import { VizEngine } from "./engine/Engine";
import { formatSeed, parseSeed, randomSeed } from "./engine/rng";
import { VIZ_SPEEDS, cloneConfig, nearestSpeed } from "./vizConfig";
import type { VizConfig } from "./vizConfig";
import VizControls from "./VizControls";
import VizDebugPanel from "./VizDebugPanel";

const CONTROLS_IDLE_MS = 2000;

interface VisualizerOverlayProps {
  panels: Panel[];
  /** Resolved by the launch modal (preset, possibly with a custom override). */
  config: VizConfig;
  /** Only requested when the launch explicitly asked for it. */
  fullscreen: boolean;
  /** Live speed changes, so the URL keeps describing what is actually running. */
  onSpeedChange?: (speed: number) => void;
  onClose: () => void;
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
  onSpeedChange,
  onClose,
}: VisualizerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VizEngine | null>(null);
  const idleTimerRef = useRef<number>(0);

  const [engine, setEngine] = useState<VizEngine | null>(null);
  const [feature, setFeature] = useState<Panel | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [paused, setPaused] = useState(false);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPanels) return;

    const instance = new VizEngine(container, usableRef.current, configRef.current, seed);
    instance.onFeature = setFeature;
    instance.start();
    engineRef.current = instance;
    setEngine(instance);

    return () => {
      instance.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [hasPanels, seed]);

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
      } else {
        wakeChrome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, togglePause, toggleFullscreen, nudgeSpeed, wakeChrome]);

  return (
    <div
      className="fixed inset-0 z-100 bg-black overflow-hidden"
      style={{ cursor: chromeVisible ? "default" : "none" }}
      onPointerMove={wakeChrome}
      onPointerDown={wakeChrome}
    >
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
        feature={feature}
        seed={formatSeed(seed)}
        paused={paused}
        fullscreen={isFullscreen}
        speed={configRef.current.speed}
        onSpeedChange={setSpeed}
        onClose={onClose}
        onToggleFullscreen={toggleFullscreen}
        onToggleDebug={() => setShowDebug((visible) => !visible)}
      />

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
