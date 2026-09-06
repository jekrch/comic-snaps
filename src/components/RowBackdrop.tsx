import { useCallback, useEffect, useRef, useState } from "react";
import { panelImageUrl } from "../utils/imageUrl";
import { useViewerOpen } from "../hooks/useViewerOpen";

/**
 * How far past 1:1 the backdrop may be magnified, and the zoom a source big
 * enough to afford it gets.
 *
 * The sources are not one size — the covers run from 293x450 to 832x1280, and
 * the creator portraits are smaller again — and `object-fit: cover` has already
 * blown a small one up to the width of the wash before any zoom is applied. So
 * the zoom is whatever is left of the budget after that: a big scan gets the
 * full close-up, a small one is left nearly where cover put it rather than
 * magnified into visible blocks.
 */
const BACKDROP_MAX_UPSCALE = 1.5;
const BACKDROP_ZOOM = 1.85;
/** Never exactly 1: a hair of overscan keeps the blur from sampling past the
 *  image's own edges and drawing a soft border inside the wash. */
const BACKDROP_MIN_ZOOM = 1.04;

/**
 * The wash behind a shelf row's rail: the row's own art, dimmed nearly out and
 * masked away before the strip starts, fitted to whatever resolution the
 * source actually has.
 *
 * Shared by both shelves, because it is the same move either way — a series
 * row is washed with the book, an artist row with the person — and the fitting
 * is the whole substance of it. Whatever upscale the budget cannot avoid is
 * spent as softness instead: at 19% opacity a soft wash is the effect, where a
 * sharp grid of blocks is just a small picture stretched. The fit is measured
 * rather than assumed because the box is a share of the row's width, which is
 * the window's.
 */
export default function RowBackdrop({ src }: { src: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ transform: string; filter: string } | null>(null);

  /**
   * The wash is not painted while the viewer is up (`.viewer-open` in
   * `index.css`), so there is nothing to fit either — and the observers below
   * fire hardest at exactly the moment the viewer opens, when the scroll lock
   * resizes the viewport out from under every row.
   */
  const viewerOpen = useViewerOpen();
  const quietRef = useRef(viewerOpen);
  quietRef.current = viewerOpen;

  const measure = useCallback(() => {
    if (quietRef.current) return;
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalWidth || !img.naturalHeight) return;
    const boxW = wrap.clientWidth;
    const boxH = wrap.clientHeight;
    // Under `content-visibility: auto` a row that is still skipped lays nothing
    // out; the ResizeObserver calls back the moment it does.
    if (!boxW || !boxH) return;

    const cover = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const zoom = Math.min(
      BACKDROP_ZOOM,
      Math.max(BACKDROP_MIN_ZOOM, BACKDROP_MAX_UPSCALE / cover),
    );
    const upscale = Math.max(1, cover * zoom);
    const blur = Math.min(2.2, (upscale - 1) * 1.3);

    const next = {
      transform: `scale(${zoom.toFixed(3)})`,
      filter: `saturate(0.85) contrast(1.05)${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
    };
    setFit((prev) =>
      prev && prev.transform === next.transform && prev.filter === next.filter ? prev : next,
    );
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  // Whatever the row missed while it was quiet is taken once, on the way back.
  useEffect(() => {
    if (!viewerOpen) measure();
  }, [viewerOpen, measure]);

  return (
    <div ref={wrapRef} className="row-bg" data-fitted={fit ? "true" : undefined} aria-hidden="true">
      <img
        ref={imgRef}
        src={panelImageUrl(src)}
        alt=""
        loading="lazy"
        decoding="async"
        style={fit ?? undefined}
        onLoad={measure}
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
    </div>
  );
}
