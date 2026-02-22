import { useState } from "react";
import type { Panel } from "./types";
import PanelViewer from "./PanelViewer";

interface Props {
  panel: Panel;
}

export default function PanelCard({ panel }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      <div
        className="panel-item group relative cursor-pointer overflow-hidden rounded-sm bg-surface-raised"
        onDoubleClick={() => setViewerOpen(true)}
      >
        <img
          src={`${import.meta.env.BASE_URL}${panel.image}`}
          alt={`${panel.title} #${panel.issue}`}
          loading="lazy"
          className="block w-full"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            el.parentElement!.querySelector<HTMLDivElement>(".fallback")!.style.display = "flex";
          }}
        />

        {/* Fallback placeholder (hidden by default) */}
        <div
          className="fallback hidden items-center justify-center bg-surface-raised text-ink-faint text-xs font-display"
          style={{ aspectRatio: "3/4" }}
        >
          {panel.title} #{panel.issue}
        </div>

        {/* Expand button — appears on hover/tap */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setViewerOpen(true);
          }}
          className="
            absolute top-2 right-2 z-10
            w-8 h-8 flex items-center justify-center
            rounded-md bg-black/50 backdrop-blur-sm
            text-white/70 hover:text-white hover:bg-black/70
            opacity-0 group-hover:opacity-100
            transition-all duration-200 ease-out
            focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/30
            active:scale-95
          "
          aria-label={`View ${panel.title} #${panel.issue} full screen`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Expand arrows icon */}
            <path d="M10 2h4v4" />
            <path d="M6 14H2v-4" />
            <path d="M14 2L9.5 6.5" />
            <path d="M2 14l4.5-4.5" />
          </svg>
        </button>

        {/* Hover overlay */}
        <div className="panel-overlay absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3">
          <p className="font-display text-sm text-ink leading-tight">
            {panel.title}{" "}
            <span className="text-accent">#{panel.issue}</span>
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            {panel.artist} · {panel.year}
          </p>
          {panel.notes && (
            <p className="text-xs text-ink-muted/70 mt-1 italic leading-snug line-clamp-2">
              {panel.notes}
            </p>
          )}
          {panel.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {panel.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] leading-none px-1.5 py-0.5 rounded-sm bg-white/10 text-ink-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewerOpen && (
        <PanelViewer panel={panel} onClose={() => setViewerOpen(false)} />
      )}
    </>
  );
}