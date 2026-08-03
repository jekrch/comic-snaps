import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioReactor, AudioSource, AudioStatus } from "./engine/AudioReactor";
import type { VizEngine } from "./engine/Engine";
import { AudioProbe } from "./engine/audioTrace";

/**
 * The listening readout: what the detector is hearing and what the composition
 * does with it, drawn live.
 *
 * Built at the same time as the reactor rather than after it, on the same
 * principle as the tuning panel itself — none of the constants in
 * `AudioReactor` can be chosen without watching them work, and from the frame
 * alone there is no way to tell "the detector is wrong" from "the binding is
 * wrong".
 *
 * That last sentence was true and the panel only ever answered half of it. The
 * meters below draw the *analysis*, which is the half that has worked since
 * phase 0; the reach readout under them draws what the analysis actually
 * delivers to the frame, which is the half two rounds of mis-tuning were spent
 * guessing at. See `engine/audioTrace.ts` and §7 of
 * `docs/visualizer-audio-reach.md`.
 *
 * It re-renders only when the status changes. The meters are written straight
 * to the DOM from a rAF loop instead: this panel carries a hundred-odd sliders,
 * and re-rendering all of them sixty times a second to move four bars would
 * cost more than the analysis does.
 */

const BANDS = [
  { key: "low", label: "low", hint: "20–160 Hz · kick, bass" },
  { key: "lowMid", label: "body", hint: "160–800 Hz" },
  { key: "mid", label: "mid", hint: "800 Hz–4 kHz · melody, vocals" },
  { key: "high", label: "air", hint: "4–16 kHz · hats, cymbals" },
] as const;

/** What each state should say to someone looking at a stalled meter. */
const STATUS_TEXT: Record<AudioStatus, string> = {
  off: "not listening",
  requesting: "waiting for permission…",
  listening: "listening",
  denied: "permission refused",
  "silent-share": "that share carried no audio",
  unsupported: "no audio capture in this browser",
  error: "capture failed",
};

/**
 * Short names for the reach rows. The full field names are two and three words
 * long and the readout is twenty rows deep in a panel this narrow — and unlike
 * the sliders, which are read one at a time, these are read as a column where
 * what matters is which of them are moving.
 */
const REACH_LABELS: Record<string, string> = {
  feedbackScale: "fb scale",
  feedbackRotate: "fb rot",
  hueShift: "hue",
  chroma: "chroma",
  grain: "grain",
  misreg: "misreg",
  bleed: "bleed",
  krackle: "krackle",
  feedbackAmount: "fb amt",
  bloom: "bloom",
  vignette: "vignette",
  bulge: "bulge",
  twist: "twist",
  ripple: "ripple",
  warp: "warp",
  kaleido: "kaleido",
  disperse: "disperse",
  pulse: "pulse",
  flight: "flight",
  spin: "spin",
};

/** The three rows of the hierarchy in §2, and what each is meant to answer. */
const REACH_GROUPS = [
  { row: "fast", label: "fast · beat", hint: "Colour, tone and the compounding trail. Nothing here has on-screen velocity, so all of it may run at beat rate." },
  { row: "bar", label: "bar · geometry", hint: "Moves the picture, so it runs at a quarter of the rate and several times the depth. Peak rate is the budget that matters here." },
  { row: "geometry", label: "distortion", hint: "Multiplied, never introduced — every one of these is 0 unless the preset asked for it, and a flat row here is usually a preset that did not." },
] as const;

/** Above this the music is doing something to a parameter worth looking at.
 *  Below it the row is dimmed, which is what makes §1.1's finding — that audio
 *  reaches eight parameters and four of them are usually zero — a glance. */
const LIVE_REACH = 0.005;

interface VizAudioMetersProps {
  reactor: AudioReactor | null;
  /** The run, for the reach readout. Rebuilt whenever the composition changes
   *  windows, which is why the probe is owned here and re-attached rather than
   *  held by the engine. */
  engine?: VizEngine | null;
  /** Stopped while the panel slides out — the meters are the most expensive
   *  thing on it, and nobody is reading them on the way off screen. */
  paused?: boolean;
}

