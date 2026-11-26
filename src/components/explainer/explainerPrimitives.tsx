import { useContext, useId, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createPortal } from "react-dom";
import { useLightbox, type ViewerItem } from "@jekrch/react-viewport-lightbox";
import { viewerIcons } from "../viewerIcons";
import type { CodeRef } from "./code/snippets";
import { GUIDE_OVERLAY_Z, STOP_EVENTS, useOverlay } from "../guide/overlayStack";
import { StepContext, VariantContext, useGuide } from "../guide/guideContext";
import { stepDef, stepNumber } from "../guide/lessons";

// Section: one numbered step of a lesson. Its number, title and anchor id
// come from the lesson registry (guide/lessons.ts), so a lesson only names
// the step.
//
// On a lesson with a short version, both versions are mounted and each step
// shows one of them: a Section renders only when its step is in its
// version, into the step's slot (see `stepSlot`), so the reader can open
// one step in depth without leaving the essentials, or the reverse.

export function Section({
  step,
  code,
  children,
}: {
  step: string;
  /** The code behind this step, opened in the margin (or a sheet) from the heading. */
  code?: CodeRef | null;
  children: React.ReactNode;
}) {
  const { page, codeStep, openCode, copyStepLink, stepShort, setStepShort, stepSlot, swapped } = useGuide();
  const variant = useContext(VariantContext);
  const n = stepNumber(page, step);
  const title = stepDef(page, step)?.title ?? step;
  const codeOpen = codeStep === step;
  const justSwapped = !!swapped?.has(step);
  // A step whose versions can be swapped: the switch sits in its heading.
  const switchable = variant !== null && !!stepShort;
  if (switchable && stepShort(step) !== (variant === "short")) return null;

  const content = (
    <>
      <h2 className={`guide-step-heading${justSwapped ? " is-swapped" : ""}`}>
        <span className="guide-step-num">{n > 0 ? n : "·"}</span>
        <span className="guide-step-title">{title}</span>
        <a
          href={`#${step}`}
          className="guide-step-link"
          onClick={(e) => {
            e.preventDefault();
            copyStepLink(step);
          }}
          aria-label={`Copy a link to “${title}”`}
          title="Copy a link to this step"
        >
          #
        </a>
        <span className="guide-step-tools">
          {code &&
            (variant !== "short" ? (
              <button
                type="button"
                onClick={() => openCode(step, code)}
                className={`guide-code-btn${justSwapped ? " is-entering" : ""}`}
                aria-pressed={codeOpen}
                title="See the code behind this step"
              >
                {"</> code"}
              </button>
            ) : (
              // Folded just now: a stand-in plays the button's exit, since
              // the full version that owned it is gone.
              justSwapped && (
                <span className="guide-code-btn is-leaving" aria-hidden="true">
                  {"</> code"}
                </span>
              )
            ))}
          {variant === "short" ? (
            <button
              type="button"
              onClick={() => setStepShort(step, false)}
              className="guide-code-btn guide-more-btn"
              aria-expanded={false}
              title="Go deeper into this step, here"
            >
              <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>In depth</span>
            </button>
          ) : (
            switchable && (
              <button
                type="button"
                onClick={() => setStepShort(step, true)}
                className="guide-code-btn guide-more-btn"
                aria-expanded={true}
                title="Fold this step back to its essentials"
              >
                <ChevronUp size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Essentials</span>
              </button>
            )
          )}
        </span>
      </h2>
      <StepContext.Provider value={step}>
        <div className={`guide-step-body${justSwapped ? " is-swapped" : ""}`}>{children}</div>
      </StepContext.Provider>
    </>
  );

  if (variant !== null && stepSlot) {
    const slot = stepSlot(step);
    return slot ? createPortal(content, slot) : null;
  }
  return (
    <section id={step} data-step={step} className={`guide-step${variant === "short" ? " is-short" : ""}`}>
      {content}
    </section>
  );
}

/** A figure that breaks out of the reading column into the margin on wide screens. */
export function Wide({ children }: { children: React.ReactNode }) {
  return <div className="guide-wide">{children}</div>;
}

/** Small print under a figure. */
export function Caption({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`guide-caption ${className}`}>{children}</p>;
}

