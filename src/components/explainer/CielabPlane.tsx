import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Panel } from "../../types";
import type { NeighborInfo } from "./explainerConstants";
import { sortColor } from "../../utils/sorting";
import { panelImageUrl } from "../../utils/imageUrl";
import {
  colorName,
  dist3,
  hueDeg,
  hueGap,
  hueName,
  inGamut,
  labCss,
  labToLinear,
  num,
  panelName,
  to8,
  type Lab,
} from "./cielab";

/**
 * The a*-b* plane of CIELAB, looked at straight down the L* axis: one slice
 * of the colour space, painted in the colours that actually live there, with
 * the anchor and its closest and furthest neighbours plotted on it.
 *
 * The lesson shows it three times, one layer per step, so no figure asks the
 * reader to decode an idea the prose hasn't reached yet:
 *  - "channels": the plane, its plain-word axes and the three colours, with a
 *    slider that moves the slice through lightness.
 *  - "hue": a line from grey out to each colour, and the angle it makes.
 *  - "distance": the rest of the comparison group, the anchor's separation
 *    from its two neighbours, and the chroma scale.
 * Each stage leads with a sentence, written from the data, saying what the
 * picture shows.
 */

export type CielabStage = "channels" | "hue" | "distance";

type Role = "anchor" | "closest" | "furthest";

interface Pt {
  id: string;
  title: string;
  /** The colour plotted for this stage. */
  lab: Lab;
  role?: Role;
  /** The colour metric's distance from the anchor (palette-weighted). */
  distance?: number;
  /** Hue stage: the panel's measured key colour, which isn't one of its palette entries. */
  key?: boolean;
  /** Hue stage: the panel counts as black-and-white, so it has no key colour. */
  noHue?: boolean;
  /** The three highlighted panels only: their picture and whole palette. */
  image?: string;
  palette?: readonly Lab[];
  /** Each palette colour's share of the panel's pixels, when measured. */
  shares?: readonly number[] | null;
}

type Focus = { kind: "dot"; pt: Pt } | { kind: "plane"; a: number; b: number } | null;

const ROLE_COLOR: Record<Role, string> = {
  anchor: "var(--color-ink, #e8e0d8)",
  closest: "var(--color-accent, #e97d62)",
  furthest: "rgba(255,255,255,0.55)",
};

const ROLE_NOUN: Record<Role, string> = {
  anchor: "the anchor",
  closest: "the closest match",
  furthest: "the furthest match",
};

/** viewBox size; the plot fills it, origin in the middle. */
const S = 300;
const C = S / 2;
/** Background canvas resolution. Smoothed up to the drawn size. */
const RES = 160;

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };
const halo = { stroke: "rgba(10,9,9,0.85)", strokeWidth: 3, paintOrder: "stroke" } as const;

const hueOf = (lab: Lab) => hueDeg(lab[1], lab[2]);

/** The colour a stage plots for a panel: the hue sort's colour on the hue step, else the main one. */
function stageColor(p: Panel, stage: CielabStage): Pick<Pt, "lab" | "key" | "noHue"> {
  const main = p.dominantColors![0];
  if (stage !== "hue") return { lab: main };
  const c = sortColor(p);
  // Measured panels sort by their key colour; older ones by a palette entry.
  return c ? { lab: c, key: !p.dominantColors!.includes(c) } : { lab: main, noHue: true };
}

// Component ------------------------------------------------------------------

