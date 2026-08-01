import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { X, ChevronDown, Check } from "lucide-react";
import type { VizConfig } from "./vizConfig";
import { parseConfigJson } from "./vizConfig";
import { VIZ_PRESETS, initialPresetId, presetConfig } from "./vizPresets";
import VizSpeedControl from "./VizSpeedControl";
import ThoughtBalloon from "./ThoughtBalloon";

export interface VizLaunchOptions {
  presetId: string;
  config: VizConfig;
  fullscreen: boolean;
  /** Start with the attribution label pinned in its own letterbox band. */
  pinLabel: boolean;
  /**
   * True when the config differs from the plain preset. Set here from whether
   * anything was pasted, and settled by the caller against what the config
   * actually encodes to — a paste that only restates the preset is not a custom
   * run, whatever it looked like in the box.
   */
  custom: boolean;
}

interface VizLaunchModalProps {
  panelCount: number;
  /** Carried over from a `?vizspeed=` link, so a shared run opens at its rate. */
  initialSpeed?: number | null;
  /**
   * True from the moment the run this modal started is on screen. The modal
   * stays mounted underneath it — keeping the reader's preset, config and speed
   * — but stops answering keys, clicks and focus, all of which belong to the run
   * from here on.
   */
  behind?: boolean;
  /**
   * True once that run's arrival fade has landed on top of this modal, which is
   * the first moment taking it away is invisible. Then, and only then, it goes
   * `display: none` so it costs nothing to draw.
   */
  covered?: boolean;
  /**
   * The preset the run underneath is actually on, which is not necessarily the
   * one it was started with — the overlay can switch modes mid-run. Null while
   * nothing is running.
   */
  runPresetId?: string | null;
  /**
   * How the run underneath departs from that preset, as JSON — from a `vizcfg`
   * link, or from the tuning panel. Adopted into the custom-config box so the
   * reader comes back to the run they were watching rather than to the plain
   * preset it started from. Null while nothing is running, or while the run is
   * the preset as authored.
   */
  runCustomJson?: string | null;
  onStart: (options: VizLaunchOptions) => void;
  onCancel: () => void;
}

const EXIT_MS = 200;

