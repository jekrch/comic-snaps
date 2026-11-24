import { useEffect, useId, useMemo, useRef, useState } from "react";
import { panelImageUrl } from "../../utils/imageUrl";
import { Wide } from "./explainerPrimitives";
import {
  bitDistance,
  dctBasis,
  exampleLabel,
  loadPhashExamples,
  luma,
  type HashSide,
  type PhashExample,
  type PhashExamples,
  type PhashStats,
} from "./phashExamples";

/**
 * The pHash lesson's figures. Each follows one example panel, the phone
 * photo as first posted ("before") and its restoration ("after"), through
 * one step of imagehash.phash, using the numbers the script recorded.
 */

const ACCENT = "var(--color-accent, #e85d3a)";
const ACCENT_RGB = [232, 93, 58] as const;
/** The diverging pair's cool pole, for negative DCT numbers. */
const COOL_RGB = [110, 150, 205] as const;
const CELL_BG = "#1b1a19";
const BIT_ON = "#e8e4df";
const BIT_OFF = "#232120";

const captionStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  color: "rgba(255,255,255,0.4)",
};

/** What each example's restoration did, keyed by panel id (EXAMPLES in the script). */
const EXAMPLE_NOTES: Record<string, string> = {
  "bijou-funnies-6-1792968043":
    "Black and white. The dim, uneven gray paper went white and the ink solid black, and the crop dropped the neighbouring panels' borders at the right and bottom.",
  "trina-s-women-n-a-1793573911":
    "A strong pink cast from the lamp taken out, and the frame tightened to drop the edges of the next panels along the left and bottom.",
};

/** The examples: undefined while loading, null if they couldn't be loaded. */
export function usePhashExamples(): PhashExamples | null | undefined {
  const [data, setData] = useState<PhashExamples | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadPhashExamples().then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, []);
  return data;
}

export function FigureNotice({ loading }: { loading: boolean }) {
  return (
    <p className="guide-caption my-3 text-center">
      {loading ? "Loading the example…" : "The examples couldn't be loaded."}
    </p>
  );
}

function sideSrc(s: HashSide): string {
  return panelImageUrl(s.image);
}

