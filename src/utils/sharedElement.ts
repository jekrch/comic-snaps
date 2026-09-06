/**
 * Geometry for the viewer's shared-element flight — the part of it that has to
 * reckon with a thumbnail that *crops*.
 *
 * A shelf tile is a clamped box with `object-fit: cover` over it, so the image
 * it shows is a slice of the whole picture. The viewer flies the *whole*
 * picture to that slice's scale (see `originGeometry` in `PanelViewer`), which
 * keeps the flight in proportion, but it also means the parts the tile crops
 * away are still on screen when the flight lands — and then the viewer unmounts
 * and they vanish in a single frame.
 *
 * The fix is an aperture: a `clip-path` that starts as the whole image and
 * closes onto the tile's own box over the same beat as the flight, so by the
 * time the image is home there is nothing left outside the crop to snap away.
 * The numbers for it are here, free of the DOM, so they can be checked without
 * a layout.
 */

/** A box in viewport coordinates; structurally a `DOMRect`. */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where a keyword sits along its axis, as a fraction of the free space. */
const KEYWORDS: Record<string, number> = {
  left: 0,
  top: 0,
  center: 0.5,
  right: 1,
  bottom: 1,
};

function axis(token: string | undefined, fallback: number): number {
  if (!token) return fallback;
  const keyword = KEYWORDS[token];
  if (keyword !== undefined) return keyword;
  const pct = /^(-?[\d.]+)%$/.exec(token);
  return pct ? Number(pct[1]) / 100 : fallback;
}

/**
 * Read a computed `object-position` as a pair of fractions: 0 pins the image's
 * leading edge to the box's, 1 its trailing edge, 0.5 centres it.
 *
 * Browsers compute the property to percentages, which is all the shelf uses
 * (portraits sit at `center 22%` so a face lands in the box). A length — which
 * would be an offset in px rather than a fraction of the overflow — is not
 * something this app writes, and is read as centred rather than guessed at.
 */
export function parseObjectPosition(value: string): { x: number; y: number } {
  const parts = value.trim().split(/\s+/);
  return { x: axis(parts[0], 0.5), y: axis(parts[1], 0.5) };
}

/**
 * The box the whole image occupies when `object-fit: cover` fills `box` with
 * it — larger than `box` on at least one axis, that overflow being exactly what
 * the tile crops off.
 */
export function coverRect(
  box: Rect,
  natural: { width: number; height: number },
  position: { x: number; y: number }
): Rect {
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return {
    left: box.left + (box.width - width) * position.x,
    top: box.top + (box.height - height) * position.y,
    width,
    height,
  };
}

/**
 * The crop, expressed in the *untransformed* image's own pixels.
 *
 * `clip-path` is applied before the element's transform, so the insets have to
 * be divided back through the flight's scale: at rest the image measures
 * `rest`, and it lands on `origin` with `clip` the window the tile leaves open.
 * Negative insets (a tile hanging off the edge of the viewport, a rounding
 * wobble) are floored at zero — the aperture only ever closes.
 */
export function clipInsets(rest: Rect, origin: Rect, clip: Rect): Insets {
  const sx = origin.width / rest.width;
  const sy = origin.height / rest.height;
  return {
    top: Math.max(0, (clip.top - origin.top) / sy),
    right: Math.max(0, (origin.left + origin.width - (clip.left + clip.width)) / sx),
    bottom: Math.max(0, (origin.top + origin.height - (clip.top + clip.height)) / sy),
    left: Math.max(0, (clip.left - origin.left) / sx),
  };
}

/** True when the aperture would take nothing off — no need to animate one. */
export function cropsAnything(insets: Insets): boolean {
  return insets.top + insets.right + insets.bottom + insets.left > 0.5;
}

/**
 * The mask that dissolves the cropped-away part of the image away.
 *
 * The first go at this closed the crop like an aperture — a hard edge sweeping
 * inward onto the tile's box. It landed in the right place, but a sweeping cut
 * is a piece of motion in its own right, and one moving across the picture at
 * the end of a flight reads as another thing happening rather than as the
 * flight finishing. So the geometry no longer moves at all: the doomed strip
 * sits exactly where it always was and fades out where it stands, and what is
 * left when it reaches nothing is the slice the tile shows.
 *
 * `progress` is how far the fade has gone, 0 (whole picture, untouched) to 1
 * (only the tile's slice). `feather` softens the join between the part that
 * stays and the part that goes, in the image's own pixels; it shrinks along
 * with the fade so the last frame is a clean edge on the tile's box rather
 * than a gradient hanging off it.
 *
 * A `cover` crop bites on exactly one axis — the scale is the *larger* of the
 * two ratios, so only the other one overflows — which is why one gradient is
 * the whole mask.
 */
export function dissolveMask(
  insets: Insets,
  size: { width: number; height: number },
  progress: number,
  feather: number
): string {
  const horizontal = insets.left + insets.right > 0;
  const lead = horizontal ? insets.left : insets.top;
  const trail = horizontal ? insets.right : insets.bottom;
  const extent = horizontal ? size.width : size.height;

  const alpha = 1 - Math.min(1, Math.max(0, progress));
  const ramp = feather * alpha;
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  const stop = (a: number, at: number) => `rgba(0,0,0,${Math.round(a * 1000) / 1000}) ${px(at)}`;

  return `linear-gradient(${horizontal ? "to right" : "to bottom"}, ${[
    stop(alpha, 0),
    stop(alpha, Math.max(0, lead - ramp)),
    stop(1, lead),
    stop(1, extent - trail),
    stop(alpha, Math.min(extent, extent - trail + ramp)),
    stop(alpha, extent),
  ].join(", ")})`;
}

/**
 * How soft the join is at its softest: a share of the strip being faded, so it
 * reads the same on a tile taking a sliver off the side and on one taking half
 * the picture.
 */
export function featherFor(insets: Insets): number {
  const horizontal = insets.left + insets.right > 0;
  const widest = horizontal
    ? Math.max(insets.left, insets.right)
    : Math.max(insets.top, insets.bottom);
  return widest * 0.4;
}
