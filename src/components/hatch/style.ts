import type { StampDef } from "./stamps";

const ROTATIONS = [45, 135];
const COLORS = ["#596424", "#a75a49"];

const STYLIZE_PLACEMENT = true;

export interface PlacementStyle {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface StableStyle {
  rotation: number;
  color: string;
  twist: string;
  placement: PlacementStyle;
  iconInnerX: number;
  iconInnerY: number;
}

/**
 * A simple integer hash that maps an index to a spread-out but deterministic
 * value, used to give each filler varied-looking placement without any
 * randomness.
 */
function deterministicHash(index: number): number {
  let h = index * 2654435761; // Knuth multiplicative hash
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

/** Map an index deterministically into the [min, max) range. */
function deterministicBetween(index: number, salt: number, min: number, max: number): number {
  const h = deterministicHash(index * 7 + salt);
  return min + (h % 10000) / 10000 * (max - min);
}

function deterministicPlacement(index: number): PlacementStyle {
  if (!STYLIZE_PLACEMENT) return { scale: 1, offsetX: 0, offsetY: 0 };
  return {
    scale: deterministicBetween(index, 1, 1.1, 2.0),
    offsetX: deterministicBetween(index, 2, 5, 200),
    offsetY: deterministicBetween(index, 3, -12, 12),
  };
}

export function generateStableStyle(
  stamp: StampDef | null,
  empty: boolean,
  fillerIndex: number,
): StableStyle {
  const rotation = ROTATIONS[fillerIndex % ROTATIONS.length];
  const color = COLORS[fillerIndex % COLORS.length];

  if (empty || !stamp) {
    return {
      rotation,
      color,
      twist: "",
      placement: { scale: 1, offsetX: 0, offsetY: 0 },
      iconInnerX: 0,
      iconInnerY: 0,
    };
  }

  const angle = deterministicBetween(fillerIndex, 10, -3, 3);
  const scale = 1.05 + deterministicBetween(fillerIndex, 11, 0, 0.1);
  const placement = stamp.type === "icon"
    ? deterministicPlacement(fillerIndex)
    : { scale: 1, offsetX: 0, offsetY: 0 };

  return {
    rotation,
    color,
    twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
    placement,
    iconInnerX: deterministicBetween(fillerIndex, 5, -10, 10),
    iconInnerY: deterministicBetween(fillerIndex, 5, -10, 40),
  };
}

/** Compute the stamp icon/text placement geometry in pixel coordinates. */
export function computeStampGeometry(
  width: number,
  height: number,
  placement: PlacementStyle,
) {
  const isSmall = Math.min(width, height) < 300;
  const baseIconSize = Math.min(width, height) * 0.7;
  // Cap scale on mobile.
  const effectiveScale = isSmall ? Math.min(placement.scale, 1.3) : placement.scale;
  const iconSize = Math.min(baseIconSize * effectiveScale, Math.min(width, height) * 0.95);

  // Tighten offset influence on small screens.
  const offsetDamping = isSmall ? 0.3 : 1.0;
  const rawCx = width / 2 + (placement.offsetX / 100) * width * offsetDamping;
  const rawCy = height / 2 + (placement.offsetY / 100) * height * offsetDamping;

  const half = iconSize / 2;
  const margin = half * (isSmall ? 0.7 : 0.3);
  const cx = Math.max(margin, Math.min(width - margin, rawCx));
  const cy = Math.max(margin, Math.min(height - margin, rawCy));

  return { iconSize, half, cx, cy };
}
