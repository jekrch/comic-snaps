import { useEffect, useState } from "react";
import type { Gallery, Panel } from "./types";
import PanelCard from "./PanelCard";

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/gallery.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<Gallery>;
      })
      .then((data) => {
        setPanels(data.panels);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-ink-faint/30">
        <div className="content-container px-4 py-4 flex items-center justify-between">
          <h1 className="font-display text-xl tracking-tight text-ink">
            COMIC SNAPS
          </h1>
          {status === "ready" && (
            <span className="text-xs text-ink-muted font-body">
              {panels.length} panel{panels.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="content-container px-1 pt-1 pb-12 sm:px-4 sm:pt-4">
        {status === "loading" && <LoadingState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && <EmptyState />}
        {status === "ready" && panels.length > 0 && (
          <div className="panel-grid">
            {panels.map((panel) => (
              <PanelCard key={panel.id} panel={panel} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="panel-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="panel-item">
          <div
            className="shimmer rounded-sm"
            style={{ height: `${220 + (i % 3) * 80}px` }}
          />
        </div>
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">
        Couldn't load the gallery.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">
        No panels yet. Send a photo to the Telegram bot to get started.
      </p>
    </div>
  );
}