/**
 * The drawing itself: a classic scalloped thought balloon with a trail of two
 * shrinking bubbles running off to its lower left, inked in the bird's rust.
 *
 * Kept apart from the header button that wraps it because the launch modal
 * carries the same balloon empty, as its mark — the two have to be the same
 * drawing rather than two drawings that resemble each other.
 */

/** The bird's stroke, so the balloon reads as drawn by the same hand. */
export const INK = "#8d422f";

/** The drawing's own coordinate space; every size below is this, scaled. */
const VIEW_W = 84;
const VIEW_H = 34;

/**
 * How the cloud is placed in that box: bigger than its own path, and offset so
 * the growth lands where it should. Because the default render width equals
 * `VIEW_W`, a unit here is a pixel — so enlarging the cloud through this scale
 * leaves the trail's bubbles at exactly the size and spot they were tuned to,
 * which enlarging the whole drawing would not.
 *
 * `CLOUD_DX` is set so the cloud's leftmost ink stays put as it grows — it is
 * really the air between the balloon and the last bubble, and that gap survives
 * a change of scale. `CLOUD_DY` re-centres the taller cloud in the taller box.
 */
const CLOUD_SCALE = 1.12;
const CLOUD_DX = 2.5;
const CLOUD_DY = -1.1;

/**
 * The cloud: nine quadratic bumps around a wide oval, each control point thrown
 * well outside the boundary so it bulges hard — the top run peaks around y=2.25
 * against endpoints at 5.5–7.5, so the scallops are about four units deep. The
 * bumps are deliberately uneven, wider along the top and bottom runs and tighter
 * at the two ends, because a balloon built from identical scallops reads as a
 * gear rather than as ink.
 *
 * Ink spans x 20.9–71.6 and y 1.25–31 in its own coordinates, landing at roughly
 * x 25.8–82.8 and y 0.3–33.6 once placed — nearly the whole box, so at header
 * size it overhangs the row, which is the intent.
 */
const CLOUD = `
  M22 16.5
  Q21 6.5, 31 6.5
  Q37 -1.5, 44 5.5
  Q50.5 -1.5, 57 7.5
  Q66 4.5, 68 14.5
  Q74 18.5, 66 21.5
  Q65 28.5, 54 26.5
  Q47.5 33.5, 41 26.5
  Q34 32.5, 29 23.5
  Q21 23.5, 22 16.5
  Z
`;

/**
 * The trail, ordered nearest the thinker first — which is also the order it
 * draws itself in.
 *
 * The line it runs on is the point of it. The bird's eye, once its glyph has
 * been rotated, lands near the top of the header row, and the cloud's core sits
 * a little lower; so the trail has to descend the whole way, evenly. Laid out in
 * row coordinates that reads eye ≈6, first bubble ≈8, second ≈10, cloud ≈13.5 —
 * monotonic, where an earlier pass dropped the second bubble below the cloud's
 * own centre and then climbed back up to it, which is what made the thought read
 * as three unrelated marks.
 *
 * The first bubble sits a couple of units under the eye rather than level with
 * it, so it lifts off the head instead of appearing to be pinned beside it.
 *
 * Radius and spacing both grow toward the balloon (1.8 then 4.0, with gaps of
 * roughly 3.5 and 6.3), because a thought that expands as it leaves the head is
 * the whole convention.
 *
 * The big bubble carries a slightly lighter `pen` than the rest of the drawing:
 * at that radius the full weight closes the circle up into a blot, and it sits
 * right against the cloud where the contrast shows. Thinning it keeps it reading
 * as an outline without breaking the one-hand look.
 */
const TRAIL = [
  { cx: 3.2, cy: 11, r: 1.8 },
  { cx: 14.5, cy: 13, r: 4, pen: 3.4 },
];

/** Between one part of the thought and the next. */
const BEAT_MS = 220;

/** The drawing's pen, matched to the bird's own weight; see TRAIL for the
 *  one mark that lightens off it. */
const PEN = 4;

interface ThoughtBalloonProps {
  /** Word inside the balloon. Omit for an empty one. */
  label?: string;
  /** Rendered width in px; the height follows the drawing's ratio. */
  width?: number;
  /**
   * Whether the parts are drawn on in sequence. Omit and the whole balloon is
   * simply there, which is what a modal that has its own entrance wants; pass a
   * boolean to hold it at nothing until the thinker is ready for it.
   */
  shown?: boolean;
  className?: string;
}

export default function ThoughtBalloon({
  label,
  width = VIEW_W,
  shown,
  className,
}: ThoughtBalloonProps) {
  /**
   * `viz-think-el` holds a part at nothing; the second class runs it in on its
   * own beat. Mounting when the thinker has already arrived just plays the whole
   * sequence at once, which is the right behaviour for arriving late.
   */
  const beat = (index: number, extra = "") => {
    if (shown === undefined) return { className: extra.trim() || undefined };
    return {
      className: `viz-think-el${shown ? " viz-think-in" : ""}${extra}`,
      style: { animationDelay: `${index * BEAT_MS}ms` },
    };
  };

  return (
    <svg
      width={width}
      height={(width * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      fill="none"
      stroke={INK}
      strokeWidth={PEN}
      strokeLinejoin="round"
      aria-hidden
      className={`viz-think-ink${className ? ` ${className}` : ""}`}
    >
      {TRAIL.map((b, i) => (
        <circle
          key={b.cx}
          cx={b.cx}
          cy={b.cy}
          r={b.r}
          strokeWidth={"pen" in b ? b.pen : undefined}
          {...beat(i)}
        />
      ))}
      {/* Carried on the group so the cloud and its word stay registered to each
          other; the pop each part animates in with is its own transform and
          composes on top of this one. No opacity here — the balloon inks at the
          bird's own full strength, so the two read as one drawing rather than as
          a bird with a faded thought beside it. */}
      <g transform={`translate(${CLOUD_DX} ${CLOUD_DY}) scale(${CLOUD_SCALE})`}>
        {/* Divided back out of the scale, so the balloon and the bubbles are
            still inked with one pen — a stroke inherited into a scaled group
            would come out heavier here than out there. */}
        <path d={CLOUD} strokeWidth={PEN / CLOUD_SCALE} {...beat(TRAIL.length)} />
        {label && (
          /* Horizontal, the way balloon lettering is set — the character is in
             the cloud around it, not in a tilted baseline. On the balloon's own
             beat, so the word inflates with it rather than after it. */
          /* Centred on the cloud path's own ink box (46.2, 16.1) rather than on
             the box, so it stays put through any change to the placement above. */
          <text
            x={45.2}
            y={20.15}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill={INK}
            stroke="none"
            /* Space Mono via the utility rather than a `font-family` attribute:
               `var()` in an SVG presentation attribute is not reliably honoured. */
            {...beat(TRAIL.length, " font-display select-none")}
          >
            {label}
          </text>
        )}
      </g>
    </svg>
  );
}
