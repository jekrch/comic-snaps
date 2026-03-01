import { useId, useRef, useState, useEffect } from "react";
import { MessageCircleMore, Globe, MessageSquareQuote, Eye } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";

export const WORDS = ["SNAPS"];

export const LUCIDE_ICONS: LucideIcon[] = [
  MessageCircleMore,
  MessageSquareQuote,
  Globe, Eye
];

const ROTATIONS = [45, 135];
const COLORS = ["#e97d62", "#7A8B2A"];

const STYLIZE_PLACEMENT = true;

export type StampDef =
  | { type: "word"; value: string }
  | { type: "icon"; value: LucideIcon };

/** Build the full pool of possible stamps for external sequencing. */
export function buildStampPool(): StampDef[] {
  const pool: StampDef[] = [];
  for (const icon of LUCIDE_ICONS) {
    pool.push({ type: "icon", value: icon });
  }
  for (const word of WORDS) {
    pool.push({ type: "word", value: word });
  }
  return pool;
}

interface PlacementStyle {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generatePlacement(): PlacementStyle {
  if (!STYLIZE_PLACEMENT) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  return {
    scale: randomBetween(1.1, 1.8),
    offsetX: randomBetween(-30, 30),
    offsetY: randomBetween(-25, 25),
  };
}

/**
 * Render a Lucide icon offscreen, extract the raw SVG children,
 * and return them as an HTML string suitable for dangerouslySetInnerHTML
 * inside an <svg> mask.
 */
function extractLucideSvgContent(IconComponent: LucideIcon): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);

    const cleanup = (root: ReturnType<typeof createRoot>) => {
      root.unmount();
      document.body.removeChild(container);
    };

    const tryExtract = () => {
      const svg = container.querySelector("svg");
      return svg ? svg.innerHTML : null;
    };

    const observer = new MutationObserver(() => {
      const content = tryExtract();
      if (content) {
        observer.disconnect();
        cleanup(root);
        resolve(content);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    const root = createRoot(container);
    root.render(
      <IconComponent size={24} strokeWidth={2} color="black" fill="none" />
    );

    setTimeout(() => {
      observer.disconnect();
      const content = tryExtract();
      cleanup(root);
      resolve(content ?? "");
    }, 500);
  });
}

function useLucideExtract(IconComponent: LucideIcon | null): string | null {
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    if (!IconComponent) {
      setSvgContent(null);
      return;
    }
    let cancelled = false;
    extractLucideSvgContent(IconComponent).then((content) => {
      if (!cancelled) setSvgContent(content);
    });
    return () => { cancelled = true; };
  }, [IconComponent]);

  return svgContent;
}

// ---------------------------------------------------------------------------
// Stable style — generated once per component instance via useRef
// ---------------------------------------------------------------------------

interface StableStyle {
  rotation: number;
  color: string;
  twist: string;
  placement: PlacementStyle;
}

function generateStableStyle(stamp: StampDef | null, empty: boolean): StableStyle {
  if (empty || !stamp) {
    return {
      rotation: pickRandom(ROTATIONS),
      color: pickRandom(COLORS),
      twist: "",
      placement: { scale: 1, offsetX: 0, offsetY: 0 },
    };
  }

  const angle = Math.random() * 6 - 3;
  const scale = 1.05 + Math.random() * 0.1;

  return {
    rotation: pickRandom(ROTATIONS),
    color: pickRandom(COLORS),
    twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
    placement:
      stamp.type === "icon"
        ? generatePlacement()
        : { scale: 1, offsetX: 0, offsetY: 0 },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HatchFillerProps {
  empty?: boolean;
  /** When provided, the filler uses this stamp instead of picking randomly. */
  assignedStamp?: StampDef | null;
}

export default function HatchFiller({
  empty = false,
  assignedStamp = null,
}: HatchFillerProps) {
  const patternId = useId();
  const maskId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Determine the stamp (assigned or random fallback), pinned on first render
  const stampRef = useRef<StampDef | null>(null);
  if (stampRef.current === null && !empty) {
    if (assignedStamp) {
      stampRef.current = assignedStamp;
    } else {
      const useIcon = Math.random() > 0.3;
      stampRef.current = useIcon
        ? { type: "icon", value: pickRandom(LUCIDE_ICONS) }
        : { type: "word", value: pickRandom(WORDS) };
    }
  }
  const stamp = stampRef.current;

  // Pin all random visual properties (rotation, color, twist, placement) once
  const styleRef = useRef<StableStyle | null>(null);
  if (styleRef.current === null) {
    styleRef.current = generateStableStyle(stamp, empty);
  }
  const { rotation, color, twist, placement } = styleRef.current;

  const iconSvgContent = useLucideExtract(
    stamp?.type === "icon" ? stamp.value : null
  );

  const patternContent = (
    <pattern
      id={patternId}
      width="8"
      height="8"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${rotation})`}
    >
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="8"
        stroke={color}
        strokeWidth="8"
        strokeOpacity="0.68"
      />
    </pattern>
  );

  const baseIconSize = Math.min(size.width, size.height) * 0.7;
  const iconSize = baseIconSize * placement.scale;
  const half = iconSize / 2;

  const cx = size.width / 2 + (placement.offsetX / 100) * size.width;
  const cy = size.height / 2 + (placement.offsetY / 100) * size.height;

  const fontSize = 100;

  let maskContent: React.ReactNode = null;

  if (!empty && stamp?.type === "word") {
    maskContent = (
      <text
        className="hatch-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="900"
        fontSize={fontSize}
        letterSpacing="0em"
        fill="black"
      >
        {stamp.value}
      </text>
    );
  } else if (!empty && stamp?.type === "icon" && iconSvgContent) {
    const patchedContent = iconSvgContent.replace(
      /stroke="currentColor"/g,
      'stroke="black"'
    );

    maskContent = (
      <g className="hatch-text">
        <svg
          x={cx}
          y={cy}
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          overflow="visible"
          style={{ transform: `translate(-${half}px, -${half}px)` }}
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

  return (
    <div ref={containerRef} className="w-full h-full rounded-sm overflow-hidden">
      <style>{`
        .hatch-text {
          transform: ${twist};
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
        }
        .hatch-container:hover .hatch-text {
          transform: scale(1.2) rotate(0deg);
        }
      `}</style>
      <svg
        className="hatch-container"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          {patternContent}
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {maskContent}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--color-surface-raised, #1a1a1a)"
        />
        <rect
          width="100%"
          height="100%"
          fill={`url(#${patternId})`}
          mask={`url(#${maskId})`}
        />
      </svg>
    </div>
  );
}