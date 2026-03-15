import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/* Tooltip animation timing */
const TOOLTIP_FADE_MS = 250;

/* Minimum distance from viewport edge */
const VIEWPORT_PADDING = 12;

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

/* Tooltip placement logic — computes viewport-absolute position for portal */

/** Estimated tooltip dimensions — these match the CSS constraints below. */
const TOOLTIP_EST_WIDTH = 150;
const TOOLTIP_EST_HEIGHT = 60; // approximate; actual varies with text
const TOOLTIP_GAP = 8; // margin between node edge and tooltip

type TooltipSide = "above" | "below" | "left" | "right";

interface TooltipPlacement {
  side: TooltipSide;
  /** Viewport-absolute x coordinate for the tooltip (left edge) */
  x: number;
  /** Viewport-absolute y coordinate for the tooltip (top edge) */
  y: number;
}

/**
 * Pick the tooltip side that keeps the tooltip most on-screen, then compute
 * viewport-absolute x/y for the tooltip container.
 *
 * The tooltip is rendered via a portal into document.body with position:fixed,
 * so all coordinates are in viewport space.
 */
function computePlacement(nodeEl: HTMLElement): TooltipPlacement {
  const rect = nodeEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // For each candidate side, compute how many pixels of the tooltip would
  // actually be visible within the viewport.

  const candidates: { side: TooltipSide; visible: number }[] = [];

  // Above: tooltip bottom edge sits at rect.top - gap
  {
    const tipBottom = rect.top - TOOLTIP_GAP;
    const tipTop = tipBottom - TOOLTIP_EST_HEIGHT;
    const visTop = Math.max(tipTop, 0);
    const visBottom = Math.min(tipBottom, vh);
    candidates.push({ side: "above", visible: Math.max(0, visBottom - visTop) });
  }

  // Below: tooltip top edge sits at rect.bottom + gap
  {
    const tipTop = rect.bottom + TOOLTIP_GAP;
    const tipBottom = tipTop + TOOLTIP_EST_HEIGHT;
    const visTop = Math.max(tipTop, 0);
    const visBottom = Math.min(tipBottom, vh);
    candidates.push({ side: "below", visible: Math.max(0, visBottom - visTop) });
  }

  // Left: tooltip right edge sits at rect.left - gap
  {
    const tipRight = rect.left - TOOLTIP_GAP;
    const tipLeft = tipRight - TOOLTIP_EST_WIDTH;
    const visLeft = Math.max(tipLeft, 0);
    const visRight = Math.min(tipRight, vw);
    candidates.push({ side: "left", visible: Math.max(0, visRight - visLeft) });
  }

  // Right: tooltip left edge sits at rect.right + gap
  {
    const tipLeft = rect.right + TOOLTIP_GAP;
    const tipRight = tipLeft + TOOLTIP_EST_WIDTH;
    const visLeft = Math.max(tipLeft, 0);
    const visRight = Math.min(tipRight, vw);
    candidates.push({ side: "right", visible: Math.max(0, visRight - visLeft) });
  }

  // Prefer above > below > right > left as tiebreaker order
  const preferenceOrder: TooltipSide[] = ["above", "below", "right", "left"];
  candidates.sort((a, b) => {
    const diff = b.visible - a.visible;
    if (Math.abs(diff) > 1) return diff;
    return preferenceOrder.indexOf(a.side) - preferenceOrder.indexOf(b.side);
  });

  const side = candidates[0].side;

  // Compute viewport-absolute x, y for the tooltip container.
  // The tooltip is positioned so its "anchor edge" is adjacent to the node,
  // and it's centred on the cross-axis, then clamped to stay on-screen.

  let x: number;
  let y: number;

  if (side === "above" || side === "below") {
    // Centre horizontally on node, clamp to viewport
    x = rect.left + rect.width / 2 - TOOLTIP_EST_WIDTH / 2;
    x = Math.max(VIEWPORT_PADDING, Math.min(x, vw - VIEWPORT_PADDING - TOOLTIP_EST_WIDTH));

    if (side === "above") {
      y = rect.top - TOOLTIP_GAP - TOOLTIP_EST_HEIGHT;
    } else {
      y = rect.bottom + TOOLTIP_GAP;
    }
  } else {
    // Centre vertically on node, clamp to viewport
    y = rect.top + rect.height / 2 - TOOLTIP_EST_HEIGHT / 2;
    y = Math.max(VIEWPORT_PADDING, Math.min(y, vh - VIEWPORT_PADDING - TOOLTIP_EST_HEIGHT));

    if (side === "left") {
      x = rect.left - TOOLTIP_GAP - TOOLTIP_EST_WIDTH;
    } else {
      x = rect.right + TOOLTIP_GAP;
    }
  }

  return { side, x, y };
}

