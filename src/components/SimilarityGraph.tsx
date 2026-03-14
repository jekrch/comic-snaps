import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Panel } from "../types";
import type { SortMode, EmbeddingMap } from "../sorting";
import {
  loadEmbeddings,
  paletteDistance,
  cosineDistance,
  hammingDistanceHex,
} from "../sorting";
import { X, ChevronDown } from "lucide-react";

/* ── Configuration ── */

const NEIGHBOR_COUNTS = [6, 10, 16, 24] as const;
const DEFAULT_COUNT = 6;

type MetricKey =
  | "embedding-siglip"
  | "embedding-dino"
  | "embedding-gram"
  | "color"
  | "phash";

interface MetricOption {
  key: MetricKey;
  label: string;
  shortLabel: string;
  description: string;
}

const METRICS: MetricOption[] = [
  {
    key: "embedding-siglip",
    label: "SigLIP",
    shortLabel: "SigLIP",
    description: "Semantic / conceptual",
  },
  {
    key: "embedding-dino",
    label: "DINOv2",
    shortLabel: "DINO",
    description: "Structural / perceptual",
  },
  {
    key: "embedding-gram",
    label: "VGG-16 Gram",
    shortLabel: "Gram",
    description: "Line style / texture",
  },
  {
    key: "color",
    label: "Color Palette",
    shortLabel: "Color",
    description: "CIELAB dominant color",
  },
  {
    key: "phash",
    label: "pHash",
    shortLabel: "pHash",
    description: "Perceptual hash (near-dupes)",
  },
];

/* ── Tap / click detection thresholds (matches PanelCard) ── */

const DOUBLE_CLICK_DELAY = 400;
const MOUSE_TOLERANCE = 20;
const TOUCH_TOLERANCE = 30;

/* ── Compute nearest neighbors ── */

interface Neighbor {
  panel: Panel;
  distance: number;
}