export default function VizAudioMeters({
  reactor,
  engine = null,
  paused = false,
}: VizAudioMetersProps) {
  const [status, setStatus] = useState<AudioStatus>(reactor?.status ?? "off");
  const bars = useRef(new Map<string, HTMLDivElement>());
  const fluxRef = useRef<HTMLDivElement>(null);
  const thresholdRef = useRef<HTMLDivElement>(null);
  const onsetRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const tempoRef = useRef<HTMLSpanElement>(null);
  const lockRef = useRef<HTMLSpanElement>(null);

  const probeRef = useRef<AudioProbe | null>(null);
  if (probeRef.current === null) probeRef.current = new AudioProbe();
  const [showReach, setShowReach] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [traced, setTraced] = useState(0);
  const reachRows = useRef(new Map<string, HTMLElement>());
  const traceCountRef = useRef<HTMLSpanElement>(null);

  /** Layout only. The keys and their grouping are fixed at construction, so
   *  this never has to follow the values it is a frame for. */
  const layout = useMemo(
    () =>
      REACH_GROUPS.map(({ row, label, hint }) => ({
        row,
        label,
        hint,
        keys: (probeRef.current?.read() ?? [])
          .filter((reach) => reach.row === row)
          .map((reach) => reach.key),
      })),
    []
  );

  const setBar = useCallback(
    (key: string) => (element: HTMLDivElement | null) => {
      if (element) bars.current.set(key, element);
      else bars.current.delete(key);
    },
    []
  );

  const setReachRow = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element) reachRows.current.set(key, element);
      else reachRows.current.delete(key);
    },
    []
  );

  useEffect(() => {
    if (!reactor) return;
    setStatus(reactor.status);
    reactor.onStatus = () => setStatus(reactor.status);
    return () => {
      reactor.onStatus = null;
    };
  }, [reactor]);

  /*
   * Attached for as long as this panel is mounted, and detached the moment it is
   * not — so a run nobody is tuning measures nothing, which is the same rule the
   * reactor follows about not opening a device until asked. The engine is torn
   * down and rebuilt when the composition changes windows, so this has to
   * re-attach rather than be handed over once.
   */
  useEffect(() => {
    if (!engine) return;
    const probe = probeRef.current;
    engine.setAudioProbe(probe);
    return () => {
      engine.setAudioProbe(null);
      // The window it was measuring is gone, and carrying a ten-second range
      // across the gap would report a reach the new run never had.
      probe?.reset();
      setTracing(false);
      setTraced(0);
    };
  }, [engine]);

  useEffect(() => {
    const probe = probeRef.current;
    // Kept running while a trace is being taken even with the rows collapsed:
    // the recording stops itself at the cap and the button below has no other
    // way to hear about it.
    if (!probe || paused || (!showReach && !tracing)) return;
    let handle = 0;
    let next = 0;

    const draw = (now: number) => {
      handle = window.requestAnimationFrame(draw);
      /*
       * Ten a second, not sixty. The window these are taken over is ten seconds
       * long, so nothing in here can say anything new inside 16ms — and this is
       * twenty rows of three writes each, against the four the meters above do.
       */
      if (now < next) return;
      next = now + 100;

      for (const reach of showReach ? probe.read() : []) {
        const bar = reachRows.current.get(`${reach.key}:bar`);
        if (bar) bar.style.width = `${Math.min(1, reach.reach) * 100}%`;
        const value = reachRows.current.get(`${reach.key}:reach`);
        if (value) value.textContent = percent(reach.reach);
        const rate = reachRows.current.get(`${reach.key}:rate`);
        if (rate) rate.textContent = reach.peakRate > 0 ? `${(reach.peakRate * 100).toFixed(0)}%/s` : "—";
        const root = reachRows.current.get(reach.key);
        if (root) {
          root.style.opacity = reach.reach > LIVE_REACH ? "1" : "0.35";
          // The exact figures, for the moment a bar raises a question. Cheaper
          // than four more spans per row and read far less often.
          root.title =
            `${reach.key}\nauthored ${reach.authored.toPrecision(4)}` +
            `\nnow ${reach.delivered.toPrecision(4)}` +
            `\nrange ${reach.low.toPrecision(4)} → ${reach.high.toPrecision(4)}` +
            `\npeak rate ${(reach.peakRate * 100).toFixed(1)}%/s`;
        }
      }

      if (traceCountRef.current) {
        traceCountRef.current.textContent = probe.recording
          ? `${probe.seconds.toFixed(0)}s`
          : probe.frames > 0
            ? `${probe.frames}`
            : "";
      }
      // Stops itself at the cap; the button has to find out somehow.
      if (tracing && !probe.recording) {
        setTracing(false);
        setTraced(probe.frames);
      }
    };

    handle = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(handle);
  }, [paused, showReach, tracing]);

  useEffect(() => {
    if (!reactor || paused || status !== "listening") return;
    let handle = 0;
    let lastOnset = -1;
    let flash = 0;

    const draw = () => {
      handle = window.requestAnimationFrame(draw);
      const frame = reactor.frame;

      for (const { key } of BANDS) {
        const bar = bars.current.get(key);
        if (bar) bar.style.width = `${(frame[key] * 100).toFixed(1)}%`;
      }
      const level = bars.current.get("level");
      if (level) level.style.width = `${(frame.level * 100).toFixed(1)}%`;

      if (fluxRef.current) fluxRef.current.style.width = `${(frame.flux * 100).toFixed(1)}%`;
      if (thresholdRef.current) {
        thresholdRef.current.style.left = `${(frame.fluxThreshold * 100).toFixed(1)}%`;
      }

      // Off the counter rather than off `onset`, which is true for exactly one
      // analysed frame — and the engine's frames are not this loop's.
      if (frame.onsetCount !== lastOnset) {
        lastOnset = frame.onsetCount;
        flash = 1;
      }
      flash *= 0.82;
      if (onsetRef.current) onsetRef.current.style.opacity = flash.toFixed(2);

      if (beatRef.current) {
        // Runs down as the next beat approaches, so a lock reads as a metronome
        // rather than as a bar wandering about.
        beatRef.current.style.width = `${((1 - frame.beatPhase) * 100).toFixed(1)}%`;
        beatRef.current.style.opacity = (0.25 + frame.confidence * 0.75).toFixed(2);
      }
      if (tempoRef.current) {
        tempoRef.current.textContent = frame.bpm > 0 ? `${frame.bpm.toFixed(1)} bpm` : "— bpm";
      }
      if (lockRef.current) {
        lockRef.current.textContent = frame.silent
          ? "silent"
          : `lock ${(frame.confidence * 100).toFixed(0)}%`;
      }
    };

    handle = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(handle);
  }, [reactor, paused, status]);

  const toggleTrace = () => {
    const probe = probeRef.current;
    if (!probe) return;
    if (probe.recording) {
      probe.stopTrace();
      setTracing(false);
      setTraced(probe.frames);
    } else {
      probe.startTrace();
      setTracing(true);
      setTraced(0);
    }
  };

  const download = () => {
    const probe = probeRef.current;
    if (!probe || probe.frames === 0) return;
    const blob = new Blob([probe.csv()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `viz-audio-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const listen = (source: AudioSource) => {
    if (!reactor) return;
    if (reactor.source === source) {
      reactor.stop();
      return;
    }
    void reactor.start(source);
  };

  const listening = status === "listening";
  const failed = status === "denied" || status === "error" || status === "silent-share";

  return (
    <div className="viz-tune-readout px-2 py-1.5 rounded-xs font-mono text-[10px] leading-relaxed tracking-wide">
      <div className="flex items-center gap-1.5">
        <div
          ref={onsetRef}
          className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
          style={{ opacity: 0 }}
          aria-hidden
        />
        <span className={failed ? "text-red-400/80" : listening ? "" : "opacity-55"}>
          {STATUS_TEXT[status]}
        </span>
        {listening && (
          <>
            <span ref={tempoRef} className="ml-auto opacity-75">
              — bpm
            </span>
            <span ref={lockRef} className="opacity-55">
              lock 0%
            </span>
          </>
        )}
      </div>

      {reactor?.error && failed && (
        <div className="mt-1 opacity-55 leading-snug normal-case">{reactor.error}</div>
      )}

      {listening && (
        <div className="mt-2 flex flex-col gap-1">
          {[...BANDS, { key: "level", label: "all", hint: "broadband" } as const].map(
            ({ key, label, hint }) => (
              <div key={key} className="flex items-center gap-1.5" title={hint}>
                <span className="w-7 shrink-0 opacity-45">{label}</span>
                <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                  <div
                    ref={setBar(key)}
                    className={`h-full rounded-full ${
                      key === "level" ? "bg-white/35" : "bg-accent/70"
                    }`}
                    style={{ width: "0%" }}
                  />
                </div>
              </div>
            )
          )}

          {/* Flux against the threshold it is tested on: the one view that says
              whether a missed beat is a detector that cannot see the transient
              or a threshold sitting above it. */}
          <div className="flex items-center gap-1.5" title="spectral flux vs. its adaptive threshold">
            <span className="w-7 shrink-0 opacity-45">flux</span>
            <div className="relative flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div ref={fluxRef} className="h-full bg-white/50 rounded-full" style={{ width: "0%" }} />
              <div
                ref={thresholdRef}
                className="absolute top-0 bottom-0 w-px bg-red-400/80"
                style={{ left: "0%" }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5" title="time to the next predicted beat">
            <span className="w-7 shrink-0 opacity-45">beat</span>
            <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div ref={beatRef} className="h-full bg-accent rounded-full" style={{ width: "0%" }} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 flex gap-1">
        <button
          onClick={() => listen("mic")}
          disabled={!reactor || status === "requesting"}
          className="viz-tune-btn flex-1 py-1 font-display text-[9px] tracking-widest uppercase
                     text-white/60 hover:text-accent disabled:opacity-40"
        >
          {reactor?.source === "mic" ? "stop" : "mic"}
        </button>
        <button
          onClick={() => listen("display")}
          disabled={!reactor || status === "requesting"}
          className="viz-tune-btn flex-1 py-1 font-display text-[9px] tracking-widest uppercase
                     text-white/60 hover:text-accent disabled:opacity-40"
          title="Share a tab or your screen with “share audio” ticked"
        >
          {reactor?.source === "display" ? "stop" : "tab audio"}
        </button>
      </div>

      {/*
        The reach readout: what the analysis above actually delivers to the
        frame. Collapsed by default — it is twenty rows and it is an instrument
        rather than a display, wanted when a binding is in question and in the
        way the rest of the time.
      */}
      {engine && (
        <div className="mt-2 pt-2 border-t border-white/8">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowReach((open) => !open)}
              className="opacity-55 hover:opacity-90 hover:text-accent"
              title="What the music delivers to each bound parameter: its range over the last ten seconds against the value the composition authored, and its peak rate of change."
            >
              {showReach ? "▾" : "▸"} reach
            </button>
            <button
              onClick={toggleTrace}
              className={`ml-auto hover:text-accent ${tracing ? "text-accent" : "opacity-55"}`}
              title="Record every channel and every delivered deviation, one row per drawn frame, for the amplitude spectrum in §7. Stops itself after three minutes."
            >
              {tracing ? "■ tracing" : "● trace"}
            </button>
            <span ref={traceCountRef} className="opacity-45 w-8 text-right" />
            <button
              onClick={download}
              disabled={tracing || traced === 0}
              className="opacity-55 hover:text-accent disabled:opacity-20"
              title="Download the trace as CSV"
            >
              csv
            </button>
          </div>

          {showReach && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {layout.map(({ row, label, hint, keys }) => (
                <div key={row} className="flex flex-col gap-0.5">
                  <div className="opacity-35 tracking-widest uppercase text-[9px]" title={hint}>
                    {label}
                  </div>
                  {keys.map((key) => (
                    <div
                      key={key}
                      ref={setReachRow(key)}
                      className="flex items-center gap-1.5"
                      style={{ opacity: 0.35 }}
                    >
                      <span className="w-14 shrink-0 opacity-60 truncate">
                        {REACH_LABELS[key] ?? key}
                      </span>
                      <div className="flex-1 min-w-0 h-1 bg-white/8 rounded-full overflow-hidden">
                        <div
                          ref={setReachRow(`${key}:bar`)}
                          className="h-full bg-accent/70 rounded-full"
                          style={{ width: "0%" }}
                        />
                      </div>
                      <span
                        ref={setReachRow(`${key}:reach`)}
                        className="w-8 shrink-0 text-right opacity-75"
                      >
                        —
                      </span>
                      <span
                        ref={setReachRow(`${key}:rate`)}
                        className="w-11 shrink-0 text-right opacity-45"
                      >
                        —
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Reach as a percentage of the authored value, and the reason it is capped
 * rather than shown.
 *
 * A parameter the preset authored at zero — most of the press family, and every
 * distortion on a default preset — has no meaningful denominator, so the honest
 * reading is "the music is the whole of this parameter" rather than a number
 * with four digits in it. The bar saturates at the same place.
 */
function percent(reach: number): string {
  if (reach < 0.0005) return "—";
  if (reach >= 10) return "≫";
  return `${(reach * 100).toFixed(reach < 0.1 ? 1 : 0)}%`;
}
