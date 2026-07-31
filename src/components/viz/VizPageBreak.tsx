/**
 * The visualizer's way out: the run is frozen, cut into comic panels, and they
 * tumble out through the camera, leaving the wall it was covering.
 *
 * Only the way out. The run arrives by fading up — there is nothing to take
 * apart on the way in, and the gallery it is arriving over is not a thing the
 * reader is being shown so much as one they are leaving. What makes the exit
 * worth the machinery is that there is a frame worth holding onto for a second
 * longer, which is the frame they chose to leave on.
 *
 * The still is one image cut across the seven shards rather than seven images:
 * each shard is a window onto a copy of the whole screen, sized and offset in
 * percentages of the shard itself, so the seams line up at any window size and
 * survive a resize mid-flight without measuring anything.
 *
 * Nothing here paints per frame: every shard moves on transform and opacity
 * alone, so the break stays on the compositor while the engine has the GPU.
 */

import { prefersReducedMotion } from "./vizConfig";

interface Shard {
  /** Rect on the page, in percent — the set tiles the frame exactly. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where it goes, in vw/vh and px of depth. Positive z is toward the reader. */
  dx: number;
  dy: number;
  dz: number;
  /** Tumble on the way out. Paper, not confetti: nothing past a quarter turn. */
  rx: number;
  ry: number;
  rz: number;
  /** Milliseconds behind the break's start. */
  delay: number;
}

/**
 * An irregular page — two panels over three over two — because a regular grid
 * reads as a video wall and this is meant to read as a page. The break starts
 * at the middle panel and runs outward, so it has an origin rather than
 * happening everywhere at once.
 */
const SHARDS: Shard[] = [
  { x: 0, y: 0, w: 58, h: 34, dx: -74, dy: -54, dz: 240, rx: -16, ry: -26, rz: -8, delay: 170 },
  { x: 58, y: 0, w: 42, h: 34, dx: 70, dy: -50, dz: -190, rx: -13, ry: 30, rz: 7, delay: 215 },
  { x: 0, y: 34, w: 32, h: 30, dx: -78, dy: -6, dz: -250, rx: 4, ry: -34, rz: -5, delay: 105 },
  // The one that comes through the camera. It carries the reveal, so it is
  // first out and clears the frame ahead of the rest.
  { x: 32, y: 34, w: 36, h: 30, dx: 26, dy: 40, dz: 430, rx: 9, ry: 13, rz: 4, delay: 0 },
  { x: 68, y: 34, w: 32, h: 30, dx: 76, dy: 12, dz: 190, rx: -2, ry: 32, rz: 6, delay: 105 },
  { x: 0, y: 64, w: 45, h: 36, dx: -64, dy: 60, dz: -170, rx: 21, ry: -18, rz: -6, delay: 185 },
  { x: 45, y: 64, w: 55, h: 36, dx: 62, dy: 64, dz: 300, rx: 25, ry: 16, rz: 9, delay: 240 },
];

const HERO = 3;

/** Kept in step with the animations in index.css. */
const SHARD_MS = 1000;
const STAGGER = 240;
const REDUCED_MS = 260;

/**
 * How long the overlay holds the shards up once the break has started. Asked
 * rather than imported as a constant because the reduced-motion break is a
 * crossfade of a quarter the length, and an overlay that sat out the full
 * tumble anyway would leave a dead sheet over the wall for a second after there
 * was anything left to see.
 */
export function vizBreakMs(): number {
  return prefersReducedMotion() ? REDUCED_MS : SHARD_MS + STAGGER;
}

interface VizPageBreakProps {
  /**
   * The frame the page is cut from, as an object URL. Null when there was
   * nothing to photograph — a run on the fallback backend has no canvas to read
   * — in which case the shards are a plain black page.
   */
  still: string | null;
}

export default function VizPageBreak({ still }: VizPageBreakProps) {
  return (
    <div className="viz-break" aria-hidden>
      {SHARDS.map((shard, index) => (
        <div
          key={index}
          className={`viz-shard ${index === HERO ? "viz-shard-out-hero" : "viz-shard-out"}`}
          style={
            {
              left: `${shard.x}%`,
              top: `${shard.y}%`,
              width: `${shard.w}%`,
              height: `${shard.h}%`,
              "--dx": `${shard.dx}vw`,
              "--dy": `${shard.dy}vh`,
              "--dz": `${shard.dz}px`,
              "--rx": `${shard.rx}deg`,
              "--ry": `${shard.ry}deg`,
              "--rz": `${shard.rz}deg`,
              animationDelay: `${shard.delay}ms`,
            } as React.CSSProperties
          }
        >
          {still && (
            // The whole screen, positioned so the piece of it this shard is
            // standing over lands under the shard's own box. Percentages
            // throughout: 100/w of the shard's width is the frame's width, and
            // x/w of it is how far along the frame the shard starts.
            <div
              className="viz-shard-face"
              style={{
                width: `${(100 / shard.w) * 100}%`,
                height: `${(100 / shard.h) * 100}%`,
                left: `${-(shard.x / shard.w) * 100}%`,
                top: `${-(shard.y / shard.h) * 100}%`,
                backgroundImage: `url("${still}")`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
