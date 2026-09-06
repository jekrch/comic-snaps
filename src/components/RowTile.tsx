import type { Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import { useNearViewport } from "../hooks/useNearViewport";
import { BLUR_COPY } from "./PanelCard";
import { clampAspect, panelAspect, placeholderFor } from "./rowGeometry";

interface Props {
  panel: Panel;
  height: number;
  range: readonly [number, number];
  /** What the hover title says after the panel's name. */
  subtitle?: string;
  onOpen: (panel: Panel) => void;
}

/**
 * One panel in a shelf strip, cropped to its clamped width.
 *
 * The blur is honoured here rather than skipped: a row must not become the
 * place a blur does not apply. `PanelCard`'s directional variants are dropped —
 * "blurred from the left" says nothing about a centred crop of the middle — so
 * every blurred tile is covered whole, which is the safe direction to err in.
 *
 * `data-panel-id` is how the viewer finds the tile to fly out of and collapse
 * back into, the same handle `PanelCard` carries on the wall.
 */
export default function RowTile({ panel, height, range, subtitle, onOpen }: Props) {
  const { ref, near } = useNearViewport<HTMLButtonElement>();
  const width = Math.round(clampAspect(panelAspect(panel), range) * height);
  const isBlurred = panel.blur === "ew" || panel.blur === "nsfw";
  const label = `${panel.title} ${formatIssue(panel.issue)}`;
  const caption = subtitle ?? panel.artist;

  return (
    <button
      ref={ref}
      type="button"
      data-panel-id={panel.id}
      onClick={() => onOpen(panel)}
      className="row-tile relative shrink-0 overflow-hidden rounded-sm bg-surface-raised cursor-pointer"
      style={{ width, height, backgroundColor: placeholderFor(panel) }}
      aria-label={`View ${label}`}
      title={caption ? `${label} · ${caption}` : label}
    >
      {near && (
        <img
          src={panelImageUrl(panel.image)}
          alt={label}
          decoding="async"
          className="block h-full w-full object-cover"
          style={isBlurred ? { filter: "blur(8px) saturate(0.6)", transform: "scale(1.08)" } : undefined}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      )}
      {isBlurred && (
        <>
          <span
            className="row-tile-hatch absolute inset-0"
            data-blur={panel.blur}
            aria-hidden="true"
          />
          <span className="absolute inset-0 flex items-center justify-center px-2">
            <span className="font-display text-[10px] leading-snug text-center text-white bg-black/75 px-1.5 py-1 select-none">
              {BLUR_COPY[panel.blur!]}
            </span>
          </span>
        </>
      )}
    </button>
  );
}
