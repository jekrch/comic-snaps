import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Panel, Artist, Series, Reference, IssueCredit, IssueCredits } from "../types";
import { formatIssue } from "../utils/issueFormat";
import type { ArtistIndex } from "../hooks/useMetadata";
import PersonProfile from "./PersonProfile";

interface PersonFacets {
  artists: number;
  colorists: number;
  letterers: number;
  credits: number;
}

function hasProfileInfo(artist: Artist | null): boolean {
  return !!(
    artist &&
    (artist.description ||
      artist.imageUrl ||
      artist.references?.length ||
      artist.birthYear ||
      artist.country)
  );
}

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

interface Props {
  open: boolean;
  panel: Panel;
  allPanels: Panel[];
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  artist: Artist | null;
  series: Series | null;
  parentSeries: Series | null;
  issueCredits: IssueCredits | null;
  artistIndex: ArtistIndex;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  searchUrl: string;
  topOffset?: number;
  bottomOffset?: number;
  closing?: boolean;
  slideDir?: "left" | "right" | null;
}

export default function InfoDrawer({ open, panel, allPanels, onSelectPanel, artist, series, parentSeries, issueCredits, artistIndex, onBrowse, searchUrl, topOffset = 0, bottomOffset = 0, closing = false, slideDir = null }: Props) {
  const seriesPanels = allPanels.filter((p) => p.slug === panel.slug && p.id !== panel.id);
  const artistPanels = allPanels.filter((p) => p.artist === panel.artist && p.id !== panel.id);
  // Full groups (including the current panel) that scope the viewer's prev/next
  // when a related thumbnail is clicked, so paging stays within that group.
  const seriesGroup = allPanels.filter((p) => p.slug === panel.slug);
  const artistGroup = allPanels.filter((p) => p.artist === panel.artist);
  const seriesDesc = series?.description || parentSeries?.description || "";
  const seriesRefs = series?.references?.length ? series.references : parentSeries?.references ?? [];
  const seriesImageUrl = series?.imageUrl || parentSeries?.imageUrl || null;
  const effectiveSeries = series ?? parentSeries ?? null;
  const coverImages = effectiveSeries?.coverImages ?? [];
  const hasCovers = coverImages.length > 0;
  const resolveCover = (url: string) =>
    url.startsWith("http") ? url : `${import.meta.env.BASE_URL}${url}`;

  const [activePerson, setActivePerson] = useState<{ name: string; artist: Artist | null } | null>(null);
  const [personOpen, setPersonOpen] = useState(false);
  const [selectedCoverIdx, setSelectedCoverIdx] = useState<number | null>(null);
  const [animPhase, setAnimPhase] = useState<"idle" | "opening" | "open" | "closing">("idle");

  // Count each person's appearances per filterable role across the whole
  // gallery, so a profile can offer "browse panels" jumps with live counts.
  const facetCounts = useMemo(() => {
    const artists = new Map<string, number>();
    const colorists = new Map<string, number>();
    const letterers = new Map<string, number>();
    const credits = new Map<string, number>();
    for (const p of allPanels) {
      artists.set(p.artist, (artists.get(p.artist) ?? 0) + 1);
      for (const c of p.colorists ?? []) colorists.set(c, (colorists.get(c) ?? 0) + 1);
      for (const l of p.letterers ?? []) letterers.set(l, (letterers.get(l) ?? 0) + 1);
      for (const n of p.credits ?? []) credits.set(n, (credits.get(n) ?? 0) + 1);
    }
    return { artists, colorists, letterers, credits };
  }, [allPanels]);

  const resolvePerson = useCallback(
    (name: string, artistId?: string | null): Artist | null => {
      if (artistId && artistIndex.byId.has(artistId)) return artistIndex.byId.get(artistId)!;
      return artistIndex.byName.get(name) ?? null;
    },
    [artistIndex]
  );

  const personFacets = useCallback(
    (name: string): PersonFacets => ({
      artists: facetCounts.artists.get(name) ?? 0,
      colorists: facetCounts.colorists.get(name) ?? 0,
      letterers: facetCounts.letterers.get(name) ?? 0,
      credits: facetCounts.credits.get(name) ?? 0,
    }),
    [facetCounts]
  );

  // A name is only clickable when there's something to show: a profile record
  // with content, or panels to browse in at least one role.
  const isPersonInteractive = useCallback(
    (name: string, artistId?: string | null): boolean => {
      const f = personFacets(name);
      if (f.artists > 0 || f.colorists > 0 || f.letterers > 0 || f.credits > 0) return true;
      return hasProfileInfo(resolvePerson(name, artistId));
    },
    [personFacets, resolvePerson]
  );

  const openPerson = useCallback(
    (name: string, artistId?: string | null) => {
      setActivePerson({ name, artist: resolvePerson(name, artistId) });
      setPersonOpen(true);
    },
    [resolvePerson]
  );
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [slideOutSettled, setSlideOutSettled] = useState(false);
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
    setActivePerson(null);
    setPersonOpen(false);
    thumbRectRef.current = null;
  }, [panel.id]);

  // When the drawer itself closes, dismiss any open profile so it doesn't
  // reappear the next time the drawer opens.
  useEffect(() => {
    if (!open) setPersonOpen(false);
  }, [open]);

  // After the slide-out animation completes, snap the drawer to its closed
  // position (off-screen bottom) without transition. This prevents a diagonal
  // animation across the viewport when slideDir later resets to null.
  const show = open && !closing;
  useEffect(() => {
    if (slideDir && !show) {
      const t = setTimeout(() => setSlideOutSettled(true), 300);
      return () => clearTimeout(t);
    }
    setSlideOutSettled(false);
  }, [slideDir, show]);

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

  // Group credited names by role, preserving the role order the backfill
  // stored (credits arrive sorted by role prominence).
  const creditGroups: [string, IssueCredit[]][] = [];
  if (issueCredits) {
    const byRole = new Map<string, IssueCredit[]>();
    for (const credit of issueCredits.credits) {
      for (const role of credit.roles) {
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push(credit);
      }
    }
    creditGroups.push(...byRole.entries());
  }

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

  // Determine transform based on slideDir or normal open/close
  let transform = show ? "translateY(0)" : "translateY(100vh)";
  if (slideDir && !show && !slideOutSettled) {
    transform = `translateX(${slideDir === "left" ? "-100%" : "100%"})`;
  }
  // When the viewer is closing, fade out instead of sliding down
  if (closing) {
    transform = "translateY(0)";
  }

  return (
    <>
    <div
      className="absolute inset-x-0 z-15 overflow-y-auto info-modal-scroll"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        transform,
        opacity: closing ? 0 : 1,
        transition: closing
          ? "opacity 0.25s ease-out"
          : slideOutSettled
            ? "none"
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

        {/* Issue credits */}
        {creditGroups.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                <span>Credits</span>
                <span className="text-white/20 normal-case tracking-normal">· {formatIssue(panel.issue)}</span>
              </div>
              <div className="space-y-1.5">
                {creditGroups.map(([role, credits]) => (
                  <div key={role} className="flex gap-3 text-xs leading-relaxed">
                    <span className="w-24 shrink-0 text-white/35">{role}</span>
                    <span className="text-white/70">
                      {credits.map((c, i) => {
                        const interactive = isPersonInteractive(c.name, c.artistId);
                        return (
                          <Fragment key={`${c.name}-${i}`}>
                            {i > 0 && ", "}
                            {interactive ? (
                              <button
                                type="button"
                                onClick={() => openPerson(c.name, c.artistId)}
                                className="text-white/70 hover:text-accent underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-accent transition-colors"
                              >
                                {c.name}
                              </button>
                            ) : (
                              c.name
                            )}
                          </Fragment>
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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

        {/* More in this series */}
        {seriesPanels.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                <span>More in this series</span>
                <span className="text-white/20 normal-case tracking-normal">· {seriesPanels.length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 info-related-scroll">
                {seriesPanels.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPanel(p, seriesGroup)}
                    className="relative shrink-0 h-24 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                    style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    title={`${p.title} ${formatIssue(p.issue)}`}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${p.image}`}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[9px] text-white/80 bg-gradient-to-t from-black/80 to-transparent leading-tight">
                      {formatIssue(p.issue)}
                    </span>
                  </button>
                ))}
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
            {isPersonInteractive(panel.artist, artist?.id) ? (
              <button
                type="button"
                onClick={() => openPerson(panel.artist, artist?.id)}
                className="font-display text-sm text-white/90 leading-snug text-left hover:text-accent transition-colors"
              >
                {panel.artist}
              </button>
            ) : (
              <p className="font-display text-sm text-white/90 leading-snug">
                {panel.artist}
              </p>
            )}
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

        {/* More by this artist */}
        {artistPanels.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                <span>More by this artist</span>
                <span className="text-white/20 normal-case tracking-normal">· {artistPanels.length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 info-related-scroll">
                {artistPanels.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPanel(p, artistGroup)}
                    className="relative shrink-0 h-24 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                    style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    title={`${p.title} ${formatIssue(p.issue)}`}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${p.image}`}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[9px] text-white/80 bg-gradient-to-t from-black/80 to-transparent leading-tight">
                      {p.title} {formatIssue(p.issue)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

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
            Search for {panel.title} {formatIssue(panel.issue)}
          </a>
        </div>
      </div>
    </div>

    <PersonProfile
      open={personOpen}
      name={activePerson?.name ?? ""}
      artist={activePerson?.artist ?? null}
      allPanels={allPanels}
      currentPanelId={panel.id}
      onSelectPanel={onSelectPanel}
      onClose={() => setPersonOpen(false)}
      onBrowse={onBrowse}
      topOffset={topOffset}
      bottomOffset={bottomOffset}
    />
    </>
  );
}