export function CielabPlane({
  stage,
  anchor,
  closest,
  furthest,
  all = [],
}: {
  stage: CielabStage;
  anchor: Panel;
  closest: NeighborInfo;
  furthest: NeighborInfo;
  /** Every panel the anchor was compared with; plotted faintly on the distance step. */
  all?: NeighborInfo[];
}) {
  const trio = useMemo<Pt[]>(() => {
    const pt = (p: Panel, role: Role, distance?: number): Pt => ({
      id: p.id,
      title: panelName(p),
      role,
      distance,
      image: panelImageUrl(p.image),
      palette: p.dominantColors!,
      shares: p.dominantWeights ?? null,
      ...stageColor(p, stage),
    });
    return [
      pt(anchor, "anchor"),
      pt(closest.panel, "closest", closest.distance),
      pt(furthest.panel, "furthest", furthest.distance),
    ];
  }, [anchor, closest, furthest, stage]);

  // One scale for all three stages, so the picture doesn't zoom between
  // steps: fit every colour any stage plots for the three, centred on grey.
  const R = useMemo(() => {
    const labs = [anchor, closest.panel, furthest.panel].flatMap((p) => [
      p.dominantColors![0],
      sortColor(p) ?? p.dominantColors![0],
    ]);
    const m = Math.max(...labs.flatMap((l) => [Math.abs(l[1]), Math.abs(l[2])]));
    return Math.min(120, Math.max(30, Math.ceil((m * 1.3) / 10) * 10));
  }, [anchor, closest, furthest]);

  const cloud = useMemo<Pt[]>(() => {
    if (stage !== "distance") return [];
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
  }, [stage, all, trio, R]);

  // Only the channels step lets the reader move the slice; the later steps
  // stay at the anchor's lightness.
  const [userL, setUserL] = useState(() => Math.round(trio[0].lab[0]));
  const sliceL = stage === "channels" ? userL : Math.round(trio[0].lab[0]);
  const [focus, setFocus] = useState<Focus>(null);

  const sx = (a: number) => C + (a / R) * C;
  const sy = (b: number) => C - (b / R) * C;

  // Each colour is drawn as a chip big enough to read, nudged clear of the
  // others where they'd overlap; a small marker and a leader keep its true spot.
  const chips = placeChips(trio.map((p) => [sx(p.lab[1]), sy(p.lab[2])]));
  const labels = placeLabels(trio, chips);

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
    // The highlighted three are hit on their chips, not their true spots.
    let hit: Pt | null = null;
    let bestD = (CHIP + 3) ** 2;
    for (let i = 0; i < chips.length; i++) {
      const d = (chips[i].x - x) ** 2 + (chips[i].y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        hit = trio[i];
      }
    }
    hit ??= near(cloud, 6);
    if (hit) return { kind: "dot", pt: hit };
    return { kind: "plane", a: ((x - C) / C) * R, b: ((C - y) / C) * R };
  }

  const onPointer = (e: React.PointerEvent) => setFocus(locate(e.clientX, e.clientY));
  const onClick = (e: React.MouseEvent) => {
    if (stage !== "channels") return;
    const f = locate(e.clientX, e.clientY);
    if (f?.kind === "dot") setUserL(Math.round(f.pt.lab[0]));
  };

  // Chroma rings: distance from grey. Numbered only where distances matter.
  const ringStep = R <= 40 ? 10 : R <= 80 ? 20 : 40;
  const rings: number[] = [];
  for (let c = ringStep; c < R * 1.42; c += ringStep) rings.push(c);

  // What the guides are drawn for: the pointer, or on the hue step the
  // anchor until the reader points somewhere.
  const guided: Focus = focus ?? (stage === "hue" ? { kind: "dot", pt: trio[0] } : null);
  const guideAB = guided?.kind === "dot" ? [guided.pt.lab[1], guided.pt.lab[2]] : guided ? [guided.a, guided.b] : null;
  const focusId = focus?.kind === "dot" ? focus.pt.id : null;

  const takeawayId = useId();

  const edge = (word: string, axis: string, x: number, y: number, pos: "start" | "end", color: string) => (
    <text x={x} y={y} textAnchor={pos} fontSize="10" style={mono} fill={color} {...halo}>
      {pos === "end" && <tspan fill="rgba(255,255,255,0.55)" fontSize="8.5">{axis} </tspan>}
      {word}
      {pos === "start" && <tspan fill="rgba(255,255,255,0.55)" fontSize="8.5"> {axis}</tspan>}
    </text>
  );

  return (
    <figure className="guide-figure cielab">
      <p id={takeawayId} className="cielab-takeaway">
        {takeaway(stage, trio, cloud)}
      </p>

      <Readout stage={stage} focus={focus} sliceL={sliceL} />

      <div className="cielab-plot">
        <canvas ref={canvasRef} width={RES} height={RES} aria-hidden="true" />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${S} ${S}`}
          role="img"
          aria-label={`CIELAB a*/b* plane at lightness ${sliceL}`}
          aria-describedby={takeawayId}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setFocus(null)}
          onClick={onClick}
        >
          {rings.map((c) => (
            <circle key={c} cx={C} cy={C} r={(c / R) * C} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.8" />
          ))}
          {stage === "distance" &&
            rings.map((c) =>
              sx(c) < S - 14 ? (
                <text key={`t${c}`} x={sx(c) + 2} y={C + 10} fontSize="7.5" style={mono}
                  fill="rgba(255,255,255,0.6)" stroke="rgba(10,9,9,0.7)" strokeWidth="2.5" paintOrder="stroke">
                  {c}
                </text>
              ) : null
            )}

          {/* Axes through neutral grey, named for what moving along them does. */}
          <line x1={0} y1={C} x2={S} y2={C} stroke="rgba(10,9,9,0.55)" strokeWidth="1" />
          <line x1={C} y1={0} x2={C} y2={S} stroke="rgba(10,9,9,0.55)" strokeWidth="1" />
          {edge("redder", "+a*", S - 6, C - 6, "end", labCss(72, 55, 25))}
          {edge("greener", "−a*", 6, C - 6, "start", labCss(78, -55, 30))}
          {edge("yellower", "+b*", C + 6, 14, "start", labCss(88, -5, 70))}
          {edge("bluer", "−b*", C + 6, S - 8, "start", labCss(68, 0, -50))}

          {/* Distance step: the rest of the group, and the anchor's separations. */}
          {cloud.map((p) => (
            <circle key={p.id} cx={sx(p.lab[1])} cy={sy(p.lab[2])} r={2.6}
              fill={labCss(...p.lab)} stroke="rgba(0,0,0,0.6)" strokeWidth="0.7" />
          ))}
          {stage === "distance" &&
            trio.slice(1).map((p) => (
              <line key={`d${p.id}`}
                x1={sx(trio[0].lab[1])} y1={sy(trio[0].lab[2])} x2={sx(p.lab[1])} y2={sy(p.lab[2])}
                stroke={ROLE_COLOR[p.role!]} strokeWidth="1.4" strokeDasharray="4,3" />
            ))}

          {/* Hue step: a line from grey out to each colour. */}
          {stage === "hue" &&
            trio.map((p) => (
              <line key={`h${p.id}`} x1={C} y1={C} x2={sx(p.lab[1])} y2={sy(p.lab[2])}
                stroke={ROLE_COLOR[p.role!]} strokeWidth="1.4" opacity="0.9" />
            ))}

          {guideAB && stage !== "distance" && (
            <FocusGuides a={guideAB[0]} b={guideAB[1]} R={R} projections={stage === "channels"} angle={stage === "hue"} />
          )}

          {/* Leaders from a nudged chip back to the colour's true spot. */}
          {chips.map((c, i) =>
            c.moved ? (
              <g key={`m${trio[i].id}`} pointerEvents="none">
                <line x1={c.tx} y1={c.ty} x2={c.x} y2={c.y} stroke="rgba(10,9,9,0.8)" strokeWidth="2.6" />
                <line x1={c.tx} y1={c.ty} x2={c.x} y2={c.y} stroke={ROLE_COLOR[trio[i].role!]} strokeWidth="1.1" />
                <circle cx={c.tx} cy={c.ty} r={3} fill={labCss(...trio[i].lab)} stroke="rgba(10,9,9,0.9)" strokeWidth="1.2" />
              </g>
            ) : null
          )}

          {trio.map((p, i) => (
            <g key={p.id}>
              <circle cx={chips[i].x} cy={chips[i].y} r={CHIP + 1.6} fill="none" stroke="rgba(10,9,9,0.85)" strokeWidth="1.4" />
              <circle cx={chips[i].x} cy={chips[i].y} r={CHIP} fill={labCss(...p.lab)}
                stroke={ROLE_COLOR[p.role!]} strokeWidth="2.4" />
              <circle cx={chips[i].x} cy={chips[i].y} r={CHIP - 1.6} fill="none" stroke="rgba(10,9,9,0.5)" strokeWidth="0.8" />
            </g>
          ))}

          {/* Direct labels, so the roles never rest on ring colour alone. */}
          {labels.map((l) => (
            <text key={l.role} x={l.x} y={l.y} textAnchor={l.end ? "end" : "start"} fontSize="9.5"
              style={mono} fill={ROLE_COLOR[l.role]} pointerEvents="none" {...halo}>
              {l.role}
            </text>
          ))}

          {focus?.kind === "dot" && (() => {
            const i = trio.findIndex((p) => p.id === focus.pt.id && focus.pt.role);
            const [x, y] = i >= 0 ? [chips[i].x, chips[i].y] : [sx(focus.pt.lab[1]), sy(focus.pt.lab[2])];
            return <circle cx={x} cy={y} r={i >= 0 ? CHIP + 4 : 6} fill="none" stroke="#fff" strokeWidth="1.2" pointerEvents="none" />;
          })()}
        </svg>
      </div>

      {stage === "channels" && <LightnessSlider value={sliceL} onChange={setUserL} trio={trio} />}

      <ul className="cielab-cards" onMouseLeave={() => setFocus(null)}>
        {trio.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={focusId === p.id ? "is-on" : undefined}
              style={{ "--role": ROLE_COLOR[p.role!] } as React.CSSProperties}
              onMouseEnter={() => setFocus({ kind: "dot", pt: p })}
              onFocus={() => setFocus({ kind: "dot", pt: p })}
              onBlur={() => setFocus(null)}
              onClick={stage === "channels" ? () => setUserL(Math.round(p.lab[0])) : undefined}
              title={stage === "channels" ? "Move the lightness slice to this color" : undefined}
            >
              <img className="cielab-card-img" src={p.image} alt="" loading="lazy" decoding="async" draggable={false} />
              <Palette pt={p} />
              <span className="cielab-card-role">{p.role}</span>
              <span className="cielab-card-name">{colorName(...p.lab).replace(/^an? /, "")}</span>
              <span className="cielab-card-line" style={mono}>{legendLine(stage, p)}</span>
              <span className="cielab-card-title">{p.title}</span>
            </button>
          </li>
        ))}
      </ul>

      <figcaption className="guide-caption mt-2 text-center">
        {CAPTION[stage]}
        {chips.some((c) => c.moved) &&
          " Colors too close to tell apart are nudged aside; the small dot at the end of each line marks the true spot."}
      </figcaption>
    </figure>
  );
}

const CAPTION: Record<CielabStage, string> = {
  channels:
    "Looking down the L* axis at one slice of CIELAB, at the lightness the slider sets. Each dot is a panel's main color. Where the plane goes dark, no screen can show that color at this lightness.",
  hue: "The same plane at the anchor's lightness. Each line runs from grey out to the color a panel is sorted by; the angle it makes is the hue.",
  distance:
    "The same plane with every panel the anchor was compared with. The dashed lines join the anchor's main color to its closest and furthest matches'; the rings count distance from grey.",
};

// Words ----------------------------------------------------------------------

/** "the anchor", "the anchor and the closest match", "a, b and c". */
function listRoles(pts: Pt[]): string {
  const n = pts.map((p) => ROLE_NOUN[p.role!]);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** The figure's point, a sentence or three, written from the data. Exported for tests. */
export function takeaway(stage: CielabStage, trio: Pt[], cloud: Pt[]): string {
  const [A, Cl, F] = trio;
  const name = (p: Pt) => colorName(...p.lab);

  if (stage === "channels") {
    const [, a, b] = A.lab;
    const nA = name(A), nC = name(Cl), nF = name(F);
    const bare = (n: string) => n.replace(/^an? /, "");
    const rest =
      nC === nA && nF === nA
        ? `Its closest and furthest matches' main colors are ${bare(nA)} too.`
        : nC === nA
          ? `Its closest match's main color is ${bare(nA)} too; the furthest's is ${nF}.`
          : `Its closest match's main color is ${nC}; the furthest's is ${nF}.`;
    // Paper and ink are often the biggest cluster; say why that's fine.
    const paper = Math.hypot(a, b) < 8 ? " Main colors are often paper or ink, which is one reason the distance looks at the whole palette." : "";
    if (Math.abs(a) < 3 && Math.abs(b) < 3)
      return `The anchor's main color is ${nA}: a* ${num(a)} and b* ${num(b)} keep it at the grey center, neither redder nor greener, yellower nor bluer. ${rest}${paper}`;
    const across =
      Math.abs(a) < 3
        ? `a* ${num(a)} keeps it close to the vertical axis`
        : `a* ${num(a)} puts it ${a > 0 ? "right of center (redder)" : "left of center (greener)"}`;
    const up =
      Math.abs(b) < 3
        ? `b* ${num(b)} keeps it close to the horizontal axis`
        : `b* ${num(b)} puts it ${b > 0 ? "above center (yellower)" : "below center (bluer)"}`;
    return `The anchor's main color is ${nA}: ${across}, and ${up}. ${rest}${paper}`;
  }

  if (stage === "hue") {
    const deg = (p: Pt) => `${Math.round(hueOf(p.lab))}°`;
    const gap = (p: Pt) => Math.round(hueGap(hueOf(A.lab), hueOf(p.lab)));
    const out: string[] = [];
    if (A.noHue) {
      out.push("The anchor counts as black-and-white, so it has no hue: it sorts by lightness, after every color panel.");
    } else {
      out.push(`The anchor's hue angle is ${deg(A)} (${hueName(...A.lab)}).`);
      const say = (p: Pt, tail: string) => (p.noHue ? "counts as black-and-white" : `sits at ${deg(p)}, ${gap(p)}° away${tail}`);
      out.push(`The closest match ${say(Cl, " around the wheel")}; the furthest ${say(F, "")}.`);
      if (!Cl.noHue && gap(Cl) > 45)
        out.push("Neighbors in the similarity graph needn't be neighbors in the sort; the next step says why.");
    }
    // The key colour is measured from a panel's coloured pixels alone, so it
    // can sit well away from the main colour the first figure plotted.
    if (trio.some((p) => p.key && dist3(p.lab, p.palette![0]) > 8))
      out.push("The sort goes by each panel's key color, measured from its colored pixels alone, so these dots can sit away from the main colors in the first figure.");
    const alsoNone = A.noHue ? [Cl, F].filter((p) => p.noHue) : [];
    if (alsoNone.length) out.push(`The same goes for ${listRoles(alsoNone)}.`);
    return out.join(" ");
  }

  const flat = (p: Pt) => Math.hypot(p.lab[1] - A.lab[1], p.lab[2] - A.lab[2]);
  const nearer = cloud.filter((p) => flat(p) < flat(Cl)).length;
  const lead = `Measured over the whole palette, the closest match is ${Cl.distance!.toFixed(1)} away and the furthest ${F.distance!.toFixed(1)}.`;
  const why = "the plot shows only each panel's main color, seen from above, while the distance also counts lightness and the other two palette colors.";
  return nearer > 0
    ? `${lead} On the plot, ${nearer} faint ${nearer === 1 ? "dot looks" : "dots look"} nearer the anchor than the closest match does: ${why}`
    : `${lead} The dots won't line up exactly with those numbers: ${why}`;
}

