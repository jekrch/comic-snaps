import type { Panel } from "./types";

interface Props {
  panel: Panel;
}

export default function PanelCard({ panel }: Props) {
  return (
    <div className="panel-item group relative cursor-pointer overflow-hidden rounded-sm bg-surface-raised">
      <img
        src={`${import.meta.env.BASE_URL}${panel.image}`}
        alt={`${panel.title} #${panel.issue}`}
        loading="lazy"
        className="block w-full"
        onError={(e) => {
          // Show a colored placeholder if the image fails to load
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
  );
}
