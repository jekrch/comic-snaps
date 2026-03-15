import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Panel } from "../types";
import { MetricKey } from "./graph/similarityConfig";

/* Types */

interface NeighborInfo {
  panel: Panel;
  distance: number;
}

interface Props {
  metric: MetricKey;
  anchorPanel: Panel;
  neighbors: NeighborInfo[];
  onClose: () => void;
}

/* Metric display metadata */

const METRIC_INFO: Record<
  MetricKey,
  { name: string; family: string; oneLiner: string }
> = {
  "embedding-siglip": {
    name: "SigLIP",
    family: "Vision-language embedding",
    oneLiner:
      "SigLIP converts each image into a list of numbers that captures its meaning: what's depicted, the mood, the composition. Two images with similar meaning end up with similar lists.",
  },
  "embedding-dino": {
    name: "DINOv2",
    family: "Self-supervised vision embedding",
    oneLiner:
      "DINOv2 converts each image into a list of numbers that captures its visual structure: shapes, spatial layout, and texture, without understanding what things \"are.\"",
  },
  "embedding-gram": {
    name: "VGG-16 Gram Matrix",
    family: "Style / texture embedding",
    oneLiner:
      "VGG-16 Gram matrices convert each image into a list of numbers that captures artistic style: line quality, hatching patterns, ink texture, and tonal rendering.",
  },
  color: {
    name: "Color Palette",
    family: "CIELAB dominant color",
    oneLiner:
      "Color distance compares the dominant colors of two images using CIELAB, a color space designed to match how humans perceive color differences.",
  },
  phash: {
    name: "Perceptual Hash",
    family: "Luminance fingerprint",
    oneLiner:
      "pHash reduces each image to a compact fingerprint based on its brightness patterns, then counts how many bits differ between two fingerprints.",
  },
};

/* Embedding dimension by metric */

const EMBEDDING_DIM: Record<string, number> = {
  "embedding-siglip": 768,
  "embedding-dino": 768,
  "embedding-gram": 512,
};

/* Helpers */

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

/* Hatch divider (matches InfoModal) */

function HatchDivider() {
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

/* Angle diagram: arrows from a shared origin */

function AngleDiagram({
  closeDist,
  farDist,
}: {
  closeDist: number;
  farDist: number;
}) {
  const closeAngle = Math.acos(Math.max(-1, Math.min(1, 1 - closeDist)));
  const farAngle = Math.acos(Math.max(-1, Math.min(1, 1 - farDist)));

  const cx = 90;
  const cy = 110;
  const r = 80;

  const anchorAngle = -Math.PI / 2;

  const closeRad = anchorAngle + closeAngle;
  const farRad = anchorAngle + farAngle;

  const arrow = (
    angle: number,
    color: string,
    label: string,
    labelSide: "left" | "right"
  ) => {
    const ex = cx + r * Math.cos(angle);
    const ey = cy + r * Math.sin(angle);

    const headLen = 7;
    const headAngle = 0.4;
    const h1x = ex - headLen * Math.cos(angle - headAngle);
    const h1y = ey - headLen * Math.sin(angle - headAngle);
    const h2x = ex - headLen * Math.cos(angle + headAngle);
    const h2y = ey - headLen * Math.sin(angle + headAngle);

    const labelR = r + 14;
    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);

    return (
      <>
        <line
          x1={cx} y1={cy} x2={ex} y2={ey}
          stroke={color} strokeWidth="1.5" strokeLinecap="round"
        />
        <polyline
          points={`${h1x},${h1y} ${ex},${ey} ${h2x},${h2y}`}
          fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"
        />
        <text
          x={lx} y={ly}
          textAnchor={labelSide === "left" ? "end" : "start"}
          dominantBaseline="middle"
          fill={color}
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
        >
          {label}
        </text>
      </>
    );
  };

  const arc = (
    fromRad: number,
    toRad: number,
    arcR: number,
    color: string,
    dashed?: boolean
  ) => {
    const steps = 24;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = fromRad + (toRad - fromRad) * (i / steps);
      points.push(`${cx + arcR * Math.cos(t)},${cy + arcR * Math.sin(t)}`);
    }
    return (
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeDasharray={dashed ? "2,2" : "none"}
        opacity={0.5}
      />
    );
  };

  return (
    <div className="flex justify-center my-3">
      <svg
        width="200"
        height="140"
        viewBox="0 0 200 140"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Diagram showing embedding vectors as arrows from a common origin, with the angle between them representing distance"
      >
        {arc(anchorAngle, closeRad, 30, "var(--color-accent, #e97d62)")}
        {arc(anchorAngle, farRad, 45, "rgba(255,255,255,0.25)", true)}

        <circle cx={cx} cy={cy} r="2.5" fill="rgba(255,255,255,0.3)" />

        {arrow(anchorAngle, "var(--color-ink, #e8e0d8)", "anchor", "left")}
        {arrow(closeRad, "var(--color-accent, #e97d62)", "closest", "right")}
        {arrow(farRad, "rgba(255,255,255,0.35)", "furthest", "right")}

        <text
          x={cx + 34 * Math.cos(anchorAngle + closeAngle / 2)}
          y={cy + 34 * Math.sin(anchorAngle + closeAngle / 2)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--color-accent, #e97d62)"
          fontSize="7.5"
          fontFamily="var(--font-mono, monospace)"
          opacity="0.8"
        >
          {(closeAngle * 180 / Math.PI).toFixed(1)}°
        </text>
      </svg>
    </div>
  );
}

