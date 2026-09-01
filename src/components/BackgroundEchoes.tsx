import { useEffect, useRef, useState } from "react";
import type { Panel } from "../types";

interface EchoDef {
  panel: Panel;
  y: number;
  h: number;
  side: "left" | "right";
}

interface BackgroundEchoesProps {
  panelPositions: { panel: Panel; y: number; h: number }[];
}

const ECHO_INTERVAL = 2;
const MIN_VIEWPORT_WIDTH = 1300;
const PIXEL_SIZE = 64;
const GAP_EM = 1;
const PILLAR_EM = 3;
const PARALLAX = 0;
/** How long the strip is held after its positions are cleared. Matches the
 *  `.echo-field` fade in index.css — long enough to read as the strip receding
 *  rather than switching off, short enough to be gone before the view that
 *  replaced it has finished arriving. */
const FADE_MS = 420;

export default function BackgroundEchoes({
  panelPositions,
}: BackgroundEchoesProps) {
  const [contentRect, setContentRect] = useState<{
    left: number;
    right: number;
    top: number;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 0
  );
  const [scrollY, setScrollY] = useState(0);
  const rafRef = useRef(0);
  /** The last set of positions the wall reported, kept one fade past the
   *  moment they are cleared. */
  const [held, setHeld] = useState<{ panel: Panel; y: number; h: number }[]>(panelPositions);

  useEffect(() => {
    if (panelPositions.length > 0) {
      setHeld(panelPositions);
      return;
    }
    const t = setTimeout(() => setHeld([]), FADE_MS);
    return () => clearTimeout(t);
  }, [panelPositions]);

  useEffect(() => {
    function measure() {
      setViewportWidth(window.innerWidth);
      const contentEl = document.querySelector(".content-container:not(header *)");
      if (contentEl) {
        const rect = contentEl.getBoundingClientRect();
        setContentRect({
          left: rect.left,
          right: window.innerWidth - rect.right,
          top: rect.top + window.scrollY,
        });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    // Re-measure after layout settles
    const t = setTimeout(measure, 500);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [panelPositions.length]);

  useEffect(() => {
    function onScroll() {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setScrollY(window.scrollY);
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // The echoes are the wall's own texture, and the wall can leave: switching to
  // the shelf clears the positions out from under them. Dropping the strip in a
  // single frame is exactly the blink the view swap was built to avoid, so the
  // last set is held on screen and faded out instead — and, because `held`
  // lands a commit after the positions do, the same opacity covers the arrival:
  // the container is painted empty at zero first, then the echoes fade up into
  // it rather than appearing at full strength.
  const lit = panelPositions.length > 0 && held.length > 0;
  const shown = panelPositions.length > 0 ? panelPositions : held;

  if (viewportWidth < MIN_VIEWPORT_WIDTH || !contentRect) return null;

  const sideWidth = Math.min(contentRect.left, contentRect.right);
  const rem = 16;
  const gapPx = GAP_EM * rem;
  const pillarPx = PILLAR_EM * rem;

  if (sideWidth < gapPx + 20) return null;

  const echoWidth = Math.min(pillarPx, sideWidth - gapPx);

  // Use consistent margin for both sides so echoes are symmetric
  const echoMarginLeft = contentRect.left - gapPx - echoWidth;
  const echoMarginRight = contentRect.right - gapPx - echoWidth;
  const echoMargin = Math.min(echoMarginLeft, echoMarginRight);

  // Compute the gallery extent so echoes stay within bounds
  const galleryHeight =
    shown.length > 0 ? Math.max(...shown.map((p) => p.y + p.h)) : 0;

  const echoes: EchoDef[] = [];
  for (let i = 0; i < shown.length; i++) {
    if (i % ECHO_INTERVAL !== 1) continue;
    const pos = shown[i];
    if (pos.panel.blur) continue;
    echoes.push({
      panel: pos.panel,
      y: pos.y,
      h: pos.h,
      side: echoes.length % 2 === 0 ? "left" : "right",
    });
  }

  return (
    <div
      className="pointer-events-none echo-field"
      style={{
        position: "absolute",
        top: contentRect.top,
        left: 0,
        width: "100%",
        height: galleryHeight,
        overflow: "hidden",
        zIndex: 0,
        opacity: lit ? 1 : 0,
      }}
    >
      {echoes.map((echo, idx) => {
        const src = `${import.meta.env.BASE_URL}${echo.panel.image}`;
        const echoHeight = echo.h * 1.8;
        const baseY = echo.y - echo.h * 0.4;
        const drift = (scrollY - echo.y) * PARALLAX;

        const horizGrad =
          echo.side === "left"
            ? "linear-gradient(to left, black 0%, transparent 100%)"
            : "linear-gradient(to right, black 0%, transparent 100%)";
        const vertGrad =
          "linear-gradient(to bottom, transparent 0%, black 15%, black 75%, transparent 100%)";

        const outerStyle: React.CSSProperties = {
          position: "absolute",
          top: baseY,
          width: echoWidth,
          height: echoHeight,
          overflow: "hidden",
          opacity: 0.3,
          filter: "blur(3px) saturate(1.7) contrast(1.25)",
          transform: `translateY(${drift}px)`,
          willChange: "transform",
          WebkitMaskImage: `${vertGrad}, ${horizGrad}`,
          WebkitMaskComposite: "destination-in" as string,
          maskImage: `${vertGrad}, ${horizGrad}`,
          maskComposite: "intersect",
        };

        if (echo.side === "left") {
          outerStyle.left = echoMargin;
          outerStyle.borderRight = "2px solid rgba(0,0,0,0.85)";
        } else {
          outerStyle.right = echoMargin;
          outerStyle.borderLeft = "2px solid rgba(0,0,0,0.85)";
        }

        const scaleX = echoWidth / PIXEL_SIZE;
        const pixelH = PIXEL_SIZE * (echoHeight / echoWidth);
        const scaleY = echoHeight / pixelH;

        return (
          <div key={`echo-${echo.panel.id}-${idx}`} style={outerStyle}>
            <div
              style={{
                width: PIXEL_SIZE,
                height: pixelH,
                transformOrigin: "top left",
                transform: `scale(${scaleX}, ${scaleY})`,
                overflow: "hidden",
              }}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: PIXEL_SIZE,
                  height: pixelH,
                  objectFit: "cover",
                  objectPosition: "center",
                  imageRendering: "pixelated",
                  transform: "scale(2.4)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