/* Component */

function PanelNode({ data }: NodeProps<Node<PanelNodeData>>) {
  const { panel, isAnchor, onDoubleClick } = data;
  const size = isAnchor ? ANCHOR_SIZE : NODE_SIZE;

  // Tooltip visibility: `wantShow` is the intent, `mounted` keeps the DOM
  // alive long enough for the fade-out transition to play.
  const [wantShow, setWantShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [placement, setPlacement] = useState<TooltipPlacement>({
    side: "above",
    x: 0,
    y: 0,
  });

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  // Show / hide helpers that coordinate the fade animation ──

  const showTooltip = useCallback(() => {
    clearTimeout(hideTimer.current);
    clearTimeout(unmountTimer.current);

    if (nodeRef.current) {
      setPlacement(computePlacement(nodeRef.current));
    }

    setMounted(true);
    // Allow a microtask so the DOM mounts at opacity 0 before we flip to 1
    requestAnimationFrame(() => setWantShow(true));
  }, []);

  const hideTooltip = useCallback(() => {
    setWantShow(false);
    clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => setMounted(false), TOOLTIP_FADE_MS);
  }, []);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(unmountTimer.current);
    };
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
        showTooltip();
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
          hideTooltip();
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearTimeout(longPressTimer.current);

      // Always dismiss tooltip on finger release
      if (longPressActive.current) {
        longPressActive.current = false;
        hideTooltip();
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
        hideTooltip();
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
  }, [isAnchor, onDoubleClick, panel, showTooltip, hideTooltip]);

  // Desktop: hover show/hide ──
  const handlePointerEnter = () => {
    clearTimeout(hideTimer.current);
    showTooltip();
  };

  const handlePointerLeave = () => {
    hideTimer.current = setTimeout(() => hideTooltip(), 150);
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

  const { side, x: tipX, y: tipY } = placement;

  // Arrow styles per side
  const arrowStyle = (() => {
    const base: React.CSSProperties = { width: 0, height: 0, flexShrink: 0 };
    const color = "rgba(0,0,0,0.9)";
    switch (side) {
      case "above":
        return {
          ...base,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: `5px solid ${color}`,
        };
      case "below":
        return {
          ...base,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `5px solid ${color}`,
        };
      case "left":
        return {
          ...base,
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
          borderLeft: `5px solid ${color}`,
        };
      case "right":
        return {
          ...base,
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
          borderRight: `5px solid ${color}`,
        };
    }
  })();

  const isHorizontal = side === "left" || side === "right";

  // Compute arrow position: for above/below it's centred horizontally on the
  // node (clamped within the tooltip body); for left/right centred vertically.
  const arrowOffset = (() => {
    if (!nodeRef.current) return "50%";
    const rect = nodeRef.current.getBoundingClientRect();
    if (side === "above" || side === "below") {
      const nodeCenterX = rect.left + rect.width / 2;
      const offset = nodeCenterX - tipX;
      return `${Math.max(8, Math.min(offset, TOOLTIP_EST_WIDTH - 8))}px`;
    } else {
      const nodeCenterY = rect.top + rect.height / 2;
      const offset = nodeCenterY - tipY;
      return `${Math.max(8, Math.min(offset, TOOLTIP_EST_HEIGHT - 8))}px`;
    }
  })();

  const tooltipPortal =
    mounted &&
    createPortal(
      <div
        style={{
          position: "fixed",
          left: tipX,
          top: tipY,
          zIndex: 10000,
          pointerEvents: "none",
          display: "flex",
          flexDirection: isHorizontal
            ? side === "left"
              ? "row"
              : "row-reverse"
            : side === "above"
              ? "column"
              : "column-reverse",
          alignItems: "flex-start",
          opacity: wantShow ? 1 : 0,
          transition: `opacity ${TOOLTIP_FADE_MS}ms ease`,
        }}
      >
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
            <span style={{ color: "rgba(255,255,255,0.9)" }}>
              {panel.title}
            </span>{" "}
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
        {/* Arrow — positioned to point at the node centre */}
        <div
          style={{
            ...arrowStyle,
            ...(isHorizontal
              ? { marginTop: arrowOffset }
              : { marginLeft: arrowOffset }),
          }}
        />
      </div>,
      document.body
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

      {tooltipPortal}
    </div>
  );
}

export const nodeTypes = { panelNode: PanelNode };
export default PanelNode;