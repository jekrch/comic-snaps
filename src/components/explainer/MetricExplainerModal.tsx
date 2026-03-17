import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { MetricExplainerProps } from "./explainerConstants";
import { METRIC_INFO } from "./explainerConstants";
import { HatchDivider } from "./explainerPrimitives";
import {
  EmbeddingExplanation,
  ColorExplanation,
  PhashExplanation,
} from "./explanations";

export default function MetricExplainerModal({
  metric,
  anchorPanel,
  neighbors,
  onClose,
}: MetricExplainerProps) {
  const [closing, setClosing] = useState(false);
  const info = METRIC_INFO[metric];

  const sorted = useMemo(
    () => [...neighbors].sort((a, b) => a.distance - b.distance),
    [neighbors]
  );
  const closest = sorted[0] ?? null;
  const furthest = sorted[sorted.length - 1] ?? null;

  /* Scroll lock */
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose, closing]);

  /* Escape key */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  if (!closest || !furthest) return null;

  const isEmbedding =
    metric === "embedding-siglip" ||
    metric === "embedding-dino" ||
    metric === "embedding-gram";

  return (
    <div
      className="fixed z-[70] flex items-center justify-center !mx-2"
      style={{
        top: "-100px",
        left: 0,
        right: 0,
        bottom: "-100px",
        overscrollBehavior: "none",
        touchAction: "none",
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }}
      onTouchMove={(e) => e.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label={`How ${info.name} similarity works`}
    >
      {/* Scrim */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.85)",
          animation: closing
            ? "scrimOut 260ms ease-out forwards"
            : "scrimIn 220ms ease-out forwards",
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[500px] mx-5 rounded-md
                   border border-[var(--color-border,rgba(74,71,69,0.25))]
                   bg-[var(--color-surface-raised,#1a1816)]"
        style={{
          maxHeight: "min(85vh, 720px)",
          display: "flex",
          flexDirection: "column",
          animation: closing
            ? "modalExit 230ms ease-out forwards"
            : "modalEnter 230ms ease-out forwards",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="shrink-0 px-5 pt-5 pb-3 border-b"
          style={{ borderColor: "var(--color-border, rgba(74,71,69,0.25))" }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p
                className="text-[10px] uppercase tracking-[0.1em] m-0 mb-1"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-accent, #e97d62)",
                  opacity: 0.7,
                }}
              >
                {info.family}
              </p>
              <h2
                className="text-[15px] tracking-tight m-0"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-ink, #e8e0d8)",
                }}
              >
                How {info.name} distance works
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="bg-transparent border-none cursor-pointer p-1
                         transition-colors duration-150 -mr-1 -mt-1"
              title="Close"
            >
              <X
                size={15}
                strokeWidth={1.5}
                className="stroke-ink-muted hover:stroke-ink-faint"
              />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 info-modal-scroll">
          <p
            className="text-[12px] leading-relaxed m-0 mb-1"
            style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
          >
            {info.oneLiner}
          </p>

          <HatchDivider />

          {isEmbedding && (
            <EmbeddingExplanation
              metric={metric}
              info={info}
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}

          {metric === "color" && (
            <ColorExplanation
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}

          {metric === "phash" && (
            <PhashExplanation
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}
        </div>
      </div>
    </div>
  );
}