import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Info } from "lucide-react";
import type { ConfigField, ConfigGroup, VizConfig } from "./vizConfig";
import { CONFIG_FIELDS, GROUP_HINTS } from "./vizConfig";
import type { EngineStats, VizEngine } from "./engine/Engine";
import VizSlider from "./VizSlider";

const GROUP_ORDER: ConfigGroup[] = [
  "stack",
  "motion",
  "post",
  "shape",
  "field",
  "optics",
  "print",
  "cycle",
  "stage",
  "director",
];

/**
 * Which sections were open last time, kept across mounts. The panel is toggled
 * off and on constantly while tuning, and re-opening it to a wall of collapsed
 * sections every time would be a chore of its own.
 */
let openMemo: ConfigGroup[] = ["stack", "motion"];

/** How long the slide out takes. Matched by `vizTuneOut` in the stylesheet, and
 *  read by the overlay, which is what holds the panel mounted for it. */
export const TUNE_PANEL_EXIT_MS = 220;

interface VizDebugPanelProps {
  /** Mutated in place — the engine reads it every frame, so edits are live. */
  config: VizConfig;
  engine: VizEngine | null;
  seed: string;
  /** Rendered, but on its way out: play the exit rather than the entrance. */
  leaving?: boolean;
  /** Lets the overlay chrome re-read fields it also shows, such as speed. */
  onChange?: () => void;
  onClose: () => void;
}

/** Decimals worth showing, from how finely the field can actually be moved. */
function format(value: number, step: number): string {
  if (step >= 1) return value.toFixed(0);
  if (step >= 0.05) return value.toFixed(2);
  if (step >= 0.005) return value.toFixed(3);
  return value.toFixed(4);
}

/**
 * A tooltip on an info icon, portalled to the body: the panel is a scroll
 * container, and anything positioned inside it gets clipped at its edge.
 * Opens on hover for a mouse and on tap for a finger, which has no hover to
 * give — and closes on the next thing that happens anywhere, so a tapped-open
 * one cannot be left sitting on the screen.
 */
