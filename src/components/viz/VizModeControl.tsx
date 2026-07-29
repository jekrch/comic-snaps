import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { VIZ_PRESETS, findPreset } from "./vizPresets";

interface VizModeControlProps {
  /** The preset the run is on, or null while a pasted config is running. */
  presetId: string | null;
  onChange: (presetId: string) => void;
  /** The chrome must not fade out from under an open menu. */
  onOpenChange?: (open: boolean) => void;
  /** Overlay chrome is focus-skipped while hidden. */
  tabIndex?: number;
}

/**
 * Mode switching from inside the run. The launch modal already asks for a
 * preset, but the answer only becomes interesting once the piece is on screen —
 * so the same list is offered here, as a menu rather than a row of pills: eight
 * names will not fit across a phone, and the chrome is only up for a couple of
 * seconds.
 */
export default function VizModeControl({
  presetId,
  onChange,
  onOpenChange,
  tabIndex,
}: VizModeControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // The list is taller than the menu on a short screen, so the mode that is
  // running is brought into view rather than left scrolled past.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes the menu rather than the run; the overlay stands down for
    // as long as this is open.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A pasted config is not any of the presets, and naming one it merely started
  // from would be a lie about what is running.
  const label = presetId === null ? "custom" : findPreset(presetId).name;

  return (
    <div ref={rootRef} className="relative pointer-events-auto">
      {open && (
        <div
          role="listbox"
          aria-label="Mode"
          className="absolute bottom-full right-0 mb-1.5 w-56 max-h-[min(28rem,55vh)] overflow-y-auto
                     info-modal-scroll rounded-md border border-white/12 bg-black/80 backdrop-blur-md p-1"
        >
          {VIZ_PRESETS.map((preset) => {
            const active = preset.id === presetId;
            return (
              <button
                key={preset.id}
                ref={active ? activeRef : undefined}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  onChange(preset.id);
                }}
                className={`w-full text-left px-2 py-1.5 rounded transition-colors duration-100 ${
                  active ? "bg-white/10" : "hover:bg-white/8"
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
                      className={`block font-display text-[10px] tracking-wider uppercase ${
                        active ? "text-ink" : "text-ink-muted"
                      }`}
                    >
                      {preset.name}
                    </span>
                    <span className="block font-mono text-[9.5px] leading-snug text-white/35 mt-0.5">
                      {preset.blurb}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="viz-btn gap-1.5"
        title="Switch mode (M)"
        aria-label={`Mode: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        tabIndex={tabIndex}
      >
        <span className="font-display text-[10px] tracking-widest uppercase truncate max-w-32">
          {label}
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  );
}
