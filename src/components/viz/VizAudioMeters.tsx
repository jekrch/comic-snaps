import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AudioInput, AudioReactor, AudioSource, AudioStatus } from "./engine/AudioReactor";
import { displayCaptureSupported, listAudioInputs } from "./engine/AudioReactor";
import type { VizEngine } from "./engine/Engine";
import { AudioProbe } from "./engine/audioTrace";
import type { VizConfig } from "./vizConfig";
import { AUDIO_CHARACTERS, audioCharacterOf, prefersReducedMotion } from "./vizConfig";

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

/** The three flux streams, each with its own adaptive threshold. Split because
 *  one sum over the spectrum is dominated by whichever region covers the most
 *  bins, and a threshold tuned for that one is deaf to the others. */
const FLUX_BANDS = [
  { key: "fluxLow", threshold: "fluxLowThreshold", label: "kick", hint: "20–200 Hz flux vs. its adaptive threshold" },
  { key: "fluxMid", threshold: "fluxMidThreshold", label: "snare", hint: "200 Hz–2 kHz flux vs. its adaptive threshold" },
  { key: "fluxHigh", threshold: "fluxHighThreshold", label: "hat", hint: "2–10 kHz flux vs. its adaptive threshold" },
] as const;

/** What each state should say to someone looking at a stalled meter. */
const STATUS_TEXT: Record<AudioStatus, string> = {
  off: "not listening",
  requesting: "waiting for permission…",
  listening: "listening",
  denied: "permission refused",
  "silent-share": "that share carried no audio",
  unsupported: "capture unavailable",
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
  /** Mutated in place, exactly as the sliders below this panel do — the named
   *  characters are two of those sliders moved together. */
  config?: VizConfig | null;
  onChange?: () => void;
  /** Stopped while the panel slides out — the meters are the most expensive
   *  thing on it, and nobody is reading them on the way off screen. */
  paused?: boolean;
}