/** Thumbnails to switch example, and the current one's name. */
export function ExamplePicker({
  examples,
  index,
  onPick,
}: {
  examples: PhashExample[];
  index: number;
  onPick: (i: number) => void;
}) {
  const current = examples[index];
  return (
    <div className="mb-3">
      <div className="flex justify-center items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Example panel">
        {examples.map((e, i) => {
          const on = i === index;
          return (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={exampleLabel(e)}
              title={exampleLabel(e)}
              onClick={() => onPick(i)}
              className="p-0 m-0 border-0 bg-transparent cursor-pointer rounded-[2px]
                         transition-opacity duration-150 hover:opacity-100
                         focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent,#e97d62)]"
              style={{ opacity: on ? 1 : 0.45 }}
            >
              <img
                src={sideSrc(e.after)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className="block rounded-[2px]"
                style={{
                  height: 30,
                  maxWidth: 64,
                  objectFit: "cover",
                  outline: on ? `1px solid ${ACCENT}` : "1px solid rgba(255,255,255,0.1)",
                  outlineOffset: 1,
                }}
              />
            </button>
          );
        })}
      </div>
      <p className="guide-caption mt-2 mb-0 text-center" style={{ ...captionStyle, color: "rgba(255,255,255,0.6)" }}>
        {exampleLabel(current)}
        {current.artist ? `, ${current.artist}` : ""}
      </p>
    </div>
  );
}

/**
 * Two images side by side at the same height: each takes width in
 * proportion to its aspect ratio, and the pair is capped so a tall panel
 * doesn't run off the screen.
 */
function PairRow({
  aspects,
  maxHeight = 420,
  children,
}: {
  aspects: [number, number];
  maxHeight?: number;
  children: [React.ReactNode, React.ReactNode];
}) {
  const gap = 12;
  return (
    <div className="flex mx-auto" style={{ gap, maxWidth: Math.round(maxHeight * (aspects[0] + aspects[1]) + gap) }}>
      {children.map((c, i) => (
        <div key={i} className="min-w-0" style={{ flex: `${aspects[i]} 1 0` }}>
          {c}
        </div>
      ))}
    </div>
  );
}

function SideCaption({ title, detail }: { title: string; detail?: string }) {
  return (
    <figcaption className="guide-caption mt-1.5 text-center" style={captionStyle}>
      <span style={{ color: "rgba(255,255,255,0.6)" }}>{title}</span>
      {detail && (
        <>
          <br />
          {detail}
        </>
      )}
    </figcaption>
  );
}

const frameStyle: React.CSSProperties = {
  outline: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 2,
};

// --- 1. The pair -------------------------------------------------------------

export function PairFigure({ example }: { example: PhashExample }) {
  const { before, after, quad } = example;
  const aspects: [number, number] = [before.width / before.height, after.width / after.height];
  const note = EXAMPLE_NOTES[example.id];
  return (
    <>
      <PairRow aspects={aspects}>
        <figure className="m-0">
          <div className="relative w-full overflow-hidden" style={{ ...frameStyle, aspectRatio: `${before.width} / ${before.height}` }}>
            <img src={sideSrc(before)} alt={`${exampleLabel(example)}, as photographed`} className="block w-full h-full" draggable={false} />
            {quad && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
                <polygon
                  points={quad.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          <SideCaption title="Phone photo, as posted" detail={`${before.width} × ${before.height}`} />
        </figure>
        <figure className="m-0">
          <div className="relative w-full overflow-hidden" style={{ ...frameStyle, aspectRatio: `${after.width} / ${after.height}` }}>
            <img src={sideSrc(after)} alt={`${exampleLabel(example)}, restored`} className="block w-full h-full" draggable={false} />
          </div>
          <SideCaption title="Restored" detail={`${after.width} × ${after.height}`} />
        </figure>
      </PairRow>
      {quad && (
        <p className="guide-caption mt-2 mb-0 text-center" style={captionStyle}>
          <span style={{ color: ACCENT }}>- - -</span> where the restored frame sits in the photo
        </p>
      )}
      {note && <p className="guide-caption mt-2 mb-0 text-center" style={captionStyle}>{note}</p>}
    </>
  );
}

// --- 2. Luminance ------------------------------------------------------------

/** An image's pixels, read once it loads. Null until then, or if it can't be read. */
function usePixels(src: string): ImageData | null {
  const [data, setData] = useState<ImageData | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!live) return;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      try {
        setData(ctx.getImageData(0, 0, c.width, c.height));
      } catch {
        // A cross-origin image can't be read; the probe just stays off.
      }
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return data;
}

interface Probe {
  side: "before" | "after";
  /** Position as fractions of the image. */
  x: number;
  y: number;
  rgb: [number, number, number];
}

/** Luminance left of a vertical line, color right of it. */
function WipeImage({
  side,
  label,
  split,
  probe,
  pixels,
  onProbe,
}: {
  side: HashSide;
  label: string;
  split: number;
  probe: Probe | null;
  pixels: ImageData | null;
  onProbe: (p: { x: number; y: number; rgb: [number, number, number] } | null) => void;
}) {
  const read = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pixels) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.9999);
    const y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 0.9999);
    // Average a few pixels so JPEG speckle doesn't make the numbers jump.
    const cx = Math.floor(x * pixels.width);
    const cy = Math.floor(y * pixels.height);
    const sum = [0, 0, 0];
    let n = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue;
        const o = (py * pixels.width + px) * 4;
        sum[0] += pixels.data[o];
        sum[1] += pixels.data[o + 1];
        sum[2] += pixels.data[o + 2];
        n++;
      }
    onProbe({ x, y, rgb: [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)] });
  };
  return (
    <figure className="m-0">
      <div
        className="relative w-full overflow-hidden select-none"
        style={{ ...frameStyle, aspectRatio: `${side.width} / ${side.height}`, touchAction: "pan-y", cursor: "crosshair" }}
        onPointerMove={read}
        onPointerDown={read}
      >
        <img src={sideSrc(side)} alt="" className="absolute inset-0 block w-full h-full" draggable={false} />
        <img
          src={panelImageUrl(side.luma)}
          alt=""
          className="absolute inset-0 block w-full h-full"
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        />
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0"
          style={{ left: `${split}%`, width: 1, marginLeft: -0.5, background: "rgba(255,255,255,0.85)", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }}
        />
        {probe && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              left: `${probe.x * 100}%`,
              top: `${probe.y * 100}%`,
              width: 12,
              height: 12,
              margin: -6,
              borderRadius: "50%",
              border: "2px solid #fff",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.7)",
            }}
          />
        )}
      </div>
      <SideCaption title={label} />
    </figure>
  );
}