// CodeBlock

export function CodeBlock({ children }: { children: string }) {
  return <pre className="guide-codeblock">{children}</pre>;
}

// Em (accent-colored inline emphasis)

export function Em({ children }: { children: React.ReactNode }) {
  return <span className="guide-em">{children}</span>;
}

// Mono (inline code)

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="guide-mono">{children}</code>;
}

/**
 * A zoom viewer for a figure, opened over the Guide. It takes a place on the
 * overlay stack while open, so Escape closes it and nothing underneath.
 */
export function useZoomViewer<T>(
  items: ViewerItem<T>[],
  ariaLabel: string,
  renderHeader: (item: ViewerItem<T>) => React.ReactNode
) {
  const lightbox = useLightbox<T>(items, {
    zoom: true,
    wheel: "zoom",
    closeOnBackdropClick: true,
    icons: viewerIcons,
    accent: "var(--color-accent, #e97d62)",
    ariaLabel,
    renderHeader: (ctx) => renderHeader(ctx.item),
  });
  useOverlay(lightbox.isOpen, "figure");
  const portal =
    lightbox.viewer &&
    createPortal(
      <div style={{ "--rvl-z": GUIDE_OVERLAY_Z } as React.CSSProperties} {...STOP_EVENTS}>
        {lightbox.viewer}
      </div>,
      document.body
    );
  return { lightbox, portal };
}

/** The usual zoom-viewer header: a title and a line of detail. */
export function ZoomHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-sm text-white/90 leading-snug m-0">{title}</p>
      <p className="text-xs text-white/50 mt-0.5 leading-snug m-0">{detail}</p>
    </div>
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
    <div className="guide-diagram">
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
// PanelTrio: the anchor and its two neighbours as pictures, so a distance
// reads against what the panels actually look like. Each opens in the same
// zoom viewer as the explainer's other figures.

export interface TrioItem {
  src: string;
  title: string;
  /** "anchor", or the distance as it should read. */
  note: string;
  color: string;
}

/** What each position in the trio is, for the viewer's header. */
const TRIO_ROLES = ["The anchor panel", "Closest neighbour", "Furthest neighbour"];

interface TrioCaption {
  title: string;
  detail: string;
}

export function PanelTrio({ items }: { items: TrioItem[] }) {
  const viewerItems = useMemo<ViewerItem<TrioCaption>[]>(
    () =>
      items.map((it, i) => {
        const role = TRIO_ROLES[i] ?? "";
        const detail = i === 0 ? role : `${role} · distance ${it.note}`;
        return { id: `${i}-${it.src}`, src: it.src, alt: `${it.title}: ${detail}`, data: { title: it.title, detail } };
      }),
    [items]
  );

  const { lightbox, portal } = useZoomViewer<TrioCaption>(viewerItems, "The anchor and its neighbours", (item) => (
    <ZoomHeader title={item.data.title} detail={item.data.detail} />
  ));

  return (
    <div className="guide-trio">
      <div className="flex items-end justify-center gap-4">
        {items.map((it, i) => (
          <figure key={i} className="m-0 flex flex-col items-center min-w-0" style={{ flex: "0 1 30%" }}>
            <button
              type="button"
              {...lightbox.triggerProps(i)}
              className="block max-w-full p-0 m-0 border-0 bg-transparent cursor-zoom-in rounded-[2px]
                         transition-opacity duration-150 hover:opacity-85
                         focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent,#e97d62)]"
              aria-label={`Inspect: ${it.title}, ${viewerItems[i]?.data.detail ?? ""}`}
              title="Inspect up close"
            >
              <img
                src={it.src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="guide-trio-img block max-w-full rounded-[2px]"
                style={{ outline: `1px solid ${it.color}`, outlineOffset: 1 }}
              />
            </button>
            <figcaption className="guide-caption mt-1.5 text-center max-w-full" style={{ color: it.color }}>
              <span className="block truncate">{it.title}</span>
              <span style={{ opacity: 0.7 }}>{it.note}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <Caption className="text-center">Tap a panel to see it up close.</Caption>
      {portal}
    </div>
  );
}