export default function VizAudioMeters({
  reactor,
  engine = null,
  config = null,
  onChange,
  paused = false,
}: VizAudioMetersProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [status, setStatus] = useState<AudioStatus>(reactor?.status ?? "off");
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  /** Empty is the system default, which is what an unpicked run opens. */
  const [input, setInput] = useState("");
  const bars = useRef(new Map<string, HTMLDivElement>());
  const fluxRefs = useRef(new Map<string, HTMLDivElement>());
  const thresholdRefs = useRef(new Map<string, HTMLDivElement>());
  const onsetRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLSpanElement>(null);
  const tempoRef = useRef<HTMLSpanElement>(null);
  const lockRef = useRef<HTMLSpanElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const rivalRef = useRef<HTMLDivElement>(null);
  const loudRef = useRef<HTMLDivElement>(null);
  const loudTextRef = useRef<HTMLSpanElement>(null);

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
   * The input list, refreshed when a device is plugged in or pulled out and
   * again on every status change — the browser withholds device *names* until a
   * capture has been granted, so the list is anonymous and one entry long until
   * the first successful listen and worth reading again immediately after it.
   */
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let live = true;
    const refresh = () => {
      void listAudioInputs().then((found) => {
        if (!live) return;
        setInputs(found);
        // The chosen input has been unplugged. Fall back rather than hold an id
        // that would now fail the `exact` constraint on the next listen.
        setInput((current) =>
          current && !found.some((entry) => entry.deviceId === current) ? "" : current
        );
      });
    };
    refresh();
    media.addEventListener?.("devicechange", refresh);
    return () => {
      live = false;
      media.removeEventListener?.("devicechange", refresh);
    };
  }, [status]);

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

      if (showReach) {
        const budget = probe.budget();
        const fast = reachRows.current.get("budget:fast");
        if (fast) fast.textContent = `fast ${percent(budget.fast)}`;
        const bar = reachRows.current.get("budget:bar");
        if (bar) bar.textContent = `bar ${percent(budget.bar)}`;
        const geometry = reachRows.current.get("budget:geometry");
        if (geometry) geometry.textContent = `dist ${percent(budget.geometry)}`;
      }

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

      /*
       * Relative loudness, drawn either side of a centre tick rather than as a
       * bar from zero — its neutral is 1, not 0, and the only question it
       * answers is which side of the run's own average this passage is on.
       * Half a decade either way fills the meter, which is more dynamic range
       * than most records have.
       */
      if (loudRef.current) {
        const offset = Math.log10(Math.max(0.01, frame.loudness)) / 0.5;
        const clamped = Math.max(-1, Math.min(1, offset));
        loudRef.current.style.left = `${(50 + Math.min(0, clamped) * 50).toFixed(1)}%`;
        loudRef.current.style.width = `${(Math.abs(clamped) * 50).toFixed(1)}%`;
      }
      if (loudTextRef.current) {
        loudTextRef.current.textContent = `${frame.loudness.toFixed(2)}×`;
      }

      for (const band of FLUX_BANDS) {
        const bar = fluxRefs.current.get(band.key);
        if (bar) bar.style.width = `${(frame[band.key] * 100).toFixed(1)}%`;
        const mark = thresholdRefs.current.get(band.key);
        if (mark) mark.style.left = `${(frame[band.threshold] * 100).toFixed(1)}%`;
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
      if (barRef.current) {
        // Runs down the bar rather than the beat, so a downbeat that is landing
        // in the wrong place is visible as the two disagreeing.
        barRef.current.style.width = `${((1 - frame.barPhase) * 100).toFixed(1)}%`;
        barRef.current.style.opacity = (0.2 + frame.downbeatConfidence * 0.8).toFixed(2);
      }
      if (figureRef.current) {
        const figure = probeRef.current?.figure;
        // Only while the grid is followed. Every routing gain in the figure is
        // multiplied by `grid` downstream, so an unlocked run is spending none of
        // them however confidently this row would name one.
        figureRef.current.textContent = frame.locked && figure ? figure : "—";
      }
      if (tempoRef.current) {
        tempoRef.current.textContent = frame.bpm > 0 ? `${frame.bpm.toFixed(1)} bpm` : "— bpm";
      }
      if (candidateRef.current) {
        // Which stream the histogram was built from, then the candidates it is
        // choosing between, strongest first. A near-tie between two of these is a
        // different fault from one confident peak in the wrong place.
        candidateRef.current.textContent =
          reactor.candidates.length > 0
            ? `${reactor.tempoSource} · ` +
              reactor.candidates
                .map((c) => `${c.bpm.toFixed(0)}@${c.score.toFixed(2)}`)
                .join("  ")
            : reactor.tempoSource;
      }
      if (rivalRef.current) {
        /*
         * The comparison tracker, beside ours — see `AudioReactor.aubioBpm`.
         *
         * Two independent estimates of the same quantity is the only instrument that
         * settles which one to trust on material a synthetic bench cannot reproduce,
         * and its confidence is shown because aubio's is well calibrated: measured
         * across the bench, 0.14 on a pad with no beat, 0.45 on off-grid hits, and
         * 1.5-3.3 on anything with a real pulse.
         */
        /*
         * Three estimates of the same quantity, which is the only instrument that can
         * settle this on material a synthetic bench cannot reproduce.
         *
         * `comb` is the tempogram and is the one that now owns the period whenever it
         * is sure — `*` marks that it is being trusted. `aubio` is the reference it was
         * built to match and cannot ship, being GPL-3.0 against this project's MIT.
         * The candidate line above is the old inter-onset histogram, kept because it is
         * still the fallback and still a witness.
         */
        const comb =
          reactor.combBpm > 0
            ? `comb ${reactor.combBpm.toFixed(1)}${reactor.combTrusted ? "*" : ""} (z ${reactor.combZ.toFixed(1)})`
            : "comb —";
        const rival =
          reactor.aubioBpm > 0
            ? `aubio ${reactor.aubioBpm.toFixed(1)} (${reactor.aubioConfidence.toFixed(2)})`
            : "aubio —";
        rivalRef.current.textContent = `${comb} · ${rival}`;
      }
      if (lockRef.current) {
        // Both confidences, because they answer different questions and a run
        // where one is high and the other is zero is the common case rather
        // than the odd one: ambient reads clear-0 lock-0, a drum solo in 7
        // reads clear-100 lock-0, and only one of those is a detector problem.
        lockRef.current.textContent = frame.silent
          ? "silent"
          : `lock ${(frame.confidence * 100).toFixed(0)} · clr ${(frame.clarity * 100).toFixed(0)}`;
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

  /**
   * Switching input under a run that is already listening reopens it on the new
   * device, which is the only way to hear the change — the constraint is fixed
   * at capture. Off, it is just a choice for the next listen.
   */
  const chooseInput = (deviceId: string) => {
    setInput(deviceId);
    if (reactor?.source === "mic") void reactor.start("mic", deviceId || undefined);
  };

  const listen = (source: AudioSource) => {
    if (!reactor) return;
    if (reactor.source === source) {
      reactor.stop();
      return;
    }
    void reactor.start(source, source === "mic" ? input || undefined : undefined);
  };

  const listening = status === "listening";
  const failed =
    status === "denied" ||
    status === "error" ||
    status === "silent-share" ||
    status === "unsupported";
  const character = config ? audioCharacterOf(config) : null;
  const calm = prefersReducedMotion();
  // A capability of the browser, not of this run: it cannot change between
  // renders, so it is read once rather than tracked as state.
  const canShareTab = useMemo(() => displayCaptureSupported(), []);

  const setCharacter = (id: string) => {
    const chosen = AUDIO_CHARACTERS.find((entry) => entry.id === id);
    if (!config || !chosen) return;
    config.reactivity = chosen.reactivity;
    config.attack = chosen.attack;
    bump();
    onChange?.();
  };

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
        // The tempo contest, per `AudioReactor.candidates`: which onset stream the
        // histogram was built from and how many onsets were in it, then the tempi it
        // is choosing between with their scores relative to the winner. A wrong BPM
        // on its own says nothing about why; this says whether two octaves are tied,
        // whether one confident peak is in the wrong place, or whether there is no
        // peak at all and the prior is deciding.
        <div
          ref={candidateRef}
          className="mt-1 font-mono text-[10px] opacity-45 normal-case tabular-nums"
        >
          —
        </div>
      )}

      {listening && (
        // The second opinion. See `AudioReactor.aubioBpm` — diagnostic only, and it
        // cannot ship: aubio is GPL-3.0 against this project's MIT.
        <div
          ref={rivalRef}
          className="font-mono text-[10px] opacity-45 normal-case tabular-nums"
        >
          aubio —
        </div>
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

          {/* The one figure here that is not range-normalised, and the only
              place a chorus can look different from a verse. Every band above
              it is mapped into 0..1 against its own recent range on purpose,
              which is what makes the detector work on any source and what
              deletes the loudest thing music does. */}
          <div
            className="flex items-center gap-1.5"
            title="this passage against the run's own average — the depth multiplier"
          >
            <span className="w-7 shrink-0 opacity-45">dyn</span>
            <div className="relative flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div
                ref={loudRef}
                className="absolute top-0 bottom-0 bg-accent/50"
                style={{ left: "50%", width: "0%" }}
              />
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />
            </div>
            <span ref={loudTextRef} className="w-8 shrink-0 text-right opacity-55">
              1.00×
            </span>
          </div>

          {/* Each flux stream against the threshold it is tested on: the one
              view that says whether a missed beat is a detector that cannot see
              the transient or a threshold sitting above it — and now which of
              the three that is true of, which one summed stream could not. */}
          {FLUX_BANDS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-1.5" title={hint}>
              <span className="w-7 shrink-0 opacity-45">{label}</span>
              <div className="relative flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div
                  ref={(element) => {
                    if (element) fluxRefs.current.set(key, element);
                    else fluxRefs.current.delete(key);
                  }}
                  className="h-full bg-white/50 rounded-full"
                  style={{ width: "0%" }}
                />
                <div
                  ref={(element) => {
                    if (element) thresholdRefs.current.set(key, element);
                    else thresholdRefs.current.delete(key);
                  }}
                  className="absolute top-0 bottom-0 w-px bg-red-400/80"
                  style={{ left: "0%" }}
                />
              </div>
            </div>
          ))}

          <div className="flex items-center gap-1.5" title="time to the next predicted beat">
            <span className="w-7 shrink-0 opacity-45">beat</span>
            <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div ref={beatRef} className="h-full bg-accent rounded-full" style={{ width: "0%" }} />
            </div>
          </div>

          {/* The bar under the beat, so the two can be read against each other.
              Everything on the geometry row of the hierarchy runs off this one,
              and until the downbeat detector existed it started on whichever
              beat the lock happened to open on. Dim means it is a valid
              four-beat cycle that has not been aligned to anything. */}
          <div className="flex items-center gap-1.5" title="position through the bar · brightness is downbeat confidence">
            <span className="w-7 shrink-0 opacity-45">bar</span>
            <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div ref={barRef} className="h-full bg-accent rounded-full" style={{ width: "0%" }} />
            </div>
          </div>

          {/* Which of the six figures the beat row is currently spending itself
              through — §20. A name rather than a bar, because it is a choice and
              not a quantity, and the one thing on this row that cannot be read
              off the picture: a phrase that has routed the beat into the walk and
              one that has routed it into a single layer look like different
              compositions rather than like the same one in a different voice. */}
          <div className="flex items-center gap-1.5" title="the rhythmic figure this phrase is running">
            <span className="w-7 shrink-0 opacity-45">fig</span>
            <span ref={figureRef} className="opacity-70">—</span>
          </div>
        </div>
      )}

      {/*
        Which input `listen` opens. Worth a control of its own because of what
        a loopback device does here: routed through one, the machine's own
        output arrives as an ordinary input, and the run hears the music with
        no capture bar over it — the browser puts one over every window of this
        origin for a tab share, fullscreen included, and there is no page-side
        way to be rid of it.

        Hidden until the browser has more than one input to name, which it will
        not do before a capture has been granted. Nothing is lost by that: the
        entry worth choosing is never the default, so it is only interesting
        once it can be read.
      */}
      {inputs.length > 1 && (
        <select
          value={input}
          onChange={(event) => chooseInput(event.target.value)}
          disabled={!reactor || status === "requesting"}
          title="Which input the mic button opens — pick a loopback device to hear this machine"
          className="viz-tune-btn mt-2 w-full px-1.5 py-1 appearance-none cursor-pointer
                     font-display text-[9px] tracking-wider text-white/60 disabled:opacity-40"
        >
          {/* The list is drawn by the OS, not by us, and inherits none of the
              panel's styling — these two are the most that can be asked. */}
          <option value="" className="bg-[#232120] text-white">
            system default
          </option>
          {inputs.map((entry) => (
            <option key={entry.deviceId} value={entry.deviceId} className="bg-[#232120] text-white">
              {entry.label}
            </option>
          ))}
        </select>
      )}

      <div className="mt-2 flex gap-1">
        <button
          onClick={() => listen("mic")}
          disabled={!reactor || status === "requesting"}
          title="Any audio input: a microphone, or a loopback device carrying what this machine is playing"
          className="viz-tune-btn flex-1 py-1 font-display text-[9px] tracking-widest uppercase
                     text-white/60 hover:text-accent disabled:opacity-40"
        >
          {reactor?.source === "mic" ? "stop" : "mic"}
        </button>
        {/* Absent rather than disabled where the browser has no screen capture
            at all — a phone, in practice. A dead control invites the tap that
            used to end in a raw `TypeError`, and there is nothing the user
            could do to make it live. The mic button takes the row. */}
        {canShareTab && (
          <button
            onClick={() => listen("display")}
            disabled={!reactor || status === "requesting"}
            className="viz-tune-btn flex-1 py-1 font-display text-[9px] tracking-widest uppercase
                       text-white/60 hover:text-accent disabled:opacity-40"
            title="Share a tab or your screen with “share audio” ticked"
          >
            {reactor?.source === "display" ? "stop" : "tab audio"}
          </button>
        )}
      </div>

      {/*
        The two axes as three points on them. `reactivity` is how far the music
        moves the composition and `attack` is how sharply, and the pair is the
        whole of §6 of the reach document — one knob conflated them, so the only
        cure for a result that twitched was to make it quieter, which is the
        search that produced a version of this that did nothing.

        The sliders for both are in the `audio` section below; these are the
        corners worth having without going and finding them.
      */}
      {config && (
        <div className="mt-1 flex gap-1">
          {AUDIO_CHARACTERS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setCharacter(entry.id)}
              title={entry.hint}
              aria-pressed={character === entry.id}
              className={`viz-tune-btn flex-1 py-1 font-display text-[9px] tracking-widest uppercase
                          ${character === entry.id ? "text-accent" : "text-white/45 hover:text-white/80"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {config && calm && (
        <div className="mt-1 opacity-45 leading-snug normal-case">
          reduced motion: following the music by the bar whichever of these is set
        </div>
      )}

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
              {/*
                The budget: how much of each row's motion has a musical cause
                rather than an authored one — §1 of
                `docs/visualizer-audio-attribution.md`.
                Above the rows because it is the question they are all evidence
                for: reach can be healthy on every line below while the drift and
                the cycler move the same parameters twice as far, and a viewer
                reads causation off whichever source dominates.
              */}
              <div
                ref={setReachRow("budget")}
                className="flex items-center gap-1.5 opacity-75"
                title="Share of each row's on-screen motion caused by the music rather than by the composition's own drift, over the last ten seconds. Attribution is a ratio; this is the one number here that is one."
              >
                <span className="w-14 shrink-0 opacity-60">audio share</span>
                <span ref={setReachRow("budget:fast")} className="flex-1 text-right tabular-nums">
                  —
                </span>
                <span ref={setReachRow("budget:bar")} className="w-11 text-right tabular-nums">
                  —
                </span>
                <span
                  ref={setReachRow("budget:geometry")}
                  className="w-11 text-right tabular-nums opacity-60"
                >
                  —
                </span>
              </div>
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
