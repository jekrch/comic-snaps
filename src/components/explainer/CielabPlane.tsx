import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Panel } from "../../types";
import type { NeighborInfo } from "./explainerConstants";
import { hueDeg, inGamut, labCss, labToLinear, num, panelName, to8, type Lab } from "./cielab";

/**
 * The a*-b* plane of CIELAB, looked at straight down the L* axis: one slice
 * of the colour space, painted in the colours that actually live there, with
 * the anchor, its nearest and furthest neighbours, and the rest of the
 * comparison group plotted by their dominant colour. A slider moves the
 * slice through lightness. Pointing at the plane reads off a colour (and its
 * hue angle); pointing at a dot reads off a panel.
 */

type Role = "anchor" | "closest" | "furthest";

interface Pt {
  id: string;
  title: string;
  lab: Lab;
  role?: Role;
  /** The colour metric's distance from the anchor (palette-weighted). */
  distance?: number;
}

type Focus = { kind: "dot"; pt: Pt } | { kind: "plane"; a: number; b: number } | null;

const ROLE_COLOR: Record<Role, string> = {
  anchor: "var(--color-ink, #e8e0d8)",
  closest: "var(--color-accent, #e97d62)",
  furthest: "rgba(255,255,255,0.55)",
};

/** viewBox size; the plot fills it, origin in the middle. */
const S = 300;
const C = S / 2;
/** Background canvas resolution. Smoothed up to the drawn size. */
const RES = 160;

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };

// Component ------------------------------------------------------------------

