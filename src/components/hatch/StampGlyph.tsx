import type { CSSProperties } from "react";
import type { StampDef } from "./stamps";
import { computeStampGeometry, type StableStyle } from "./style";

interface StampGlyphProps {
  stamp: StampDef;
  width: number;
  height: number;
  style: StableStyle;
  iconSvgContent: string | null;
}

const WORD_FONT_SIZE = 80;

/**
 * Painted in the tile's background colour, on top of the hatch, so it reads
 * as a cut-out. This used to be a luminance mask over the hatch group; over
 * an opaque background the two composite to the same pixels, antialiased
 * edges included, and painting it skips a mask pass on every animated frame.
 */
const INK = "var(--color-surface-raised, #1a1a1a)";

// Set as fill/stroke directly, never through `color` + `currentColor`: the base
// layer's `*` rule gives every element its own grey `color`, so the icon's
// inner <svg> and paths would resolve `currentColor` to grey, not the ink.
const TEXT_INK: CSSProperties = { fill: INK };
const ICON_INK: CSSProperties = { stroke: INK };

/** The stamp — a word in big bold mono or a Lucide icon. */
export default function StampGlyph({
  stamp,
  width,
  height,
  style,
  iconSvgContent,
}: StampGlyphProps) {
  if (stamp.type === "word") {
    return (
      <text
        className="hatch-text"
        style={TEXT_INK}
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="900"
        fontSize={WORD_FONT_SIZE}
        letterSpacing="0em"
      >
        {stamp.value}
      </text>
    );
  }

  if (!iconSvgContent) return null;

  const { iconSize, half, cx, cy } = computeStampGeometry(width, height, style.placement);
  // Strip any stroke the paths carry so they inherit the ink from the <svg>.
  const patchedContent = iconSvgContent.replace(/\sstroke="(?:currentColor|black)"/g, "");

  return (
    <g className="hatch-text" transform={`translate(${cx - half}, ${cy - half})`}>
      <svg
        style={ICON_INK}
        x={style.iconInnerX}
        y={style.iconInnerY}
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        overflow="visible"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: patchedContent }}
      />
    </g>
  );
}