function legendLine(stage: CielabStage, p: Pt): string {
  const [L, a, b] = p.lab;
  if (stage === "channels") return `L* ${num(L)} · a* ${num(a)} · b* ${num(b)}`;
  if (stage === "hue")
    return p.noHue ? "black-and-white: no hue" : `hue ${Math.round(hueDeg(a, b))}° · ${hueName(L, a, b)}`;
  return p.distance == null ? "the reference" : `distance ${p.distance.toFixed(1)}`;
}

// Layout ---------------------------------------------------------------------

/** Radius of the chip each highlighted colour is drawn as. */
const CHIP = 10;

interface Chip {
  /** Where the chip is drawn. */
  x: number;
  y: number;
  /** The colour's true spot on the plane. */
  tx: number;
  ty: number;
  moved: boolean;
}

/**
 * Chip positions: each on its colour's true spot, unless that overlaps
 * another chip, in which case the pair is pushed apart just far enough. The
 * anchor barely moves, so it stays the fixed point the others are read from.
 * Chips that start on the same spot fan out in fixed directions, so the
 * layout is the same every time.
 */
/** Exported for tests. */
export function placeChips(spots: [number, number][]): Chip[] {
  const chips = spots.map(([x, y]) => ({ x, y, tx: x, ty: y, moved: false }));
  const gap = CHIP * 2 + 6;
  const give = [0.1, 1, 1]; // anchor, closest, furthest
  const fan = [-Math.PI / 2, (5 * Math.PI) / 6, Math.PI / 6];
  const lo = CHIP + 3;
  const hi = S - CHIP - 3;
  for (let pass = 0; pass < 60; pass++) {
    let clear = true;
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const p = chips[i];
        const q = chips[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d = Math.hypot(dx, dy);
        if (d >= gap - 0.01) continue;
        clear = false;
        if (d < 0.5) {
          dx = Math.cos(fan[j]) - Math.cos(fan[i]);
          dy = Math.sin(fan[j]) - Math.sin(fan[i]);
          d = Math.hypot(dx, dy);
        }
        const push = gap - Math.min(d, gap);
        const share = give[j] / (give[i] + give[j]);
        p.x -= (dx / d) * push * (1 - share);
        p.y -= (dy / d) * push * (1 - share);
        q.x += (dx / d) * push * share;
        q.y += (dy / d) * push * share;
      }
    }
    for (const c of chips) {
      c.x = Math.min(hi, Math.max(lo, c.x));
      c.y = Math.min(hi, Math.max(lo, c.y));
    }
    if (clear) break;
  }
  for (const c of chips) c.moved = Math.hypot(c.x - c.tx, c.y - c.ty) > 3;
  return chips;
}

