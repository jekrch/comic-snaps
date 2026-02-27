import { useEffect, useState, useRef, useCallback } from "react";
import { LoaderCircle, MessageSquareMore } from "lucide-react";
import type { Gallery, Panel } from "./types";
import PanelCard from "./PanelCard";
import InfoModal from "./InfoModal";

export default function App() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
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
          img.src = `${import.meta.env.BASE_URL}${panel.image}`;
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

  const showSpinner =
    status === "loading" || (status === "ready" && !imagesLoaded);

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
            className="text-ink/80 hover:text-ink transition-colors mr-2 cursor-pointer"
            title="About"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4.5 3.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-3.5 3v-3H4.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" />
              <circle
                cx="7"
                cy="8.5"
                r="0.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="10"
                cy="8.5"
                r="0.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="13"
                cy="8.5"
                r="0.6"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {showSpinner && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && panels.length === 0 && !showSpinner && (
          <EmptyState />
        )}
        {status === "ready" && panels.length > 0 && (
          <div
            className="transition-opacity duration-700 ease-out"
            style={{ opacity: imagesLoaded ? 1 : 0 }}
          >
            <MasonryGrid panels={panels} />
          </div>
        )}
      </main>

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}


// masonry style: height-balanced columns, right-to-left order


const GAP = 4;
const DEFAULT_ASPECT = 3 / 4; // w/h fallback when dimensions unknown

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

/**
 * Distributes panels into N columns by always placing the next panel
 * into the shortest column. When two columns have equal height the
 * leftmost one wins, producing a left-to-right fill bias.
 *
 * The returned columns are in visual order: index 0 = leftmost.
 */
function distributeToColumns(
  panels: Panel[],
  colCount: number,
  colWidth: number
): Panel[][] {
  const columns: Panel[][] = Array.from({ length: colCount }, () => []);
  const heights: number[] = new Array(colCount).fill(0);

  for (const panel of panels) {
    // Determine the rendered height of this panel in the column
    let aspect = DEFAULT_ASPECT;
    if (panel.width && panel.height && panel.width > 0 && panel.height > 0) {
      aspect = panel.width / panel.height;
    }
    const renderedHeight = colWidth / aspect;

    // Find the shortest column; ties go to the leftmost (lowest index)
    let targetCol = 0;
    let minHeight = heights[0];
    for (let i = 1; i < colCount; i++) {
      if (heights[i] < minHeight) {
        minHeight = heights[i];
        targetCol = i;
      }
    }

    columns[targetCol].push(panel);
    heights[targetCol] += renderedHeight + GAP;
  }

  return columns;
}

function MasonryGrid({ panels }: { panels: Panel[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<Panel[][]>([]);

  const layout = useCallback(() => {
    if (!containerRef.current) return;
    const colCount = getColumnCount();
    const containerWidth = containerRef.current.offsetWidth;
    const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;
    setColumns(distributeToColumns(panels, colCount, colWidth));
  }, [panels]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  return (
    <div
      ref={containerRef}
      className="flex"
      style={{ gap: `${GAP}px` }}
    >
      {columns.map((colPanels, colIdx) => (
        <div
          key={colIdx}
          className="flex-1 flex flex-col min-w-0"
          style={{ gap: `${GAP}px` }}
        >
          {colPanels.map((panel) => (
            <PanelCard key={panel.id} panel={panel} />
          ))}
        </div>
      ))}
    </div>
  );
}


function SpinnerState() {
  return (
    <div className="flex items-center justify-center py-32">
      <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">Couldn't load the gallery.</p>
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