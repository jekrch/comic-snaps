import { useId, useMemo } from "react";

// Section 

export function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span
          className="text-[10px] font-mono shrink-0"
          style={{ color: "var(--color-accent, #e97d62)", opacity: 0.7 }}
        >
          {number}.
        </span>
        <h3
          className="text-[12px] tracking-[0.04em] m-0"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--color-ink, #e8e0d8)",
          }}
        >
          {title}
        </h3>
      </div>
      <div
        className="text-[11.5px] leading-relaxed pl-5"
        style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
      >
        {children}
      </div>
    </div>
  );
}

// CodeBlock 

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="mt-2 mb-0 p-3 rounded overflow-x-auto text-[10px] leading-[1.6]"
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.04)",
        fontFamily: "var(--font-mono, monospace)",
        color: "rgba(255,255,255,0.55)",
        whiteSpace: "pre",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {children}
    </pre>
  );
}

// Em (accent-colored inline emphasis) */

export function Em({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--color-accent, #e97d62)", fontStyle: "normal" }}>
      {children}
    </span>
  );
}

// Mono (inline code)───── */

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="text-[10.5px] px-1 py-0.5 rounded"
      style={{
        fontFamily: "var(--font-mono, monospace)",
        background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.7)",
      }}
    >
      {children}
    </code>
  );
}

// HatchDivider

