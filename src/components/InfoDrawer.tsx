import { useEffect, useState } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ChevronDown } from "lucide-react";
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
  const teaserCount = Math.min(4, coverImages.length);
  const teaserCovers = coverImages.slice(0, teaserCount);
  const hiddenCount = Math.max(0, coverImages.length - teaserCount);
  const resolveCover = (url: string) =>
    url.startsWith("http") ? url : `${import.meta.env.BASE_URL}${url}`;

  const [coversExpanded, setCoversExpanded] = useState(false);
  useEffect(() => { setCoversExpanded(false); }, [panel.id]);

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

        {/* Covers */}
        {hasCovers && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <button
                type="button"
                aria-expanded={coversExpanded}
                onClick={() => setCoversExpanded((e) => !e)}
                className="group flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
              >
                <span>Covers</span>
                <span className="text-white/20 normal-case tracking-normal">· {coverImages.length}</span>
                <ChevronDown
                  size={11}
                  className="transition-transform duration-300 ease-out"
                  style={{ transform: coversExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>

              {/* Teaser strip (collapsed) */}
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                style={{
                  gridTemplateRows: coversExpanded ? "0fr" : "1fr",
                  opacity: coversExpanded ? 0 : 1,
                }}
                aria-hidden={coversExpanded}
              >
                <div className="overflow-hidden">
                  <div className="flex gap-1.5">
                    {teaserCovers.map((url, i) => {
                      const showOverlay = hiddenCount > 0 && i === teaserCount - 1;
                      return (
                        <button
                          key={url}
                          type="button"
                          tabIndex={coversExpanded ? -1 : 0}
                          onClick={() => setCoversExpanded(true)}
                          className="relative block w-11 h-16.5 rounded-sm overflow-hidden bg-white/5 shrink-0 ring-1 ring-inset ring-white/5 hover:ring-white/20 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5"
                        >
                          <img
                            src={resolveCover(url)}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {showOverlay && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white/85 text-[10px] font-display">
                              +{hiddenCount}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Full grid (expanded) */}
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                style={{
                  gridTemplateRows: coversExpanded ? "1fr" : "0fr",
                  opacity: coversExpanded ? 1 : 0,
                }}
                aria-hidden={!coversExpanded}
              >
                <div className="overflow-hidden">
                  <div className="grid grid-cols-4 gap-2 pt-0.5">
                    {coverImages.map((url) => (
                      <a
                        key={url}
                        href={resolveCover(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        tabIndex={coversExpanded ? 0 : -1}
                        className="relative block aspect-2/3 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5"
                      >
                        <img
                          src={resolveCover(url)}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                        />
                      </a>
                    ))}
                  </div>
                </div>
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