export function LumaFigure({ example }: { example: PhashExample }) {
  const [split, setSplit] = useState(50);
  const [probe, setProbe] = useState<Probe | null>(null);
  const beforePixels = usePixels(sideSrc(example.before));
  const afterPixels = usePixels(sideSrc(example.after));
  const id = useId();
  const { before, after } = example;
  const aspects: [number, number] = [before.width / before.height, after.width / after.height];

  useEffect(() => setProbe(null), [example.id]);

  const L = probe ? luma(...probe.rgb) : null;
  const gray = L === null ? null : `rgb(${L},${L},${L})`;

  return (
    <div onPointerLeave={() => setProbe(null)}>
      <div className="phash-readout" aria-live="polite">
        <span className={`phash-swatch ${probe ? "" : "is-empty"}`} style={probe ? { background: `rgb(${probe.rgb.join(",")})` } : undefined} />
        <span className="phash-readout-arrow">→</span>
        <span className={`phash-swatch ${gray ? "" : "is-empty"}`} style={gray ? { background: gray } : undefined} />
        <span className="phash-readout-text">
          {probe && L !== null ? (
            <>
              <span>
                {probe.side === "before" ? "Photo" : "Restored"}: R {probe.rgb[0]} · G {probe.rgb[1]} · B {probe.rgb[2]}
              </span>
              <span>
                0.299·{probe.rgb[0]} + 0.587·{probe.rgb[1]} + 0.114·{probe.rgb[2]} = <span style={{ color: "rgba(255,255,255,0.85)" }}>L {L}</span>
              </span>
            </>
          ) : (
            <>
              <span>Point at either image</span>
              <span>to see one spot's color become a brightness</span>
            </>
          )}
        </span>
      </div>
      <PairRow aspects={aspects}>
        <WipeImage
          side={before}
          label="Phone photo"
          split={split}
          pixels={beforePixels}
          probe={probe?.side === "before" ? probe : null}
          onProbe={(p) => setProbe(p && { ...p, side: "before" })}
        />
        <WipeImage
          side={after}
          label="Restored"
          split={split}
          pixels={afterPixels}
          probe={probe?.side === "after" ? probe : null}
          onProbe={(p) => setProbe(p && { ...p, side: "after" })}
        />
      </PairRow>
      <div className="phash-slider-row">
        <label htmlFor={id} className="phash-slider-label">
          color
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="cielab-slider"
          style={{ background: "linear-gradient(90deg, #c98b5a, #7d9cc4 50%, #3a3836 50%, #c8c4bf)" }}
          aria-label="How much of each image shows its luminance"
          aria-valuetext={`${split}% luminance`}
        />
        <span className="phash-slider-label text-right">luminance</span>
      </div>
    </div>
  );
}

// --- 3. 32 × 32 --------------------------------------------------------------

/** An n × n grid drawn one canvas pixel per cell and scaled up with hard edges. */
function CellCanvas({
  n,
  paint,
  hover,
  onHover,
  label,
}: {
  n: number;
  /** Fills the n × n image; memoize it, since it reruns when it changes. */
  paint: (img: ImageData) => void;
  hover: number | null;
  onHover: (cell: number | null) => void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(n, n);
    paint(img);
    ctx.putImageData(img, 0, 0);
  }, [n, paint]);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * n);
    const rr = Math.floor(((e.clientY - r.top) / r.height) * n);
    onHover(c >= 0 && c < n && rr >= 0 && rr < n ? rr * n + c : null);
  };

  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: "1", ...frameStyle, touchAction: "pan-y", cursor: "crosshair" }}
      onPointerMove={pick}
      onPointerDown={pick}
      role="img"
      aria-label={label}
    >
      <canvas ref={ref} width={n} height={n} className="block w-full h-full" style={{ imageRendering: "pixelated" }} />
      {hover !== null && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none"
          style={{
            left: `${((hover % n) / n) * 100}%`,
            top: `${(Math.floor(hover / n) / n) * 100}%`,
            width: `${100 / n}%`,
            height: `${100 / n}%`,
            outline: `2px solid ${ACCENT}`,
            outlineOffset: 0,
          }}
        />
      )}
    </div>
  );
}