function computeNeighbors(
  anchor: Panel,
  allPanels: Panel[],
  metric: MetricKey,
  count: number,
  embeddings: EmbeddingMap | null
): Neighbor[] {
  const candidates: Neighbor[] = [];

  for (const p of allPanels) {
    if (p.id === anchor.id) continue;

    let dist: number | null = null;

    if (
      metric === "embedding-siglip" ||
      metric === "embedding-dino" ||
      metric === "embedding-gram"
    ) {
      if (!embeddings) continue;
      const aEmb = embeddings[anchor.id];
      const bEmb = embeddings[p.id];
      if (!aEmb || !bEmb) continue;
      dist = cosineDistance(aEmb, bEmb);
    } else if (metric === "color") {
      dist = paletteDistance(
        anchor.dominantColors ?? null,
        p.dominantColors ?? null
      );
    } else if (metric === "phash") {
      if (!anchor.phash || !p.phash) continue;
      dist = hammingDistanceHex(String(anchor.phash), String(p.phash));
    }

    if (dist !== null && isFinite(dist)) {
      candidates.push({ panel: p, distance: dist });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, count);
}

/* ── Cross-distances for edges between neighbors ── */

function computeCrossDistance(
  a: Panel,
  b: Panel,
  metric: MetricKey,
  embeddings: EmbeddingMap | null
): number | null {
  if (
    metric === "embedding-siglip" ||
    metric === "embedding-dino" ||
    metric === "embedding-gram"
  ) {
    if (!embeddings) return null;
    const aE = embeddings[a.id];
    const bE = embeddings[b.id];
    if (!aE || !bE) return null;
    return cosineDistance(aE, bE);
  } else if (metric === "color") {
    return paletteDistance(a.dominantColors ?? null, b.dominantColors ?? null);
  } else if (metric === "phash") {
    if (!a.phash || !b.phash) return null;
    return hammingDistanceHex(String(a.phash), String(b.phash));
  }
  return null;
}

/* ── Force-directed layout (simple spring simulation) ── */

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

function forceLayout(
  nodeCount: number,
  edges: { source: number; target: number; weight: number; isCross?: boolean }[],
  iterations: number = 300
): { x: number; y: number }[] {
  const nodes: LayoutNode[] = [];
  const hasCrossEdges = edges.some((e) => e.isCross);
  const radius = 120 + nodeCount * 8;

  // Place node 0 at center, others in a circle
  for (let i = 0; i < nodeCount; i++) {
    if (i === 0) {
      nodes.push({ id: String(i), x: 0, y: 0, vx: 0, vy: 0, fixed: false });
    } else {
      const angle = ((i - 1) / (nodeCount - 1)) * 2 * Math.PI;
      nodes.push({
        id: String(i),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fixed: false,
      });
    }
  }

  // Normalize weights to ideal lengths
  const maxWeight = Math.max(...edges.map((e) => e.weight), 0.001);
  const layoutEdges = edges.map((e) => ({
    source: String(e.source),
    target: String(e.target),
    idealLen: e.isCross
      ? 140 + (e.weight / maxWeight) * 200   // cross-edges: longer ideal length
      : 60 + (e.weight / maxWeight) * 120,    // anchor-edges: tight
    isCross: e.isCross ?? false,
  }));

  const damping = 0.85;
  // Increase repulsion when cross-edges are present to prevent clumping
  const repulsionStrength = hasCrossEdges ? 35000 : 15000;
  const anchorSpringStrength = 0.04;
  const crossSpringStrength = 0.005; // much weaker — structural hint, not a hard constraint

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Repulsion (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const distSq = dx * dx + dy * dy + 1;
        const force = (repulsionStrength * temp) / distSq;
        const fx = (dx / Math.sqrt(distSq)) * force;
        const fy = (dy / Math.sqrt(distSq)) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Spring attraction (edges)
    for (const edge of layoutEdges) {
      const si = parseInt(edge.source);
      const ti = parseInt(edge.target);
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const displacement = dist - edge.idealLen;
      const strength = edge.isCross ? crossSpringStrength : anchorSpringStrength;
      const force = strength * displacement * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[si].vx += fx;
      nodes[si].vy += fy;
      nodes[ti].vx -= fx;
      nodes[ti].vy -= fy;
    }

    // Apply velocities
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return nodes.map((n) => ({ x: n.x, y: n.y }));
}

/* ── Custom Node: Panel thumbnail ── */

const NODE_SIZE = 100;
const ANCHOR_SIZE = 130;

interface PanelNodeData {
  panel: Panel;
  isAnchor: boolean;
  onDoubleClick: (panel: Panel) => void;
  [key: string]: unknown;
}

function PanelNode({ data }: NodeProps<Node<PanelNodeData>>) {
  const { panel, isAnchor, onDoubleClick } = data;
  const size = isAnchor ? ANCHOR_SIZE : NODE_SIZE;
  const [showInfo, setShowInfo] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Double-tap / double-click detection (mirrors PanelCard)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchOpenRef = useRef(false); // true when tooltip was opened via touch

  // Close tooltip on outside tap (touch only)
  useEffect(() => {
    if (!showInfo || !touchOpenRef.current) return;
    const handler = (e: PointerEvent) => {
      if (nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        setShowInfo(false);
        touchOpenRef.current = false;
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showInfo]);

  const aspect =
    panel.width && panel.height && panel.width > 0 && panel.height > 0
      ? panel.width / panel.height
      : 3 / 4;

  let w: number, h: number;
  if (aspect >= 1) {
    w = size;
    h = size / aspect;
  } else {
    h = size;
    w = size * aspect;
  }

  const updateTooltipPos = useCallback(() => {
    if (!nodeRef.current) return;
    const rect = nodeRef.current.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const handlePointerEnter = () => {
    clearTimeout(hideTimer.current);
    updateTooltipPos();
    setShowInfo(true);
  };

  const handlePointerLeave = () => {
    // Don't auto-dismiss if tooltip was opened via touch — outside tap handles it
    if (touchOpenRef.current) return;
    hideTimer.current = setTimeout(() => setShowInfo(false), 150);
  };

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const now = Date.now();
      const isTouch = e.pointerType === "touch";
      const ref = isTouch ? lastTap : lastClick;
      const tolerance = isTouch ? TOUCH_TOLERANCE : MOUSE_TOLERANCE;
      const prev = ref.current;

      if (
        prev &&
        now - prev.time < DOUBLE_CLICK_DELAY &&
        Math.abs(e.clientX - prev.x) <= tolerance &&
        Math.abs(e.clientY - prev.y) <= tolerance
      ) {
        // Double-tap / double-click → recenter on this node
        ref.current = null;
        touchOpenRef.current = false;
        setShowInfo(false);
        if (!isAnchor) {
          e.stopPropagation();
          onDoubleClick(panel);
        }
      } else {
        // First tap → toggle tooltip on touch; mouse hover handles it on desktop
        ref.current = { time: now, x: e.clientX, y: e.clientY };
        if (isTouch) {
          e.stopPropagation();
          updateTooltipPos();
          setShowInfo((prev) => {
            const next = !prev;
            touchOpenRef.current = next;
            return next;
          });
        }
      }
    },
    [isAnchor, onDoubleClick, panel, updateTooltipPos]
  );

  return (
    <>
      <div
        ref={nodeRef}
        className="similarity-node"
        style={{
          width: w,
          height: h,
          position: "relative",
          cursor: isAnchor ? "default" : "pointer",
        }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerUp={handlePointerUp}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />

        <img
          src={`${import.meta.env.BASE_URL}${panel.image}`}
          alt={`${panel.title} #${panel.issue}`}
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: 3,
            border: isAnchor
              ? "2px solid var(--color-accent, #e8a44a)"
              : "1px solid rgba(255,255,255,0.08)",
            boxShadow: isAnchor
              ? "0 0 20px rgba(232,164,74,0.25)"
              : "0 2px 8px rgba(0,0,0,0.5)",
          }}
        />
      </div>

      {/* Tooltip — rendered via portal to sit above all nodes */}
      {showInfo &&
        tooltipPos &&
        ReactDOM.createPortal(
          <div
            style={{
              position: "fixed",
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: "translate(-50%, -100%)",
              marginTop: -8,
              zIndex: 10000,
              pointerEvents: "none",
            }}
            onPointerEnter={() => {
              clearTimeout(hideTimer.current);
            }}
            onPointerLeave={handlePointerLeave}
          >
            <div
              style={{
                background: "rgba(0,0,0,0.9)",
                backdropFilter: "blur(8px)",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "5px 8px",
                whiteSpace: "nowrap",
                maxWidth: 220,
              }}
            >
              <p
                className="font-display leading-tight"
                style={{ fontSize: 11 }}
              >
                <span style={{ color: "rgba(255,255,255,0.9)" }}>{panel.title}</span>{" "}
                <span className="text-accent">#{panel.issue}</span>
              </p>
              <p
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.45)",
                  marginTop: 1,
                  lineHeight: "1.3",
                }}
              >
                {panel.artist} · {panel.year}
              </p>
              {!isAnchor && (
                <p
                  style={{
                    fontSize: 8,
                    color: "rgba(255,255,255,0.25)",
                    marginTop: 3,
                  }}
                >
                  double-tap to explore
                </p>
              )}
            </div>
            {/* Arrow */}
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "5px solid rgba(0,0,0,0.9)",
                margin: "0 auto",
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}

const nodeTypes = { panelNode: PanelNode };

/* ── Custom edge with distance label ── */

function DistanceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  data?: {
    distance?: number;
    showLabel?: boolean;
    isAnchorEdge?: boolean;
    rank?: number;
    totalNeighbors?: number;
  };
}) {
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const isAnchorEdge = data?.isAnchorEdge ?? false;
  const rank = data?.rank;
  const total = data?.totalNeighbors ?? 1;

  // Anchor edges: thickness scales inversely with rank (closest = thickest)
  let strokeWidth = 1;
  let strokeOpacity = 0.06;
  if (isAnchorEdge && rank !== undefined) {
    const t = 1 - (rank - 1) / Math.max(total - 1, 1); // 1.0 for rank 1, 0.0 for last
    strokeWidth = 1 + t * 2.5; // range: 1.0 – 3.5
    strokeOpacity = 0.1 + t * 0.2; // range: 0.1 – 0.3
  }

  return (
    <>
      <path
        id={id}
        d={`M ${sourceX},${sourceY} L ${targetX},${targetY}`}
        stroke={
          isAnchorEdge
            ? `rgba(232,164,74,${strokeOpacity})`
            : "rgba(255,255,255,0.06)"
        }
        strokeWidth={isAnchorEdge ? strokeWidth : 1}
        fill="none"
        strokeDasharray={isAnchorEdge ? undefined : "4 4"}
      />
      {data?.showLabel && data.distance !== undefined && (
        <foreignObject
          x={midX - 30}
          y={midY - 9}
          width={60}
          height={18}
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          <div
            style={{
              fontSize: 8,
              fontFamily: "var(--font-mono, monospace)",
              textAlign: "center",
              lineHeight: "18px",
              background: "rgba(0,0,0,0.6)",
              borderRadius: 3,
              padding: "0 4px",
              whiteSpace: "nowrap",
            }}
          >
            {rank !== undefined && (
              <span style={{ color: isAnchorEdge ? "rgba(232,164,74,0.7)" : "rgba(255,255,255,0.3)", fontSize: 8 }}>
                #{rank}
              </span>
            )}
            <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 7, marginLeft: 3 }}>
              {data.distance.toFixed(3)}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

const edgeTypes = { distance: DistanceEdge };

/* ── Main component ── */

interface SimilarityGraphProps {
  panel: Panel;
  allPanels: Panel[];
  activeSortMode: SortMode;
  onClose: () => void;
}

export default function SimilarityGraph({
  panel,
  allPanels,
  activeSortMode,
  onClose,
}: SimilarityGraphProps) {
  // ── State ──
  const [anchorPanel, setAnchorPanel] = useState<Panel>(panel);

  const [metric, setMetric] = useState<MetricKey>(() => {
    const embeddingModes: MetricKey[] = [
      "embedding-siglip",
      "embedding-dino",
      "embedding-gram",
    ];
    if (embeddingModes.includes(activeSortMode as MetricKey)) {
      return activeSortMode as MetricKey;
    }
    if (activeSortMode === "color") return "color";
    if (activeSortMode === "phash") return "phash";
    return "embedding-siglip";
  });

  const [neighborCount, setNeighborCount] = useState(DEFAULT_COUNT);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  //const [showCrossEdges, setShowCrossEdges] = useState(false);
  const [showCrossEdges, ] = useState(false);
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [embeddings, setEmbeddings] = useState<EmbeddingMap | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PanelNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setMetricDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Load embeddings when metric changes ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (
      metric === "embedding-siglip" ||
      metric === "embedding-dino" ||
      metric === "embedding-gram"
    ) {
      loadEmbeddings(metric).then((emb) => {
        if (!cancelled) {
          setEmbeddings(emb);
          setLoading(false);
        }
      });
    } else {
      setEmbeddings(null);
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [metric]);

  // ── Compute graph when inputs change ──
  const handleDoubleClick = useCallback(
    (p: Panel) => {
      setAnchorPanel(p);
    },
    []
  );

  useEffect(() => {
    if (loading) return;

    const neighbors = computeNeighbors(
      anchorPanel,
      allPanels,
      metric,
      neighborCount,
      embeddings
    );

    if (neighbors.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Build layout input
    const allInGraph = [anchorPanel, ...neighbors.map((n) => n.panel)];
    const edgeInputs: { source: number; target: number; weight: number; isCross?: boolean }[] = [];

    // Anchor → neighbor edges
    for (let i = 0; i < neighbors.length; i++) {
      edgeInputs.push({
        source: 0,
        target: i + 1,
        weight: neighbors[i].distance,
      });
    }

    // Optional cross-edges (neighbor → neighbor)
    const crossEdgeData: {
      sourceIdx: number;
      targetIdx: number;
      distance: number;
    }[] = [];

    if (showCrossEdges) {
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          const d = computeCrossDistance(
            neighbors[i].panel,
            neighbors[j].panel,
            metric,
            embeddings
          );
          if (d !== null && isFinite(d)) {
            crossEdgeData.push({
              sourceIdx: i + 1,
              targetIdx: j + 1,
              distance: d,
            });
            edgeInputs.push({
              source: i + 1,
              target: j + 1,
              weight: d,
              isCross: true,
            });
          }
        }
      }
    }

    // Run force layout
    const positions = forceLayout(allInGraph.length, edgeInputs);

    // Build React Flow nodes
    const rfNodes: Node<PanelNodeData>[] = allInGraph.map((p, i) => {
      const isAnchor = i === 0;
      const size = isAnchor ? ANCHOR_SIZE : NODE_SIZE;
      return {
        id: p.id,
        type: "panelNode",
        position: { x: positions[i].x - size / 2, y: positions[i].y - size / 2 },
        data: {
          panel: p,
          isAnchor,
          onDoubleClick: handleDoubleClick,
        },
        draggable: true,
      };
    });

    // Build React Flow edges
    const rfEdges: Edge[] = [];

    for (let i = 0; i < neighbors.length; i++) {
      rfEdges.push({
        id: `anchor-${neighbors[i].panel.id}`,
        source: anchorPanel.id,
        target: neighbors[i].panel.id,
        type: "distance",
        data: {
          distance: neighbors[i].distance,
          showLabel: showEdgeLabels,
          isAnchorEdge: true,
          rank: i + 1,
          totalNeighbors: neighbors.length,
        },
      });
    }

    for (const ce of crossEdgeData) {
      rfEdges.push({
        id: `cross-${allInGraph[ce.sourceIdx].id}-${allInGraph[ce.targetIdx].id}`,
        source: allInGraph[ce.sourceIdx].id,
        target: allInGraph[ce.targetIdx].id,
        type: "distance",
        data: {
          distance: ce.distance,
          showLabel: showEdgeLabels,
          isAnchorEdge: false,
        },
      });
    }

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [
    anchorPanel,
    allPanels,
    metric,
    neighborCount,
    embeddings,
    loading,
    showEdgeLabels,
    showCrossEdges,
    handleDoubleClick,
    setNodes,
    setEdges,
  ]);

  // ── Auto-fit on graph change ──
  const FitOnChange = () => {
    const { fitView } = useReactFlow();
    const prevNodeCount = useRef(0);
    useEffect(() => {
      if (nodes.length > 0 && nodes.length !== prevNodeCount.current) {
        prevNodeCount.current = nodes.length;
        setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50);
      }
    }, [nodes, fitView]);
    return null;
  };

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "rgba(0,0,0,0.95)" }}
    >
      {/* ── Toolbar ── */}
      <div
        className="relative z-10 flex items-center gap-3 px-4 py-3 shrink-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)",
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        }}
      >
        {/* Metric selector */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setMetricDropdownOpen((p) => !p)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
          >
            <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
              {activeMetric.shortLabel}
            </span>
            <ChevronDown
              size={12}
              className={`text-white/40 transition-transform duration-200 ${
                metricDropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {metricDropdownOpen && (
            <div
              className="absolute top-full left-0 mt-1 py-1 rounded bg-neutral-900/95 border border-white/10 backdrop-blur-md shadow-xl"
              style={{ minWidth: 180, zIndex: 100 }}
            >
              {METRICS.map((m) => {
                const active = m.key === metric;
                return (
                  <button
                    key={m.key}
                    onClick={() => {
                      setMetric(m.key);
                      setMetricDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 flex flex-col transition-colors ${
                      active
                        ? "text-accent"
                        : "text-white/60 hover:text-white/90 hover:bg-white/5"
                    }`}
                  >
                    <span className="font-display text-[11px] tracking-wider uppercase flex items-center gap-2">
                      {active && (
                        <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                      )}
                      {m.label}
                    </span>
                    <span className="text-[10px] text-white/30 mt-0.5 ml-3">
                      {m.description}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Neighbor count */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white/30 uppercase tracking-wider mr-1">n=</span>
          {NEIGHBOR_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setNeighborCount(n)}
              className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                n === neighborCount
                  ? "bg-white/12 text-white/90"
                  : "text-white/35 hover:text-white/60 hover:bg-white/5"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Toggle: edge labels */}
        <button
          onClick={() => setShowEdgeLabels((p) => !p)}
          className={`px-2.5 py-1.5 rounded text-[10px] uppercase tracking-wider font-display transition-colors ${
            showEdgeLabels
              ? "bg-white/10 text-white/70"
              : "text-white/25 hover:text-white/50 hover:bg-white/5"
          }`}
        >
          Dist
        </button>

        {/* Toggle: cross edges */}
        {/* <button
          onClick={() => setShowCrossEdges((p) => !p)}
          className={`px-2.5 py-1.5 rounded text-[10px] uppercase tracking-wider font-display transition-colors ${
            showCrossEdges
              ? "bg-white/10 text-white/70"
              : "text-white/25 hover:text-white/50 hover:bg-white/5"
          }`}
        >
          Cross-edges
        </button> */}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Hint */}
        <span className="text-[10px] text-white/20 tracking-wide hidden sm:inline">
          double-click node to recenter
        </span>

        {/* Close */}
        <button
          onClick={onClose}
          className="viewer-btn ml-2"
          title="Close similarity graph"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* ── Graph ── */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-6 h-6 border-2 border-white/20 border-t-accent rounded-full"
                style={{ animation: "spin 0.8s linear infinite" }}
              />
              <span className="text-[11px] text-white/30 font-display uppercase tracking-wider">
                Loading embeddings…
              </span>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px] text-white/25 font-display uppercase tracking-wider">
              No neighbors found for this metric
            </span>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.1}
            maxZoom={3}
            proOptions={{ hideAttribution: true }}
            style={{ background: "transparent" }}
            defaultEdgeOptions={{ animated: false }}
          >
            <Background color="rgba(255,255,255,0.03)" gap={40} size={1} />
            <Controls
              showInteractive={false}
              style={{
                bottom: 16,
                left: 16,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            />
            <FitOnChange />
          </ReactFlow>
        )}
      </div>

      {/* CSS overrides for React Flow controls to match dark theme */}
      <style>{`
        .react-flow__controls-button {
          background: rgba(255,255,255,0.06) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          border-radius: 4px !important;
          fill: rgba(255,255,255,0.5) !important;
          width: 28px !important;
          height: 28px !important;
        }
        .react-flow__controls-button:hover {
          background: rgba(255,255,255,0.12) !important;
          fill: rgba(255,255,255,0.8) !important;
        }
        .react-flow__controls-button svg {
          max-width: 14px !important;
          max-height: 14px !important;
        }
        .similarity-node {
          transition: filter 0.15s ease;
        }
        .similarity-node:hover {
          filter: brightness(1.05);
        }
        .similarity-node .panel-overlay {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .similarity-node:hover .panel-overlay {
          opacity: 1;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}