import { useEffect, useRef } from "react";

const POS: [number, number, number] = [233, 125, 98]; // accent
const NEG: [number, number, number] = [104, 158, 214];
const ZERO: [number, number, number] = [34, 32, 30];

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
};

export interface StripRow {
  label: string;
  /** Right-aligned readout, e.g. a total. */
  note?: string;
  color: string;
  values: number[];
}

/** One row of cells, one cell per number, drawn as a 1-px-tall canvas scaled up. */
function Strip({ values, scale }: { values: number[]; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || values.length === 0) return;
    const img = ctx.createImageData(values.length, 1);
    values.forEach((v, i) => {
      const t = Math.min(1, Math.abs(v) / (scale || 1)) ** 0.75;
      const c = v >= 0 ? POS : NEG;
      img.data[i * 4] = ZERO[0] + (c[0] - ZERO[0]) * t;
      img.data[i * 4 + 1] = ZERO[1] + (c[1] - ZERO[1]) * t;
      img.data[i * 4 + 2] = ZERO[2] + (c[2] - ZERO[2]) * t;
      img.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(img, 0, 0);
  }, [values, scale]);
  return (
    <canvas
      ref={ref}
      width={Math.max(1, values.length)}
      height={1}
      className="block w-full rounded-[1px]"
      style={{ height: 10, imageRendering: "pixelated" }}
      aria-hidden="true"
    />
  );
}

/** Share of cells drawn below full brightness; the rest clip. */
const SCALE_PERCENTILE = 0.95;

/**
 * The colour scale: the 95th percentile of |value| across every row, not the
 * maximum. Some models have a dimension or two that sit far above the rest for
 * every image (SigLIP's are ~20× the typical value); scaling to the max let
 * those cells take all the contrast and left the ones that differ near black.
 * They now clip to full brightness instead.
 */
export function stripScale(rows: number[][]): number {
  const mags = rows.flat().map(Math.abs).sort((a, b) => a - b);
  if (mags.length === 0) return 1;
  const p = mags[Math.min(mags.length - 1, Math.floor(SCALE_PERCENTILE * mags.length))];
  return p > 0 ? p : mags[mags.length - 1] || 1;
}

/**
 * Vectors as strips of coloured cells: orange for positive numbers, blue for
 * negative, brighter for bigger. Rows share one colour scale so they can be
 * compared cell by cell.
 */
export function VectorStrips({ rows, caption }: { rows: StripRow[]; caption: string }) {
  const scale = stripScale(rows.map((r) => r.values));
  return (
    <figure className="guide-figure">
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="guide-caption flex justify-between gap-2 mb-0.5" style={labelStyle}>
              <span className="truncate" style={{ color: r.color }}>
                {r.label}
              </span>
              {r.note && (
                <span className="shrink-0" style={{ color: r.color }}>
                  {r.note}
                </span>
              )}
            </div>
            <Strip values={r.values} scale={scale} />
          </div>
        ))}
      </div>
      <figcaption className="guide-caption mt-1.5 text-center" style={labelStyle}>
        {caption}
      </figcaption>
    </figure>
  );
}
