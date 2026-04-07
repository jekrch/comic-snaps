import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Youtube, Search, ExternalLink } from "lucide-react";
import type { Panel, Artist, Series, Reference } from "../types";

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

interface Props {
  open: boolean;
  onClose: () => void;
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

export default function InfoDrawer({ open, onClose, panel, artist, series, parentSeries, searchUrl, topOffset = 0, bottomOffset = 0, closing = false, slideDir = null }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 400);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // When the parent viewer is closing, immediately hide and unmount fast
  useEffect(() => {
    if (closing) {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 250);
      return () => clearTimeout(timer);
    }
  }, [closing]);

  if (!mounted) return null;

  const seriesDesc = series?.description || parentSeries?.description || "";
  const seriesRefs = series?.references?.length ? series.references : parentSeries?.references ?? [];
  const seriesImageUrl = series?.imageUrl || parentSeries?.imageUrl || null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 pointer-events-auto"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        ...(slideDir
          ? {
              transform: !visible ? `translateX(${slideDir === "left" ? "-100%" : "100%"})` : "translateX(0)",
              transition: "transform 0.28s cubic-bezier(0.2, 0, 0, 1)",
            }
          : {
              opacity: closing ? 0 : undefined,
              transition: closing ? "opacity 0.2s ease-out" : undefined,
            }),
      }}
      onClick={onClose}
    >
      {/* Hatch overlay — animated diagonal lines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `repeating-linear-gradient(
            45deg,
            rgba(0,0,0,0.85) 0px,
            rgba(0,0,0,0.85) 2px,
            transparent 2px,
            transparent 6px
          )`,
          opacity: visible ? 1 : 0,
          transition: "opacity 0.35s ease-out",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `repeating-linear-gradient(
            -45deg,
            rgba(0,0,0,0.85) 0px,
            rgba(0,0,0,0.85) 2px,
            transparent 2px,
            transparent 6px
          )`,
          opacity: visible ? 1 : 0,
          transition: "opacity 0.3s ease-out 0.05s",
        }}
      />
      {/* Solid background that fades in behind the hatch */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: "rgba(0,0,0,0.85)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.4s ease-out 0.15s",
        }}
      />

      <div
        className={`
          relative w-full h-full overflow-y-auto info-modal-scroll
          pointer-events-auto
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-6 sm:px-10 sm:py-8 space-y-5 max-w-lg lg:max-w-xl mx-auto w-full"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.3s ease-out 0.2s, transform 0.3s ease-out 0.2s",
          }}
        >
          {/* Series info — fall back to parentSeries for description & references */}
          <div className="relative overflow-hidden rounded" style={{ backgroundColor: "rgba(0,0,0,0.8)" }}>
            {seriesImageUrl && (
              <div className="absolute inset-0 pointer-events-none">
                <img
                  src={seriesImageUrl}
                  alt=""
                  className="absolute right-0 top-0 h-full w-2/3 object-cover object-center"
                  style={{ opacity: 0.35 }}
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

          {/* Divider */}
          <div className="border-t border-white/8" />

          {/* Artist info */}
          <div className="relative overflow-hidden rounded" style={{ backgroundColor: "rgba(0,0,0,0.8)" }}>
            {artist?.imageUrl && (
              <div className="absolute inset-0 pointer-events-none">
                <img
                  src={artist.imageUrl}
                  alt=""
                  className="absolute right-0 top-0 h-full w-2/3 object-cover object-center"
                  style={{ opacity: 0.35 }}
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
    </div>,
    document.body
  );
}