// CIELAB a*/b* plane diagram — with label collision avoidance 

function CielabDiagram({
  anchorLab,
  closeLab,
  farLab,
  anchorLabel,
  closeLabel,
  farLabel,
}: {
  anchorLab: [number, number, number];
  closeLab: [number, number, number];
  farLab: [number, number, number];
  anchorLabel: string;
  closeLabel: string;
  farLabel: string;
}) {
  const points = [anchorLab, closeLab, farLab];
  const aVals = points.map((p) => p[1]);
  const bVals = points.map((p) => p[2]);

  const aMin = Math.min(...aVals);
  const aMax = Math.max(...aVals);
  const bMin = Math.min(...bVals);
  const bMax = Math.max(...bVals);

  const pad = Math.max((aMax - aMin) * 0.45, (bMax - bMin) * 0.45, 20);
  const domainAMin = aMin - pad;
  const domainAMax = aMax + pad;
  const domainBMin = bMin - pad;
  const domainBMax = bMax + pad;

  const W = 220;
  const H = 180;
  const margin = { top: 18, right: 14, bottom: 26, left: 32 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const scaleA = (a: number) =>
    margin.left + ((a - domainAMin) / (domainAMax - domainAMin)) * plotW;
  const scaleB = (b: number) =>
    margin.top + ((domainBMax - b) / (domainBMax - domainBMin)) * plotH;

  function labToDisplayRgb(lab: [number, number, number]): string {
    const [L, a, b] = lab;
    let fy = (L + 16) / 116;
    let fx = a / 500 + fy;
    let fz = fy - b / 200;
    const delta = 6 / 29;
    const xn = 0.9505, yn = 1.0, zn = 1.089;
    const invF = (t: number) =>
      t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);
    const X = xn * invF(fx);
    const Y = yn * invF(fy);
    const Z = zn * invF(fz);
    let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    let bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
    const gamma = (c: number) =>
      c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    const clamp = (c: number) =>
      Math.max(0, Math.min(255, Math.round(gamma(c) * 255)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(bl)})`;
  }

  const anchorXY = [scaleA(anchorLab[1]), scaleB(anchorLab[2])] as const;
  const closeXY = [scaleA(closeLab[1]), scaleB(closeLab[2])] as const;
  const farXY = [scaleA(farLab[1]), scaleB(farLab[2])] as const;

  // --- Label placement with collision avoidance ---
  const LABEL_W = 58;
  const LABEL_H = 10;
  const DOT_R = 8;

  interface LabelPlacement {
    x: number;
    y: number;
    anchor: "start" | "middle" | "end";
  }

  function getCandidates(px: number, py: number): LabelPlacement[] {
    return [
      { x: px + DOT_R, y: py + 3, anchor: "start" as const },
      { x: px - DOT_R, y: py + 3, anchor: "end" as const },
      { x: px + DOT_R, y: py - DOT_R, anchor: "start" as const },
      { x: px - DOT_R, y: py - DOT_R, anchor: "end" as const },
      { x: px + DOT_R, y: py + DOT_R + LABEL_H, anchor: "start" as const },
      { x: px - DOT_R, y: py + DOT_R + LABEL_H, anchor: "end" as const },
      { x: px, y: py - DOT_R - 2, anchor: "middle" as const },
      { x: px, y: py + DOT_R + LABEL_H, anchor: "middle" as const },
    ];
  }

  function labelBBox(placement: LabelPlacement) {
    let x1: number, x2: number;
    if (placement.anchor === "start") {
      x1 = placement.x;
      x2 = placement.x + LABEL_W;
    } else if (placement.anchor === "end") {
      x1 = placement.x - LABEL_W;
      x2 = placement.x;
    } else {
      x1 = placement.x - LABEL_W / 2;
      x2 = placement.x + LABEL_W / 2;
    }
    return { x1, y1: placement.y - LABEL_H, x2, y2: placement.y };
  }

  function bboxOverlap(
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number }
  ): number {
    const overlapX = Math.max(
      0,
      Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
    );
    const overlapY = Math.max(
      0,
      Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
    );
    return overlapX * overlapY;
  }

  function outOfBoundsPenalty(bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }): number {
    let penalty = 0;
    if (bbox.x1 < 2) penalty += (2 - bbox.x1) * 10;
    if (bbox.x2 > W - 2) penalty += (bbox.x2 - (W - 2)) * 10;
    if (bbox.y1 < 2) penalty += (2 - bbox.y1) * 10;
    if (bbox.y2 > H - 2) penalty += (bbox.y2 - (H - 2)) * 10;
    return penalty;
  }

  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const dotInfos = [
    { xy: anchorXY, label: anchorLabel },
    { xy: closeXY, label: closeLabel },
    { xy: farXY, label: farLabel },
  ];
  const labelPlacements: LabelPlacement[] = [];

  for (const dot of dotInfos) {
    const candidates = getCandidates(dot.xy[0], dot.xy[1]);
    let bestCandidate = candidates[0];
    let bestCost = Infinity;

    for (const candidate of candidates) {
      const bbox = labelBBox(candidate);
      let cost = outOfBoundsPenalty(bbox);
      for (const existing of placed) {
        cost += bboxOverlap(bbox, existing) * 5;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestCandidate = candidate;
      }
    }

    placed.push(labelBBox(bestCandidate));
    labelPlacements.push(bestCandidate);
  }

  const dotData = [
    {
      xy: anchorXY,
      lab: anchorLab,
      label: anchorLabel,
      ring: "var(--color-ink, #e8e0d8)",
      placement: labelPlacements[0],
    },
    {
      xy: closeXY,
      lab: closeLab,
      label: closeLabel,
      ring: "var(--color-accent, #e97d62)",
      placement: labelPlacements[1],
    },
    {
      xy: farXY,
      lab: farLab,
      label: farLabel,
      ring: "rgba(255,255,255,0.35)",
      placement: labelPlacements[2],
    },
  ];

  return (
    <div className="flex justify-center my-3">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="CIELAB a*b* plane showing anchor and neighbor colors with distance lines"
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotW}
          height={plotH}
          fill="rgba(0,0,0,0.25)"
          rx="2"
        />

        {[-60, -30, 0, 30, 60].map((v) => {
          if (v < domainAMin || v > domainAMax) return null;
          const x = scaleA(v);
          return (
            <line
              key={`ga${v}`}
              x1={x} y1={margin.top} x2={x} y2={margin.top + plotH}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
            />
          );
        })}
        {[-60, -30, 0, 30, 60].map((v) => {
          if (v < domainBMin || v > domainBMax) return null;
          const y = scaleB(v);
          return (
            <line
              key={`gb${v}`}
              x1={margin.left} y1={y} x2={margin.left + plotW} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
            />
          );
        })}

        <line
          x1={anchorXY[0]} y1={anchorXY[1]}
          x2={closeXY[0]} y2={closeXY[1]}
          stroke="var(--color-accent, #e97d62)"
          strokeWidth="1"
          strokeDasharray="3,2"
          opacity="0.6"
        />

        <line
          x1={anchorXY[0]} y1={anchorXY[1]}
          x2={farXY[0]} y2={farXY[1]}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
          strokeDasharray="3,2"
          opacity="0.5"
        />

        {dotData.map(({ xy, lab, label, ring, placement }, i) => (
          <g key={i}>
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r="6"
              fill={labToDisplayRgb(lab as [number, number, number])}
            />
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r="6"
              fill="none"
              stroke={ring}
              strokeWidth="1.5"
            />
            <text
              x={placement.x}
              y={placement.y}
              textAnchor={placement.anchor}
              fontSize="7"
              fontFamily="var(--font-mono, monospace)"
              fill={ring}
            >
              {label}
            </text>
          </g>
        ))}

        <text
          x={margin.left + plotW / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.25)"
        >
          a* (green → red)
        </text>
        <text
          x={8}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.25)"
          transform={`rotate(-90, 8, ${margin.top + plotH / 2})`}
        >
          b* (blue → yellow)
        </text>
      </svg>
    </div>
  );
}

/* Explanation sections by metric */

function EmbeddingExplanation({
  metric,
  info,
  closest,
  furthest,
  anchorPanel,
}: {
  metric: MetricKey;
  info: (typeof METRIC_INFO)[MetricKey];
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const dim = EMBEDDING_DIM[metric] ?? 768;
  const closeDist = closest.distance;
  const farDist = furthest.distance;
  const closeSim = 1 - closeDist;
  const farSim = 1 - farDist;

  return (
    <>
      <Section number={1} title="Turn each image into a direction">
        <p className="m-0">
          A neural network looks at each panel and produces {dim} numbers.
          These aren't just a list; they define an <Em>arrow</Em> (or
          vector) pointing from the origin through {dim}-dimensional space.
          Each arrow's direction encodes what the model sees in that image
          {metric === "embedding-siglip"
            ? ": subject, composition, mood, all compressed into orientation."
            : metric === "embedding-dino"
            ? ": shapes, spatial layout, texture, all compressed into orientation."
            : ": line quality, hatching, ink texture, all compressed into orientation."}
        </p>
        <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  [0.0312, -0.1450, 0.0821, …, -0.0044]
"${truncate(closest.panel.title, 20)}"  →  [0.0298, -0.1510, 0.0790, …,  0.0112]

        ${dim} numbers each → a direction through ${dim}D space`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Before comparing, every arrow is scaled to the same length (a step
          called <Em>normalization</Em>). This is important because the raw
          magnitude of the vector is an artifact of how strongly the network's
          neurons activated, not a meaningful measure of what is <Em>in</Em> the
          image. An overexposed photo and a dim one might produce vectors of
          different lengths that point the same way. Normalizing removes that
          noise so only the direction, the part that encodes actual content,
          is used for comparison.
        </p>
      </Section>

      <Section number={2} title="Measure the angle between arrows">
        <p className="m-0">
          Two images that look similar to the model get arrows pointing nearly
          the same way. To measure how aligned two arrows are, we compute
          their <Em>dot product</Em>: multiply matching numbers and add
          everything up.
        </p>
        <CodeBlock>
{`similarity  =  a[1]×b[1]  +  a[2]×b[2]  +  …  +  a[${dim}]×b[${dim}]

            =  (0.0312 × 0.0298)
             + (-0.1450 × -0.1510)
             + (0.0821 × 0.0790)
             + …

            ≈  ${fmt(closeSim)}      ← similarity score`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Because the arrows are normalized, this dot product equals
          the <Em>cosine</Em> of the angle between them. Cosine is a
          function from trigonometry that takes an angle and returns a number
          between −1 and 1. When two arrows point in the same direction
          the angle is 0° and the cosine is <Mono>1.0</Mono>. 
          </p>
          <p className="mt-2">As the arrows
          spread apart the angle grows and the cosine falls
          toward <Mono>0</Mono> (perpendicular)
          or <Mono>−1</Mono> (opposite). This is why the technique is
          called <Em>cosine similarity</Em>: it uses the cosine to turn an
          angle into a single similarity score.
          </p>

        <AngleDiagram closeDist={closeDist} farDist={farDist} />

        <p
          className="mt-1 mb-0 text-center text-[9.5px]"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          2D projection; the real arrows live in {dim} dimensions
        </p>
      </Section>

      <Section number={3} title="From similarity to distance">
        <p className="m-0">
          A similarity score is convenient, but for sorting we want
          a <Em>distance</Em> where smaller = more similar. The conversion is
          simple: subtract the similarity from 1.
        </p>
        <CodeBlock>
{`distance  =  1  −  similarity

closest neighbor:   1 − ${fmt(closeSim)}  =  ${fmt(closeDist)}
furthest neighbor:  1 − ${fmt(farSim)}  =  ${fmt(farDist)}`}
        </CodeBlock>

        <p className="mt-2 mb-0">
          A distance of <Mono>0</Mono> means two arrows point in exactly
          the same direction; the images are identical
          to {info.name}. A distance of <Mono>1</Mono> means the arrows are
          perpendicular (nothing in common). In practice, most comic panels
          land somewhere in between.
        </p>

        <div className="mt-3">
          <DistanceBar
            closeDist={closeDist}
            farDist={farDist}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
          />
        </div>

        <p className="mt-3 mb-0">
          The <Em>closest</Em> neighbor to{" "}
          <Mono>{truncate(anchorPanel.title, 20)}</Mono>{" "}
          is{" "}
          <Mono>{truncate(closest.panel.title, 20)}</Mono>{" "}
          at distance <Mono>{fmt(closeDist)}</Mono>. The{" "}
          <Em>furthest</Em> shown is{" "}
          <Mono>{truncate(furthest.panel.title, 20)}</Mono>{" "}
          at <Mono>{fmt(farDist)}</Mono>.
        </p>
      </Section>
    </>
  );
}

function ColorExplanation({
  closest,
  furthest,
  anchorPanel,
}: {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const anchorColor = anchorPanel.dominantColors?.[0];
  const closeColor = closest.panel.dominantColors?.[0];
  const farColor = furthest.panel.dominantColors?.[0];

  return (
    <>
      <Section number={1} title="Why not just use RGB?">
        <p className="m-0">
          Computer screens mix red, green, and blue light to make colors, but
          the human eye isn't equally sensitive to each channel. Two colors can
          be far apart in RGB numbers yet look almost identical, or close in
          RGB yet appear strikingly different. <Em>CIELAB</Em> is a color
          space specifically designed so that equal numeric distances correspond
          to equal <Em>perceived</Em> differences. If two colors are 10 units
          apart in CIELAB, they look about as different as any other pair that's
          10 units apart, no matter where they sit on the spectrum.
        </p>
      </Section>

      <Section number={2} title="The three CIELAB channels">
        <p className="m-0">
          CIELAB describes a color with three numbers:
        </p>
        <div
          className="mt-2 mb-0 text-[10.5px] leading-[1.8]"
          style={{
            fontFamily: "var(--font-mono, monospace)",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>L*</span>{" "}
            — lightness, from <span style={{ opacity: 0.7 }}>0</span> (pure
            black) to <span style={{ opacity: 0.7 }}>100</span> (pure white)
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>a*</span>{" "}
            — the green‑red axis: negative values are green, positive are red
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>b*</span>{" "}
            — the blue‑yellow axis: negative values are blue, positive are yellow
          </div>
        </div>
        <p className="mt-2 mb-0">
          Together these form a 3D space. Any color lands at a specific point
          inside it. Two panels' dominant colors become two points, and the
          question becomes: how far apart are they?
        </p>

        {anchorColor && closeColor && farColor && (
          <>
            <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  L*=${fmt(anchorColor[0], 1)}  a*=${fmt(anchorColor[1], 1)}  b*=${fmt(anchorColor[2], 1)}
"${truncate(closest.panel.title, 20)}"  →  L*=${fmt(closeColor[0], 1)}  a*=${fmt(closeColor[1], 1)}  b*=${fmt(closeColor[2], 1)}
"${truncate(furthest.panel.title, 20)}"  →  L*=${fmt(farColor[0], 1)}  a*=${fmt(farColor[1], 1)}  b*=${fmt(farColor[2], 1)}`}
            </CodeBlock>

            <CielabDiagram
              anchorLab={anchorColor as [number, number, number]}
              closeLab={closeColor as [number, number, number]}
              farLab={farColor as [number, number, number]}
              anchorLabel={truncate(anchorPanel.title, 14)}
              closeLabel={truncate(closest.panel.title, 14)}
              farLabel={truncate(furthest.panel.title, 14)}
            />
            <p
              className="mt-1 mb-0 text-center text-[9.5px]"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              a*/b* plane (lightness L* is the third axis, not shown)
            </p>
          </>
        )}
      </Section>

      <Section number={3} title="Color vs. black-and-white">
        <p className="m-0">
          Before sorting, panels are split into two groups: <Em>chromatic</Em>{" "}
          (color) and <Em>achromatic</Em> (black-and-white). This matters
          because even grayscale pixels can have faint chroma values in CIELAB —
          a warm paper tint or a slight scanner cast is enough to give a
          technically "gray" pixel a nonzero position on the a*/b* axes. Without
          this split, black-and-white panels would land somewhere on the hue
          spectrum and break up the flow of actual color panels.
        </p>
        <p className="mt-2 mb-0">
          The split uses a <Em>colorfulness score</Em> derived from the spread
          of the a* and b* channels across the image. Panels with very little
          spread (below a threshold of about 5) are classified as achromatic.
          This is an interesting case where "colorfulness" is more of a human,
          perceptual judgment than a strict property of the light — a warm-toned
          newsprint scan might technically contain color, but it reads as
          black-and-white to the eye.
        </p>
        <p className="mt-2 mb-0">
          This partition also applies to the similarity graph: a color panel
          will only ever show other color panels as neighbors, and likewise for
          black-and-white. Cross-group comparisons are excluded entirely.
        </p>
      </Section>

      <Section number={4} title="Hue-angle sorting within each group">
        <p className="m-0">
          Within each group, panels are sorted by the <Em>hue angle</Em> of
          their most dominant color. The hue angle is calculated
          from the a* and b* channels using the arctangent function, which
          returns an angle around the color wheel. Reds sit near 0°,
          yellows around 90°, greens near 180°, and blues near 270°.
        </p>
        <CodeBlock>
{`hue  =  atan2( b*, a* )

       ← reds → oranges → yellows → greens → blues → purples →`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Sorting by this angle produces a natural spectrum walk: reds flow
          into oranges, then yellows, greens, and so on. Lightness is used as
          a tiebreaker when two panels have a similar hue, so darker and lighter
          variants of the same color stay near each other.
        </p>
      </Section>

      <Section number={5} title="Measuring distance between neighbors">
        <p className="m-0">
          The similarity graph uses a different measure than the sort order: the
          straight-line <Em>Euclidean distance</Em> through the full 3D CIELAB
          space between two panels' dominant colors.
        </p>
        {anchorColor && closeColor && (
          <CodeBlock>
{`distance  =  √( ΔL*² + Δa*² + Δb*² )

closest:   √( ${fmt(anchorColor[0] - closeColor[0], 1)}² + ${fmt(anchorColor[1] - closeColor[1], 1)}² + ${fmt(anchorColor[2] - closeColor[2], 1)}² )  ≈  ${fmt(closest.distance, 2)}`}
          </CodeBlock>
        )}
        <p className="mt-2 mb-0">
          The dashed lines in the diagram above are this distance projected
          onto the a*/b* plane. The real distance also includes the L*
          (lightness) difference, which is why the numbers may not perfectly
          match the 2D picture.
        </p>
        <p className="mt-2 mb-0">
          The distance is computed across all palette entries, not just the
          dominant color. Each entry is weighted by its <Em>perceptual
          importance</Em>: a combination of chroma (how saturated the color is)
          and lightness (peaking at mid-tones). Near-white and near-black
          colors, the kind that come from page margins, gutters, and panel
          borders, are heavily discounted so that the actual artwork colors
          drive the result.
        </p>
      </Section>

      <Section number={6} title="Reading the result">
        <p className="m-0">
          Smaller numbers mean the colors are more alike to the human eye.
          As a rough guide: a distance under ~10 is a very close match (most
          people would call them "the same color"), 10–30 is noticeably
          different, and above ~50 is quite far apart.
        </p>
        <div className="mt-3">
          <DistanceBar
            closeDist={closest.distance}
            farDist={furthest.distance}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
            maxVal={Math.max(furthest.distance * 1.2, 80)}
          />
        </div>
      </Section>
    </>
  );
}

function PhashExplanation({
  closest,
  furthest,
  anchorPanel,
}: {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const anchorHash = anchorPanel.phash ? String(anchorPanel.phash) : "a3c1e7…";
  const closeHash = closest.panel.phash
    ? String(closest.panel.phash)
    : "a3c1e6…";

  return (
    <>
      <Section number={1} title="Shrink and simplify">
        <p className="m-0">
          The image is scaled way down (to about 32×32), converted to grayscale,
          and run through a frequency transform that captures the big-picture
          brightness patterns while ignoring fine detail. The result is a compact
          hash, a short string of hex characters.
        </p>
        <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  ${anchorHash.slice(0, 16)}…
"${truncate(closest.panel.title, 20)}"  →  ${closeHash.slice(0, 16)}…`}
        </CodeBlock>
      </Section>

      <Section number={2} title="Count the differences">
        <p className="m-0">
          Each hex character encodes 4 bits. To compare two hashes, we look at
          every bit and count how many differ. This count is the{" "}
          <Em>Hamming distance</Em>.
        </p>
        <CodeBlock>
{`hash A:  1010 0011 1100 …
hash B:  1010 0010 1100 …
              ↑
         differences = ${closest.distance.toFixed(0)} (closest)
                     = ${furthest.distance.toFixed(0)} (furthest)`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Zero differing bits would mean two images are perceptually identical.
          The more bits differ, the less the images share in terms of overall
          brightness layout.
        </p>
      </Section>

      <Section number={3} title="Reading the result">
        <p className="m-0">
          pHash is best at finding near-duplicates (distances under ~10). For
          very different images, the distances cluster together and don't tell
          you much, which is why this mode is mostly useful for spotting close
          matches.
        </p>
        <div className="mt-3">
          <DistanceBar
            closeDist={closest.distance}
            farDist={furthest.distance}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
            maxVal={64}
            unit=" bits"
          />
        </div>
      </Section>
    </>
  );
}

/* Tiny reusable pieces */

function Section({
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

function CodeBlock({ children }: { children: string }) {
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

function Em({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--color-accent, #e97d62)", fontStyle: "normal" }}>
      {children}
    </span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
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

function DistanceBar({
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

  const fmtDist = (d: number) =>
    d < 1 ? fmt(d) : d.toFixed(1);

  const W = 320;
  const CHAR_W = 5.4; // approximate width of a character at 9px mono
  const MIN_GAP = 8;  // minimum horizontal gap between label edges

  // Layout zones
  const scaleY = 10;           // scale labels baseline
  const barY = scaleY + 6;     // bar top
  const barH = 6;
  const barBot = barY + barH;
  const leaderStartY = barBot + 2;

  // Bar positions
  const anchorX = 0;
  const closeX = (closePct / 100) * W;
  const farX = (farPct / 100) * W;

  // Build label entries sorted by bar position
  const rawLabels = [
    { key: "anchor", barPosX: anchorX, text: anchorLabel, dist: null as number | null, color: "var(--color-ink, #e8e0d8)", opacity: 0.5, lineOpacity: 0.35 },
    { key: "close", barPosX: closeX, text: closeLabel, dist: closeDist, color: "var(--color-accent, #e97d62)", opacity: 1, lineOpacity: 0.5 },
    { key: "far", barPosX: farX, text: farLabel, dist: farDist, color: "rgba(255,255,255,0.3)", opacity: 1, lineOpacity: 0.3 },
  ].sort((a, b) => a.barPosX - b.barPosX);

  // Compute text widths and spread labels horizontally so they don't overlap.
  // Each label is left-aligned at a computed textX. We start by placing each
  // label at its bar position, then push rightward if it would collide with
  // the previous label.
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

  // Determine if each label overflows the viewBox. If so, right-align it
  // so its right edge sits at W, and flip the leader line to attach to
  // the right end of the text.
  const labelAnchors: ("left" | "right")[] = textXs.map((x, i) => {
    return x + labelWidths[i] > W ? "right" : "left";
  });

  // For right-anchored labels, recompute textX as the right edge position.
  // We also need to re-run collision avoidance backwards: ensure a
  // right-anchored label doesn't overlap the one before it.
  for (let i = textXs.length - 1; i >= 0; i--) {
    if (labelAnchors[i] === "right") {
      const rightEdge = i < textXs.length - 1 && labelAnchors[i + 1] === "right"
        ? (textXs[i + 1] - labelWidths[i + 1]) - MIN_GAP
        : W;
      textXs[i] = rightEdge - labelWidths[i];
      // If pushing left caused it to fit normally, keep it left-anchored
      if (textXs[i] >= rawLabels[i].barPosX) {
        labelAnchors[i] = "left";
        textXs[i] = rawLabels[i].barPosX;
      }
    }
  }

  // Each label row is spaced 16px apart vertically
  const rowH = 16;
  const row0Y = leaderStartY + 14;
  const totalH = row0Y + (rawLabels.length - 1) * rowH + 8;

  // Unique gradient ID to avoid collisions when multiple bars render
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

        {/* Scale labels — above the bar */}
        <text
          x="0"
          y={scaleY}
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.15)"
        >
          0 (identical)
        </text>
        <text
          x={W}
          y={scaleY}
          textAnchor="end"
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.15)"
        >
          {max < 2 ? "1" : max.toFixed(0)} (very different)
        </text>

        {/* Bar background */}
        <rect
          x="0" y={barY} width={W} height={barH} rx="3"
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />

        {/* Filled portion up to furthest */}
        <rect
          x="0" y={barY} width={farX} height={barH} rx="3"
          fill={`url(#${gradId})`}
        />

        {/* Closest marker */}
        <rect
          x={closeX - 1} y={barY} width="2" height={barH} rx="1"
          fill="var(--color-accent, #e97d62)"
        />

        {/* Furthest marker */}
        <rect
          x={farX - 1} y={barY} width="2" height={barH} rx="1"
          fill="rgba(255,255,255,0.25)"
        />

        {/* Leader lines + labels */}
        {rawLabels.map((label, i) => {
          const anchor = labelAnchors[i];
          const leftX = textXs[i];
          const rightX = leftX + labelWidths[i];
          const textBaselineY = row0Y + i * rowH;

          // Single straight leader line from bar position to the near
          // edge of the text.
          const lineTopX = label.barPosX;
          const lineTopY = leaderStartY;
          const lineBotY = textBaselineY - 9;
          const lineBotX = anchor === "right" ? rightX + 2 : leftX - 2;

          return (
            <g key={label.key}>
              {/* Straight leader line */}
              <line
                x1={lineTopX} y1={lineTopY}
                x2={lineBotX} y2={lineBotY}
                stroke={label.color}
                strokeWidth="0.75"
                opacity={label.lineOpacity}
              />
              {/* Label text */}
              <text
                x={anchor === "right" ? rightX : leftX}
                y={textBaselineY}
                textAnchor={anchor === "right" ? "end" : "start"}
                fontSize="9"
                fontFamily="var(--font-mono, monospace)"
                fill={label.color}
                opacity={label.opacity}
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

function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}

/* Modal */

export default function MetricExplainerModal({
  metric,
  anchorPanel,
  neighbors,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false);
  const info = METRIC_INFO[metric];

  const sorted = useMemo(
    () => [...neighbors].sort((a, b) => a.distance - b.distance),
    [neighbors]
  );
  const closest = sorted[0] ?? null;
  const furthest = sorted[sorted.length - 1] ?? null;

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose, closing]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  if (!closest || !furthest) return null;

  const isEmbedding =
    metric === "embedding-siglip" ||
    metric === "embedding-dino" ||
    metric === "embedding-gram";

  return (
    <div
      className="fixed z-[70] flex items-center justify-center !mx-2"
      style={{
        top: "-100px",
        left: 0,
        right: 0,
        bottom: "-100px",
        overscrollBehavior: "none",
        touchAction: "none",
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }}
      onTouchMove={(e) => e.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label={`How ${info.name} similarity works`}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.85)",
          animation: closing
            ? "scrimOut 260ms ease-out forwards"
            : "scrimIn 220ms ease-out forwards",
        }}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-[500px] mx-5 rounded-md
                   border border-[var(--color-border,rgba(74,71,69,0.25))]
                   bg-[var(--color-surface-raised,#1a1816)]"
        style={{
          maxHeight: "min(85vh, 720px)",
          display: "flex",
          flexDirection: "column",
          animation: closing
            ? "modalExit 230ms ease-out forwards"
            : "modalEnter 230ms ease-out forwards",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div
          className="shrink-0 px-5 pt-5 pb-3 border-b"
          style={{ borderColor: "var(--color-border, rgba(74,71,69,0.25))" }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p
                className="text-[10px] uppercase tracking-[0.1em] m-0 mb-1"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-accent, #e97d62)",
                  opacity: 0.7,
                }}
              >
                {info.family}
              </p>
              <h2
                className="text-[15px] tracking-tight m-0"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-ink, #e8e0d8)",
                }}
              >
                How {info.name} distance works
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="bg-transparent border-none cursor-pointer p-1
                         transition-colors duration-150 -mr-1 -mt-1"
              title="Close"
            >
              <X
                size={15}
                strokeWidth={1.5}
                className="stroke-ink-muted hover:stroke-ink-faint"
              />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-5 pt-4 pb-6 info-modal-scroll"
        >
          <p
            className="text-[12px] leading-relaxed m-0 mb-1"
            style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
          >
            {info.oneLiner}
          </p>

          <HatchDivider />

          {isEmbedding && (
            <EmbeddingExplanation
              metric={metric}
              info={info}
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}

          {metric === "color" && (
            <ColorExplanation
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}

          {metric === "phash" && (
            <PhashExplanation
              closest={closest}
              furthest={furthest}
              anchorPanel={anchorPanel}
            />
          )}
        </div>
      </div>
    </div>
  );
}