import { useId, useMemo } from "react";

const WORDS = ["SNAPS"];
const ROTATIONS = [45, 135];
const COLORS = ["#e97d62", "#7A8B2A"];
type FillStyle = "hatch" | "dots";
const FILL_STYLES: FillStyle[] = ["hatch", "dots"];
type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function HatchFiller() {
  const patternId = useId();
  const maskId = useId();
  const gradientId = useId();
  const compositePatternId = useId();

  const { word, rotation, color, twist, fillStyle, corner } = useMemo(() => {
    const angle = Math.random() * 6 - 3;
    const scale = 1.05 + Math.random() * 0.1;
    return {
      word: pickRandom(WORDS),
      rotation: pickRandom(ROTATIONS),
      color: pickRandom(COLORS),
      twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
      fillStyle: FILL_STYLES[0], //pickRandom(FILL_STYLES),
      corner: pickRandom(CORNERS),
    };
  }, []);

  const gradientCoords = {
    tl: { x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
    tr: { x1: "100%", y1: "0%", x2: "0%", y2: "100%" },
    bl: { x1: "0%", y1: "100%", x2: "100%", y2: "0%" },
    br: { x1: "100%", y1: "100%", x2: "0%", y2: "0%" },
  }[corner];

  const spacing = 6;
  const dotRows: { cx: number; cy: number }[] = [];
  for (let row = 0; row < Math.ceil(600 / spacing); row++) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    for (let col = 0; col < Math.ceil(900 / spacing); col++) {
      dotRows.push({
        cx: col * spacing + offset,
        cy: row * spacing,
      });
    }
  }

  const patternContent =
    fillStyle === "dots" ? (
      <>
        <pattern
          id={patternId}
          width="900"
          height="600"
          patternUnits="userSpaceOnUse"
        >
          {dotRows.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r=".3" fill={color} />
          ))}
        </pattern>
        <linearGradient id={gradientId} {...gradientCoords}>
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="55%" stopColor="white" stopOpacity="0.6" />
          <stop offset="100%" stopColor="white" stopOpacity="0.08" />
        </linearGradient>
        <mask id={compositePatternId}>
          <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        </mask>
      </>
    ) : (
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

  return (
    <div className="w-full h-full rounded-sm overflow-hidden">
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
            <text
              className="hatch-text"
              x="50%"
              y="50%"
              dominantBaseline="central"
              textAnchor="middle"
              fontFamily="'Space Mono', monospace"
              fontWeight="900"
              fontSize="120"
              letterSpacing="0em"
              fill="black"
            >
              {word}
            </text>
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--color-surface-raised, #1a1a1a)"
        />
        {fillStyle === "dots" ? (
          <g mask={`url(#${maskId})`}>
            <rect
              width="100%"
              height="100%"
              fill={`url(#${patternId})`}
              mask={`url(#${compositePatternId})`}
            />
          </g>
        ) : (
          <rect
            width="100%"
            height="100%"
            fill={`url(#${patternId})`}
            mask={`url(#${maskId})`}
          />
        )}
      </svg>
    </div>
  );
}