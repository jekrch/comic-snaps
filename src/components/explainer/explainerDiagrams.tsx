/** How much larger than their drawn size the diagrams may grow in the Guide's
 *  reading column. They're drawn in px for a 460px modal; the text inside
 *  scales with them. */
const DIAGRAM_SCALE = 1.6;

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
  // Angles past 90° are real: gram distances often exceed 1 (PCA centres
  // its vectors), so the furthest arrow may point below the origin. The cap
  // only keeps it from folding back onto the anchor's own line.
  const MIN_ANGLE = 15 * (Math.PI / 180); // 15°
  const MIN_GAP = 12 * (Math.PI / 180);   // 12° between close & far
  const MAX_ANGLE = 170 * (Math.PI / 180);

  let closeAngle = closeAngleTrue;
  let farAngle = farAngleTrue;

  if (closeAngle < MIN_ANGLE) closeAngle = MIN_ANGLE;
  if (farAngle < closeAngle + MIN_GAP) farAngle = closeAngle + MIN_GAP;
  if (farAngle > MAX_ANGLE) farAngle = MAX_ANGLE;
  // If capping the far angle collapses the gap, re-derive close
  if (farAngle - closeAngle < MIN_GAP) closeAngle = farAngle - MIN_GAP;

  //Layout constants
  // Origin shifted left; viewBox widened to give right-side room. The
  // height grows only when the far arrow (and its label) dips below the
  // origin, so acute cases keep the original compact box.
  const W = 240;
  const cx = 70;
  const cy = 115;
  const r = 80;
  const labelR = r + 14;
  const below = Math.max(0, -Math.cos(farAngle)); // 0 until past 90°
  const H = Math.max(150, Math.ceil(cy + labelR * below + 12));
  const anchorAngle = -Math.PI / 2;
  const closeRad = anchorAngle + closeAngle;
  const farRad = anchorAngle + farAngle;

  // Label placement with collision avoidance
  const labels = buildLabels(cx, cy, labelR, anchorAngle, closeRad, farRad, W, H);
  const deg = (a: number) => `${(a * (180 / Math.PI)).toFixed(1)}°`;
  // The far angle's readout sits between the two arrows, past the arcs.
  const farTextRad = anchorAngle + (closeAngle + farAngle) / 2;

  return (
    <div className="flex justify-center my-3">
      <svg
        width={W}
        height={H}
        style={{ width: "100%", maxWidth: W * DIAGRAM_SCALE, height: "auto" }}
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
          x={cx + 34 * Math.cos(anchorAngle + closeAngle / 2)}
          y={cy + 34 * Math.sin(anchorAngle + closeAngle / 2)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--color-accent, #e97d62)"
          fontSize="7.5"
          fontFamily="var(--font-mono, monospace)"
          opacity="0.8"
        >
          {deg(closeAngleTrue)}
        </text>
        <text
          x={cx + 60 * Math.cos(farTextRad)}
          y={cy + 60 * Math.sin(farTextRad)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.4)"
          fontSize="7.5"
          fontFamily="var(--font-mono, monospace)"
        >
          {deg(farAngleTrue)}
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
