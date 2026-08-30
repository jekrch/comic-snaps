import type { SortMode } from "../utils/sorting";
import { SORT_OPTIONS } from "../utils/sorting";
import { HelpCircle, GitGraph } from "lucide-react";
import SortMenu from "./SortMenu";

interface SortControlProps {
  activeSort: SortMode;
  onSort: (mode: SortMode) => void;
  onInfoOpen?: () => void;
}

// Embedding-based sort modes
const EMBEDDING_MODES = new Set<SortMode>(["embedding-dino", "embedding-gram", "embedding-siglip"]);

export default function SortControl({ activeSort, onSort, onInfoOpen }: SortControlProps) {
  return (
    <SortMenu
      headerLabel={
        activeSort === "newest" || activeSort === "oldest"
          ? activeSort.toUpperCase()
          : `BY ${activeSort.toUpperCase()}`
      }
      options={SORT_OPTIONS}
      active={activeSort}
      onSelect={onSort}
      renderBadge={(value) =>
        EMBEDDING_MODES.has(value) ? (
          <GitGraph size={10} className="opacity-40 flex-shrink-0" />
        ) : null
      }
      footer={
        onInfoOpen ? (
          <button
            onClick={onInfoOpen}
            className="
              w-full text-right px-3 py-2
              font-display text-[11px] tracking-wider uppercase
              transition-colors duration-100
              cursor-pointer
              text-ink-muted hover:text-ink
            "
          >
            <span className="flex items-center justify-end gap-1.5">
              <HelpCircle size={11} className="opacity-60" />
              huh?
            </span>
          </button>
        ) : null
      }
    />
  );
}
