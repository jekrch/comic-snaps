// AngleDiagram
/* Arrows from a shared origin showing cosine-distance as angle   */

export function AngleDiagram({
  closeDist,
  farDist,
}: {
  closeDist: number;
  farDist: number;
}) {
  const closeAngleTrue = Math.acos(Math.max(-1, Math.min(1, 1 - closeDist)));
  const farAngleTrue = Math.acos(Math.max(-1, Math.min(1, 1 - farDist)));

  //Minimum visual separation 
  // Ensure the diagram is readable even when the real angle is
  // tiny.  The closest arrow is pushed to at least MIN_ANGLE
  // from the anchor, and the furthest to at least MIN_GAP
  // beyond the closest.  Relative ordering is always preserved.
  const MIN_ANGLE = 15 * (Math.PI / 180); // 15°
  const MIN_GAP = 12 * (Math.PI / 180);   // 12° between close & far
  const MAX_ANGLE = 80 * (Math.PI / 180); // cap so arrows stay in view

  let closeAngle = closeAngleTrue;
  let farAngle = farAngleTrue;

  if (closeAngle < MIN_ANGLE) closeAngle = MIN_ANGLE;
  if (farAngle < closeAngle + MIN_GAP) farAngle = closeAngle + MIN_GAP;
  if (farAngle > MAX_ANGLE) farAngle = MAX_ANGLE;
  // If capping the far angle collapses the gap, re-derive close
  if (farAngle - closeAngle < MIN_GAP) closeAngle = farAngle - MIN_GAP;

  //Layout constants
  // Origin shifted left; viewBox widened to give right-side room.
  const W = 240;
  const H = 150;
  const cx = 70;
  const cy = 115;
  const r = 80;
  const anchorAngle = -Math.PI / 2;
  const closeRad = anchorAngle + closeAngle;
  const farRad = anchorAngle + farAngle;

  // Label placement with collision avoidance 
  const labelR = r + 14;
  const labels = buildLabels(cx, cy, labelR, anchorAngle, closeRad, farRad, W, H);

  return (
    <div className="flex justify-center my-3">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Diagram showing embedding vectors as arrows from a common origin, with the angle between them representing distance"
      >
        {arc(cx, cy, anchorAngle, closeRad, 30, "var(--color-accent, #e97d62)")}
        {arc(cx, cy, anchorAngle, farRad, 45, "rgba(255,255,255,0.25)", true)}

        <circle cx={cx} cy={cy} r="2.5" fill="rgba(255,255,255,0.3)" />

        {arrow(cx, cy, r, anchorAngle, "var(--color-ink, #e8e0d8)", labels.anchor)}
        {arrow(cx, cy, r, closeRad, "var(--color-accent, #e97d62)", labels.close)}
        {arrow(cx, cy, r, farRad, "rgba(255,255,255,0.35)", labels.far)}

        <text
          x={cx + 34 * Math.cos(anchorAngle + closeAngleTrue / 2)}
          y={cy + 34 * Math.sin(anchorAngle + closeAngleTrue / 2)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--color-accent, #e97d62)"
          fontSize="7.5"
          fontFamily="var(--font-mono, monospace)"
          opacity="0.8"
        >
          {(closeAngleTrue * (180 / Math.PI)).toFixed(1)}°
        </text>
      </svg>
    </div>
  );
}

/*Label collision helper */

interface LabelInfo {
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  text: string;
}

function buildLabels(
  cx: number,
  cy: number,
  labelR: number,
  anchorAngle: number,
  closeRad: number,
  farRad: number,
  viewW: number,
  _viewH: number
): { anchor: LabelInfo; close: LabelInfo; far: LabelInfo } {
  const LABEL_H = 10; // approximate text height
  const LABEL_W = 52; // approximate text width
  const EDGE_PAD = 4;

  function naturalPos(angle: number, text: string): LabelInfo {
    const x = cx + labelR * Math.cos(angle);
    const y = cy + labelR * Math.sin(angle);
    // Default: labels on the right side use "start", left side "end"
    const side = Math.cos(angle) >= 0 ? "start" : "end";
    return { x, y, anchor: side as "start" | "end", text };
  }

  function labelBBox(l: LabelInfo) {
    let x1: number, x2: number;
    if (l.anchor === "start") {
      x1 = l.x;
      x2 = l.x + LABEL_W;
    } else if (l.anchor === "end") {
      x1 = l.x - LABEL_W;
      x2 = l.x;
    } else {
      x1 = l.x - LABEL_W / 2;
      x2 = l.x + LABEL_W / 2;
    }
    return { x1, y1: l.y - LABEL_H, x2, y2: l.y };
  }

  function overlaps(a: LabelInfo, b: LabelInfo): boolean {
    const ba = labelBBox(a);
    const bb = labelBBox(b);
    return ba.x1 < bb.x2 && ba.x2 > bb.x1 && ba.y1 < bb.y2 && ba.y2 > bb.y1;
  }

  function clampToView(l: LabelInfo): LabelInfo {
    const bb = labelBBox(l);
    let dx = 0;
    if (bb.x2 > viewW - EDGE_PAD) dx = viewW - EDGE_PAD - bb.x2;
    if (bb.x1 < EDGE_PAD) dx = EDGE_PAD - bb.x1;
    return { ...l, x: l.x + dx };
  }

  const anchor = clampToView(naturalPos(anchorAngle, "anchor"));
  let close = clampToView(naturalPos(closeRad, "closest"));
  let far = clampToView(naturalPos(farRad, "furthest"));

  // Nudge close label if it overlaps anchor
  if (overlaps(anchor, close)) {
    close = { ...close, y: close.y + LABEL_H + 2 };
    close = clampToView(close);
  }

  // Nudge far label if it overlaps close
  if (overlaps(close, far)) {
    far = { ...far, y: far.y + LABEL_H + 2 };
    far = clampToView(far);
  }

  // Second pass: if far still overlaps anchor
  if (overlaps(anchor, far)) {
    far = { ...far, y: far.y + LABEL_H + 2 };
    far = clampToView(far);
  }

  return { anchor, close, far };
}

/* Arrow helper */

function arrow(
  cx: number,
  cy: number,
  r: number,
  angle: number,
  color: string,
  label: LabelInfo
) {
  const ex = cx + r * Math.cos(angle);
  const ey = cy + r * Math.sin(angle);
  const headLen = 7;
  const headAngle = 0.4;
  const h1x = ex - headLen * Math.cos(angle - headAngle);
  const h1y = ey - headLen * Math.sin(angle - headAngle);
  const h2x = ex - headLen * Math.cos(angle + headAngle);
  const h2y = ey - headLen * Math.sin(angle + headAngle);

  return (
    <>
      <line
        x1={cx}
        y1={cy}
        x2={ex}
        y2={ey}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polyline
        points={`${h1x},${h1y} ${ex},${ey} ${h2x},${h2y}`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x={label.x}
        y={label.y}
        textAnchor={label.anchor}
        dominantBaseline="middle"
        fill={color}
        fontSize="8"
        fontFamily="var(--font-mono, monospace)"
      >
        {label.text}
      </text>
    </>
  );
}

/* Arc helper */

function arc(
  cx: number,
  cy: number,
  fromRad: number,
  toRad: number,
  arcR: number,
  color: string,
  dashed?: boolean
) {
  const steps = 24;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = fromRad + (toRad - fromRad) * (i / steps);
    points.push(`${cx + arcR * Math.cos(t)},${cy + arcR * Math.sin(t)}`);
  }
  return (
    <polyline
      points={points.join(" ")}
      fill="none"
      stroke={color}
      strokeWidth="1"
      strokeDasharray={dashed ? "2,2" : "none"}
      opacity={0.5}
    />
  );
}

// CielabDiagram 
/* a/b plane with label collision avoidance                      */

export function CielabDiagram({
  anchorLab,
  closeLab,
  farLab,
  anchorLabel,
  closeLabel,
  farLabel,
}: {
  anchorLab: [number, number, number];
  closeLab: [number, number, number];
  farLab: [number, number, number];
  anchorLabel: string;
  closeLabel: string;
  farLabel: string;
}) {
  const points = [anchorLab, closeLab, farLab];
  const aVals = points.map((p) => p[1]);
  const bVals = points.map((p) => p[2]);

  const aMin = Math.min(...aVals);
  const aMax = Math.max(...aVals);
  const bMin = Math.min(...bVals);
  const bMax = Math.max(...bVals);

  const pad = Math.max((aMax - aMin) * 0.45, (bMax - bMin) * 0.45, 20);
  const domainAMin = aMin - pad;
  const domainAMax = aMax + pad;
  const domainBMin = bMin - pad;
  const domainBMax = bMax + pad;

  const W = 220;
  const H = 180;
  const margin = { top: 18, right: 14, bottom: 26, left: 32 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const scaleA = (a: number) =>
    margin.left + ((a - domainAMin) / (domainAMax - domainAMin)) * plotW;
  const scaleB = (b: number) =>
    margin.top + ((domainBMax - b) / (domainBMax - domainBMin)) * plotH;

  const anchorXY = [scaleA(anchorLab[1]), scaleB(anchorLab[2])] as const;
  const closeXY = [scaleA(closeLab[1]), scaleB(closeLab[2])] as const;
  const farXY = [scaleA(farLab[1]), scaleB(farLab[2])] as const;

  const labelPlacements = resolveLabels(
    [anchorXY, closeXY, farXY],
    [anchorLabel, closeLabel, farLabel],
    W,
    H
  );

  const dotData = [
    { xy: anchorXY, lab: anchorLab, ring: "var(--color-ink, #e8e0d8)", placement: labelPlacements[0] },
    { xy: closeXY, lab: closeLab, ring: "var(--color-accent, #e97d62)", placement: labelPlacements[1] },
    { xy: farXY, lab: farLab, ring: "rgba(255,255,255,0.35)", placement: labelPlacements[2] },
  ];

  return (
    <div className="flex justify-center my-3">
      <svg
        width={W} height={H}
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="CIELAB a*b* plane showing anchor and neighbor colors with distance lines"
      >
        <rect
          x={margin.left} y={margin.top}
          width={plotW} height={plotH}
          fill="rgba(0,0,0,0.25)" rx="2"
        />

        {/* Grid lines */}
        {[-60, -30, 0, 30, 60].map((v) => {
          if (v < domainAMin || v > domainAMax) return null;
          const x = scaleA(v);
          return (
            <line key={`ga${v}`}
              x1={x} y1={margin.top} x2={x} y2={margin.top + plotH}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
            />
          );
        })}
        {[-60, -30, 0, 30, 60].map((v) => {
          if (v < domainBMin || v > domainBMax) return null;
          const y = scaleB(v);
          return (
            <line key={`gb${v}`}
              x1={margin.left} y1={y} x2={margin.left + plotW} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
            />
          );
        })}

        {/* Distance lines */}
        <line
          x1={anchorXY[0]} y1={anchorXY[1]}
          x2={closeXY[0]} y2={closeXY[1]}
          stroke="var(--color-accent, #e97d62)"
          strokeWidth="1" strokeDasharray="3,2" opacity="0.6"
        />
        <line
          x1={anchorXY[0]} y1={anchorXY[1]}
          x2={farXY[0]} y2={farXY[1]}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1" strokeDasharray="3,2" opacity="0.5"
        />

        {/* Dots + labels */}
        {dotData.map(({ xy, lab, ring, placement }, i) => (
          <g key={i}>
            <circle cx={xy[0]} cy={xy[1]} r="6"
              fill={labToDisplayRgb(lab as [number, number, number])}
            />
            <circle cx={xy[0]} cy={xy[1]} r="6"
              fill="none" stroke={ring} strokeWidth="1.5"
            />
            <text
              x={placement.x} y={placement.y}
              textAnchor={placement.anchor}
              fontSize="7" fontFamily="var(--font-mono, monospace)"
              fill={ring}
            >
              {placement.label}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text
          x={margin.left + plotW / 2} y={H - 4}
          textAnchor="middle" fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.25)"
        >
          a* (green → red)
        </text>
        <text
          x={8} y={margin.top + plotH / 2}
          textAnchor="middle" fontSize="8"
          fontFamily="var(--font-mono, monospace)"
          fill="rgba(255,255,255,0.25)"
          transform={`rotate(-90, 8, ${margin.top + plotH / 2})`}
        >
          b* (blue → yellow)
        </text>
      </svg>
    </div>
  );
}

// CIELAB → sRGB conversion */

function labToDisplayRgb(lab: [number, number, number]): string {
  const [L, a, b] = lab;
  let fy = (L + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;
  const delta = 6 / 29;
  const xn = 0.9505, yn = 1.0, zn = 1.089;
  const invF = (t: number) =>
    t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);
  const X = xn * invF(fx);
  const Y = yn * invF(fy);
  const Z = zn * invF(fz);
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const gamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const clamp = (c: number) =>
    Math.max(0, Math.min(255, Math.round(gamma(c) * 255)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(bl)})`;
}

// Label collision avoidance */

interface LabelPlacement {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  label: string;
}

function resolveLabels(
  coords: readonly (readonly [number, number])[],
  labels: string[],
  viewW: number,
  viewH: number
): LabelPlacement[] {
  const DOT_R = 8;
  const LABEL_W = 58;
  const LABEL_H = 10;

  function getCandidates(px: number, py: number): Omit<LabelPlacement, "label">[] {
    return [
      { x: px + DOT_R, y: py + 3, anchor: "start" },
      { x: px - DOT_R, y: py + 3, anchor: "end" },
      { x: px + DOT_R, y: py - DOT_R, anchor: "start" },
      { x: px - DOT_R, y: py - DOT_R, anchor: "end" },
      { x: px + DOT_R, y: py + DOT_R + LABEL_H, anchor: "start" },
      { x: px - DOT_R, y: py + DOT_R + LABEL_H, anchor: "end" },
      { x: px, y: py - DOT_R - 2, anchor: "middle" },
      { x: px, y: py + DOT_R + LABEL_H, anchor: "middle" },
    ];
  }

  function bbox(p: Omit<LabelPlacement, "label">) {
    let x1: number, x2: number;
    if (p.anchor === "start") { x1 = p.x; x2 = p.x + LABEL_W; }
    else if (p.anchor === "end") { x1 = p.x - LABEL_W; x2 = p.x; }
    else { x1 = p.x - LABEL_W / 2; x2 = p.x + LABEL_W / 2; }
    return { x1, y1: p.y - LABEL_H, x2, y2: p.y };
  }

  function overlap(
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number }
  ): number {
    return (
      Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) *
      Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
    );
  }

  function oobPenalty(bb: { x1: number; y1: number; x2: number; y2: number }): number {
    let p = 0;
    if (bb.x1 < 2) p += (2 - bb.x1) * 10;
    if (bb.x2 > viewW - 2) p += (bb.x2 - (viewW - 2)) * 10;
    if (bb.y1 < 2) p += (2 - bb.y1) * 10;
    if (bb.y2 > viewH - 2) p += (bb.y2 - (viewH - 2)) * 10;
    return p;
  }

  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const result: LabelPlacement[] = [];

  for (let i = 0; i < coords.length; i++) {
    const [px, py] = coords[i];
    const candidates = getCandidates(px, py);
    let best = candidates[0];
    let bestCost = Infinity;

    for (const c of candidates) {
      const bb = bbox(c);
      let cost = oobPenalty(bb);
      for (const existing of placed) cost += overlap(bb, existing) * 5;
      if (cost < bestCost) { bestCost = cost; best = c; }
    }

    placed.push(bbox(best));
    result.push({ ...best, label: labels[i] });
  }

  return result;
}