import { useEffect, useState } from "react";
import type { Gallery, Panel } from "./types";
import PanelCard from "./PanelCard";
import InfoModal from "./InfoModal";

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

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

  // Preload all panel images once data arrives
  useEffect(() => {
    if (status !== "ready" || panels.length === 0) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setImagesLoaded(true);
    }, 8000);

    const promises = panels.map(
      (panel) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `${import.meta.env.BASE_URL}images/${panel.image}`;
        })
    );

    Promise.all(promises).then(() => {
      if (!cancelled) {
        clearTimeout(timeout);
        setImagesLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [status, panels]);

  const showSpinner = status === "loading" || (status === "ready" && !imagesLoaded);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-ink-faint/30 pl-1!">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <h1 className="font-display font-bold text-xl tracking-tight text-ink">
            COMIC SNAPS
          </h1>
          <button
            onClick={() => setShowInfo(true)}
            className="text-ink/80 hover:text-ink transition-colors 
                        mr-2 cursor-pointer"
            title="About"
          >

            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 3.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-3.5 3v-3H4.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" />
              <circle cx="7" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="10" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="13" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {showSpinner && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && !showSpinner && <EmptyState />}
        {status === "ready" && panels.length > 0 && (
          <div
            className="panel-grid transition-opacity duration-700 ease-out"
            style={{ opacity: imagesLoaded ? 1 : 0 }}
          >
            {panels.map((panel) => (
              <PanelCard key={panel.id} panel={panel} />
            ))}
          </div>
        )}
      </main>

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}

function SpinnerState() {
  return (
    <div className="flex items-center justify-center py-32">
      <svg
        className="animate-spin h-8 w-8 text-ink-muted"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          className="opacity-70"
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
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