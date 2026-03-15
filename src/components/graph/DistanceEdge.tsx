import { useReactFlow, type Node } from "@xyflow/react";
//import type { Panel } from "../types";
import type { PanelNodeData } from "./PanelNode";
import { getNodeDimensions } from "./PanelNode";

/* Geometry helpers: edge-of-box routing */

/**
 * Given a rectangle (center cx,cy; half-widths hw,hh) and an external target
 * point (px,py), return the point on the rectangle's perimeter closest to
 * the line from the center toward (px,py).
 */
function nearestPointOnRect(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  px: number,
  py: number
): { x: number; y: number } {
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx + hw, y: cy };
  const sx = hw / (Math.abs(dx) || 1e-9);
  const sy = hh / (Math.abs(dy) || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/* Component */

interface DistanceEdgeData {
  distance?: number;
  showLabel?: boolean;
  isAnchorEdge?: boolean;
  rank?: number;
  totalNeighbors?: number;
}

function DistanceEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: {
  id: string;
  source: string;
  target: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  data?: DistanceEdgeData;
}) {
  const { getNodes } = useReactFlow<Node<PanelNodeData>>();
  const isAnchorEdge = data?.isAnchorEdge ?? false;
  const rank = data?.rank;
  const total = data?.totalNeighbors ?? 1;

  // Look up both nodes to get their position + panel data for sizing
  const allNodes = getNodes();
  const sourceNode = allNodes.find((n) => n.id === source);
  const targetNode = allNodes.find((n) => n.id === target);

  let sx = sourceX,
    sy = sourceY,
    tx = targetX,
    ty = targetY;

  if (sourceNode?.data?.panel && targetNode?.data?.panel) {
    const sDim = getNodeDimensions(
      sourceNode.data.panel,
      sourceNode.data.isAnchor
    );
    const tDim = getNodeDimensions(
      targetNode.data.panel,
      targetNode.data.isAnchor
    );

    // Node positions in ReactFlow are top-left; compute centers
    const sCx = sourceNode.position.x + sDim.w / 2;
    const sCy = sourceNode.position.y + sDim.h / 2;
    const tCx = targetNode.position.x + tDim.w / 2;
    const tCy = targetNode.position.y + tDim.h / 2;

    const sPerim = nearestPointOnRect(
      sCx,
      sCy,
      sDim.w / 2,
      sDim.h / 2,
      tCx,
      tCy
    );
    const tPerim = nearestPointOnRect(
      tCx,
      tCy,
      tDim.w / 2,
      tDim.h / 2,
      sCx,
      sCy
    );

    sx = sPerim.x;
    sy = sPerim.y;
    tx = tPerim.x;
    ty = tPerim.y;
  }

  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;

  // Anchor edges: thickness scales inversely with rank (closest = thickest)
  let strokeWidth = 1;
  let strokeOpacity = 0.06;
  if (isAnchorEdge && rank !== undefined) {
    const t = 1 - (rank - 1) / Math.max(total - 1, 1);
    strokeWidth = 1 + t * 2.5;
    strokeOpacity = 0.1 + t * 0.2;
  }

  return (
    <>
      <path
        id={id}
        d={`M ${sx},${sy} L ${tx},${ty}`}
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
              <span
                style={{
                  color: isAnchorEdge
                    ? "rgba(232,164,74,0.7)"
                    : "rgba(255,255,255,0.3)",
                  fontSize: 8,
                }}
              >
                #{rank}
              </span>
            )}
            <span
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: 7,
                marginLeft: 3,
              }}
            >
              {data.distance.toFixed(3)}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const edgeTypes = { distance: DistanceEdge };
export default DistanceEdge;