function ThreeUp({ children, captions }: { children: React.ReactNode[]; captions: { title: string; detail?: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 mx-auto" style={{ maxWidth: 600 }}>
      {children.map((c, i) => (
        <figure key={i} className="m-0 min-w-0">
          {c}
          <SideCaption {...captions[i]} />
        </figure>
      ))}
    </div>
  );
}

function paintGray(grid: Uint8Array) {
  return (img: ImageData) => {
    for (let i = 0; i < grid.length; i++) {
      const o = i * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = grid[i];
      img.data[o + 3] = 255;
    }
  };
}

export function GridFigure({ example }: { example: PhashExample }) {
  const [hover, setHover] = useState<number | null>(null);
  const { before, after } = example;
  const diff = useMemo(() => {
    const d = new Uint8Array(1024);
    let total = 0;
    for (let i = 0; i < 1024; i++) {
      d[i] = Math.abs(before.grid[i] - after.grid[i]);
      total += d[i];
    }
    return { cells: d, mean: total / 1024 };
  }, [before, after]);

  const paintBefore = useMemo(() => paintGray(before.grid), [before]);
  const paintAfter = useMemo(() => paintGray(after.grid), [after]);
  const paintDiff = useMemo(
    () => (img: ImageData) => {
      for (let i = 0; i < 1024; i++) {
        const t = Math.min(diff.cells[i] / 128, 1);
        const o = i * 4;
        img.data[o] = 27 + (ACCENT_RGB[0] - 27) * t;
        img.data[o + 1] = 26 + (ACCENT_RGB[1] - 26) * t;
        img.data[o + 2] = 25 + (ACCENT_RGB[2] - 25) * t;
        img.data[o + 3] = 255;
      }
    },
    [diff]
  );

  const readout =
    hover === null ? null : { row: Math.floor(hover / 32) + 1, col: (hover % 32) + 1, b: before.grid[hover], a: after.grid[hover] };

  return (
    <div onPointerLeave={() => setHover(null)}>
      <div className="phash-readout phash-readout-text" aria-live="polite">
        {readout ? (
          <>
            <span>
              Row {readout.row}, column {readout.col}
            </span>
            <span>
              photo {readout.b} · restored {readout.a} · difference {Math.abs(readout.a - readout.b)}
            </span>
          </>
        ) : (
          <>
            <span>Point at a square to read its pixels</span>
            <span>0 is black, 255 is white</span>
          </>
        )}
      </div>
      <ThreeUp
        captions={[
          { title: "Phone photo", detail: `${before.width} × ${before.height} → 32 × 32` },
          { title: "Restored", detail: `${after.width} × ${after.height} → 32 × 32` },
          { title: "Difference", detail: `average ${diff.mean.toFixed(0)} of 255` },
        ]}
      >
        {[
          <CellCanvas key="b" n={32} paint={paintBefore} hover={hover} onHover={setHover} label="The photo's luminance at 32 by 32" />,
          <CellCanvas key="a" n={32} paint={paintAfter} hover={hover} onHover={setHover} label="The restoration's luminance at 32 by 32" />,
          <CellCanvas key="d" n={32} paint={paintDiff} hover={hover} onHover={setHover} label="How much each pixel changed" />,
        ]}
      </ThreeUp>
    </div>
  );
}

// --- 4. Patterns -------------------------------------------------------------

/** The 64 DCT patterns as one 8 × 8 atlas, each tile 32 × 32 with a 1-pixel seam. */
function BasisAtlas({ hover, onHover }: { hover: number | null; onHover: (cell: number | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = 8 * 33 - 1;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    img.data.fill(0);
    for (let u = 0; u < 8; u++)
      for (let v = 0; v < 8; v++) {
        const b = dctBasis(u, v);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const g = Math.round(127.5 + 127.5 * b[y * 32 + x]);
            const o = ((u * 33 + y) * size + v * 33 + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
            img.data[o + 3] = 255;
          }
      }
    ctx.putImageData(img, 0, 0);
  }, [size]);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const u = Math.floor(((e.clientY - r.top) / r.height) * 8);
    onHover(u >= 0 && u < 8 && v >= 0 && v < 8 ? u * 8 + v : null);
  };

  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: "1", touchAction: "pan-y", cursor: "crosshair" }}
      onPointerMove={pick}
      onPointerDown={pick}
      role="img"
      aria-label="The 64 smooth patterns pHash measures"
    >
      <canvas ref={ref} width={size} height={size} className="block w-full h-full" />
      {hover !== null && <CellOutline cell={hover} />}
    </div>
  );
}

