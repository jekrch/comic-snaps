import { useMemo } from "react";
import type { MetricExplainerProps } from "./explainerConstants";
import { METRIC_INFO } from "./explainerConstants";
import { HatchDivider } from "./explainerPrimitives";
import {
  EmbeddingExplanation,
  ColorExplanation,
  PhashExplanation,
} from "./explanations";

export default function MetricExplainerPanel({
  metric,
  anchorPanel,
  neighbors,
}: Omit<MetricExplainerProps, "onClose">) {
  const info = METRIC_INFO[metric];

  const sorted = useMemo(
    () => [...neighbors].sort((a, b) => a.distance - b.distance),
    [neighbors]
  );
  const closest = sorted[0] ?? null;
  const furthest = sorted[sorted.length - 1] ?? null;

  if (!closest || !furthest) return null;

  const isEmbedding =
    metric === "embedding-siglip" ||
    metric === "embedding-dino" ||
    metric === "embedding-gram";

  return (
    <div className="px-6 py-6 sm:px-10 sm:py-8 max-w-lg lg:max-w-xl mx-auto w-full">
      {/* Header */}
      <div className="mb-4">
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

      {/* Body */}
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
  );
}