/** The launch options that are a plain on/off, in the modal's own language. */
function OptionCheck({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        role="checkbox"
        aria-checked={checked}
        className="flex items-center gap-2 font-display text-[10px] tracking-widest
                   uppercase text-ink-muted hover:text-ink transition-colors"
      >
        <span
          className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
            checked ? "border-accent bg-accent/20" : "border-white/25"
          }`}
        >
          {checked && <Check size={10} className="text-accent" strokeWidth={3} />}
        </span>
        {label}
      </button>
      {hint && (
        <p className="font-mono text-[10px] leading-snug text-white/35 mt-1 ml-5.5">{hint}</p>
      )}
    </div>
  );
}

export default function VizLaunchModal({
  panelCount,
  initialSpeed,
  behind = false,
  covered = false,
  runPresetId = null,
  runCustomJson = null,
  onStart,
  onCancel,
}: VizLaunchModalProps) {
  const [presetId, setPresetId] = useState(initialPresetId);
  const [speed, setSpeed] = useState(initialSpeed ?? 1);
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [pinLabel, setPinLabel] = useState(false);
  const [closing, setClosing] = useState(false);
  /**
   * True once a run has hidden this modal. Coming back from `display: none`
   * restarts every CSS animation on the subtree, so the modal would replay its
   * entrance when the run ends — reading as if it were opening again, when in
   * fact it was open the whole time behind the run. From the first time it is
   * hidden on, the entrance is dropped and the settled state is rendered flat.
   */
  const [resumed, setResumed] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);

  const patternId = useId();
  const maskId = useId();
  const fadeId = useId();

  // Same hatch backdrop language as the about modal.
  const { rotation, color } = useMemo(() => {
    const rotations = [45, 135];
    const colors = ["#e97d62", "#7A8B2A"];
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    return { rotation: pick(rotations), color: pick(colors) };
  }, []);

  // Speed folds into the base rather than being applied after the JSON, so a
  // pasted config can still override it like any other field.
  const base = useMemo(() => ({ ...presetConfig(presetId), speed }), [presetId, speed]);

  // Parsed live so the error appears while typing rather than on submit.
  const parsed = useMemo(() => {
    const trimmed = json.trim();
    if (!trimmed) return null;
    return parseConfigJson(trimmed, base);
  }, [json, base]);

  const blocked = parsed !== null && !parsed.ok;

  /** Cancelling is the only way out of here that the modal itself plays. */
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onCancel, EXIT_MS);
  }, [onCancel]);

  /**
   * Starting is not an exit. The modal is left standing exactly as the reader
   * left it and the run fades up over it — so pressing start puts something on
   * screen immediately, rather than first taking away the only thing on it.
   * What hides the modal afterwards is the run having covered it; see `covered`.
   */
  const start = useCallback(() => {
    if (blocked) return;
    onStart({
      presetId,
      config: parsed?.ok ? parsed.parsed.config : base,
      fullscreen,
      pinLabel,
      custom: parsed?.ok === true,
    });
  }, [blocked, onStart, presetId, parsed, base, fullscreen, pinLabel]);

  // A mode switched from inside the run is still the reader's choice of preset,
  // so it is what they come back to here — the selection follows the run rather
  // than reverting to whatever this modal last started.
  useEffect(() => {
    if (runPresetId) setPresetId(runPresetId);
  }, [runPresetId]);

  // Same for the tuning, which the run can also change under this modal — and
  // which a `?vizcfg=` link brings in without this modal ever having been used.
  // Held off until the run has covered the modal rather than merely started it:
  // adopting it any earlier would open the config box, and grow the card, in
  // full view under the arriving run. By then the box is out of sight, so this
  // also cannot overwrite something being typed.
  useEffect(() => {
    if (!covered) return;
    setJson(runCustomJson ?? "");
    if (runCustomJson) setShowJson(true);
  }, [runCustomJson, covered]);

  // Also fires when a run ends and the modal comes back, so the reader lands on
  // start again rather than on whatever the run left focused. Keyed off `behind`
  // rather than `covered`: while the run is fading up it already owns the focus,
  // even though this is still on screen under it.
  useEffect(() => {
    if (!behind) startRef.current?.focus();
  }, [behind]);

  useEffect(() => {
    if (covered) setResumed(true);
  }, [covered]);

  useEffect(() => {
    if (behind) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, start, behind]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      // Everything here belongs to the run the moment one starts — including the
      // window between start and the run being drawn over this, when the card is
      // still sitting there in full view and would otherwise take a second click.
      inert={behind}
      style={{
        // `vh` on mobile means the *large* viewport, so a vh-sized card runs off
        // screen while the browser chrome is up. The fixed box already tracks the
        // visible area; dvh caps it for the engines where it does not, and the
        // insets keep the card clear of the notch and the home indicator.
        maxHeight: "100dvh",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1.25rem)",
        // A run takes the page's scrollbar gutter for itself, which widens the
        // viewport this is centred in and would walk the card half a scrollbar
        // to the right as the run fades up over it. The overlay publishes what
        // it took; matching it on this side holds the card still. Resolved by
        // the browser the instant the property is set, so the two happen in one
        // flush and there is no frame where only one of them has landed.
        paddingRight:
          "calc(env(safe-area-inset-right, 0px) + 1.25rem + var(--viz-scroll-comp, 0px))",
        ...(covered ? { display: "none" } : null),
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Start visualizer"
      onClick={() => close()}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          animation: closing
            ? `scrimOut ${EXIT_MS}ms ease-out forwards`
            : resumed
              ? "none"
              : "scrimIn 200ms ease-out forwards",
        }}
        aria-hidden="true"
      />

      {/* Hatch-pattern backdrop */}
      <div
        className="absolute inset-0 select-none"
        aria-hidden="true"
        style={{
          willChange: "opacity",
          // Where hatchFadeIn leaves it, for the pass that skips the fade.
          opacity: resumed ? 0.32 : 0,
          animation: closing
            ? `hatchFadeOut ${EXIT_MS}ms ease-out forwards`
            : resumed
              ? "hatchDrift 10s ease-in-out infinite"
              : "hatchFadeIn 400ms ease-out forwards, hatchDrift 10s ease-in-out 400ms infinite",
          transform: "rotate(-5deg) scale(1.15) translate(-4%, 3%)",
        }}
      >
        <svg
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          style={{ overflow: "visible" }}
        >
          <defs>
            <pattern
              id={patternId}
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform={`rotate(${rotation})`}
            >
              <line x1="0" y1="0" x2="0" y2="7" stroke={color} strokeWidth="5" strokeOpacity="1" />
            </pattern>

            {/* Radial fade: solid centre → transparent edges */}
            <radialGradient id={fadeId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="55%" stopColor="white" stopOpacity="0.85" />
              <stop offset="80%" stopColor="white" stopOpacity="0.35" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>

            <mask id={maskId}>
              <rect width="100%" height="100%" fill={`url(#${fadeId})`} />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={`url(#${patternId})`}
            mask={`url(#${maskId})`}
          />
        </svg>
      </div>

      <div
        className="relative w-full max-w-[26rem] max-h-full flex flex-col overflow-hidden
                   rounded-md border border-[var(--color-border,rgba(74,71,69,0.25))]
                   bg-[var(--color-surface-raised)]"
        style={{
          animation: closing
            ? `modalExit ${EXIT_MS}ms ease-out forwards`
            : resumed
              ? "none"
              : "modalEnter 200ms ease-out forwards",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between border-b border-white/8 px-4 pt-3.5 pb-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h2 className="font-display text-[11px] tracking-widest uppercase text-accent">
                visualizer
              </h2>
              <p className="font-mono text-[10px] text-ink-muted mt-0.5">
                {panelCount} panel{panelCount === 1 ? "" : "s"} in the current view
              </p>
            </div>
            {/* The same balloon the header wears, empty — this is the room the
                thought was about, so the word would only be repeating itself.
                Its trail runs back at the title, which is the thing talking. */}
            <ThoughtBalloon width={88} className="shrink-0 -my-1" />
          </div>
          <button
            onClick={() => close()}
            className="text-white/40 hover:text-white/80 transition-colors -mr-1 -mt-1 p-1"
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>

        {/* From 640px up only the preset list scrolls, so speed / custom config / fullscreen
            stay put with the header and footer. On a shorter viewport the list keeps its full
            height and the body scrolls instead — the sections below are too tall to pin there. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain info-modal-scroll">
          <div
            role="radiogroup"
            aria-label="Preset"
            className="shrink-0 px-2 pt-1 pb-1 overscroll-contain info-modal-scroll
                       [@media(min-height:640px)]:flex-1 [@media(min-height:640px)]:min-h-0
                       [@media(min-height:640px)]:overflow-y-auto"
          >
            {VIZ_PRESETS.map((preset) => {
              const active = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPresetId(preset.id)}
                  className={`w-full text-left px-2.5 py-2 rounded transition-colors duration-100 ${
                    active ? "bg-white/8" : "hover:bg-white/4"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`inline-block w-1 h-1 rounded-full shrink-0 translate-y-[-0.15rem] ${
                        active ? "bg-accent" : "bg-transparent"
                      }`}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block font-display text-[11px] tracking-wider uppercase ${
                          active ? "text-ink" : "text-ink-muted"
                        }`}
                      >
                        {preset.name}
                      </span>
                      <span className="block font-mono text-[10px] leading-snug text-white/35 mt-0.5">
                        {preset.blurb}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-white/8 mt-1 px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="font-display text-[10px] tracking-widest uppercase text-ink-muted">
              speed
            </span>
            <VizSpeedControl value={speed} onChange={setSpeed} tone="modal" />
          </div>

          <div className="shrink-0 border-t border-white/8">
            <button
              onClick={() => setShowJson((open) => !open)}
              aria-expanded={showJson}
              className="w-full flex items-center justify-between px-4 py-2.5
                         font-display text-[10px] tracking-widest uppercase
                         text-ink-muted hover:text-ink transition-colors"
            >
              custom config
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${showJson ? "rotate-180" : ""}`}
              />
            </button>

            {showJson && (
              <div className="px-4 pb-3">
                <p className="font-mono text-[10px] leading-snug text-white/35 mb-2">
                  Overrides the preset. Paste the JSON from the tuning panel
                  (<span className="text-white/55">d</span> while running). Unlisted
                  fields keep the preset's value; every field is clamped to the
                  tuning panel's range. Whatever you set here goes into the
                  address bar with the run, so the link plays it back.
                </p>
                <textarea
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  spellCheck={false}
                  rows={7}
                  placeholder={'{\n  "layerCount": 5,\n  "post": { "halftone": 0.6 }\n}'}
                  className="w-full font-mono text-[10.5px] leading-relaxed rounded
                             bg-black/40 border border-white/10 focus:border-accent/60
                             outline-none px-2 py-1.5 text-ink resize-y"
                />
                {parsed && !parsed.ok && (
                  <p className="font-mono text-[10px] text-accent mt-1.5">{parsed.error}</p>
                )}
                {parsed?.ok && parsed.parsed.unknown.length > 0 && (
                  <p className="font-mono text-[10px] text-white/45 mt-1.5">
                    ignored: {parsed.parsed.unknown.join(", ")}
                  </p>
                )}
                {parsed?.ok && parsed.parsed.adjusted.length > 0 && (
                  <p className="font-mono text-[10px] text-white/45 mt-1">
                    clamped: {parsed.parsed.adjusted.join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/8 px-4 py-2.5 flex flex-col gap-2.5">
            <OptionCheck
              checked={fullscreen}
              onToggle={() => setFullscreen((on) => !on)}
              label="open in full screen"
            />
            <OptionCheck
              checked={pinLabel}
              onToggle={() => setPinLabel((on) => !on)}
              label="pin the panel label"
              hint="Keeps the credit on screen, with the rest of what is in frame a click behind it. Toggle any time with L."
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-white/8 px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={() => close()}
            className="font-display text-[10px] tracking-widest uppercase
                       text-ink-muted hover:text-ink transition-colors px-2.5 py-1.5"
          >
            cancel
          </button>
          <button
            ref={startRef}
            onClick={start}
            disabled={blocked || panelCount === 0}
            className="font-display text-[10px] tracking-widest uppercase
                       text-accent hover:text-ink border border-accent/40 hover:border-accent
                       rounded px-3.5 py-1.5 transition-colors
                       disabled:opacity-30 disabled:hover:text-accent disabled:hover:border-accent/40
                       disabled:cursor-default"
          >
            start
          </button>
        </div>
      </div>
    </div>
  );
}