function CellOutline({ cell }: { cell: number }) {
  return (
    <div
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        left: `${(cell % 8) * 12.5}%`,
        top: `${Math.floor(cell / 8) * 12.5}%`,
        width: "12.5%",
        height: "12.5%",
        outline: `2px solid ${ACCENT}`,
      }}
    />
  );
}

/** Orange for a positive number, blue for a negative one, brighter for bigger. */
function coefficientColor(v: number, scale: number): string {
  const t = Math.sqrt(Math.min(Math.abs(v) / scale, 1));
  const [r, g, b] = v >= 0 ? ACCENT_RGB : COOL_RGB;
  const mix = (c: number, base: number) => Math.round(base + (c - base) * t);
  return `rgb(${mix(r, 27)},${mix(g, 26)},${mix(b, 25)})`;
}

function EightGrid({
  cells,
  hover,
  onHover,
  label,
}: {
  cells: { color: string; text?: string; ink?: string; title: string }[];
  hover: number | null;
  onHover: (cell: number | null) => void;
  label: string;
}) {
  return (
    <div
      className="relative grid w-full"
      style={{ aspectRatio: "1", gridTemplateColumns: "repeat(8, 1fr)", gap: 1, background: "#000", ...frameStyle, touchAction: "pan-y" }}
      role="img"
      aria-label={label}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          title={c.title}
          onPointerEnter={() => onHover(i)}
          onPointerDown={() => onHover(i)}
          className="flex items-center justify-center"
          style={{ background: c.color, fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: c.ink ?? "rgba(0,0,0,0.6)" }}
        >
          {c.text}
        </div>
      ))}
      {hover !== null && <CellOutline cell={hover} />}
    </div>
  );
}

function patternName(cell: number): string {
  const u = Math.floor(cell / 8);
  const v = cell % 8;
  if (cell === 0) return "The flat pattern: overall brightness";
  const across = v === 0 ? "" : `${v} half-wave${v > 1 ? "s" : ""} across`;
  const down = u === 0 ? "" : `${u} half-wave${u > 1 ? "s" : ""} down`;
  return `Pattern ${u + 1}, ${v + 1}: ${[across, down].filter(Boolean).join(", ")}`;
}

const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

export function PatternFigure({ example }: { example: PhashExample }) {
  const [hover, setHover] = useState<number | null>(null);
  const { before, after } = example;
  // One scale for both, so the same color means the same amount.
  const scale = useMemo(() => {
    const mags = [...before.dct.slice(1), ...after.dct.slice(1)].map(Math.abs).sort((a, b) => a - b);
    return mags[Math.floor(mags.length * 0.9)] || 1;
  }, [before, after]);

  const cells = (s: HashSide) =>
    s.dct.map((v, i) => ({ color: coefficientColor(v, scale), title: `${patternName(i)}: ${fmt(v)}` }));

  return (
    <div onPointerLeave={() => setHover(null)}>
      <div className="phash-readout phash-readout-text" aria-live="polite">
        {hover !== null ? (
          <>
            <span>{patternName(hover)}</span>
            <span>
              photo {fmt(before.dct[hover])} · restored {fmt(after.dct[hover])}
            </span>
          </>
        ) : (
          <>
            <span>Point at a pattern to compare</span>
            <span>how much of it each image has</span>
          </>
        )}
      </div>
      <ThreeUp
        captions={[
          { title: "The 64 patterns", detail: "smooth → busy" },
          { title: "Phone photo", detail: "how much of each" },
          { title: "Restored", detail: "how much of each" },
        ]}
      >
        {[
          <BasisAtlas key="p" hover={hover} onHover={setHover} />,
          <EightGrid key="b" cells={cells(before)} hover={hover} onHover={setHover} label="The photo's 64 pattern numbers" />,
          <EightGrid key="a" cells={cells(after)} hover={hover} onHover={setHover} label="The restoration's 64 pattern numbers" />,
        ]}
      </ThreeUp>
      <div className="phash-legend" aria-hidden="true">
        <span className="phash-legend-ramp" style={{ background: `linear-gradient(90deg, rgb(${COOL_RGB.join(",")}), ${CELL_BG}, rgb(${ACCENT_RGB.join(",")}))` }} />
        <span className="phash-legend-ends">
          <span>the pattern, inverted</span>
          <span>none</span>
          <span>the pattern</span>
        </span>
      </div>
    </div>
  );
}

