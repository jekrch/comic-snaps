import { Fragment, useEffect, useMemo } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ArrowLeft } from "lucide-react";
import type { Artist, Panel, Reference } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

interface Props {
  open: boolean;
  name: string;
  artist: Artist | null;
  allPanels: Panel[];
  currentPanelId: string;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onClose: () => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  topOffset?: number;
  bottomOffset?: number;
}

const ROLE_ROWS: {
  dimension: "artists" | "colorists" | "letterers" | "credits";
  label: string;
  matches: (p: Panel, name: string) => boolean;
}[] = [
  { dimension: "artists", label: "As artist", matches: (p, name) => p.artist === name },
  { dimension: "colorists", label: "As colorist", matches: (p, name) => (p.colorists ?? []).includes(name) },
  { dimension: "letterers", label: "As letterer", matches: (p, name) => (p.letterers ?? []).includes(name) },
];

export default function PersonProfile({
  open,
  name,
  artist,
  allPanels,
  currentPanelId,
  onSelectPanel,
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

  // This person's panels per role across the whole gallery. The full group
  // (including the current panel) scopes the viewer's prev/next when a
  // thumbnail is clicked; the strip itself only shows the *other* panels,
  // mirroring the drawer's related sections. Panels where they're credited
  // in any remaining role (writer, cover, editor…) get a catch-all row.
  const panelRows = useMemo(() => {
    const roleGroups = ROLE_ROWS.map((row) => {
      const group = allPanels.filter((p) => row.matches(p, name));
      return { ...row, group, others: group.filter((p) => p.id !== currentPanelId) };
    }).filter((row) => row.group.length > 0);
    const covered = new Set(roleGroups.flatMap((r) => r.group.map((p) => p.id)));
    const creditGroup = allPanels.filter(
      (p) => (p.credits ?? []).includes(name) && !covered.has(p.id)
    );
    if (creditGroup.length > 0) {
      roleGroups.push({
        dimension: "credits",
        label: roleGroups.length > 0 ? "Also credited" : "Credited on",
        matches: () => false,
        group: creditGroup,
        others: creditGroup.filter((p) => p.id !== currentPanelId),
      });
    }
    return roleGroups;
  }, [allPanels, name, currentPanelId]);

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

  // The same three lines the drawer's series and artist cards lead with — small
  // caps label, display name, meta — so the profile reads as that card opened
  // rather than as a different kind of surface. One step up in name size is the
  // only difference, because here the person *is* the subject of the view.
  const heroText = (
    <div className="relative z-10">
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Creator</p>
      <p className="font-display text-base text-white/90 leading-snug">{name}</p>
      {meta && <p className="text-[10px] text-white/40 mt-0.5">{meta}</p>}
    </div>
  );

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

      {/* Slideover panel — leaves a strip of backdrop exposed on the left so
          tapping outside dismisses the profile. It slides on the drawer's own
          left/right timing, since this is the same lateral move the drawer
          makes when it pages between panels. */}
      <div
        className="absolute right-0 left-9 sm:left-16 z-20 overflow-y-auto info-modal-scroll"
        style={{
          top: topOffset,
          bottom: bottomOffset,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.2, 0, 0, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`About ${name}`}
        // Closed, the panel is still in the layout so it can slide out — but it
        // must not be in the tab order while it's off-screen.
        inert={!open}
      >
        {/* The scrim is the drawer's, at the drawer's own reading opacity; the
            edge is a hairline, because nothing else in the app frames a surface
            with a coloured border. */}
        <div
          className="min-h-full backdrop-blur-sm border-l border-white/8"
          style={{ backgroundColor: "rgba(6,6,6,0.97)", boxShadow: "-16px 0 40px rgba(0,0,0,0.4)" }}
        >
          <div className="px-6 pb-6 sm:px-10 sm:pb-8 max-w-lg lg:max-w-xl mx-auto w-full">
            {/* Back / close — sticky so it stays reachable while scrolled. */}
            <div
              className="sticky top-0 z-10 -mx-6 sm:-mx-10 px-6 sm:px-10 pt-4 pb-3 sm:pt-5"
              style={{
                background: "linear-gradient(to bottom, rgba(6,6,6,0.97) 70%, rgba(6,6,6,0))",
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
              >
                <ArrowLeft size={12} />
                Back
              </button>
            </div>

            <div className="space-y-5">
              {/* Hero — the drawer's card, with the portrait shown proper
                  rather than as the faded right-hand wash, since this view
                  exists to put the person in front of the reader. */}
              <div
                className="relative overflow-hidden rounded"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                {artist?.imageUrl ? (
                  <>
                    <img
                      src={artist.imageUrl}
                      alt={name}
                      className="w-full aspect-16/10 object-cover"
                      style={{ objectPosition: "center 22%" }}
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(to top, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.45) 45%, rgba(10,10,10,0.05) 75%)",
                      }}
                    />
                    <div className="absolute inset-x-0 bottom-0 px-4 pb-3">{heroText}</div>
                  </>
                ) : (
                  <div className="relative px-4 py-4">
                    {/* Oversized monogram stands in when there's no portrait —
                        the same initial the artist rail cuts into its box. */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-4 font-display text-[5.5rem] leading-none text-white/8 select-none pointer-events-none"
                    >
                      {name.charAt(0)}
                    </span>
                    {heroText}
                  </div>
                )}
              </div>

              {/* References — set as the drawer sets them: accent text links,
                  not pills. */}
              {artist?.references && artist.references.length > 0 && (
                <div className="flex flex-wrap gap-2">
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

              {/* Description */}
              {artist?.description && (
                <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line">
                  {artist.description}
                </p>
              )}

              {/* Panels per role — the drawer's related sections exactly: a
                  rule, a small-caps header carrying its own count, then the
                  strip. The one addition is a jump to the filtered gallery,
                  which rides the header line where the count leaves off. */}
              {panelRows.map(({ dimension, label, group, others }) => (
                <Fragment key={dimension}>
                  <div className="border-t border-white/8" />
                  <div>
                    <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                      <span>{label}</span>
                      <span className="text-white/20 normal-case tracking-normal">· {group.length}</span>
                      <button
                        type="button"
                        onClick={() => onBrowse(dimension, name)}
                        className="ml-auto normal-case tracking-normal text-[10px] text-accent hover:text-accent-dim transition-colors"
                      >
                        View in gallery →
                      </button>
                    </div>
                    {others.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1 info-related-scroll">
                        {others.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onSelectPanel(p, group)}
                            className="relative shrink-0 h-24 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                            style={{ aspectRatio: `${p.width} / ${p.height}` }}
                            title={`${p.title} ${formatIssue(p.issue)}`}
                          >
                            <img
                              src={panelImageUrl(p.image)}
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
                    )}
                  </div>
                </Fragment>
              ))}

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
      </div>
    </>
  );
}
