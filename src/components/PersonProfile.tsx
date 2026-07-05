import { useEffect } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ArrowLeft, Palette, Type, Brush } from "lucide-react";
import type { Artist, Reference } from "../types";

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

export interface PersonFacets {
  artists: number;
  colorists: number;
  letterers: number;
}

interface Props {
  open: boolean;
  name: string;
  artist: Artist | null;
  facets: PersonFacets;
  onClose: () => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers", value: string) => void;
  topOffset?: number;
  bottomOffset?: number;
}

const BROWSE_ROWS: {
  key: keyof PersonFacets;
  dimension: "artists" | "colorists" | "letterers";
  label: string;
  icon: typeof Brush;
}[] = [
  { key: "artists", dimension: "artists", label: "As artist", icon: Brush },
  { key: "colorists", dimension: "colorists", label: "As colorist", icon: Palette },
  { key: "letterers", dimension: "letterers", label: "As letterer", icon: Type },
];

export default function PersonProfile({
  open,
  name,
  artist,
  facets,
  onClose,
  onBrowse,
  topOffset = 0,
  bottomOffset = 0,
}: Props) {
  // Intercept Escape before the viewer/drawer sees it so it closes the profile
  // first, returning the user to the drawer they came from.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  const years =
    artist?.birthYear && artist?.deathYear
      ? `${artist.birthYear}–${artist.deathYear}`
      : artist?.birthYear
        ? `b. ${artist.birthYear}`
        : null;
  const metaParts: string[] = [];
  if (years) metaParts.push(years);
  if (artist?.country) metaParts.push(artist.country);
  const meta = metaParts.join(" · ");

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${name} comics`)}`;
  const browseRows = BROWSE_ROWS.filter((r) => facets[r.key] > 0);

  return (
    <>
      {/* Backdrop — dims the drawer beneath and closes on tap. */}
      <div
        className="absolute inset-x-0 z-20"
        style={{
          top: topOffset,
          bottom: bottomOffset,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease-out",
        }}
        onClick={onClose}
      />

      {/* Slideover panel */}
      <div
        className="absolute inset-x-0 z-20 overflow-y-auto info-modal-scroll"
        style={{
          top: topOffset,
          bottom: bottomOffset,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.32s cubic-bezier(0.2, 0, 0, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-full bg-surface/95 backdrop-blur-sm border-l border-white/8">
          <div className="px-6 py-5 sm:px-10 sm:py-6 space-y-5 max-w-lg lg:max-w-xl mx-auto w-full">
            {/* Back / close */}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors"
            >
              <ArrowLeft size={12} />
              Back
            </button>

            {/* Hero */}
            <div className="relative overflow-hidden rounded" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
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
                      background:
                        "linear-gradient(to right, rgba(0,0,0,1) 25%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.15) 100%)",
                    }}
                  />
                </div>
              )}
              <div className="relative z-10 px-4 py-5">
                <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Creator</p>
                <p className="font-display text-lg text-white/90 leading-snug">{name}</p>
                {meta && <p className="text-[10px] text-white/40 mt-1">{meta}</p>}
                {artist?.references && artist.references.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2.5">
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

            {/* Description */}
            {artist?.description && (
              <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line">
                {artist.description}
              </p>
            )}

            {/* Browse — jump to the filtered gallery for this person's roles. */}
            {browseRows.length > 0 && (
              <>
                <div className="border-t border-white/8" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Browse panels</p>
                  <div className="space-y-1.5">
                    {browseRows.map(({ key, dimension, label, icon: Icon }) => {
                      const count = facets[key];
                      return (
                        <button
                          key={dimension}
                          type="button"
                          onClick={() => onBrowse(dimension, name)}
                          className="group w-full flex items-center gap-3 rounded px-3 py-2.5 bg-white/[0.03] hover:bg-white/[0.07] ring-1 ring-inset ring-white/8 hover:ring-accent/40 transition-colors text-left"
                        >
                          <Icon size={14} className="shrink-0 text-white/40 group-hover:text-accent transition-colors" />
                          <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                            {label}
                          </span>
                          <span className="ml-auto text-[10px] tabular-nums text-white/35">
                            {count} panel{count === 1 ? "" : "s"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Google search fallback */}
            <div className="border-t border-white/8" />
            <div>
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-dim transition-colors"
              >
                <Search size={12} />
                Search for {name}
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