export function HatchDivider() {
  const id = useId();
  const patId = `${id}-pat`;
  const maskId = `${id}-mask`;
  const gradId = `${id}-grad`;

  const angle = useMemo(() => {
    const angles = [45, -45, 135, -135];
    return angles[Math.floor(Math.random() * angles.length)];
  }, []);

  return (
    <div
      className="mx-auto my-4"
      style={{ width: 180, height: 14, opacity: 0.35 }}
      aria-hidden="true"
    >
      <svg
        width="180"
        height="14"
        viewBox="0 0 180 14"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id={patId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${angle})`}
          >
            <line
              x1="0" y1="0" x2="0" y2="6"
              stroke="#e97d62"
              strokeWidth="2.5"
            />
          </pattern>
          <linearGradient id={gradId} x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="25%" stopColor="white" stopOpacity="1" />
            <stop offset="75%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={maskId}>
            <rect width="180" height="14" fill={`url(#${gradId})`} />
          </mask>
        </defs>
        <rect
          width="180"
          height="14"
          fill={`url(#${patId})`}
          mask={`url(#${maskId})`}
        />
      </svg>
    </div>
  );
}

// DistanceBar

export function DistanceBar({
  closeDist,
  farDist,
  anchorLabel,
  closeLabel,
  farLabel,
  maxVal,
  unit = "",
}: {
  closeDist: number;
  farDist: number;
  anchorLabel: string;
  closeLabel: string;
  farLabel: string;
  maxVal?: number;
  unit?: string;
}) {
  const max = maxVal ?? Math.max(farDist * 1.15, 1);
  const closePct = Math.min((closeDist / max) * 100, 100);
  const farPct = Math.min((farDist / max) * 100, 100);

  const fmtDist = (d: number) => (d < 1 ? d.toFixed(4) : d.toFixed(1));

  const W = 320;
  const CHAR_W = 5.4;
  const MIN_GAP = 8;

  const scaleY = 10;
  const barY = scaleY + 6;
  const barH = 6;
  const barBot = barY + barH;
  const leaderStartY = barBot + 2;

  const anchorX = 0;
  const closeX = (closePct / 100) * W;
  const farX = (farPct / 100) * W;

  const rawLabels = [
    { key: "anchor", barPosX: anchorX, text: anchorLabel, dist: null as number | null, color: "var(--color-ink, #e8e0d8)", opacity: 0.5, lineOpacity: 0.35 },
    { key: "close", barPosX: closeX, text: closeLabel, dist: closeDist, color: "var(--color-accent, #e97d62)", opacity: 1, lineOpacity: 0.5 },
    { key: "far", barPosX: farX, text: farLabel, dist: farDist, color: "rgba(255,255,255,0.3)", opacity: 1, lineOpacity: 0.3 },
  ].sort((a, b) => a.barPosX - b.barPosX);

  const labelWidths = rawLabels.map((l) => {
    const distText = l.dist !== null ? ` (${fmtDist(l.dist)}${unit})` : "";
    return (l.text.length + distText.length) * CHAR_W;
  });


  const textXs: number[] = [];
  for (let i = 0; i < rawLabels.length; i++) {
    const idealX = rawLabels[i].barPosX;
    if (i === 0) {
      textXs.push(Math.max(0, idealX));
    } else {
      const prevRight = textXs[i - 1] + labelWidths[i - 1];
      textXs.push(Math.max(idealX, prevRight + MIN_GAP));
    }
  }

  const labelAnchors: ("left" | "right")[] = textXs.map((x, i) =>
    x + labelWidths[i] > W ? "right" : "left"
  );

  for (let i = textXs.length - 1; i >= 0; i--) {
    if (labelAnchors[i] === "right") {
      const rightEdge =
        i < textXs.length - 1 && labelAnchors[i + 1] === "right"
          ? textXs[i + 1] - labelWidths[i + 1] - MIN_GAP
          : W;
      textXs[i] = rightEdge - labelWidths[i];
      if (textXs[i] >= rawLabels[i].barPosX) {
        labelAnchors[i] = "left";
        textXs[i] = rawLabels[i].barPosX;
      }
    }
  }

  const rowH = 16;
  const row0Y = leaderStartY + 14;
  const totalH = row0Y + (rawLabels.length - 1) * rowH + 8;

  const gradId = `distBarGrad-${anchorLabel.slice(0, 6).replace(/\W/g, "")}`;

  return (
    <div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${totalH}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(232,164,74,0.5)" />
            <stop offset="100%" stopColor="rgba(232,164,74,0.08)" />
          </linearGradient>
        </defs>

        <text
          x="0" y={scaleY}
          fontSize="8" fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.15)"
        >
          0 (identical)
        </text>
        <text
          x={W} y={scaleY}
          textAnchor="end" fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.15)"
        >
          {max < 2 ? "1" : max.toFixed(0)} (very different)
        </text>

        <rect
          x="0" y={barY} width={W} height={barH} rx="3"
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.06)" strokeWidth="1"
        />
        <rect
          x="0" y={barY} width={farX} height={barH} rx="3"
          fill={`url(#${gradId})`}
        />
        <rect
          x={closeX - 1} y={barY} width="2" height={barH} rx="1"
          fill="var(--color-accent, #e97d62)"
        />
        <rect
          x={farX - 1} y={barY} width="2" height={barH} rx="1"
          fill="rgba(255,255,255,0.25)"
        />

        {rawLabels.map((label, i) => {
          const anchor = labelAnchors[i];
          const leftX = textXs[i];
          const rightX = leftX + labelWidths[i];
          const textBaselineY = row0Y + i * rowH;

          const lineTopX = label.barPosX;
          const lineTopY = leaderStartY;
          const lineBotY = textBaselineY - 9;
          const lineBotX = anchor === "right" ? rightX + 2 : leftX - 2;

          return (
            <g key={label.key}>
              <line
                x1={lineTopX} y1={lineTopY}
                x2={lineBotX} y2={lineBotY}
                stroke={label.color} strokeWidth="0.75"
                opacity={label.lineOpacity}
              />
              <text
                x={anchor === "right" ? rightX : leftX}
                y={textBaselineY}
                textAnchor={anchor === "right" ? "end" : "start"}
                fontSize="8" fontFamily="var(--font-mono, monospace)"
                fill={label.color} opacity={label.opacity}
              >
                {label.text}
                {label.dist !== null && (
                  <tspan opacity="0.7">
                    {" "}({fmtDist(label.dist)}{unit})
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}