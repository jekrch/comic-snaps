import { useId, useMemo } from "react";

const WORDS = ["SNAPS"];
const ROTATIONS = [45, 135];
const COLORS = ["#e97d62", "#7A8B2A"];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function HatchFiller() {
  const patternId = useId();
  const maskId = useId();

  const { word, rotation, color, twist } = useMemo(() => {
    const angle = (Math.random() * 6 - 3); // -3 to 3 degrees
    const scale = 1.05 + Math.random() * 0.1; // 1.05 to 1.15
    return {
      word: pickRandom(WORDS),
      rotation: pickRandom(ROTATIONS),
      color: pickRandom(COLORS),
      twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
    };
  }, []);

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
        <rect width="100%" height="100%" fill="var(--color-surface-raised, #1a1a1a)" />
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