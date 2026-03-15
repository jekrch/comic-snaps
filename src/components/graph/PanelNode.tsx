import { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Panel } from "../../types";
import {
  NODE_SIZE,
  ANCHOR_SIZE,
  DOUBLE_CLICK_DELAY,
  MOUSE_TOLERANCE,
  TOUCH_TOLERANCE,
  LONG_PRESS_DELAY,
} from "./similarityConfig";

/* Mount guard: ignore touch events that arrive shortly after mount */
const MOUNT_GUARD_MS = 500;

/* Node data interface */

export interface PanelNodeData {
  panel: Panel;
  isAnchor: boolean;
  onDoubleClick: (panel: Panel) => void;
  [key: string]: unknown;
}

/* Helper: compute rendered pixel dimensions for a panel node */

export function getNodeDimensions(
  panel: Panel,
  isAnchor: boolean
): { w: number; h: number } {
  const size = isAnchor ? ANCHOR_SIZE : NODE_SIZE;
  const aspect =
    panel.width && panel.height && panel.width > 0 && panel.height > 0
      ? panel.width / panel.height
      : 3 / 4;
  if (aspect >= 1) return { w: size, h: size / aspect };
  return { w: size * aspect, h: size };
}

/* Component */

function PanelNode({ data }: NodeProps<Node<PanelNodeData>>) {
  const { panel, isAnchor, onDoubleClick } = data;
  const size = isAnchor ? ANCHOR_SIZE : NODE_SIZE;
  const [showInfo, setShowInfo] = useState(false);
  const [tooltipBelow, setTooltipBelow] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nodeRef = useRef<HTMLDivElement>(null);

  // Long-press timer ref
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressActive = useRef(false);

  // Mount guard
  const mountTime = useRef(Date.now());

  // Tap detection refs (for double-tap recenter)
  const lastTapTime = useRef<{ time: number; x: number; y: number } | null>(
    null
  );
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null);

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

  // Decide whether tooltip should go above or below based on viewport position
  const updateTooltipDirection = useCallback(() => {
    if (!nodeRef.current) return;
    const rect = nodeRef.current.getBoundingClientRect();
    setTooltipBelow(rect.top < 100);
  }, []);

  // Native touch listeners in capture phase ──
  // ReactFlow intercepts touch events in its own handlers, so React synthetic
  // onTouchEnd never fires reliably on nodes. Attaching native capture-phase
  // listeners on the DOM node itself ensures we see every touch.
  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchStartPos.current = { x: t.clientX, y: t.clientY };

      // Skip long-press if this node just mounted (ghost touch from graph reload)
      if (Date.now() - mountTime.current < MOUNT_GUARD_MS) return;

      // Start long-press timer — show tooltip after delay
      longPressActive.current = false;
      clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        longPressActive.current = true;
        updateTooltipDirection();
        setShowInfo(true);
      }, LONG_PRESS_DELAY);
    };

    const onTouchMove = (e: TouchEvent) => {
      // If finger moves too far, cancel the long-press
      const t = e.touches[0];
      const start = touchStartPos.current;
      if (
        t &&
        start &&
        (Math.abs(t.clientX - start.x) > TOUCH_TOLERANCE ||
          Math.abs(t.clientY - start.y) > TOUCH_TOLERANCE)
      ) {
        clearTimeout(longPressTimer.current);
        if (longPressActive.current) {
          longPressActive.current = false;
          setShowInfo(false);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearTimeout(longPressTimer.current);

      // Always dismiss tooltip on finger release
      if (longPressActive.current) {
        longPressActive.current = false;
        setShowInfo(false);
        touchStartPos.current = null;
        return;
      }

      const t = e.changedTouches[0];
      if (!t) return;

      // If the finger moved too far, this was a drag/pan, not a tap
      const start = touchStartPos.current;
      if (
        !start ||
        Math.abs(t.clientX - start.x) > TOUCH_TOLERANCE ||
        Math.abs(t.clientY - start.y) > TOUCH_TOLERANCE
      ) {
        touchStartPos.current = null;
        return;
      }
      touchStartPos.current = null;

      const now = Date.now();
      const prev = lastTapTime.current;

      if (
        prev &&
        now - prev.time < DOUBLE_CLICK_DELAY &&
        Math.abs(t.clientX - prev.x) <= TOUCH_TOLERANCE &&
        Math.abs(t.clientY - prev.y) <= TOUCH_TOLERANCE
      ) {
        // Double-tap → recenter
        lastTapTime.current = null;
        if (!isAnchor) {
          onDoubleClick(panel);
        }
      } else {
        lastTapTime.current = { time: now, x: t.clientX, y: t.clientY };
      }
    };

    const onTouchCancel = () => {
      clearTimeout(longPressTimer.current);
      if (longPressActive.current) {
        longPressActive.current = false;
        setShowInfo(false);
      }
    };

    el.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchend", onTouchEnd, { capture: true });
    el.addEventListener("touchcancel", onTouchCancel, { capture: true });

    return () => {
      clearTimeout(longPressTimer.current);
      el.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchend", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchcancel", onTouchCancel, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [isAnchor, onDoubleClick, panel, updateTooltipDirection]);

  // Desktop: hover show/hide ──
  const handlePointerEnter = () => {
    clearTimeout(hideTimer.current);
    updateTooltipDirection();
    setShowInfo(true);
  };

  const handlePointerLeave = () => {
    hideTimer.current = setTimeout(() => setShowInfo(false), 150);
  };

  // Desktop: mouse double-click to recenter ──
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      const now = Date.now();
      const prev = lastClick.current;

      if (
        prev &&
        now - prev.time < DOUBLE_CLICK_DELAY &&
        Math.abs(e.clientX - prev.x) <= MOUSE_TOLERANCE &&
        Math.abs(e.clientY - prev.y) <= MOUSE_TOLERANCE
      ) {
        lastClick.current = null;
        if (!isAnchor) {
          e.stopPropagation();
          onDoubleClick(panel);
        }
      } else {
        lastClick.current = { time: now, x: e.clientX, y: e.clientY };
      }
    },
    [isAnchor, onDoubleClick, panel]
  );

  const tooltipContent = (
    <div
      style={{
        position: "absolute",
        left: "50%",
        ...(tooltipBelow
          ? { top: "100%", marginTop: 8 }
          : { bottom: "100%", marginBottom: 8 }),
        transform: "translateX(-50%)",
        zIndex: 10,
        pointerEvents: "none",
        width: "max-content",
        display: "flex",
        flexDirection: tooltipBelow ? "column" : "column-reverse",
        alignItems: "center",
      }}
    >
      {/* Arrow */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          ...(tooltipBelow
            ? { borderBottom: "5px solid rgba(0,0,0,0.9)" }
            : { borderTop: "5px solid rgba(0,0,0,0.9)" }),
        }}
      />
      {/* Body */}
      <div
        style={{
          background: "rgba(0,0,0,0.9)",
          backdropFilter: "blur(8px)",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.1)",
          padding: "5px 8px",
          whiteSpace: "normal",
          maxWidth: 150,
          minWidth: 90,
        }}
      >
        <p className="font-display leading-tight" style={{ fontSize: 11 }}>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>{panel.title}</span>{" "}
          <span className="text-accent" style={{ whiteSpace: "nowrap" }}>
            #{panel.issue}
          </span>
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
    </div>
  );

  return (
    <div
      ref={nodeRef}
      className="similarity-node"
      style={{
        width: w,
        height: h,
        position: "relative",
        overflow: "visible",
        cursor: isAnchor ? "default" : "pointer",
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerUp={handlePointerUp}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0 }}
      />

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
          WebkitTouchCallout: "none",
        }}
      />

      {showInfo && tooltipContent}
    </div>
  );
}

export const nodeTypes = { panelNode: PanelNode };
export default PanelNode;