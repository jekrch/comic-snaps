import { useEffect, useMemo } from "react";
import { BookOpen, Youtube, Search, ExternalLink, ArrowLeft, Palette, Type, Brush, Users } from "lucide-react";
import type { Artist, Panel, Reference } from "../types";
import { formatIssue } from "../utils/issueFormat";

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
  icon: typeof Brush;
  matches: (p: Panel, name: string) => boolean;
}[] = [
  { dimension: "artists", label: "As artist", icon: Brush, matches: (p, name) => p.artist === name },
  { dimension: "colorists", label: "As colorist", icon: Palette, matches: (p, name) => (p.colorists ?? []).includes(name) },
  { dimension: "letterers", label: "As letterer", icon: Type, matches: (p, name) => (p.letterers ?? []).includes(name) },
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
        icon: Users,
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

  const heroText = (
    <div className="relative z-10">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="h-px w-5 bg-accent/80" />
        <p className="text-[10px] uppercase tracking-widest text-accent">Creator</p>
      </div>
      <p className="font-display text-xl text-white/95 leading-snug">{name}</p>
      {meta && <p className="text-[10px] font-mono text-white/50 mt-1">{meta}</p>}
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
          tapping outside dismisses the profile. */}
      <div
        className="absolute right-0 left-9 sm:left-16 z-20 overflow-y-auto info-modal-scroll"
        style={{
          top: topOffset,
          bottom: bottomOffset,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.32s cubic-bezier(0.2, 0, 0, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="min-h-full backdrop-blur-sm border-l-2 border-accent/40"
          style={{ backgroundColor: "rgba(6,6,6,0.97)", boxShadow: "-24px 0 48px rgba(0,0,0,0.45)" }}
        >
          <div className="px-6 pb-5 sm:px-10 sm:pb-6 max-w-lg lg:max-w-xl mx-auto w-full">
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
                className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors"
              >
                <ArrowLeft size={12} />
                Back
              </button>
            </div>
            <div className="space-y-5">

            {/* Hero — show the portrait proper, not just a faded wash. */}
            <div
              className="relative overflow-hidden rounded ring-1 ring-inset ring-white/8"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
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
                  <div className="absolute inset-x-0 bottom-0 px-4 pb-3.5">{heroText}</div>
                </>
              ) : (
                <div className="relative px-4 py-5">
                  {/* Oversized monogram stands in when there's no portrait. */}
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-7 font-display text-[7rem] leading-none text-white/5 select-none pointer-events-none"
                  >
                    {name.charAt(0)}
                  </span>
                  {heroText}
                </div>
              )}
            </div>

            {/* References */}
            {artist?.references && artist.references.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {artist.references.map((ref) => (
                  <a
                    key={ref.url}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/4 text-[10px] text-white/55 hover:text-accent hover:border-accent/40 transition-colors"
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

            {/* Panels per role — same treatment as the drawer's related
                sections, with a jump to the filtered gallery per role. */}
            {panelRows.map(({ dimension, label, icon: Icon, group, others }) => (
              <div key={dimension}>
                <div className="border-t border-white/8 mb-4" />
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                  <Icon size={11} className="text-accent/70" />
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
                          src={`${import.meta.env.BASE_URL}${p.image}`}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[9px] text-white/80 bg-linear-to-t from-black/80 to-transparent leading-tight">
                          {p.title} {formatIssue(p.issue)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
