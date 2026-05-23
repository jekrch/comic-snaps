import type { StampDef } from "./stamps";
import { computeStampGeometry, type StableStyle } from "./style";

interface MaskContentProps {
  stamp: StampDef;
  width: number;
  height: number;
  style: StableStyle;
  iconSvgContent: string | null;
}

const WORD_FONT_SIZE = 80;

/**
 * The mask payload — either a word in big bold mono or a Lucide icon, used as
 * a cut-out so the hatch only shows around the stamp.
 */
export default function MaskContent({
  stamp,
  width,
  height,
  style,
  iconSvgContent,
}: MaskContentProps) {
  if (stamp.type === "word") {
    return (
      <text
        className="hatch-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="900"
        fontSize={WORD_FONT_SIZE}
        letterSpacing="0em"
        fill="black"
      >
        {stamp.value}
      </text>
    );
  }

  if (!iconSvgContent) return null;

  const { iconSize, half, cx, cy } = computeStampGeometry(width, height, style.placement);
  const patchedContent = iconSvgContent.replace(/stroke="currentColor"/g, 'stroke="black"');

  return (
    <g className="hatch-text" transform={`translate(${cx - half}, ${cy - half})`}>
      <svg
        x={style.iconInnerX}
        y={style.iconInnerY}
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        overflow="visible"
        fill="none"
        stroke="black"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: patchedContent }}
      />
    </g>
  );
}
