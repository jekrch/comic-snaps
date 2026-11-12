import { useMemo } from "react";
import type { Panel } from "../types";
import type { ViewOptions } from "../hooks/useViewOptions";
import { DEFAULT_VIEW_OPTIONS } from "../hooks/useViewOptions";
import WallModal from "./WallModal";
import Toggle from "./Toggle";

interface Props {
  options: ViewOptions;
  onChange: (next: ViewOptions) => void;
  /** Every panel, for how many each option has something to say about. */
  panels: Panel[];
  onClose: () => void;
}

interface Row {
  key: keyof ViewOptions;
  label: string;
  blurb: string;
  /** How many panels the option can label; absent when it is all of them. */
  known?: number;
}

/** How much of the wall an option can label: a hairline bar and the count. */
function Coverage({ known, total }: { known: number; total: number }) {
  const share = total > 0 ? known / total : 0;
  return (
    <span className="mt-2 flex items-center gap-2">
      <span className="relative block w-14 h-[2px] rounded-full bg-white/[0.08] overflow-hidden">
        <span className="absolute inset-y-0 left-0 bg-ink-faint" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="text-[10px] tabular-nums text-ink-faint">
        {known.toLocaleString()} of {total.toLocaleString()} panels
      </span>
    </span>
  );
}

/** What the wall's cards show beyond the art. Opened from the sort card. */
export default function ViewOptionsModal({ options, onChange, panels, onClose }: Props) {
  const rows = useMemo<Row[]>(() => {
    const owned = panels.filter((p) => p.publisher || p.imprint).length;
    const aged = panels.filter((p) => p.artistAge != null).length;
    return [
      {
        key: "details",
        label: "Details",
        blurb: "Title, issue, artist, year, notes and tags on every card, not only on hover or tap.",
      },
      {
        key: "owner",
        label: "Owner",
        blurb: "A badge for the company at the top of the publisher's ownership chain. Tap it for the full chain.",
        known: owned,
      },
      {
        key: "age",
        label: "Creator's age",
        blurb: "How old the artist was in the year the issue came out.",
        known: aged,
      },
    ];
  }, [panels]);

  const anyOn = rows.some((r) => options[r.key]);

  return (
    <WallModal
      eyebrow="Wall"
      title="View options"
      label="View options"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-4">
          <span className="text-[10px] text-ink-faint">Saved in the page link.</span>
          <button
            type="button"
            disabled={!anyOn}
            onClick={() => onChange(DEFAULT_VIEW_OPTIONS)}
            className="font-display text-[11px] tracking-wider uppercase transition-colors text-ink-muted enabled:hover:text-ink enabled:cursor-pointer disabled:opacity-35"
          >
            Reset
          </button>
        </div>
      }
    >
      <ul className="-mx-5 -my-4 p-0 list-none divide-y divide-[var(--color-border,rgba(74,71,69,0.25))]">
        {rows.map((row) => {
          const on = options[row.key];
          return (
            <li key={row.key}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onChange({ ...options, [row.key]: !on })}
                className="w-full flex items-center gap-5 px-5 py-4 text-left cursor-pointer transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block font-display text-[11px] tracking-wider uppercase transition-colors ${
                      on ? "text-ink" : "text-ink-muted"
                    }`}
                  >
                    {row.label}
                  </span>
                  <span className="block mt-1.5 text-[11px] leading-relaxed text-ink-muted/75">{row.blurb}</span>
                  {row.known !== undefined && <Coverage known={row.known} total={panels.length} />}
                </span>
                <Toggle on={on} />
              </button>
            </li>
          );
        })}
      </ul>
    </WallModal>
  );
}