function Hint({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Flipped to the left of the icon only if there is no room to its right,
    // which on a panel pinned to the left edge is essentially never.
    const left = rect.right + 8;
    setAt({
      left: Math.min(left, window.innerWidth - 248),
      // Anchored below its own top, then lifted off the bottom edge if the row
      // is near it.
      top: Math.min(rect.top - 4, window.innerHeight - 120),
    });
  };
  const close = () => setAt(null);

  // A tapped-open hint has nothing to close it on a phone — there is no pointer
  // to leave, and the icon is a 10px target to have to find again. So anything
  // that happens elsewhere dismisses it. Scrolling counts: the popup is fixed to
  // the viewport and would otherwise drift off its own icon.
  useEffect(() => {
    if (!at) return;
    const dismiss = (e: Event) => {
      // The icon's own press is its click's to handle, which toggles.
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
    };
  }, [at]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="viz-hint-icon shrink-0 flex items-center"
        aria-label={`What ${label} does`}
        onPointerEnter={(e) => e.pointerType === "mouse" && open()}
        onPointerLeave={(e) => e.pointerType === "mouse" && close()}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (at) close();
          else open();
        }}
      >
        <Info size={10} />
      </button>
      {at &&
        createPortal(
          <div className="viz-hint-pop" style={{ left: at.left, top: Math.max(8, at.top) }} role="tooltip">
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Live tuning, built alongside the renderer rather than after it: the bulk of
 * the work on this feature is aesthetic iteration, and a recompile per
 * decay-value tweak would dominate everything else.
 */
export default function VizDebugPanel({
  config,
  engine,
  seed,
  leaving = false,
  onChange,
  onClose,
}: VizDebugPanelProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [copied, setCopied] = useState<"json" | "link" | null>(null);
  const [open, setOpen] = useState<Set<ConfigGroup>>(() => new Set(openMemo));

  // Stopped for the slide out: the readout re-rendering under a panel already
  // on its way off screen is work spent on something nobody is reading.
  useEffect(() => {
    if (leaving) return;
    const id = window.setInterval(() => setStats(engine?.stats ?? null), 250);
    return () => window.clearInterval(id);
  }, [engine, leaving]);

  useEffect(() => {
    openMemo = [...open];
  }, [open]);

  const groups = useMemo(() => {
    const byGroup = new Map<ConfigGroup, ConfigField[]>();
    for (const entry of CONFIG_FIELDS) {
      const list = byGroup.get(entry.group) ?? [];
      list.push(entry);
      byGroup.set(entry.group, list);
    }
    return GROUP_ORDER.map((group) => ({ group, fields: byGroup.get(group) ?? [] }));
  }, []);

  const allOpen = open.size === groups.length;
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(GROUP_ORDER));
  const toggle = (group: ConfigGroup) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  /**
   * The link to this exact run. The address bar already carries every slider on
   * this panel — but a run is usually watched full screen, where there is no
   * address bar to reach, and the seed is added on the way out so the copy
   * replays the same composition rather than only the same look. Only on the
   * copy: pinning the seed in the address bar would make every later launch a
   * repeat of this one.
   */
  const runLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("vizseed", seed);
    return url.toString();
  };

  const copy = (what: "json" | "link") => {
    const text = what === "json" ? JSON.stringify(config, null, 2) : runLink();
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(what);
        window.setTimeout(() => setCopied(null), 1200);
      })
      .catch(() => undefined);
  };

  return (
    /* A column rather than one long scroll: the readout at the top and the copy
       buttons at the bottom are wanted at every point in the list, and with a
       hundred-odd sliders between them both used to be a scroll away. */
    <div
      className={`viz-tune-panel absolute top-0 left-0 bottom-0 w-72 max-w-[85vw] z-20
                  flex flex-col ${leaving ? "viz-tune-out pointer-events-none" : "viz-tune-in pointer-events-auto"}`}
      aria-hidden={leaving}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="viz-tune-band shrink-0 px-3 py-2.5 flex items-center gap-2 border-b border-black/40">
        <span className="font-display text-[10px] tracking-widest uppercase text-accent">
          viz tuning
        </span>
        <button
          onClick={toggleAll}
          className="viz-tune-btn ml-auto h-6 px-1.5 flex items-center text-white/55 hover:text-white/90"
          title={allOpen ? "Collapse every section" : "Expand every section"}
          aria-label={allOpen ? "Collapse every section" : "Expand every section"}
        >
          {allOpen ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
        </button>
        <button
          onClick={onClose}
          className="viz-tune-btn h-6 px-2 font-display text-[9px] tracking-widest uppercase
                     text-white/50 hover:text-white/90"
        >
          hide
        </button>
      </div>

      <div className="viz-tune-band shrink-0 px-2.5 py-2.5 border-b border-black/40">
        <div className="viz-tune-readout px-2 py-1.5 rounded-xs font-mono text-[10px] leading-relaxed tracking-wide">
          <div>
            {stats ? `${stats.fps.toFixed(0)} fps` : "—"} · {stats?.backend ?? "—"} ·{" "}
            {stats?.scene ?? "—"}
          </div>
          <div>
            shards {stats?.shards ?? 0} · tex {stats?.resident ?? 0}
            {stats?.pending ? ` (+${stats.pending})` : ""}
          </div>
          <div className="opacity-55">seed {seed}</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto info-modal-scroll">
        {groups.map(({ group, fields }) => {
          const expanded = open.has(group);
          return (
            <div key={group}>
              <div className="viz-tune-head flex items-center gap-1.5 pr-2">
                <button
                  onClick={() => toggle(group)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-2 text-left"
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    size={11}
                    className={`shrink-0 text-white/35 transition-transform duration-150 ${
                      expanded ? "rotate-90" : ""
                    }`}
                  />
                  <span className="font-display text-[9px] tracking-widest uppercase text-white/45">
                    {group}
                  </span>
                  <span className="font-mono text-[9px] text-white/20">{fields.length}</span>
                </button>
                <Hint text={GROUP_HINTS[group]} label={group} />
              </div>

              {expanded && (
                <div className="viz-tune-section px-3 py-2 border-b border-black/40 bg-black/20">
                  {fields.map((entry) => (
                    <VizSlider
                      key={entry.path}
                      id={`viz-${entry.path}`}
                      label={entry.label}
                      hint={entry.hint && <Hint text={entry.hint} label={entry.label} />}
                      display={(v) => format(v, entry.step)}
                      min={entry.min}
                      max={entry.max}
                      step={entry.step}
                      value={entry.get(config)}
                      // Mid-drag: the engine reads the config every frame, so
                      // writing to it is the whole of a live preview. Anything
                      // that re-renders — this panel, the chrome, the URL —
                      // waits for the release.
                      onInput={(next) => entry.set(config, next)}
                      onCommit={() => {
                        bump();
                        onChange?.();
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="viz-tune-band shrink-0 px-3 py-3 flex flex-col gap-1.5 border-t border-white/6">
        <button
          onClick={() => copy("link")}
          className="viz-tune-btn w-full font-display text-[10px] tracking-widest uppercase
                     text-white/60 hover:text-accent py-1.5"
        >
          {copied === "link" ? "copied" : "copy link to this run"}
        </button>
        <button
          onClick={() => copy("json")}
          className="viz-tune-btn w-full font-display text-[10px] tracking-widest uppercase
                     text-white/60 hover:text-accent py-1.5"
        >
          {copied === "json" ? "copied" : "copy config json"}
        </button>
      </div>
    </div>
  );
}
