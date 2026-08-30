import { Bird } from "lucide-react";

/**
 * The rating meter — the row of birds that says what we thought of something.
 *
 * Lifted out of `InfoDrawer` unchanged so the series view's rail can show the
 * same meter rather than a second one that drifts from it. The
 * `.score-bird-in` / `.score-bird-on` rules it leans on stay in `index.css`.
 */

/** The 1-10 scale, drawn as a bird apiece. */
const SCORE_SCALE = 10;

/**
 * The logo bird's own rust — deliberately not `--color-accent`, which is the
 * brighter orange the links use. Ten of those at once would shout; the faded
 * rust is what the bird in the header is painted in, and the meter is quieter
 * for borrowing it. The accent is held back for the hover, where lighting the
 * whole run at once is the point.
 */
const SCORE_ON = "#8d422f";
const SCORE_OFF = "rgba(255,255,255,0.22)";

/** The logo's masked bird fades out from the waist down. So does the meter. */
const BIRD_FADE = "linear-gradient(to bottom, #000 55%, rgba(0,0,0,0.4) 100%)";

/** `10`, not `10.0` — the decimal only earns its place when there is one. */
export function formatScore(avg: number): string {
  return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
}

/**
 * One bird of the scale: solid for a scored one, hollow for the rest. The
 * silhouette-versus-outline contrast is what makes the run readable at a
 * glance — two solid masses at different opacities just read as a smudge, and
 * at this size a filled glyph needs the room to still look like a bird.
 *
 * Colour is set inline rather than through a utility class: `fill`/`stroke`
 * are `currentColor` by default, so the glyph takes whatever `color` it
 * inherits the moment anything fails to override it — and inheriting the
 * drawer's grey text is indistinguishable from an unscored bird.
 */
export function ScoreBird({ on, delay }: { on: boolean; delay?: number }) {
  const color = on ? SCORE_ON : SCORE_OFF;
  return (
    <Bird
      size={16}
      strokeWidth={1.5}
      fill={on ? color : "none"}
      stroke={color}
      className={`shrink-0${on ? " score-bird-on" : ""}${delay === undefined ? "" : " score-bird-in"}`}
      style={{ color, display: "block", animationDelay: delay ? `${delay}ms` : undefined }}
    />
  );
}

/**
 * The score, then the scale it sits on: ten birds, solid in the logo's rust up
 * to the average and hollow past it. The last bird fills part-way when an
 * average lands between two whole numbers, so 8.5 reads as eight and a half
 * birds rather than rounding the half away.
 *
 * How many people voted is deliberately nowhere on the row — at this group
 * size it is one or two, and a second number only competes with the score for
 * the same glance (docs/ratings-plan.md §8).
 */
export function ScoreBirds({ avg, animate }: { avg: number; animate: boolean }) {
  const label = `${formatScore(avg)} out of ${SCORE_SCALE}`;

  return (
    <div className="flex items-center gap-2.5" title={label} role="img" aria-label={label}>
      {/* Fixed width and tabular figures so both scopes' meters start on the
          same vertical line however wide the number is. */}
      <span className="w-8 shrink-0 text-right font-display text-base tabular-nums text-white/90">
        {formatScore(avg)}
      </span>
      <span
        className="flex items-end gap-[3px]"
        style={{ maskImage: BIRD_FADE, WebkitMaskImage: BIRD_FADE }}
        aria-hidden
      >
        {Array.from({ length: SCORE_SCALE }, (_, i) => {
          // Whole birds below the score, empty above, and one part-filled at
          // the boundary when the average carries a fraction.
          const fill = Math.min(Math.max(avg - i, 0), 1);
          const delay = animate && fill > 0 ? i * 30 : undefined;

          if (fill === 0) return <ScoreBird key={i} on={false} />;
          if (fill === 1) return <ScoreBird key={i} on delay={delay} />;
          return (
            <span key={i} className="relative block h-4 w-4 shrink-0">
              <ScoreBird on={false} />
              <span
                className="absolute left-0 top-0 h-full overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <ScoreBird on delay={delay} />
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}
