import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Panel } from "../types";

/* ── Types ── */

type MetricKey =
  | "embedding-siglip"
  | "embedding-dino"
  | "embedding-gram"
  | "color"
  | "phash";

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

/* ── Metric display metadata ── */

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

/* ── Embedding dimension by metric ── */

const EMBEDDING_DIM: Record<string, number> = {
  "embedding-siglip": 768,
  "embedding-dino": 768,
  "embedding-gram": 512, // adjust if the Gram pipeline uses a different output dim
};

/* ── Helpers ── */

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

/* ── Hatch divider (matches InfoModal) ── */

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

/* ── Angle diagram: arrows from a shared origin ── */

function AngleDiagram({
  closeDist,
  farDist,
}: {
  closeDist: number;
  farDist: number;
}) {
  // Map cosine distance [0, 2] → angle [0°, 180°]
  // cos(θ) = 1 - distance, so θ = acos(1 - distance)
  const closeAngle = Math.acos(Math.max(-1, Math.min(1, 1 - closeDist)));
  const farAngle = Math.acos(Math.max(-1, Math.min(1, 1 - farDist)));

  const cx = 90;
  const cy = 110;
  const r = 80;

  // Anchor arrow always points straight up
  const anchorAngle = -Math.PI / 2;

  // Neighbors splay to the right of the anchor
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

    // Arrowhead
    const headLen = 7;
    const headAngle = 0.4;
    const h1x = ex - headLen * Math.cos(angle - headAngle);
    const h1y = ey - headLen * Math.sin(angle - headAngle);
    const h2x = ex - headLen * Math.cos(angle + headAngle);
    const h2y = ey - headLen * Math.sin(angle + headAngle);

    // Label position — offset outward from the arrow tip
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

  // Arc showing the angle between anchor and a neighbor
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
        {/* Arcs */}
        {arc(anchorAngle, closeRad, 30, "var(--color-accent, #e97d62)")}
        {arc(anchorAngle, farRad, 45, "rgba(255,255,255,0.25)", true)}

        {/* Origin dot */}
        <circle cx={cx} cy={cy} r="2.5" fill="rgba(255,255,255,0.3)" />

        {/* Arrows */}
        {arrow(anchorAngle, "var(--color-ink, #e8e0d8)", "anchor", "left")}
        {arrow(closeRad, "var(--color-accent, #e97d62)", "closest", "right")}
        {arrow(farRad, "rgba(255,255,255,0.35)", "furthest", "right")}

        {/* Angle label for closest */}
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

/* ── Explanation sections by metric ── */

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
      {/* Step 1: Embedding as a direction */}
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

      {/* Step 2: Cosine similarity + angle diagram */}
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

      {/* Step 3: Distance + reading the result (merged from old 3 + 4) */}
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
      <Section number={1} title="Extract dominant colors">
        <p className="m-0">
          Each panel's pixels are analyzed to find the most prominent colors,
          expressed in <Em>CIELAB</Em>, a color space designed so that equal
          numeric distances correspond to equal perceived differences. It has
          three channels: <Mono>L*</Mono> (lightness), <Mono>a*</Mono>{" "}
          (green↔red), and <Mono>b*</Mono> (blue↔yellow).
        </p>
        {anchorColor && closeColor && farColor && (
          <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  L=${fmt(anchorColor[0], 1)}  a=${fmt(anchorColor[1], 1)}  b=${fmt(anchorColor[2], 1)}
"${truncate(closest.panel.title, 20)}"  →  L=${fmt(closeColor[0], 1)}  a=${fmt(closeColor[1], 1)}  b=${fmt(closeColor[2], 1)}
"${truncate(furthest.panel.title, 20)}"  →  L=${fmt(farColor[0], 1)}  a=${fmt(farColor[1], 1)}  b=${fmt(farColor[2], 1)}`}
          </CodeBlock>
        )}
      </Section>

      <Section number={2} title="Measure the gap">
        <p className="m-0">
          The distance between two colors is the straight-line distance through
          this 3D color space, the same idea as measuring distance on a map,
          but with three axes instead of two.
        </p>
        {anchorColor && closeColor && (
          <CodeBlock>
{`distance  =  √( ΔL² + Δa² + Δb² )

closest:   √( ${fmt((anchorColor[0] - closeColor[0]), 1)}² + ${fmt((anchorColor[1] - closeColor[1]), 1)}² + ${fmt((anchorColor[2] - closeColor[2]), 1)}² )  ≈  ${fmt(closest.distance, 2)}`}
          </CodeBlock>
        )}
        <p className="mt-2 mb-0">
          Secondary colors are also compared and blended in (75% weight on the
          dominant color, 25% on the rest).
        </p>
      </Section>

      <Section number={3} title="Reading the result">
        <p className="m-0">
          Smaller numbers mean the colors are more alike to the human eye.
          A distance under ~10 is a very close match; above ~50 is quite different.
        </p>
        <div className="mt-3">
          <DistanceBar
            closeDist={closest.distance}
            farDist={furthest.distance}
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

/* ── Tiny reusable pieces ── */

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
  closeLabel,
  farLabel,
  maxVal,
  unit = "",
}: {
  closeDist: number;
  farDist: number;
  closeLabel: string;
  farLabel: string;
  maxVal?: number;
  unit?: string;
}) {
  const max = maxVal ?? Math.max(farDist * 1.15, 1);
  const closePct = Math.min((closeDist / max) * 100, 100);
  const farPct = Math.min((farDist / max) * 100, 100);

  return (
    <div>
      {/* Scale bar */}
      <div
        className="relative rounded-full overflow-hidden"
        style={{
          height: 6,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Gradient fill from 0 to furthest */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${farPct}%`,
            background:
              "linear-gradient(to right, rgba(232,164,74,0.5), rgba(232,164,74,0.08))",
          }}
        />
        {/* Closest marker */}
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: `${closePct}%`,
            width: 2,
            background: "var(--color-accent, #e97d62)",
            borderRadius: 1,
          }}
        />
        {/* Furthest marker */}
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: `${farPct}%`,
            width: 2,
            background: "rgba(255,255,255,0.25)",
            borderRadius: 1,
          }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-1.5">
        <div className="text-[9px]" style={{ color: "var(--color-accent, #e97d62)" }}>
          ← {closeLabel}{" "}
          <span style={{ opacity: 0.7 }}>
            ({closeDist < 1 ? fmt(closeDist) : closeDist.toFixed(1)}{unit})
          </span>
        </div>
        <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          {farLabel}{" "}
          <span style={{ opacity: 0.7 }}>
            ({farDist < 1 ? fmt(farDist) : farDist.toFixed(1)}{unit})
          </span>{" "}
          →
        </div>
      </div>

      {/* Endpoints */}
      <div
        className="flex justify-between mt-0.5 text-[8px]"
        style={{ color: "rgba(255,255,255,0.15)" }}
      >
        <span>0 (identical)</span>
        <span>{max < 2 ? "1" : max.toFixed(0)} (very different)</span>
      </div>
    </div>
  );
}

function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}

/* ── Modal ── */

export default function MetricExplainerModal({
  metric,
  anchorPanel,
  neighbors,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false);
  const info = METRIC_INFO[metric];

  // Sort neighbors to find closest and furthest
  const sorted = useMemo(
    () => [...neighbors].sort((a, b) => a.distance - b.distance),
    [neighbors]
  );
  const closest = sorted[0] ?? null;
  const furthest = sorted[sorted.length - 1] ?? null;

  // Lock body scroll
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
      {/* Scrim */}
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

      {/* Card */}
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
        {/* Header */}
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

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto px-5 pt-4 pb-6 info-modal-scroll"
        >
          {/* One-liner intro */}
          <p
            className="text-[12px] leading-relaxed m-0 mb-1"
            style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
          >
            {info.oneLiner}
          </p>

          <HatchDivider />

          {/* Metric-specific explanation */}
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