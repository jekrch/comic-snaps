import type { LiquidConfig, SplashEvent, SplashLayer } from "./types";

interface LiquidIds {
  gooFilterId: string;
  liquidMaskId: string;
  animId: string;
}

interface LiquidDefsProps extends LiquidIds {
  liquid: LiquidConfig;
  layers: SplashLayer[];
  event: SplashEvent | null;
}

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

/**
 * Active-event mask: the currently animating droplets. Drawn last (on top of
 * all settled layers) so a new in-flight splash is always visible regardless
 * of cycle.
 */
function ActiveEventMask({
  event,
  maskId,
  gooFilterId,
  animId,
}: {
  event: SplashEvent;
  maskId: string;
  gooFilterId: string;
  animId: string;
}) {
  return (
    <mask id={maskId}>
      <rect width="100%" height="100%" fill="black" />
      <g key={event.id} filter={`url(#${gooFilterId})`} fill="white">
        {event.droplets.map((d, i) => (
          <ellipse
            key={i}
            className={`drop-${animId}-${i}`}
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

/** SVG `<defs>` content for the liquid splash system. */
export function LiquidDefs({ liquid, layers, event, gooFilterId, liquidMaskId, animId }: LiquidDefsProps) {
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
      {event && (
        <ActiveEventMask
          event={event}
          maskId={`${liquidMaskId}-active`}
          gooFilterId={gooFilterId}
          animId={animId}
        />
      )}
    </>
  );
}

interface LiquidLayersProps {
  liquid: LiquidConfig;
  layers: SplashLayer[];
  event: SplashEvent | null;
  patternId: string;
  darkPatternId: string;
  liquidMaskId: string;
}

/**
 * The rect overlays that paint each splash layer (and the active in-flight
 * event) on top of the static base hatch.
 *
 * Layers render oldest first so each new phase visibly overpaints the previous
 * one; the active event renders last so the live animation is always visible
 * over the settled layers regardless of phase.
 */
export function LiquidLayers({
  liquid,
  layers,
  event,
  patternId,
  darkPatternId,
  liquidMaskId,
}: LiquidLayersProps) {
  if (!liquid.enabled) return null;
  const fillFor = (phase: SplashLayer["phase"]) =>
    phase === "dark" ? `url(#${darkPatternId})` : `url(#${patternId})`;
  return (
    <>
      {layers.map((layer) => (
        <rect
          key={layer.id}
          width="100%"
          height="100%"
          fill={fillFor(layer.phase)}
          mask={`url(#${liquidMaskId}-${layer.id})`}
        />
      ))}
      {event && (
        <rect
          width="100%"
          height="100%"
          fill={fillFor(event.phase)}
          mask={`url(#${liquidMaskId}-active)`}
        />
      )}
    </>
  );
}
