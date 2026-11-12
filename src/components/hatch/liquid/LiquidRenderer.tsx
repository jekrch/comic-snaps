import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { eventBounds, gooPad, settledBounds } from "./bounds";
import { buildDropAnimations } from "./keyframes";
import type { LiquidConfig, SplashEvent, SplashLayer } from "./types";

/**
 * Gooey filter: blur + alpha threshold turns overlapping ellipses into a
 * single continuous liquid silhouette.
 */
function GooFilter({ id, blurStd }: { id: string; blurStd: number }) {
  return (
    <filter
      id={id}
      x="-20%"
      y="-20%"
      width="140%"
      height="160%"
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation={blurStd} result="blur" />
      <feColorMatrix
        in="blur"
        mode="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
      />
    </filter>
  );
}

const fillFor = (phase: SplashLayer["phase"], patternId: string, darkPatternId: string) =>
  phase === "dark" ? `url(#${darkPatternId})` : `url(#${patternId})`;

// ---------------------------------------------------------------------------
// Settled layers — the static SVG. Repaints only when a layer changes.
// ---------------------------------------------------------------------------

/**
 * One mask per chronological splash layer. Gooey-merged ellipses become a
 * single white "fluid" silhouette over black, which masks that layer's hatch
 * pattern fill.
 */
function LayerMask({
  layer,
  maskId,
  gooFilterId,
}: {
  layer: SplashLayer;
  maskId: string;
  gooFilterId: string;
}) {
  return (
    <mask id={maskId}>
      <rect width="100%" height="100%" fill="black" />
      <g filter={`url(#${gooFilterId})`} fill="white">
        {layer.globs.map((g, i) => (
          <ellipse key={i} cx={g.x} cy={g.y} rx={g.rx} ry={g.ry} />
        ))}
      </g>
    </mask>
  );
}

interface SettledDefsProps {
  liquid: LiquidConfig;
  layers: SplashLayer[];
  gooFilterId: string;
  liquidMaskId: string;
}

/** `<defs>` content for the settled layers. */
export function SettledDefs({ liquid, layers, gooFilterId, liquidMaskId }: SettledDefsProps) {
  if (!liquid.enabled) return null;
  return (
    <>
      <GooFilter id={gooFilterId} blurStd={liquid.blurStd} />
      {layers.map((layer) => (
        <LayerMask
          key={layer.id}
          layer={layer}
          maskId={`${liquidMaskId}-${layer.id}`}
          gooFilterId={gooFilterId}
        />
      ))}
    </>
  );
}

interface SettledLayersProps {
  liquid: LiquidConfig;
  layers: SplashLayer[];
  width: number;
  height: number;
  patternId: string;
  darkPatternId: string;
  liquidMaskId: string;
}

/**
 * The rects that paint each settled layer over the base hatch, oldest first
 * so each new phase visibly overpaints the previous one.
 *
 * Each rect covers only its globs' reach rather than the whole tile: the
 * pattern is in user space so it lines up the same either way, and the mask
 * and filter then rasterize over that box alone.
 */
export function SettledLayers({
  liquid,
  layers,
  width,
  height,
  patternId,
  darkPatternId,
  liquidMaskId,
}: SettledLayersProps) {
  if (!liquid.enabled) return null;
  const pad = gooPad(liquid.blurStd);
  return (
    <>
      {layers.map((layer) => {
        const box = settledBounds(layer.globs, pad, width, height);
        if (!box) return null;
        return (
          <rect
            key={layer.id}
            {...box}
            fill={fillFor(layer.phase, patternId, darkPatternId)}
            mask={`url(#${liquidMaskId}-${layer.id})`}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Active event — the live SVG. The only part that repaints every frame.
// ---------------------------------------------------------------------------

const DROP_STYLE: CSSProperties = {
  transformBox: "fill-box",
  transformOrigin: "center",
};

/**
 * Active-event mask: the currently animating droplets. Their motion is
 * started with `element.animate()` before first paint, so the droplets never
 * show at rest size.
 */
function ActiveEventMask({
  event,
  maskId,
  gooFilterId,
}: {
  event: SplashEvent;
  maskId: string;
  gooFilterId: string;
}) {
  const dropRefs = useRef<(SVGEllipseElement | null)[]>([]);

  useLayoutEffect(() => {
    const animations = buildDropAnimations(event).map((a, i) =>
      dropRefs.current[i]?.animate(a.keyframes, a.options),
    );
    return () => {
      for (const a of animations) a?.cancel();
    };
  }, [event]);

  return (
    <mask id={maskId}>
      <rect width="100%" height="100%" fill="black" />
      <g key={event.id} filter={`url(#${gooFilterId})`} fill="white">
        {event.droplets.map((d, i) => (
          <ellipse
            key={i}
            ref={(el) => {
              dropRefs.current[i] = el;
            }}
            style={DROP_STYLE}
            cx={d.x}
            cy={d.y}
            rx={d.rx}
            ry={d.ry}
          />
        ))}
      </g>
    </mask>
  );
}

interface ActiveLayerProps {
  liquid: LiquidConfig;
  event: SplashEvent | null;
  width: number;
  height: number;
  patternId: string;
  darkPatternId: string;
  gooFilterId: string;
  maskId: string;
}

/**
 * The in-flight splash: its own goo filter and mask, and a rect bounded to
 * the reach of this event's droplets, so each frame re-rasterizes one blur
 * over that box instead of every layer's blur over the whole tile.
 */
export function ActiveLayer({
  liquid,
  event,
  width,
  height,
  patternId,
  darkPatternId,
  gooFilterId,
  maskId,
}: ActiveLayerProps) {
  if (!liquid.enabled || !event) return null;
  const box = eventBounds(event, gooPad(liquid.blurStd), width, height);
  if (!box) return null;
  return (
    <>
      <defs>
        <GooFilter id={gooFilterId} blurStd={liquid.blurStd} />
        <ActiveEventMask event={event} maskId={maskId} gooFilterId={gooFilterId} />
      </defs>
      <rect
        {...box}
        fill={fillFor(event.phase, patternId, darkPatternId)}
        mask={`url(#${maskId})`}
      />
    </>
  );
}
