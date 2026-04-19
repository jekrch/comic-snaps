import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Panel, Artist, Series, Reference } from "../types";

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

interface Props {
  open: boolean;
  panel: Panel;
  artist: Artist | null;
  series: Series | null;
  parentSeries: Series | null;
  searchUrl: string;
  topOffset?: number;
  bottomOffset?: number;
  closing?: boolean;
  slideDir?: "left" | "right" | null;
}

export default function InfoDrawer({ open, panel, artist, series, parentSeries, searchUrl, topOffset = 0, bottomOffset = 0, closing = false, slideDir = null }: Props) {
  const seriesDesc = series?.description || parentSeries?.description || "";
  const seriesRefs = series?.references?.length ? series.references : parentSeries?.references ?? [];
  const seriesImageUrl = series?.imageUrl || parentSeries?.imageUrl || null;
  const effectiveSeries = series ?? parentSeries ?? null;
  const coverImages = effectiveSeries?.coverImages ?? [];
  const hasCovers = coverImages.length > 0;
  const resolveCover = (url: string) =>
    url.startsWith("http") ? url : `${import.meta.env.BASE_URL}${url}`;

  const [selectedCoverIdx, setSelectedCoverIdx] = useState<number | null>(null);
  const [animPhase, setAnimPhase] = useState<"idle" | "opening" | "open" | "closing">("idle");
  const [swipeOffset, setSwipeOffset] = useState(0);
  const thumbRectRef = useRef<DOMRect | null>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const slideTrackRef = useRef<HTMLDivElement | null>(null);
  const coverContainerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const swipeOffsetRef = useRef(0);
  const commitLockRef = useRef(false);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    locked: false,
    rejected: false,
  });

  const len = coverImages.length;
  const prevCoverIdx = selectedCoverIdx === null || len < 2 ? -1 : (selectedCoverIdx - 1 + len) % len;
  const nextCoverIdx = selectedCoverIdx === null || len < 2 ? -1 : (selectedCoverIdx + 1) % len;

  useEffect(() => {
    setSelectedCoverIdx(null);
    setAnimPhase("idle");
    thumbRectRef.current = null;
  }, [panel.id]);

  const openCover = useCallback((idx: number) => {
    if (animPhase !== "idle") return;
    const btn = thumbRefs.current.get(idx);
    thumbRectRef.current = btn ? btn.getBoundingClientRect() : null;
    const container = coverContainerRef.current;
    if (container) {
      container.style.height = `${container.offsetHeight}px`;
      container.style.overflow = "hidden";
    }
    setSelectedCoverIdx(idx);
    setAnimPhase("opening");
  }, [animPhase]);

  const closeCover = useCallback(() => {
    if (animPhase !== "open") return;
    const el = expandedRef.current;
    const container = coverContainerRef.current;
    const grid = gridRef.current;
    const currentIdx = selectedCoverIdx;
    if (el === null || currentIdx === null) {
      setSelectedCoverIdx(null);
      thumbRectRef.current = null;
      setAnimPhase("idle");
      return;
    }
    const targetBtn = thumbRefs.current.get(currentIdx);
    const targetRect = targetBtn?.getBoundingClientRect() ?? thumbRectRef.current;
    const dest = el.getBoundingClientRect();
    if (!targetRect || dest.width === 0 || dest.height === 0) {
      setSelectedCoverIdx(null);
      thumbRectRef.current = null;
      setAnimPhase("idle");
      return;
    }
    const dx = targetRect.left - dest.left;
    const dy = targetRect.top - dest.top;
    const sx = targetRect.width / dest.width;
    const sy = targetRect.height / dest.height;

    const gridTargetHeight = grid?.offsetHeight ?? dest.height;
    if (container) {
      container.style.height = `${dest.height}px`;
      container.style.overflow = "hidden";
      container.style.transition = "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    }

    el.style.transformOrigin = "top left";
    el.style.willChange = "transform, opacity";
    el.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease-out";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = "0";

    requestAnimationFrame(() => {
      if (container) container.style.height = `${gridTargetHeight}px`;
    });

    setAnimPhase("closing");
    setTimeout(() => {
      if (container) {
        container.style.height = "";
        container.style.overflow = "";
        container.style.transition = "";
      }
      setSelectedCoverIdx(null);
      thumbRectRef.current = null;
      setAnimPhase("idle");
    }, 320);
  }, [animPhase, selectedCoverIdx]);

  useLayoutEffect(() => {
    if (animPhase !== "opening") return;
    const el = expandedRef.current;
    const rect = thumbRectRef.current;
    const container = coverContainerRef.current;
    const clearContainer = () => {
      if (container) {
        container.style.height = "";
        container.style.overflow = "";
        container.style.transition = "";
      }
    };
    if (!el || !rect) {
      clearContainer();
      setAnimPhase("open");
      return;
    }
    const dest = el.getBoundingClientRect();
    if (dest.width === 0 || dest.height === 0) {
      clearContainer();
      setAnimPhase("open");
      return;
    }
    const dx = rect.left - dest.left;
    const dy = rect.top - dest.top;
    const sx = rect.width / dest.width;
    const sy = rect.height / dest.height;

    el.style.transformOrigin = "top left";
    el.style.willChange = "transform, opacity";
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = "0.4";
    void el.getBoundingClientRect();

    const raf = requestAnimationFrame(() => {
      el.style.transition = "transform 0.35s cubic-bezier(0.2, 0, 0, 1), opacity 0.25s ease-out";
      el.style.transform = "";
      el.style.opacity = "1";
      if (container) {
        container.style.transition = "height 0.35s cubic-bezier(0.2, 0, 0, 1)";
        container.style.height = `${dest.height}px`;
      }
    });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transformOrigin = "";
      el.style.willChange = "";
      clearContainer();
      setAnimPhase("open");
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "transform") return;
      finish();
    };
    el.addEventListener("transitionend", onEnd);
    const timeout = setTimeout(finish, 500);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      el.removeEventListener("transitionend", onEnd);
    };
  }, [animPhase]);

  useLayoutEffect(() => {
    if (selectedCoverIdx === null) return;
    const track = slideTrackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translateX(0px)";
      void track.getBoundingClientRect();
    }
    swipeOffsetRef.current = 0;
    setSwipeOffset(0);
    commitLockRef.current = false;
  }, [selectedCoverIdx]);

  const commitSlide = useCallback((dir: "prev" | "next") => {
    if (commitLockRef.current) return;
    const track = slideTrackRef.current;
    if (!track || selectedCoverIdx === null || len < 2) return;
    commitLockRef.current = true;

    const width = track.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    const targetOffset = dir === "prev" ? width : -width;

    track.style.transition = "transform 0.28s cubic-bezier(0.2, 0, 0, 1)";
    track.style.transform = `translateX(${targetOffset}px)`;
    swipeOffsetRef.current = targetOffset;
    setSwipeOffset(targetOffset);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      track.removeEventListener("transitionend", onEnd);
      setSelectedCoverIdx((i) => {
        if (i === null) return null;
        return dir === "prev"
          ? (i - 1 + len) % len
          : (i + 1) % len;
      });
    };
    const onEnd = () => finish();
    track.addEventListener("transitionend", onEnd, { once: true });
    setTimeout(finish, 400);
  }, [selectedCoverIdx, len]);

  const snapBack = useCallback(() => {
    const track = slideTrackRef.current;
    if (!track) return;
    track.style.transition = "transform 0.28s cubic-bezier(0.2, 0, 0, 1)";
    track.style.transform = "translateX(0px)";
    swipeOffsetRef.current = 0;
    setSwipeOffset(0);
  }, []);

  const beginDrag = useCallback((x: number, y: number) => {
    if (animPhase !== "open" || len < 2 || commitLockRef.current) return;
    dragRef.current = {
      active: true, startX: x, startY: y, startTime: Date.now(),
      locked: false, rejected: false,
    };
  }, [animPhase, len]);

  const moveDrag = useCallback((x: number, y: number, lockThreshold: number, angleBias: number): boolean => {
    const d = dragRef.current;
    if (!d.active || d.rejected) return false;
    const dx = x - d.startX;
    const dy = y - d.startY;
    if (!d.locked) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < lockThreshold && absDy < lockThreshold) return false;
      if (absDy > absDx * angleBias) { d.rejected = true; return false; }
      d.locked = true;
    }
    const track = slideTrackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = `translateX(${dx}px)`;
    }
    swipeOffsetRef.current = dx;
    setSwipeOffset(dx);
    return true;
  }, []);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (d.active && d.locked && !d.rejected) {
      const offset = swipeOffsetRef.current;
      const dt = Date.now() - d.startTime;
      const velocity = Math.abs(offset) / Math.max(dt, 1);
      const width = slideTrackRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
      const threshold = width * 0.25;
      const velocityThreshold = 0.4;

      if (offset > 0 && (offset > threshold || velocity > velocityThreshold)) {
        commitSlide("prev");
      } else if (offset < 0 && (Math.abs(offset) > threshold || velocity > velocityThreshold)) {
        commitSlide("next");
      } else {
        snapBack();
      }
    }
    dragRef.current.active = false;
  }, [commitSlide, snapBack]);

  useEffect(() => {
    if (selectedCoverIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closeCover();
      } else if (e.key === "ArrowLeft" && len > 1) {
        e.stopImmediatePropagation();
        commitSlide("prev");
      } else if (e.key === "ArrowRight" && len > 1) {
        e.stopImmediatePropagation();
        commitSlide("next");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedCoverIdx, len, closeCover, commitSlide]);

  const seriesMetaParts: string[] = [];
  if (effectiveSeries?.startYear) seriesMetaParts.push(String(effectiveSeries.startYear));
  if (effectiveSeries?.publisher) seriesMetaParts.push(effectiveSeries.publisher);
  if (effectiveSeries?.issueCount) {
    seriesMetaParts.push(`${effectiveSeries.issueCount} issue${effectiveSeries.issueCount === 1 ? "" : "s"}`);
  }
  const seriesMeta = seriesMetaParts.join(" · ");

  const artistYears =
    artist?.birthYear && artist?.deathYear
      ? `${artist.birthYear}–${artist.deathYear}`
      : artist?.birthYear
        ? `b. ${artist.birthYear}`
        : null;
  const artistMetaParts: string[] = [];
  if (artistYears) artistMetaParts.push(artistYears);
  if (artist?.country) artistMetaParts.push(artist.country);
  const artistMeta = artistMetaParts.join(" · ");

  const show = open && !closing;

  // Determine transform based on slideDir or normal open/close
  let transform = show ? "translateY(0)" : "translateY(100vh)";
  if (slideDir && !show) {
    transform = `translateX(${slideDir === "left" ? "-100%" : "100%"})`;
  }
  // When the viewer is closing, fade out instead of sliding down
  if (closing) {
    transform = "translateY(0)";
  }

  return (
    <div
      className="absolute inset-x-0 z-15 overflow-y-auto info-modal-scroll"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        transform,
        opacity: closing ? 0 : 1,
        transition: closing
          ? "opacity 0.25s ease-out"
          : slideDir
            ? "transform 0.28s cubic-bezier(0.2, 0, 0, 1)"
            : "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        pointerEvents: show ? "auto" : "none",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="px-6 py-6 sm:px-10 sm:py-8 space-y-5 max-w-lg lg:max-w-xl mx-auto w-full"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.25s ease-out 0.15s, transform 0.25s ease-out 0.15s",
        }}
      >
        {/* Series info */}
        <div className="relative overflow-hidden rounded" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          {seriesImageUrl && (
            <div className="absolute inset-0 pointer-events-none">
              <img
                src={seriesImageUrl}
                alt=""
                className="absolute right-0 top-0 h-full w-2/3 object-cover object-center"
                style={{ opacity: 0.3 }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(to right, rgba(0,0,0,1) 25%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.15) 100%)",
                }}
              />
            </div>
          )}
          <div className="relative z-10 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Series</p>
            <p className="font-display text-sm text-white/90 leading-snug">
              {panel.title}
            </p>
            {seriesMeta && (
              <p className="text-[10px] text-white/40 mt-0.5">{seriesMeta}</p>
            )}
            {seriesDesc && (
              <p className="text-xs text-white/55 mt-1.5 leading-relaxed whitespace-pre-line">{seriesDesc}</p>
            )}
            {seriesRefs.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {seriesRefs.map((ref) => (
                  <a
                    key={ref.url}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-accent hover:text-accent-dim transition-colors"
                  >
                    {refIcon(ref)}
                    {ref.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Covers — only mount images once the drawer has opened, so the browser
            doesn't fetch them while the drawer is hidden off-screen. */}
        {hasCovers && open && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                <span>Covers</span>
                <span className="text-white/20 normal-case tracking-normal">· {coverImages.length}</span>
                {selectedCoverIdx !== null && (
                  <span className="text-white/30 normal-case tracking-normal ml-auto">
                    {selectedCoverIdx + 1} / {coverImages.length}
                  </span>
                )}
              </div>

              <div ref={coverContainerRef} className="relative">
                <div
                  ref={gridRef}
                  className="grid grid-cols-4 gap-2 pt-0.5"
                  style={
                    selectedCoverIdx !== null
                      ? {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          pointerEvents: "none",
                          opacity: animPhase === "closing" ? 1 : 0,
                          transition: "opacity 0.25s ease-out",
                        }
                      : undefined
                  }
                >
                  {coverImages.map((url, i) => (
                    <button
                      key={url}
                      ref={(el) => {
                        if (el) thumbRefs.current.set(i, el);
                        else thumbRefs.current.delete(i);
                      }}
                      type="button"
                      onClick={() => openCover(i)}
                      className="relative block aspect-2/3 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                    >
                      <img
                        src={resolveCover(url)}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                      />
                    </button>
                  ))}
                </div>

                {selectedCoverIdx !== null && (
                  <div ref={expandedRef} className="space-y-2">
                    <div
                      className="relative rounded-sm overflow-hidden bg-black/40"
                      style={{ touchAction: "pan-y" }}
                      onPointerDown={(e) => {
                        if (e.pointerType === "touch") return;
                        beginDrag(e.clientX, e.clientY);
                      }}
                      onPointerMove={(e) => {
                        if (e.pointerType === "touch") return;
                        moveDrag(e.clientX, e.clientY, 4, 1);
                      }}
                      onPointerUp={(e) => {
                        if (e.pointerType !== "touch") endDrag();
                      }}
                      onPointerCancel={(e) => {
                        if (e.pointerType !== "touch") endDrag();
                      }}
                      onTouchStart={(e) => {
                        if (e.touches.length !== 1) return;
                        beginDrag(e.touches[0].clientX, e.touches[0].clientY);
                      }}
                      onTouchMove={(e) => {
                        if (e.touches.length !== 1) return;
                        const moved = moveDrag(e.touches[0].clientX, e.touches[0].clientY, 6, 0.8);
                        if (moved && e.cancelable) e.preventDefault();
                      }}
                      onTouchEnd={endDrag}
                      onTouchCancel={endDrag}
                    >
                      <div
                        ref={slideTrackRef}
                        className="relative"
                        style={{
                          transform: `translateX(${swipeOffset}px)`,
                          willChange: "transform",
                        }}
                      >
                        <img
                          src={resolveCover(coverImages[selectedCoverIdx])}
                          alt=""
                          className="block w-full max-h-[70vh] object-contain select-none"
                          draggable={false}
                        />
                        {prevCoverIdx >= 0 && (
                          <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            style={{ transform: "translateX(-100%)" }}
                          >
                            <img
                              src={resolveCover(coverImages[prevCoverIdx])}
                              alt=""
                              className="block w-full h-full object-contain select-none"
                              draggable={false}
                            />
                          </div>
                        )}
                        {nextCoverIdx >= 0 && (
                          <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            style={{ transform: "translateX(100%)" }}
                          >
                            <img
                              src={resolveCover(coverImages[nextCoverIdx])}
                              alt=""
                              className="block w-full h-full object-contain select-none"
                              draggable={false}
                            />
                          </div>
                        )}
                      </div>
                      {len > 1 && (
                        <>
                          <button
                            type="button"
                            aria-label="Previous cover"
                            onClick={(e) => { e.stopPropagation(); commitSlide("prev"); }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors z-10"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label="Next cover"
                            onClick={(e) => { e.stopPropagation(); commitSlide("next"); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors z-10"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        aria-label="Close cover"
                        onClick={(e) => { e.stopPropagation(); closeCover(); }}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors z-10"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={closeCover}
                      className="text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
                    >
                      ← Back to covers
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Artist info */}
        <div className="relative overflow-hidden rounded" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          {artist?.imageUrl && (
            <div className="absolute inset-0 pointer-events-none">
              <img
                src={artist.imageUrl}
                alt=""
                className="absolute right-0 top-0 h-full w-2/3 object-cover object-center"
                style={{ opacity: 0.3 }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(to right, rgba(0,0,0,1) 25%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.15) 100%)",
                }}
              />
            </div>
          )}
          <div className="relative z-10 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Artist</p>
            <p className="font-display text-sm text-white/90 leading-snug">
              {panel.artist}
            </p>
            {artistMeta && (
              <p className="text-[10px] text-white/40 mt-0.5">{artistMeta}</p>
            )}
            {artist?.description && (
              <p className="text-xs text-white/55 mt-1.5 leading-relaxed whitespace-pre-line">{artist.description}</p>
            )}
            {artist?.references && artist.references.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {artist.references.map((ref) => (
                  <a
                    key={ref.url}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-accent hover:text-accent-dim transition-colors"
                  >
                    {refIcon(ref)}
                    {ref.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {panel.notes && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Notes</p>
              <p className="text-xs text-white/55 leading-relaxed">{panel.notes}</p>
            </div>
          </>
        )}

        {/* Tags */}
        {panel.tags?.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {panel.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] leading-none px-1.5 py-[3.9px] rounded-sm bg-white/8 text-white/35"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Google search link */}
        <div className="border-t border-white/8" />
        <div>
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-dim transition-colors"
          >
            <Search size={12} />
            Search for {panel.title} #{panel.issue}
          </a>
        </div>
      </div>
    </div>
  );
}
