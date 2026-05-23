import { useId, useMemo, useRef } from "react";
import type { NeighborMap } from "../adjacency";
import { useHatchViewerOpen } from "../hooks/useHatchPause";
import FillerLabels from "./FillerLabels";
import HatchPattern from "./hatch/HatchPattern";
import MaskContent from "./hatch/MaskContent";
import { buildStampPool, useLucideExtract, type StampDef } from "./hatch/stamps";
import { generateStableStyle } from "./hatch/style";
import {
  buildDropKeyframes,
  buildLiquidConfig,
  LiquidDefs,
  LiquidLayers,
  useLiquidAnimation,
} from "./hatch/liquid";
import {
  useContainerSize,
  useOnScreen,
  usePrefersReducedMotion,
} from "./hatch/useContainerSize";

// Re-exports preserved so external callers (MasonryGrid) keep working.
export { buildStampPool } from "./hatch/stamps";
export type { StampDef } from "./hatch/stamps";

interface HatchFillerProps {
  empty?: boolean;
  /** When provided, the filler uses this stamp instead of picking randomly. */
  assignedStamp?: StampDef | null;
  /**
   * Deterministic index used to cycle colors, rotations, and placement styles.
   * Assigned by MasonryGrid in layout order.
   */
  fillerIndex?: number;
  /** Adjacent panel info for rendering artist labels. */
  neighbors?: NeighborMap | null;
  /** Override the hatch color (bypasses the deterministic palette cycle). */
  colorOverride?: string | null;
}

export default function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
  colorOverride = null,
}: HatchFillerProps) {
  const patternId = useId();
  const darkPatternId = useId();
  const maskId = useId();
  const gooFilterId = useId();
  const liquidMaskId = useId();
  const animId = useId().replace(/[^a-zA-Z0-9_-]/g, "_");

  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const onScreen = useOnScreen(containerRef);
  const reducedMotion = usePrefersReducedMotion();
  const viewerOpen = useHatchViewerOpen();

  // Pick the stamp once and pin it — re-picks would visually swap mid-life.
  const stampRef = useRef<StampDef | null>(null);
  if (stampRef.current === null && !empty) {
    const pool = buildStampPool();
    stampRef.current = assignedStamp ?? pool[fillerIndex % pool.length];
  }
  const stamp = stampRef.current;

  // Stable style — same idea, pinned once for the filler's lifetime.
  const styleRef = useRef<ReturnType<typeof generateStableStyle> | null>(null);
  if (styleRef.current === null) {
    styleRef.current = generateStableStyle(stamp, empty, fillerIndex);
  }
  const style = styleRef.current;
  const resolvedColor = colorOverride ?? style.color;

  const iconSvgContent = useLucideExtract(stamp?.type === "icon" ? stamp.value : null);

  // Liquid runs on any hatched filler — the dark shade is derived from the
  // resolved line color, so green tiles get dark-green ink, orange tiles
  // get dark-orange ink, etc.
  const liquidEligible = !empty && !reducedMotion;
  const liquid = useMemo(
    () => buildLiquidConfig(liquidEligible, size.width, size.height, resolvedColor),
    [liquidEligible, size.width, size.height, resolvedColor],
  );

  const animationActive = liquid.enabled && onScreen && !viewerOpen;
  const { event, layers } = useLiquidAnimation({
    enabled: animationActive,
    width: size.width,
    height: size.height,
    baseRadius: liquid.baseRadius,
  });

  const dropKeyframes = useMemo(
    () => (liquid.enabled ? buildDropKeyframes(event, animId) : ""),
    [event, liquid.enabled, animId],
  );

  return (
    <div ref={containerRef} className="hatch-root relative w-full h-full rounded-sm overflow-hidden">
      <style>{`
        .hatch-text {
          transform: ${style.twist};
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
        }
        .hatch-root:hover .hatch-text {
          transform: scale(1.2) rotate(0deg);
        }
        .filler-labels {
          opacity: 0;
          transform: scale(0.92);
          transition: opacity 0.25s ease-out, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
          pointer-events: none;
        }
        .hatch-root:hover .filler-labels {
          opacity: 1;
          transform: scale(1);
        }
        ${dropKeyframes}
      `}</style>
      <svg
        className="hatch-container"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <HatchPattern id={patternId} rotation={style.rotation} color={resolvedColor} />
          {liquid.enabled && (
            <HatchPattern id={darkPatternId} rotation={style.rotation} color={liquid.darkColor} />
          )}
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {!empty && stamp && (
              <MaskContent
                stamp={stamp}
                width={size.width}
                height={size.height}
                style={style}
                iconSvgContent={iconSvgContent}
              />
            )}
          </mask>
          <LiquidDefs
            liquid={liquid}
            layers={layers}
            event={event}
            gooFilterId={gooFilterId}
            liquidMaskId={liquidMaskId}
            animId={animId}
          />
        </defs>
        <rect width="100%" height="100%" fill="var(--color-surface-raised, #1a1a1a)" />
        <g mask={`url(#${maskId})`}>
          {/* Base hatch — always present, never animated. */}
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          <LiquidLayers
            liquid={liquid}
            layers={layers}
            event={event}
            patternId={patternId}
            darkPatternId={darkPatternId}
            liquidMaskId={liquidMaskId}
          />
        </g>
      </svg>

      {neighbors && (
        <FillerLabels neighbors={neighbors} width={size.width} height={size.height} />
      )}
    </div>
  );
}
