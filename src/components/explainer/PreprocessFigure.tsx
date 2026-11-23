import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLightbox, type ViewerItem } from "@jekrch/react-viewport-lightbox";
import type { Panel } from "../../types";
import { panelImageUrl } from "../../utils/imageUrl";
import { viewerIcons } from "../viewerIcons";
import { setFigureViewerOpen } from "./figureViewer";
import { loadImage, renderStage, type StageSpec } from "./renderModelInput";

type EmbeddingMetric = "embedding-siglip" | "embedding-dino" | "embedding-gram";

/** Longest side of each figure, in CSS px. Three fit across the modal on desktop. */
const BOX = 104;

// These mirror scripts/compute-embeddings.py, so the captions and grids are
// the real input sizes rather than approximations.
const SQUARE = 224; // SigLIP's processor squashes to this
const SIGLIP_PATCH = 16; // siglip-base-patch16-224
const DINO_SHORT_SIDE = 256;
const DINO_MAX_SIDE = 1036;
const DINO_PATCH = 14;
const GRAM_SHORT_SIDE = 448;
const GRAM_MAX_SIDE = 1024;
const SCRAMBLE_TILES = 6; // per side, for the Gram illustration

/** Above the explainer modal (z-70) and the panel viewer (the library's 50). */
const VIEWER_Z = 90;

/** Python's round(): ties go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** The (width, height) compute-embeddings.py feeds DINOv2 for a panel. */
export function dinoInputSize(w: number, h: number): [number, number] {
  const scale = Math.min(DINO_SHORT_SIDE / Math.min(w, h), DINO_MAX_SIDE / Math.max(w, h));
  const snap = (n: number) => Math.max(DINO_PATCH, roundHalfEven(n / DINO_PATCH) * DINO_PATCH);
  return [snap(w * scale), snap(h * scale)];
}

/** The (width, height) compute-embeddings.py feeds VGG-16 for a panel. */
export function gramInputSize(w: number, h: number): [number, number] {
  const scale = Math.min(GRAM_SHORT_SIDE / Math.min(w, h), GRAM_MAX_SIDE / Math.max(w, h));
  return [roundHalfEven(w * scale), roundHalfEven(h * scale)];
}

/** Fit a w×h rectangle inside BOX×BOX, keeping its shape. */
function fit(w: number, h: number): { width: number; height: number } {
  const s = BOX / Math.max(w, h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** Small deterministic PRNG so a panel always scrambles the same way. */
function seededShuffle<T>(items: T[], seedText: string): T[] {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const captionStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  color: "rgba(255,255,255,0.4)",
};

/** Caption carried by each zoomable stage, shown in the viewer's header. */
interface StageCaption {
  title: string;
  detail: string;
}

/** What one figure is: its thumbnail size, caption, and zoomable render. */
interface Stage extends StageCaption {
  id: "stored" | "input" | "scramble";
  /** Thumbnail box, in CSS px. */
  width: number;
  height: number;
  /** Fuller caption for the viewer header. */
  viewerDetail: string;
  /** How to render the zoomable version; null shows the stored image itself. */
  spec: StageSpec | null;
}

type TriggerProps = ReturnType<ReturnType<typeof useLightbox>["triggerProps"]>;

function Figure({
  width,
  height,
  title,
  detail,
  trigger,
  children,
}: {
  width: number;
  height: number;
  title: string;
  detail: string;
  /** Opens this figure in the zoom viewer; absent until its render is ready. */
  trigger?: TriggerProps;
  children: React.ReactNode;
}) {
  const frame = (
    <div
      className="relative overflow-hidden rounded-[2px]"
      style={{ width, height, outline: "1px solid rgba(255,255,255,0.08)" }}
    >
      {children}
    </div>
  );
  return (
    <figure className="m-0 flex flex-col items-center" style={{ width: BOX }}>
      <div className="flex items-center justify-center" style={{ width: BOX, height: BOX }}>
        {trigger ? (
          <button
            type="button"
            {...trigger}
            className="block p-0 m-0 border-0 bg-transparent cursor-zoom-in rounded-[2px]
                       transition-opacity duration-150 hover:opacity-85
                       focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent,#e97d62)]"
            aria-label={`Inspect: ${title}, ${detail}`}
            title="Inspect up close"
          >
            {frame}
          </button>
        ) : (
          frame
        )}
      </div>
      <figcaption className="mt-1.5 text-center text-[9px] leading-[1.4]" style={captionStyle}>
        <span style={{ color: "rgba(255,255,255,0.6)" }}>{title}</span>
        <br />
        {detail}
      </figcaption>
    </figure>
  );
}

/** A patch grid drawn over an image, in the model's own pixel units. */
function PatchGrid({ cols, rows }: { cols: number; rows: number }) {
  // vector-effect isn't inherited, so it goes on every line; it keeps the
  // strokes hairline even though the viewBox is in patch units.
  const line = (key: string, x1: number, y1: number, x2: number, y2: number) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
  );
  const lines = [];
  for (let c = 1; c < cols; c++) lines.push(line(`c${c}`, c, 0, c, rows));
  for (let r = 1; r < rows; r++) lines.push(line(`r${r}`, 0, r, cols, r));
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g stroke="rgba(255,255,255,0.45)" strokeWidth={0.6}>
        {lines}
      </g>
    </svg>
  );
}