/**
 * Role labels beside the three chips: to the right unless that runs off the
 * plot, then nudged down wherever two would overlap.
 */
function placeLabels(trio: Pt[], chips: Chip[]) {
  const width = (t: string) => t.length * 5.8 + 2;
  const items = trio.map((p, i) => {
    const { x, y } = chips[i];
    const right = x < S - 70;
    return { role: p.role!, x: right ? x + CHIP + 5 : x - CHIP - 5, y: y + 3.5, end: !right };
  });
  const span = (l: (typeof items)[number]) => (l.end ? [l.x - width(l.role), l.x] : [l.x, l.x + width(l.role)]);
  const order = [...items].sort((p, q) => p.y - q.y);
  for (let i = 1; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      const [a0, a1] = span(order[j]);
      const [b0, b1] = span(order[i]);
      if (a1 < b0 || b1 < a0) continue;
      if (order[i].y - order[j].y < 11) order[i].y = order[j].y + 11;
    }
  }
  for (const l of items) l.y = Math.min(S - 4, Math.max(10, l.y));
  return items;
}

/**
 * A panel's palette, each colour as wide as its share of the pixels, with the
 * one plotted ringed. On the hue step the plotted colour is the measured key
 * colour, which isn't in the palette, so it gets a chip of its own.
 */
