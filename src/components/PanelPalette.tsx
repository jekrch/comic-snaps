import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ColorFormat } from "../utils/colorFormats";
import { COLOR_FORMATS, formatColor, labToRgb255, prefersDarkInk, toHex } from "../utils/colorFormats";

const FORMAT_LABELS: Record<ColorFormat, string> = {
  hex: "Hex",
  rgb: "RGB",
  hsl: "HSL",
  lab: "Lab",
  oklch: "OKLCH",
};

/** How long a copied row keeps its check before falling back to the copy icon. */
const COPIED_MS = 1200;

/**
 * The panel's dominant colours, in whatever notation the reader wants to paste
 * somewhere else.
 *
 * Rows rather than a strip of squares: `oklch(0.646 0.178 35.9)` is twice the
 * width of `#e55c37`, and a three-column strip would have to truncate the very
 * string the section exists to hand over. Stacked, every format is readable at
 * every drawer width, and the chips still read left-to-right as a palette.
 */
export default function PanelPalette({ colors }: { colors: [number, number, number][] }) {
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const timer = useRef<number | null>(null);

  const swatches = useMemo(
    () =>
      colors.map((lab) => {
        const rgb = labToRgb255(lab);
        return { rgb, hex: toHex(rgb), darkInk: prefersDarkInk(rgb) };
      }),
    [colors]
  );

  // The drawer keeps this mounted while it pages between panels, so a check
  // left standing from the last panel would mark a row of different colours.
  useEffect(() => {
    setCopied(null);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [colors]);

  const copy = useCallback((text: string, which: number | "all") => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(which);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => undefined);
  }, []);

  const values = swatches.map((s) => formatColor(s.rgb, format));

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
        <span>Palette</span>
        <span className="text-white/20 normal-case tracking-normal">· {swatches.length}</span>
        <div className="ml-auto flex items-center gap-2">
          {COLOR_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              aria-pressed={format === f}
              className={`font-display text-[9px] tracking-wider uppercase transition-colors ${
                format === f ? "text-accent" : "text-white/25 hover:text-white/60"
              }`}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {swatches.map((s, i) => {
          const value = values[i];
          const done = copied === i;
          return (
            <button
              key={`${s.hex}-${i}`}
              type="button"
              onClick={() => copy(value, i)}
              title={`Copy ${value}`}
              className="group flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-left hover:bg-white/5 transition-colors"
            >
              {/* The value rides on the swatch, so the colour is never
                  described at arm's length from itself. */}
              <span
                className="flex h-7 flex-1 min-w-0 items-center justify-center overflow-hidden rounded-sm px-2 ring-1 ring-inset ring-white/10 group-hover:ring-white/25 transition-colors"
                style={{ backgroundColor: s.hex }}
              >
                <span
                  className="truncate font-mono text-[9.5px] leading-none tracking-tight"
                  style={{ color: s.darkInk ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.75)" }}
                >
                  {value}
                </span>
              </span>
              <span
                className={`shrink-0 transition-colors ${
                  done ? "text-accent" : "text-white/20 group-hover:text-white/50"
                }`}
              >
                {done ? <Check size={12} /> : <Copy size={12} />}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => copy(values.join("\n"), "all")}
        className="mt-1.5 ml-1 inline-flex items-center gap-1.5 text-[10px] text-accent hover:text-accent-dim transition-colors"
      >
        {copied === "all" ? <Check size={11} /> : <Copy size={11} />}
        {copied === "all" ? "Copied all" : "Copy all"}
      </button>
    </div>
  );
}
