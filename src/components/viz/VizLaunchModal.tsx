import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { X, ChevronDown, Check } from "lucide-react";
import type { VizConfig } from "./vizConfig";
import { parseConfigJson } from "./vizConfig";
import { VIZ_PRESETS, initialPresetId, presetConfig } from "./vizPresets";

export interface VizLaunchOptions {
  presetId: string;
  config: VizConfig;
  fullscreen: boolean;
  /** True when the config differs from the plain preset, for the URL's sake. */
  custom: boolean;
}

interface VizLaunchModalProps {
  panelCount: number;
  onStart: (options: VizLaunchOptions) => void;
  onCancel: () => void;
}

const EXIT_MS = 200;

export default function VizLaunchModal({ panelCount, onStart, onCancel }: VizLaunchModalProps) {
  const [presetId, setPresetId] = useState(initialPresetId);
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [closing, setClosing] = useState(false);
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

  const base = useMemo(() => presetConfig(presetId), [presetId]);

  // Parsed live so the error appears while typing rather than on submit.
  const parsed = useMemo(() => {
    const trimmed = json.trim();
    if (!trimmed) return null;
    return parseConfigJson(trimmed, base);
  }, [json, base]);

  const blocked = parsed !== null && !parsed.ok;

  const close = useCallback(
    (run: VizLaunchOptions | null) => {
      setClosing(true);
      window.setTimeout(() => (run ? onStart(run) : onCancel()), EXIT_MS);
    },
    [onStart, onCancel]
  );

  const start = useCallback(() => {
    if (blocked) return;
    close({
      presetId,
      config: parsed?.ok ? parsed.parsed.config : base,
      fullscreen,
      custom: parsed?.ok === true,
    });
  }, [blocked, close, presetId, parsed, base, fullscreen]);

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, start]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Start visualizer"
      onClick={() => close(null)}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          animation: closing
            ? `scrimOut ${EXIT_MS}ms ease-out forwards`
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
          opacity: 0,
          animation: closing
            ? `hatchFadeOut ${EXIT_MS}ms ease-out forwards`
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
        className="relative w-full max-w-[26rem] mx-5 max-h-[88vh] overflow-y-auto info-modal-scroll
                   rounded-md border border-[var(--color-border,rgba(74,71,69,0.25))]
                   bg-[var(--color-surface-raised)]"
        style={{
          animation: closing
            ? `modalExit ${EXIT_MS}ms ease-out forwards`
            : "modalEnter 200ms ease-out forwards",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
          <div>
            <h2 className="font-display text-[11px] tracking-widest uppercase text-accent">
              visualizer
            </h2>
            <p className="font-mono text-[10px] text-ink-muted mt-0.5">
              {panelCount} panel{panelCount === 1 ? "" : "s"} in the current view
            </p>
          </div>
          <button
            onClick={() => close(null)}
            className="text-white/40 hover:text-white/80 transition-colors -mr-1 -mt-1 p-1"
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>

        <div role="radiogroup" aria-label="Preset" className="px-2 pb-1">
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

        <div className="border-t border-white/8 mt-1">
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
                tuning panel's range.
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

        <div className="border-t border-white/8 px-4 py-2.5">
          <button
            onClick={() => setFullscreen((on) => !on)}
            role="checkbox"
            aria-checked={fullscreen}
            className="flex items-center gap-2 font-display text-[10px] tracking-widest
                       uppercase text-ink-muted hover:text-ink transition-colors"
          >
            <span
              className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                fullscreen ? "border-accent bg-accent/20" : "border-white/25"
              }`}
            >
              {fullscreen && <Check size={10} className="text-accent" strokeWidth={3} />}
            </span>
            open in full screen
          </button>
        </div>

        <div className="border-t border-white/8 px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={() => close(null)}
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
