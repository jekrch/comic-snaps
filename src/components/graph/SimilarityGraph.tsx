import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, ChevronDown, Info } from "lucide-react";

import type { Panel } from "../../types";
import type { SortMode, EmbeddingMap } from "../../utils/sorting";
import { loadEmbeddings } from "../../utils/sorting";

import {
  METRICS,
  NEIGHBOR_COUNTS,
  DEFAULT_COUNT,
  ANCHOR_SIZE,
  NODE_SIZE,
  type MetricKey,
} from "./similarityConfig.ts";
import {
  computeNeighbors,
  computeCrossDistance,
  forceLayout,
  type Neighbor,
} from "../../utils/similarityUtils.ts";
import { nodeTypes, type PanelNodeData } from "./PanelNode.tsx";
import { edgeTypes } from "./DistanceEdge.tsx";
import MetricExplainerModal from "../explainer/MetricExplainerModal";

/* Helper: fit view only when anchor changes */

function FitOnAnchorChange({ anchorId }: { anchorId: string }) {
  const { fitView } = useReactFlow();
  const prevAnchorId = useRef(anchorId);
  const initialFit = useRef(false);

  useEffect(() => {
    if (!initialFit.current || anchorId !== prevAnchorId.current) {
      initialFit.current = true;
      prevAnchorId.current = anchorId;
      setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50);
    }
  }, [anchorId, fitView]);

  return null;
}

/* Main component */

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
  // State
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

  const [showEdgeLabels, ] = useState(true);
  const [neighborCount, setNeighborCount] = useState(DEFAULT_COUNT);
  const [showCrossEdges] = useState(false);
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [embeddings, setEmbeddings] = useState<EmbeddingMap | null>(null);

  const [currentNeighbors, setCurrentNeighbors] = useState<Neighbor[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PanelNodeData>>(
    []
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as HTMLElement)
      ) {
        setMetricDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load embeddings when metric changes 
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

  // Compute graph when inputs change 
  const handleDoubleClick = useCallback((p: Panel) => {
    setAnchorPanel(p);
  }, []);

  useEffect(() => {
    if (loading) return;

    const neighbors = computeNeighbors(
      anchorPanel,
      allPanels,
      metric,
      neighborCount,
      embeddings
    );

    setCurrentNeighbors(neighbors);

    if (neighbors.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Build layout input
    const allInGraph = [anchorPanel, ...neighbors.map((n:any) => n.panel)];
    const edgeInputs: {
      source: number;
      target: number;
      weight: number;
      isCross?: boolean;
    }[] = [];

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
        position: {
          x: positions[i].x - size / 2,
          y: positions[i].y - size / 2,
        },
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

  const activeMetric = METRICS.find((m:any) => m.key === metric)!;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "rgba(0,0,0,0.95)" }}
    >
      {/* Close — pinned top-right, always in place */}
      <button
        onClick={onClose}
        className="viewer-btn absolute z-20 sm:mr-2"
        style={{
          top: "max(0.75rem, env(safe-area-inset-top))",
          right: "1rem",
        }}
        title="Close similarity graph"
      >
        <X size={16} strokeWidth={1.5} />
      </button>

      {/* Toolbar */}
      <div
        className="relative z-10 flex items-center gap-3 px-4 pr-12 py-3 shrink-0"
        style={{
          background: "rgba(0,0,0,0.85)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
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
              {METRICS.filter((m:any) => !m.hide).map((m:any) => {
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

        {/* Toggle: edge labels */}
        {/* <button
          onClick={() => setShowEdgeLabels((p) => !p)}
          className={`px-2.5 py-1.5 rounded text-[10px] uppercase tracking-wider font-display transition-colors ${
            showEdgeLabels
              ? "bg-white/10 text-white/70"
              : "text-white/25 hover:text-white/50 hover:bg-white/5"
          }`}
        >
          Dist
        </button> */}

        {/* Neighbor count */}
        <div className="flex items-center gap-1">
          {NEIGHBOR_COUNTS.map((n: any) => (
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

        {/* Blurb — reads with the count pills: [5] [10] [20] nearest panels by SigLIP */}
        {!loading && currentNeighbors.length > 0 && (
          <span className="text-[10px] text-white/40 tracking-wide">
            nearest panels by {activeMetric.shortLabel}
          </span>
        )}
      </div>

      {/* Graph */}
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
            <Background
              color="rgba(255,255,255,0.03)"
              gap={40}
              size={1}
            />
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
            <FitOnAnchorChange anchorId={anchorPanel.id} />
          </ReactFlow>
        )}

        {/* "How it works" — floats in graph space, below toolbar */}
        {!loading && currentNeighbors.length > 0 && (
          <button
            onClick={() => setShowExplainer(true)}
            className="absolute z-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
                       bg-white/8 hover:bg-white/14 border border-white/10
                       hover:border-white/20 transition-all duration-200
                       backdrop-blur-sm"
            style={{ top: 2, left: 16 }}
          >
            <Info size={13} strokeWidth={1.5} className="text-accent/80" />
            <span className="font-display text-[10px] tracking-wider text-white/70 uppercase">
              How {activeMetric.shortLabel} works
            </span>
          </button>
        )}
      </div>

      {/* Metric explainer modal */}
      {showExplainer && currentNeighbors.length > 0 && (
        <MetricExplainerModal
          metric={metric}
          anchorPanel={anchorPanel}
          neighbors={currentNeighbors}
          onClose={() => setShowExplainer(false)}
        />
      )}

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
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
        .similarity-node .panel-overlay {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}