function Palette({ pt }: { pt: Pt }) {
  const palette = pt.palette!;
  const at = palette.indexOf(pt.lab);
  const lab = (c: Lab) => `L* ${num(c[0])} a* ${num(c[1])} b* ${num(c[2])}`;
  return (
    <span className="cielab-palette" aria-hidden="true">
      {palette.map((c, i) => {
        const share = pt.shares?.[i];
        return (
          <span
            key={i}
            className={i === at ? "is-plotted" : undefined}
            style={{ background: labCss(...c), flexGrow: Math.max(0.12, share ?? 1 / palette.length) }}
            title={`${i === 0 ? "main" : i === 1 ? "2nd" : "3rd"} color${share != null ? `, ${Math.round(share * 100)}% of the panel` : ""} · ${lab(c)}`}
          />
        );
      })}
      {at < 0 && pt.key && (
        <span className="cielab-palette-key is-plotted" style={{ background: labCss(...pt.lab) }} title={`key color · ${lab(pt.lab)}`} />
      )}
    </span>
  );
}

// Parts ----------------------------------------------------------------------

/**
 * Channels step: projections onto both axes, how a point's two numbers are
 * read. Hue step: the ray from grey and the angle it makes.
 */
function FocusGuides({ a, b, R, projections, angle }: { a: number; b: number; R: number; projections: boolean; angle: boolean }) {
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
      {projections && (
        <>
          <line x1={x} y1={y} x2={x} y2={C} stroke="rgba(255,255,255,0.75)" strokeWidth="0.8" strokeDasharray="2,2" />
          <line x1={x} y1={y} x2={C} y2={y} stroke="rgba(255,255,255,0.75)" strokeWidth="0.8" strokeDasharray="2,2" />
        </>
      )}
      {angle && dist > 4 && (
        <>
          <line x1={C} y1={C} x2={C + Math.max(rr + 6, 30)} y2={C} stroke="#fff" strokeWidth="1" opacity="0.6" />
          <line x1={C} y1={C} x2={x} y2={y} stroke="#fff" strokeWidth="1" opacity="0.85" />
          <path
            d={`M ${C + rr} ${C} A ${rr} ${rr} 0 ${h > 180 ? 1 : 0} 0 ${ex} ${ey}`}
            fill="none" stroke="#fff" strokeWidth="1.4"
          />
          <text
            x={C + lr * Math.cos(mid)} y={C - lr * Math.sin(mid) + 3}
            textAnchor="middle" fontSize="10" style={mono} fill="#fff" {...halo}
          >
            {Math.round(h)}°
          </text>
        </>
      )}
    </g>
  );
}