// --- 5. Bits -----------------------------------------------------------------

function BitGrid({ side, label, hover, onHover }: { side: HashSide; label: string; hover: number | null; onHover: (c: number | null) => void }) {
  return (
    <figure className="m-0 min-w-0">
      <div className="flex gap-2 items-stretch">
        <div className="flex-1 min-w-0">
          <EightGrid
            cells={side.bits.map((b, i) => ({
              color: b ? BIT_ON : BIT_OFF,
              text: b ? "1" : "0",
              ink: b ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.35)",
              title: `${patternName(i)}: ${fmt(side.dct[i])}, ${b ? "above" : "below"} the median`,
            }))}
            hover={hover}
            onHover={onHover}
            label={`${label}: 64 bits`}
          />
        </div>
        {/* Each row of 8 bits is two hex digits. */}
        <div className="grid shrink-0" style={{ gridTemplateRows: "repeat(8, 1fr)", gap: 1, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
          {Array.from({ length: 8 }, (_, r) => (
            <span key={r} className="flex items-center" style={{ color: hover !== null && Math.floor(hover / 8) === r ? ACCENT : "rgba(255,255,255,0.6)" }}>
              {side.hash.slice(r * 2, r * 2 + 2)}
            </span>
          ))}
        </div>
      </div>
      <SideCaption title={label} detail={`median ${fmt(side.median)}`} />
    </figure>
  );
}

export function BitsFigure({ example }: { example: PhashExample }) {
  const [hover, setHover] = useState<number | null>(null);
  const { before, after } = example;
  return (
    <div onPointerLeave={() => setHover(null)}>
      <div className="phash-readout phash-readout-text" aria-live="polite">
        {hover !== null ? (
          <>
            <span>{patternName(hover)}</span>
            <span>
              photo {fmt(before.dct[hover])} → {before.bits[hover] ? 1 : 0} · restored {fmt(after.dct[hover])} → {after.bits[hover] ? 1 : 0}
            </span>
          </>
        ) : (
          <>
            <span>1 = above that image's median, 0 = below</span>
            <span>32 of each, every time</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-5 mx-auto" style={{ maxWidth: 440 }}>
        <BitGrid side={before} label="Phone photo" hover={hover} onHover={setHover} />
        <BitGrid side={after} label="Restored" hover={hover} onHover={setHover} />
      </div>
    </div>
  );
}

// --- 6. Hamming --------------------------------------------------------------

function HexCompare({ a, b, which }: { a: string; b: string; which: "a" | "b" }) {
  const s = which === "a" ? a : b;
  return (
    <span style={{ letterSpacing: "0.08em" }}>
      {[...s].map((c, i) => (
        <span key={i} style={{ color: c !== (which === "a" ? b : a)[i] ? ACCENT : "rgba(255,255,255,0.6)" }}>
          {c}
        </span>
      ))}
    </span>
  );
}

export function HammingFigure({ example }: { example: PhashExample }) {
  const [hover, setHover] = useState<number | null>(null);
  const { before, after } = example;
  const d = bitDistance(before.bits, after.bits);
  return (
    <div onPointerLeave={() => setHover(null)}>
      <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4">
        <div style={{ width: 200, maxWidth: "60vw" }}>
          <EightGrid
            cells={before.bits.map((b, i) => {
              const differ = b !== after.bits[i];
              return {
                color: differ ? ACCENT : CELL_BG,
                text: differ ? `${b ? 1 : 0}→${after.bits[i] ? 1 : 0}` : undefined,
                title: differ ? `${patternName(i)}: photo ${b ? 1 : 0}, restored ${after.bits[i] ? 1 : 0}` : `${patternName(i)}: both ${b ? 1 : 0}`,
              };
            })}
            hover={hover}
            onHover={setHover}
            label={`${d} of 64 bits differ`}
          />
        </div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.9 }}>
          <div style={captionStyle}>Phone photo</div>
          <HexCompare a={before.hash} b={after.hash} which="a" />
          <div style={{ ...captionStyle, marginTop: 6 }}>Restored</div>
          <HexCompare a={before.hash} b={after.hash} which="b" />
          <div className="mt-3" style={{ color: "rgba(255,255,255,0.85)", fontSize: 15 }}>
            <span style={{ color: ACCENT }}>{d}</span> of 64 bits differ
          </div>
          <div style={{ ...captionStyle, fontSize: 12 }}>orange: photo → restored</div>
        </div>
      </div>
    </div>
  );
}

// --- 7. Reading it -----------------------------------------------------------

interface RangeRow {
  label: string;
  detail: string;
  min: number;
  max: number;
  median: number;
}

export function DistanceRanges({
  stats,
  example,
}: {
  stats: PhashStats;
  example: PhashExample;
}) {
  const pair = bitDistance(example.before.bits, example.after.bits);
  const rows: RangeRow[] = [
    {
      label: "Restored, framing kept",
      detail: `${stats.restoredKeptFrame.n} restorations`,
      ...stats.restoredKeptFrame,
    },
    {
      label: "Restored and reframed",
      detail: `${stats.restoredReframed.n} restorations`,
      ...stats.restoredReframed,
    },
    {
      label: "Each panel's nearest other panel",
      detail: `${stats.nearest.n} panels`,
      ...stats.nearest,
    },
    {
      label: "Any two different panels",
      detail: `middle 90% of ${stats.pairs.n.toLocaleString("en-US")} pairs`,
      min: stats.pairs.p5,
      max: stats.pairs.p95,
      median: stats.pairs.median,
    },
  ];
  const pct = (v: number) => `${(v / 64) * 100}%`;

  return (
    <div className="phash-ranges">
      <div className="phash-ranges-plot">
        <div className="phash-ranges-row">
          <div className="phash-ranges-label">
            <span>This pair</span>
            <span>
              {exampleLabel(example)} · {pair} bits
            </span>
          </div>
          <div className="phash-ranges-track" role="img" aria-label={`This pair: ${pair} bits`}>
            <span className="phash-ranges-guide" style={{ left: pct(pair) }} />
            <span className="phash-ranges-dot is-accent" style={{ left: pct(pair) }} />
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="phash-ranges-row">
            <div className="phash-ranges-label">
              <span>{r.label}</span>
              <span>
                {r.detail} · {r.min}–{r.max} bits, median {r.median}
              </span>
            </div>
            <div className="phash-ranges-track" role="img" aria-label={`${r.label}: ${r.min} to ${r.max} bits, median ${r.median}`}>
              <span className="phash-ranges-guide" style={{ left: pct(pair) }} />
              <span className="phash-ranges-band" style={{ left: pct(r.min), width: `calc(${pct(r.max - r.min)} + 2px)` }} />
              <span className="phash-ranges-median" style={{ left: pct(r.median) }} />
            </div>
          </div>
        ))}
        <div className="phash-ranges-axis" aria-hidden="true">
          {[0, 16, 32, 48, 64].map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="guide-caption mt-1 mb-0 text-center" style={captionStyle}>
        Hamming distance in bits · bands run min to max, the tick is the median
      </p>
    </div>
  );
}

/** A figure that tracks the lesson's current example, with the picker above it. */
export function ExampleFigure({
  data,
  index,
  onPick,
  children,
}: {
  data: PhashExamples | null | undefined;
  index: number;
  onPick: (i: number) => void;
  children: (example: PhashExample, data: PhashExamples) => React.ReactNode;
}) {
  if (!data || data.examples.length === 0) return <FigureNotice loading={data === undefined} />;
  const i = Math.min(index, data.examples.length - 1);
  return (
    <Wide>
      <ExamplePicker examples={data.examples} index={i} onPick={onPick} />
      {children(data.examples[i], data)}
    </Wide>
  );
}