function Arrow() {
  return (
    <span
      className="self-start text-[12px] select-none"
      style={{ ...captionStyle, marginTop: BOX / 2 - 9 }}
      aria-hidden="true"
    >
      →
    </span>
  );
}

// Events from the portal'd viewer still bubble up the React tree to whatever
// rendered this figure: the explainer modal's scrim (closes on touch), or the
// panel viewer the graph lives in (swipe-to-close, backdrop click). Stop them
// at the portal's root; the viewer's own handlers have run by then.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const STOP_EVENTS = {
  onClick: stop,
  onDoubleClick: stop,
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onMouseDown: stop,
  onTouchStart: stop,
  onTouchMove: stop,
  onTouchEnd: stop,
  onWheel: stop,
  onKeyDown: stop,
};

/**
 * The anchor panel as stored, next to exactly what one model is given:
 * SigLIP's squashed square and patch grid, DINOv2's whole-panel patch
 * grid, or VGG-16's whole panel at 448 px plus an illustration of the one
 * thing a Gram matrix forgets (where each mark was).
 *
 * Every figure opens in a zoom viewer. The model inputs there are real
 * renders at the model's own resolution (see renderModelInput), so zooming
 * in shows the actual pixels and patches the model works from.
 */
export function PreprocessFigure({ metric, panel }: { metric: EmbeddingMetric; panel: Panel }) {
  const src = panelImageUrl(panel.image);
  const w = panel.width || SQUARE;
  const h = panel.height || SQUARE;

  const scrambled = useMemo(() => {
    const tiles = Array.from({ length: SCRAMBLE_TILES * SCRAMBLE_TILES }, (_, i) => i);
    return seededShuffle(tiles, panel.id);
  }, [panel.id]);

  // Each figure, in order. The viewer pages through the same list. Keyed on
  // plain numbers only: the render effect below re-runs whenever this
  // changes identity.
  const stages = useMemo<Stage[]>(() => {
    const siglipSide = SQUARE / SIGLIP_PATCH;
    const [dw, dh] = dinoInputSize(w, h);
    // VGG's input keeps the panel's shape, so the scramble does too.
    const [gw, gh] = gramInputSize(w, h);
    const stored: Stage = {
      id: "stored",
      ...fit(w, h),
      title: "Stored panel",
      detail: `${w} × ${h} px`,
      viewerDetail: `${w} × ${h} px, as photographed and stored`,
      spec: null,
    };
    if (metric === "embedding-siglip") {
      return [
        stored,
        {
          id: "input",
          width: BOX,
          height: BOX,
          title: "SigLIP input",
          detail: `${SQUARE} × ${SQUARE} px · ${siglipSide} × ${siglipSide} patches`,
          viewerDetail: `Squashed to ${SQUARE} × ${SQUARE} px, ${siglipSide} × ${siglipSide} patches of ${SIGLIP_PATCH} px. Each block is one pixel the model sees.`,
          spec: { width: SQUARE, height: SQUARE, patch: SIGLIP_PATCH },
        },
      ];
    }
    if (metric === "embedding-dino") {
      return [
        stored,
        {
          id: "input",
          ...fit(dw, dh),
          title: "DINOv2 input",
          detail: `${dw} × ${dh} px · ${dw / DINO_PATCH} × ${dh / DINO_PATCH} patches`,
          viewerDetail: `Whole panel at ${dw} × ${dh} px, ${dw / DINO_PATCH} × ${dh / DINO_PATCH} patches of ${DINO_PATCH} px. Each block is one pixel the model sees.`,
          spec: { width: dw, height: dh, patch: DINO_PATCH },
        },
      ];
    }
    const gramBox = fit(gw, gh);
    return [
      stored,
      {
        id: "input",
        ...gramBox,
        title: "VGG-16 input",
        detail: `${gw} × ${gh} px`,
        viewerDetail: `Whole panel at ${gw} × ${gh} px. Each block is one pixel the model sees.`,
        spec: { width: gw, height: gh },
      },
      {
        id: "scramble",
        ...gramBox,
        title: "What a Gram keeps",
        detail: "marks kept, places lost",
        viewerDetail:
          "Illustration: the same marks with their places shuffled, roughly what survives into a Gram matrix.",
        spec: { width: gw, height: gh, scramble: { tiles: SCRAMBLE_TILES, order: scrambled } },
      },
    ];
  }, [metric, w, h, scrambled]);

  // Render the zoomable versions in the background once the figure is up.
  // Until a stage's render lands, its figure isn't clickable.
  const [renders, setRenders] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    setRenders({});
    loadImage(src)
      .then(async (img) => {
        for (const stage of stages) {
          if (!stage.spec) continue;
          const url = await renderStage(img, stage.spec);
          if (!url) continue;
          if (!live) {
            // Cleanup already ran; nobody else will free this one.
            URL.revokeObjectURL(url);
            break;
          }
          urls.push(url);
          setRenders((r) => ({ ...r, [stage.id]: url }));
        }
      })
      .catch(() => {
        // The image wouldn't decode; the figures stay as plain thumbnails.
      });
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [src, stages]);

  // Only stages that are ready go to the viewer, in figure order.
  const items = useMemo<ViewerItem<StageCaption>[]>(
    () =>
      stages
        .filter((s) => !s.spec || renders[s.id])
        .map((s) => ({
          id: s.id,
          src: s.spec ? renders[s.id] : src,
          alt: `${s.title}: ${s.viewerDetail}`,
          data: { title: s.title, detail: s.viewerDetail },
        })),
    [stages, renders, src]
  );

  const lightbox = useLightbox<StageCaption>(items, {
    zoom: true,
    wheel: "zoom",
    closeOnBackdropClick: true,
    icons: viewerIcons,
    accent: "var(--color-accent, #e97d62)",
    ariaLabel: `${panel.title}, as the model sees it`,
    renderHeader: (ctx) => (
      <div className="min-w-0">
        <p className="font-display text-sm text-white/90 leading-snug m-0">{ctx.item.data.title}</p>
        <p className="text-xs text-white/50 mt-0.5 leading-snug m-0">{ctx.item.data.detail}</p>
      </div>
    ),
  });

  // Let the Escape handlers underneath stand down while this is open.
  useEffect(() => {
    setFigureViewerOpen(lightbox.isOpen);
  }, [lightbox.isOpen]);
  useEffect(() => () => setFigureViewerOpen(false), []);

  const triggerFor = (id: Stage["id"]): TriggerProps | undefined => {
    const i = items.findIndex((item) => item.id === id);
    return i >= 0 ? lightbox.triggerProps(i) : undefined;
  };

  const img = (style: React.CSSProperties) => (
    <img src={src} alt="" draggable={false} decoding="async" className="block" style={style} />
  );

  const thumbnail = (stage: Stage) => {
    if (stage.id === "stored") return img({ width: stage.width, height: stage.height });
    if (stage.id === "scramble") {
      const tileW = stage.width / SCRAMBLE_TILES;
      const tileH = stage.height / SCRAMBLE_TILES;
      return (
        <div
          className="grid w-full h-full"
          style={{
            gridTemplateColumns: `repeat(${SCRAMBLE_TILES}, 1fr)`,
            gridTemplateRows: `repeat(${SCRAMBLE_TILES}, 1fr)`,
          }}
        >
          {scrambled.map((from) => (
            <div
              key={from}
              style={{
                backgroundImage: `url("${src}")`,
                backgroundSize: `${stage.width}px ${stage.height}px`,
                backgroundPosition: `${-(from % SCRAMBLE_TILES) * tileW}px ${
                  -Math.floor(from / SCRAMBLE_TILES) * tileH
                }px`,
              }}
            />
          ))}
        </div>
      );
    }
    // A model input: the panel at the stage's box (stretched for SigLIP's
    // square), with the patch grid when the model has one.
    const patch = stage.spec?.patch;
    return (
      <>
        {img({ width: stage.width, height: stage.height, objectFit: "fill" })}
        {patch && stage.spec && (
          <PatchGrid cols={stage.spec.width / patch} rows={stage.spec.height / patch} />
        )}
      </>
    );
  };

  return (
    <div className="my-3">
      <div
        className="flex flex-wrap items-start justify-center gap-x-2 gap-y-3"
        role="group"
        aria-label={`${panel.title} as stored, and as ${
          metric === "embedding-siglip" ? "SigLIP" : metric === "embedding-dino" ? "DINOv2" : "VGG-16"
        } receives it`}
      >
        {stages.map((stage, i) => (
          <div key={stage.id} className="contents">
            {i > 0 && <Arrow />}
            <Figure
              width={stage.width}
              height={stage.height}
              title={stage.title}
              detail={stage.detail}
              trigger={triggerFor(stage.id)}
            >
              {thumbnail(stage)}
            </Figure>
          </div>
        ))}
      </div>
      <p className="mt-2 mb-0 text-center text-[9px]" style={captionStyle}>
        Tap an image to inspect it at the model's own resolution.
      </p>
      {lightbox.viewer &&
        createPortal(
          <div style={{ "--rvl-z": VIEWER_Z } as React.CSSProperties} {...STOP_EVENTS}>
            {lightbox.viewer}
          </div>,
          document.body
        )}
    </div>
  );
}