export function CielabPlane({
  anchor,
  closest,
  furthest,
  all = [],
}: {
  anchor: Panel;
  closest: NeighborInfo;
  furthest: NeighborInfo;
  /** The rest of the comparison group, plotted faintly for context. */
  all?: NeighborInfo[];
}) {
  const trio = useMemo<Pt[]>(() => {
    const pt = (p: Panel, role: Role, distance?: number): Pt => ({
      id: p.id,
      title: panelName(p),
      lab: p.dominantColors![0],
      role,
      distance,
    });
    return [
      pt(anchor, "anchor"),
      pt(closest.panel, "closest", closest.distance),
      pt(furthest.panel, "furthest", furthest.distance),
    ];
  }, [anchor, closest, furthest]);

  // Fit the view to the three highlighted colours, centred on neutral grey
  // so the axes (and the hue angle) always read from the middle.
  const R = useMemo(() => {
    const m = Math.max(...trio.flatMap((p) => [Math.abs(p.lab[1]), Math.abs(p.lab[2])]));
    return Math.min(120, Math.max(30, Math.ceil((m * 1.3) / 10) * 10));
  }, [trio]);

  const cloud = useMemo<Pt[]>(() => {
    const skip = new Set(trio.map((p) => p.id));
    return all
      .filter((n) => !skip.has(n.panel.id) && n.panel.dominantColors?.length)
      .map((n) => ({
        id: n.panel.id,
        title: panelName(n.panel),
        lab: n.panel.dominantColors![0],
        distance: n.distance,
      }))
      .filter((p) => Math.abs(p.lab[1]) <= R && Math.abs(p.lab[2]) <= R);
  }, [all, trio, R]);

  const [sliceL, setSliceL] = useState(() => Math.round(trio[0].lab[0]));
  const [focus, setFocus] = useState<Focus>(null);

  const sx = (a: number) => C + (a / R) * C;
  const sy = (b: number) => C - (b / R) * C;

  // Paint the slice.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(RES, RES);
    for (let y = 0; y < RES; y++) {
      const b = R - ((y + 0.5) / RES) * 2 * R;
      for (let x = 0; x < RES; x++) {
        const a = ((x + 0.5) / RES) * 2 * R - R;
        const rgb = labToLinear(sliceL, a, b);
        const i = (y * RES + x) * 4;
        if (!inGamut(rgb)) continue; // stays transparent
        img.data[i] = to8(rgb[0]);
        img.data[i + 1] = to8(rgb[1]);
        img.data[i + 2] = to8(rgb[2]);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [sliceL, R]);

  // Pointer → what's under it. Highlighted dots win ties over the cloud.
  const svgRef = useRef<SVGSVGElement>(null);
  function locate(clientX: number, clientY: number): Focus {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const x = ((clientX - r.left) / r.width) * S;
    const y = ((clientY - r.top) / r.height) * S;
    const near = (pts: Pt[], reach: number) => {
      let best: Pt | null = null;
      let bestD = reach * reach;
      for (const p of pts) {
        const d = (sx(p.lab[1]) - x) ** 2 + (sy(p.lab[2]) - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    };
    const hit = near(trio, 12) ?? near(cloud, 6);
    if (hit) return { kind: "dot", pt: hit };
    return { kind: "plane", a: ((x - C) / C) * R, b: ((C - y) / C) * R };
  }

  const onPointer = (e: React.PointerEvent) => setFocus(locate(e.clientX, e.clientY));
  const onClick = (e: React.MouseEvent) => {
    const f = locate(e.clientX, e.clientY);
    if (f?.kind === "dot") setSliceL(Math.round(f.pt.lab[0]));
  };

  // Chroma rings and the step they're drawn at.
  const ringStep = R <= 40 ? 10 : R <= 80 ? 20 : 40;
  const rings: number[] = [];
  for (let c = ringStep; c < R * 1.42; c += ringStep) rings.push(c);

  const focusAB = focus?.kind === "dot" ? [focus.pt.lab[1], focus.pt.lab[2]] : focus ? [focus.a, focus.b] : null;
  const focusId = focus?.kind === "dot" ? focus.pt.id : null;

  const axisLabel = (text: string, x: number, y: number, anchorPos: "start" | "end", color: string) => (
    <text
      x={x} y={y} textAnchor={anchorPos} fontSize="10" style={mono}
      fill={color} stroke="rgba(10,9,9,0.85)" strokeWidth="3" paintOrder="stroke"
    >
      {text}
    </text>
  );

  return (
    <figure className="guide-figure cielab">
      <Readout focus={focus} sliceL={sliceL} />

      <div className="cielab-plot">
        <canvas ref={canvasRef} width={RES} height={RES} aria-hidden="true" />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${S} ${S}`}
          role="img"
          aria-label={`CIELAB a*/b* plane at lightness ${sliceL}, with the anchor's, closest and furthest panels' dominant colors`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setFocus(null)}
          onClick={onClick}
        >
          {/* Chroma rings: distance from grey. */}
          {rings.map((c) => (
            <circle key={c} cx={C} cy={C} r={(c / R) * C} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.8" />
          ))}
          {rings.map((c) =>
            sx(c) < S - 14 ? (
              <text key={`t${c}`} x={sx(c) + 2} y={C + 10} fontSize="7.5" style={mono}
                fill="rgba(255,255,255,0.6)" stroke="rgba(10,9,9,0.7)" strokeWidth="2.5" paintOrder="stroke">
                {c}
              </text>
            ) : null
          )}

          {/* Axes through neutral grey. */}
          <line x1={0} y1={C} x2={S} y2={C} stroke="rgba(10,9,9,0.55)" strokeWidth="1" />
          <line x1={C} y1={0} x2={C} y2={S} stroke="rgba(10,9,9,0.55)" strokeWidth="1" />
          {axisLabel("red +a*", S - 6, C - 6, "end", labCss(72, 55, 25))}
          {axisLabel("−a* green", 6, C - 6, "start", labCss(78, -55, 30))}
          {axisLabel("+b* yellow", C + 6, 14, "start", labCss(88, -5, 70))}
          {axisLabel("−b* blue", C + 6, S - 8, "start", labCss(68, 0, -50))}

          {/* The rest of the group. */}
          {cloud.map((p) => (
            <circle key={p.id} cx={sx(p.lab[1])} cy={sy(p.lab[2])} r={2.6}
              fill={labCss(...p.lab)} stroke="rgba(0,0,0,0.6)" strokeWidth="0.7" />
          ))}

          {/* Anchor → neighbour separations, as seen from above. */}
          {trio.slice(1).map((p) => (
            <line key={`d${p.id}`}
              x1={sx(trio[0].lab[1])} y1={sy(trio[0].lab[2])} x2={sx(p.lab[1])} y2={sy(p.lab[2])}
              stroke={ROLE_COLOR[p.role!]} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.8" />
          ))}

          {/* Focus: how a point's two numbers and its hue angle are read. */}
          {focusAB && <FocusGuides a={focusAB[0]} b={focusAB[1]} R={R} />}

          {trio.map((p) => (
            <g key={p.id}>
              <circle cx={sx(p.lab[1])} cy={sy(p.lab[2])} r={7.5} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="1.5" />
              <circle cx={sx(p.lab[1])} cy={sy(p.lab[2])} r={6.5} fill={labCss(...p.lab)}
                stroke={ROLE_COLOR[p.role!]} strokeWidth="2" />
            </g>
          ))}

          {focus?.kind === "dot" && (
            <circle cx={sx(focus.pt.lab[1])} cy={sy(focus.pt.lab[2])} r={focus.pt.role ? 11 : 6}
              fill="none" stroke="#fff" strokeWidth="1.2" pointerEvents="none" />
          )}
        </svg>
      </div>

      <LightnessSlider value={sliceL} onChange={setSliceL} trio={trio} />

      <ul className="cielab-legend" onMouseLeave={() => setFocus(null)}>
        {trio.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={focusId === p.id ? "is-on" : undefined}
              onMouseEnter={() => setFocus({ kind: "dot", pt: p })}
              onFocus={() => setFocus({ kind: "dot", pt: p })}
              onBlur={() => setFocus(null)}
              onClick={() => setSliceL(Math.round(p.lab[0]))}
              title="Move the lightness slice to this color"
            >
              <span className="cielab-dot" style={{ background: labCss(...p.lab), borderColor: ROLE_COLOR[p.role!] }} />
              <span className="cielab-legend-role" style={{ color: ROLE_COLOR[p.role!] }}>{p.role}</span>
              <span className="cielab-legend-title">{p.title}</span>
              <span className="cielab-legend-lab" style={mono}>
                L* {num(p.lab[0])} · a* {num(p.lab[1])} · b* {num(p.lab[2])}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <figcaption className="guide-caption mt-2 text-center">
        Looking down the L* axis at one slice of CIELAB. Each dot is a panel's dominant color; the
        faint ones are the rest of the panels it was compared with. Where the plane goes dark, no
        screen can show that color at this lightness.
      </figcaption>
    </figure>
  );
}

/** Projections onto both axes, the ray from grey, and the hue angle. */
function FocusGuides({ a, b, R }: { a: number; b: number; R: number }) {
  const x = C + (a / R) * C;
  const y = C - (b / R) * C;
  const dist = Math.hypot(x - C, y - C);
  const h = hueDeg(a, b);
  const rad = (h * Math.PI) / 180;
  const rr = Math.max(10, Math.min(24, dist * 0.55));
  const ex = C + rr * Math.cos(rad);
  const ey = C - rr * Math.sin(rad);
  const mid = rad / 2;
  const lr = rr + 11;
  return (
    <g pointerEvents="none">
      <line x1={x} y1={y} x2={x} y2={C} stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" strokeDasharray="2,2" />
      <line x1={x} y1={y} x2={C} y2={y} stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" strokeDasharray="2,2" />
      {dist > 4 && (
        <>
          <line x1={C} y1={C} x2={x} y2={y} stroke="#fff" strokeWidth="1" opacity="0.85" />
          <path
            d={`M ${C + rr} ${C} A ${rr} ${rr} 0 ${h > 180 ? 1 : 0} 0 ${ex} ${ey}`}
            fill="none" stroke="#fff" strokeWidth="1.2"
          />
          <text
            x={C + lr * Math.cos(mid)} y={C - lr * Math.sin(mid) + 3}
            textAnchor="middle" fontSize="9" style={mono}
            fill="#fff" stroke="rgba(10,9,9,0.85)" strokeWidth="3" paintOrder="stroke"
          >
            {Math.round(h)}°
          </text>
        </>
      )}
    </g>
  );
}

/** Two fixed lines about whatever is under the pointer. */
function Readout({ focus, sliceL }: { focus: Focus; sliceL: number }) {
  let swatch: string | null = null;
  let line1: React.ReactNode;
  let line2: React.ReactNode;

  if (focus?.kind === "dot") {
    const { pt } = focus;
    const [L, a, b] = pt.lab;
    swatch = labCss(L, a, b);
    line1 = (
      <>
        {pt.role && <span style={{ color: ROLE_COLOR[pt.role] }}>{pt.role} · </span>}
        {pt.title}
      </>
    );
    line2 = (
      <>
        L* {num(L, 1)} a* {num(a, 1)} b* {num(b, 1)} · hue {Math.round(hueDeg(a, b))}°
        {pt.distance != null && <> · distance {pt.distance.toFixed(1)}</>}
      </>
    );
  } else if (focus) {
    const { a, b } = focus;
    const shown = inGamut(labToLinear(sliceL, a, b));
    swatch = shown ? labCss(sliceL, a, b) : null;
    line1 = (
      <>
        L* {sliceL} a* {num(a)} b* {num(b)}
      </>
    );
    line2 = shown ? (
      <>
        hue {Math.round(hueDeg(a, b))}° · {Math.round(Math.hypot(a, b))} from grey
      </>
    ) : (
      <>no screen color here at L* {sliceL}</>
    );
  } else {
    line1 = "Point anywhere on the plane to read its color,";
    line2 = "or at a dot to see which panel it is.";
  }

  return (
    <div className="cielab-readout" aria-live="polite">
      <span className={`cielab-swatch${swatch ? "" : " is-empty"}`} style={swatch ? { background: swatch } : undefined} />
      <span className="cielab-readout-text" style={mono}>
        <span>{line1}</span>
        <span>{line2}</span>
      </span>
    </div>
  );
}

/** The L* axis, edge-on: a grey ramp with the three colours' lightness marked. */
function LightnessSlider({ value, onChange, trio }: { value: number; onChange: (v: number) => void; trio: Pt[] }) {
  const ramp = useMemo(
    () => `linear-gradient(to right, ${[0, 20, 40, 60, 80, 100].map((L) => `${labCss(L, 0, 0)} ${L}%`).join(", ")})`,
    []
  );
  const id = useId();
  return (
    <div className="cielab-slider-row">
      <label className="cielab-slider-label" style={mono} htmlFor={id}>
        L* {value}
      </label>
      <div className="cielab-slider-track">
        {trio.map((p) => (
          <span
            key={p.id}
            className="cielab-slider-mark"
            style={{ left: `calc(8px + (100% - 16px) * ${p.lab[0] / 100})`, borderTopColor: ROLE_COLOR[p.role!] }}
            title={`${p.role}: L* ${num(p.lab[0], 1)}`}
          />
        ))}
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="cielab-slider"
          style={{ background: ramp }}
          aria-label="Lightness of the slice shown"
        />
      </div>
    </div>
  );
}