const PROMPT: Record<CielabStage, [string, string]> = {
  channels: ["Point anywhere on the plane to read its a* and b*,", "or at a dot to see which panel it is."],
  hue: ["Point anywhere on the plane to read its hue angle,", "or at a dot to see which panel it is."],
  distance: ["Point at a dot to see which panel it is", "and how far its palette is from the anchor's."],
};

/** Two fixed lines about whatever is under the pointer, in the stage's terms. */
function Readout({ stage, focus, sliceL }: { stage: CielabStage; focus: Focus; sliceL: number }) {
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
    line2 =
      stage === "channels"
        ? `L* ${num(L, 1)} a* ${num(a, 1)} b* ${num(b, 1)}`
        : stage === "hue"
          ? `hue ${Math.round(hueDeg(a, b))}° · ${hueName(L, a, b)}${pt.key ? " · key color" : ""}`
          : `${colorName(L, a, b).replace(/^an? /, "")} · ${pt.distance != null ? `distance ${pt.distance.toFixed(1)}` : "the reference"}`;
  } else if (focus) {
    const { a, b } = focus;
    const shown = inGamut(labToLinear(sliceL, a, b));
    swatch = shown ? labCss(sliceL, a, b) : null;
    line1 =
      stage === "hue"
        ? `hue ${Math.round(hueDeg(a, b))}° · ${hueName(sliceL, a, b)}`
        : `a* ${num(a)} b* ${num(b)} · ${Math.round(Math.hypot(a, b))} from grey`;
    line2 = shown ? `at L* ${sliceL}: ${colorName(sliceL, a, b).replace(/^an? /, "")}` : `no screen color here at L* ${sliceL}`;
  } else {
    [line1, line2] = PROMPT[stage];
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
