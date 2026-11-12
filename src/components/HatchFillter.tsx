import { memo, useId, useMemo, useRef, type CSSProperties } from "react";
import type { NeighborMap } from "../adjacency";
import { useViewerOpen } from "../hooks/useViewerOpen";
import FillerLabels from "./FillerLabels";
import HatchPattern from "./hatch/HatchPattern";
import StampGlyph from "./hatch/StampGlyph";
import { buildStampPool, useLucideExtract, type StampDef } from "./hatch/stamps";
import { generateStableStyle } from "./hatch/style";
import {
  ActiveLayer,
  buildLiquidConfig,
  SettledDefs,
  SettledLayers,
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

/** Promotes the live SVG to its own compositor layer while it animates. */
const LIVE_LAYER: CSSProperties = { willChange: "transform" };

/**
 * The filler is two stacked SVGs.
 *
 *   static — background, base hatch, settled splash layers. Changes only when
 *            a splash settles, so it is rasterized a few times a minute.
 *   live   — the in-flight splash and the stamp. Repaints every frame, on its
 *            own compositor layer, so those repaints never re-run the static
 *            SVG's goo filters.
 *
 * The in-flight splash always drew above every settled layer and the stamp
 * cut through all of it, so splitting at that seam keeps the stacking order.
 */
function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
  colorOverride = null,
}: HatchFillerProps) {
  const patternId = useId();
  const darkPatternId = useId();
  const gooFilterId = useId();
  const liquidMaskId = useId();
  const liveGooFilterId = useId();
  const liveMaskId = useId();

  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const onScreen = useOnScreen(containerRef);
  const reducedMotion = usePrefersReducedMotion();
  const viewerOpen = useViewerOpen();

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

  const glyphStamp = empty ? null : stamp;
  const rootStyle = useMemo(
    () => ({ "--hatch-twist": style.twist || "none" }) as CSSProperties,
    [style.twist],
  );

  return (
    <div
      ref={containerRef}
      className="hatch-root relative w-full h-full rounded-sm overflow-hidden"
      style={rootStyle}
    >
      <svg
        className="hatch-container absolute inset-0"
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
          <SettledDefs
            liquid={liquid}
            layers={layers}
            gooFilterId={gooFilterId}
            liquidMaskId={liquidMaskId}
          />
        </defs>
        <rect width="100%" height="100%" fill="var(--color-surface-raised, #1a1a1a)" />
        {/* Base hatch — always present, never animated. */}
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        <SettledLayers
          liquid={liquid}
          layers={layers}
          width={size.width}
          height={size.height}
          patternId={patternId}
          darkPatternId={darkPatternId}
          liquidMaskId={liquidMaskId}
        />
      </svg>

      {(glyphStamp || liquid.enabled) && (
        <svg
          className="hatch-live absolute inset-0"
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={animationActive ? LIVE_LAYER : undefined}
        >
          {/* Patterns are referenced from the static SVG; ids are document-wide. */}
          <ActiveLayer
            liquid={liquid}
            event={event}
            width={size.width}
            height={size.height}
            patternId={patternId}
            darkPatternId={darkPatternId}
            gooFilterId={liveGooFilterId}
            maskId={liveMaskId}
          />
          {glyphStamp && (
            <StampGlyph
              stamp={glyphStamp}
              width={size.width}
              height={size.height}
              style={style}
              iconSvgContent={iconSvgContent}
            />
          )}
        </svg>
      )}

      {neighbors && (
        <FillerLabels neighbors={neighbors} width={size.width} height={size.height} />
      )}
    </div>
  );
}

/** Neighbor maps are rebuilt object-fresh on every layout; compare by panel identity. */
function sameNeighbors(a?: NeighborMap | null, b?: NeighborMap | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.top?.id === b.top?.id &&
    a.bottom?.id === b.bottom?.id &&
    a.left?.id === b.left?.id &&
    a.right?.id === b.right?.id
  );
}

// Each filler owns two observers, two SVGs and a running liquid animation, so
// re-rendering the full set on every relayout is the dominant cost in the
// grid. Only a genuine content change warrants it.
export default memo(
  HatchFiller,
  (prev, next) =>
    prev.empty === next.empty &&
    prev.assignedStamp === next.assignedStamp &&
    prev.fillerIndex === next.fillerIndex &&
    prev.colorOverride === next.colorOverride &&
    sameNeighbors(prev.neighbors, next.neighbors)
);
