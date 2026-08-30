import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface SortMenuOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** What the collapsed header reads, already in its final wording. */
  headerLabel: string;
  options: SortMenuOption<T>[];
  active: T;
  onSelect: (value: T) => void;
  /** Trailing glyph for an option — the embedding sorts mark themselves. */
  renderBadge?: (value: T) => ReactNode;
  /** Anything below the list, under its own rule. */
  footer?: ReactNode;
}

/**
 * The wall's sort card, as one component.
 *
 * The panel sort and the row sort are different mode sets over different
 * things, but they are the same control — a card in the last column that
 * expands in place — and there is no reason for a reader to meet two idioms for
 * picking an order. The expand is a `grid-template-rows` transition rather than
 * a popover so the masonry's `ResizeObserver` can re-pack the grid behind it
 * frame by frame.
 */
export default function SortMenu<T extends string>({
  headerLabel,
  options,
  active,
  onSelect,
  renderBadge,
  footer,
}: Props<T>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sort-control panel-item overflow-hidden select-none">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          w-full flex items-center justify-end
          px-3 py-2.5
          transition-colors duration-150
          cursor-pointer
        "
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
            {headerLabel}
          </span>
          <ChevronDown
            size={14}
            className={`text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div>
            {options.map((opt) => {
              const isActive = opt.value === active;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSelect(opt.value);
                    setOpen(false);
                  }}
                  className={`
                    w-full text-right px-3 py-2
                    font-display text-[11px] tracking-wider uppercase
                    transition-colors duration-100
                    cursor-pointer
                    ${isActive ? "text-accent" : "text-ink-muted hover:text-ink"}
                  `}
                >
                  <span className="flex items-center justify-end gap-2">
                    {isActive && (
                      <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    )}
                    {opt.label}
                    {renderBadge?.(opt.value)}
                  </span>
                </button>
              );
            })}

            {footer && (
              <>
                <div
                  className="mx-3 my-1"
                  style={{
                    height: "1px",
                    background: "var(--color-border, rgba(74,71,69,0.25))",
                  }}
                />
                {footer}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
