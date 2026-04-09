import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { ArrowLeft, ChevronDown, Info } from "lucide-react";

import type { Panel } from "../../types";
import type { EmbeddingMap } from "../../utils/sorting";
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
import MetricExplainerPanel from "../explainer/MetricExplainerPanel";
import { useFilterParams } from "../../hooks/useFilterParams.ts";

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
  open: boolean;
  topOffset?: number;
  bottomOffset?: number;
  closing?: boolean;
  toolbarContainer: HTMLElement | null;
  slideDir?: "left" | "right" | null;
}

export default function SimilarityGraph({
  panel,
  allPanels,
  open,
  topOffset = 0,
  bottomOffset = 0,
  closing = false,
  toolbarContainer,
  slideDir = null,
}: SimilarityGraphProps) {
  // State
  const [anchorPanel, setAnchorPanel] = useState<Panel>(panel);

  const { initialSort } = useFilterParams();

  const [metric, setMetric] = useState<MetricKey>(() => {
    const embeddingModes: MetricKey[] = [
      "embedding-siglip",
      "embedding-dino",
      "embedding-gram",
    ];
    if (embeddingModes.includes(initialSort as MetricKey)) {
      return initialSort as MetricKey;
    }
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

  // Escape closes explainer before graph
  useEffect(() => {
    if (!open || !showExplainer) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setShowExplainer(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, showExplainer]);

  // Sync anchor when the parent panel changes (e.g. navigation)
  useEffect(() => {
    setAnchorPanel(panel);
  }, [panel]);

  // Close explainer when metric changes or graph closes
  useEffect(() => {
    setShowExplainer(false);
  }, [metric, open]);

  // Load embeddings when metric changes (only when open)
  useEffect(() => {
    if (!open) return;
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
  }, [metric, open]);

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

  const show = open && !closing;

  // Determine transform based on slideDir or normal open/close
  let graphTransform = show ? "translateY(0)" : "translateY(-100vh)";
  if (slideDir && !show) {
    graphTransform = `translateX(${slideDir === "left" ? "-100%" : "100%"})`;
  }
  if (closing) {
    graphTransform = "translateY(0)";
  }

  // Toolbar — rendered via portal into the top bar
  const toolbar = toolbarContainer && createPortal(
    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
      {showExplainer ? (
        /* Back button when explainer is open */
        <button
          onClick={() => setShowExplainer(false)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
        >
          <ArrowLeft size={13} strokeWidth={1.5} className="text-white/60" />
          <span className="font-display text-[11px] tracking-wider text-white/80 uppercase">
            Graph
          </span>
        </button>
      ) : (
        <>
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
                          <span className="inline-block w-1 h-1 rounded-full bg-accent shrink-0" />
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

          {/* Blurb */}
          {!loading && currentNeighbors.length > 0 && (
            <span className="text-[10px] text-white/40 tracking-wide hidden sm:inline">
              nearest panels by {activeMetric.shortLabel}
            </span>
          )}
        </>
      )}
    </div>,
    toolbarContainer,
  );

  return (
    <>
      {toolbar}

      {/* Graph body — same z-layer as InfoDrawer, slides down from top */}
      <div
        className="absolute inset-x-0 z-15 overflow-hidden"
        style={{
          top: topOffset,
          bottom: bottomOffset,
          transform: graphTransform,
          opacity: closing ? 0 : 1,
          transition: closing
            ? "opacity 0.25s ease-out"
            : slideDir
              ? "transform 0.28s cubic-bezier(0.2, 0, 0, 1)"
              : "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
          pointerEvents: show ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner slide track: shifts graph down when explainer is open */}
        <div
          className="relative w-full h-full"
          style={{
            transform: showExplainer ? "translateY(100%)" : "translateY(0)",
            transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
          }}
        >
          {/* Graph */}
          <div className="absolute inset-0 flex flex-col">
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

              {/* "How it works" — floats in graph space */}
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
          </div>

          {/* Metric explainer — slides down from top (positioned above the graph) */}
          <div
            className="absolute inset-x-0 overflow-y-auto info-modal-scroll"
            style={{
              top: 0,
              bottom: 0,
              transform: "translateY(-100%)",
            }}
          >
            {currentNeighbors.length > 0 && (
              <MetricExplainerPanel
                metric={metric}
                anchorPanel={anchorPanel}
                neighbors={currentNeighbors}
              />
            )}
          </div>
        </div>
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
    </>
  );
}
