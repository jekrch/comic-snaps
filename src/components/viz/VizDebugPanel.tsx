import { useEffect, useMemo, useReducer, useState } from "react";
import type { ConfigField, ConfigGroup, VizConfig } from "./vizConfig";
import { CONFIG_FIELDS } from "./vizConfig";
import type { EngineStats, VizEngine } from "./engine/Engine";

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

interface VizDebugPanelProps {
  /** Mutated in place — the engine reads it every frame, so edits are live. */
  config: VizConfig;
  engine: VizEngine | null;
  seed: string;
  /** Lets the overlay chrome re-read fields it also shows, such as speed. */
  onChange?: () => void;
  onClose: () => void;
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
  onChange,
  onClose,
}: VizDebugPanelProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [copied, setCopied] = useState<"json" | "link" | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setStats(engine?.stats ?? null), 250);
    return () => window.clearInterval(id);
  }, [engine]);

  const groups = useMemo(() => {
    const byGroup = new Map<ConfigGroup, ConfigField[]>();
    for (const entry of CONFIG_FIELDS) {
      const list = byGroup.get(entry.group) ?? [];
      list.push(entry);
      byGroup.set(entry.group, list);
    }
    return GROUP_ORDER.map((group) => ({ group, fields: byGroup.get(group) ?? [] }));
  }, []);

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
    <div
      className="absolute top-0 left-0 bottom-0 w-62 max-w-[80vw] z-20 overflow-y-auto info-modal-scroll pointer-events-auto"
      style={{ background: "rgba(10,10,10,0.86)", backdropFilter: "blur(8px)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-white/10">
        <span className="font-display text-[10px] tracking-widest uppercase text-accent">
          viz tuning
        </span>
        <button
          onClick={onClose}
          className="font-display text-[10px] tracking-widest uppercase text-white/40 hover:text-white/80"
        >
          hide
        </button>
      </div>

      <div className="px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-muted border-b border-white/10">
        <div>
          {stats ? `${stats.fps.toFixed(0)} fps` : "—"} · {stats?.backend ?? "—"} ·{" "}
          {stats?.scene ?? "—"}
        </div>
        <div>
          shards {stats?.shards ?? 0} · tex {stats?.resident ?? 0}
          {stats?.pending ? ` (+${stats.pending})` : ""}
        </div>
        <div className="text-white/30">seed {seed}</div>
      </div>

      {groups.map(({ group, fields }) => (
        <div key={group} className="px-3 py-2 border-b border-white/5">
          <div className="font-display text-[9px] tracking-widest uppercase text-white/30 mb-1.5">
            {group}
          </div>
          {fields.map((entry) => (
            <label key={entry.path} className="block mb-1.5">
              <div className="flex justify-between font-mono text-[10px] text-ink-muted">
                <span>{entry.label}</span>
                <span className="text-white/50">{entry.get(config).toFixed(3)}</span>
              </div>
              <input
                type="range"
                min={entry.min}
                max={entry.max}
                step={entry.step}
                value={entry.get(config)}
                onChange={(e) => {
                  entry.set(config, Number(e.target.value));
                  bump();
                  onChange?.();
                }}
                className="w-full accent-accent h-1 cursor-pointer"
              />
            </label>
          ))}
        </div>
      ))}

      <div className="px-3 py-3 flex flex-col gap-1.5">
        <button
          onClick={() => copy("link")}
          className="w-full font-display text-[10px] tracking-widest uppercase text-white/60 hover:text-accent border border-white/15 rounded py-1.5"
        >
          {copied === "link" ? "copied" : "copy link to this run"}
        </button>
        <button
          onClick={() => copy("json")}
          className="w-full font-display text-[10px] tracking-widest uppercase text-white/60 hover:text-accent border border-white/15 rounded py-1.5"
        >
          {copied === "json" ? "copied" : "copy config json"}
        </button>
      </div>
    </div>
  );
}
