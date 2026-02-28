import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface FacetSectionProps {
  title: string;
  items: { label: string; count: number }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  renderLabel?: (label: string) => React.ReactNode;
}

export default function FacetSection({
  title,
  items,
  selected,
  onToggle,
  renderLabel,
}: FacetSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-ink-faint/10 first:border-t-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="
          w-full flex items-center justify-between
          px-3 py-2
          text-left cursor-pointer
          hover:bg-surface-hover transition-colors duration-100
        "
      >
        <span className="font-display text-[10px] tracking-widest text-accent uppercase">
          {title}
        </span>
        <span className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <span className="font-display text-[9px] text-accent tabular-nums">
              {selected.size}
            </span>
          )}
          <ChevronDown
            size={12}
            className={`text-ink-faint transition-transform duration-200 ${expanded ? "rotate-180" : ""
              }`}
          />
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-1 pb-1.5">
            {items.map((item) => {
              const isActive = selected.has(item.label);
              return (
                <button
                  key={item.label}
                  onClick={() => onToggle(item.label)}
                  className={`
                    w-full text-left px-2 py-1 rounded-sm
                    flex items-center justify-between gap-2
                    transition-colors duration-100
                    cursor-pointer
                    ${isActive
                      ? "text-accent bg-accent/8"
                      : "text-ink-muted hover:text-ink hover:bg-surface-hover"
                    }
                  `}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {isActive && (
                      <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    )}
                    <span className="font-display text-[10px] tracking-wide uppercase truncate">
                      {renderLabel ? renderLabel(item.label) : item.label}
                    </span>
                  </span>
                  <span
                    className={`font-display text-[9px] tabular-nums flex-shrink-0 ${isActive ? "text-accent/60" : "text-ink-faint"
                      }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}