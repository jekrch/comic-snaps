import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Search, ArrowLeft } from "lucide-react";
import type { Artist, Panel } from "../types";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import ReferenceLinks from "./ReferenceLinks";
import CollaboratorGraph from "./CollaboratorGraph";

interface Props {
  open: boolean;
  name: string;
  artist: Artist | null;
  allPanels: Panel[];
  currentPanelId: string;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onClose: () => void;
  onBrowse: (dimension: "artists" | "colorists" | "letterers" | "credits", value: string) => void;
  /** Put a collaborator's page up in place of this one. */
  onOpenPerson?: (name: string) => void;
  /** Viewer is over a running visualizer — the column takes the drawer's scrim. */
  overViz?: boolean;
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

/**
 * The hero portrait, fading into the backdrop at its foot.
 *
 * The fade is a gradient laid over the image, not a mask: iOS Safari left a
 * masked portrait in the drawer as a dark gap, both with the mask on the
 * `<img>` and on a wrapper around it. The gradient ends in black, which is
 * what the viewer's backdrop (90% black over the wall) reads as, and its stops
 * mirror the mask it replaces. The image also fades up once it has decoded,
 * so it never pops in half-drawn.
 */
function ProfilePortrait({ src, alt, onError }: { src: string; alt: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // A cached image can finish before the load listener is attached.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <div className="relative w-full aspect-16/10 overflow-hidden rounded-sm">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={onError}
        className="block w-full h-full object-cover"
        style={{
          objectPosition: "center 22%",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease-out",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "linear-gradient(to bottom, transparent 35%, rgba(0,0,0,0.45) 70%, #000 100%)" }}
      />
    </div>
  );
}

/** Stagger slot for one block of the page; see `.profile-rise`. */
const rise = (i: number) => ({ "--i": Math.min(i, 5) }) as CSSProperties;

/**
 * A person's page, opened from a name in the info drawer (or the viewer's
 * header) and shown *in* the drawer rather than over it.
 *
 * It lives inside the drawer's own moving box and on the same see-through
 * backdrop, with the same column, so it reads as the drawer turning a page
 * rather than as a second surface stacked on the first. The drawer's details
 * step aside as it arrives (InfoDrawer runs the other half of that exchange),
 * and closing the drawer takes the profile down with it.
 */
export default function PersonProfile({
  open,
  name,
  artist,
  allPanels,
  currentPanelId,
  onSelectPanel,
  onClose,
  onBrowse,
  onOpenPerson,
  overViz = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A portrait whose source is gone (a moved or hotlink-blocked image) falls
  // back to the monogram rather than leaving a blank hero.
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);

  // Intercept Escape before the viewer/drawer sees it so it closes the profile
  // first, returning the user to wherever they came from.
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

  // A fresh key per opening, so the staggered entrance replays each time
  // rather than only on the first. Tracked in state (the "previous prop"
  // pattern) so the remount lands in the same render as the open.
  const [openSeq, setOpenSeq] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOpenSeq((s) => s + 1);
  }

  // Every opening starts at the top of the page — including one person's page
  // handing over to a collaborator's.
  useLayoutEffect(() => {
    if (openSeq > 0 && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [openSeq, name]);

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
  const hasIntro = !!artist?.description || (artist?.references?.length ?? 0) > 0;

  const nameBlock = (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-white/35 mb-1">Creator</p>
      <h2 className="font-display text-xl sm:text-2xl text-white/95 leading-tight">{name}</h2>
      {meta && <p className="text-[11px] text-white/45 mt-1">{meta}</p>}
    </div>
  );

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 z-10 overflow-y-auto info-modal-scroll"
      style={{
        opacity: open ? 1 : 0,
        transform: open ? "translate3d(0,0,0)" : "translate3d(24px,0,0)",
        // Arrives on a decelerating push, just behind the details leaving;
        // leaves quickly, so the details it hands back to aren't kept waiting.
        transition: open
          ? "opacity 0.22s ease-out 0.08s, transform 0.34s cubic-bezier(0.2, 0, 0, 1)"
          : "opacity 0.12s ease-in, transform 0.22s cubic-bezier(0.3, 0, 0.8, 0.15)",
        pointerEvents: open ? "auto" : "none",
      }}
      // The margins either side of the column are the backdrop, and a tap
      // there dismisses the profile the way it dismisses the viewer.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`About ${name}`}
      // Hidden, the page is still in the layout so it can transition out — but
      // it must not be in the tab order while it's invisible.
      inert={!open}
    >
      <div
        key={`${name}-${openSeq}`}
        className={`px-6 pt-4 pb-8 sm:px-10 sm:pt-6 sm:pb-10 max-w-lg lg:max-w-xl mx-auto w-full${
          overViz ? " viz-read-scrim min-h-full" : ""
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          className="profile-rise -ml-1.5 mb-4 inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[10px] uppercase tracking-widest text-white/40 hover:text-white/80 hover:bg-white/6 transition-colors"
          style={rise(0)}
        >
          <ArrowLeft size={12} />
          Back
        </button>

        {/* Hero — the portrait dissolves into the backdrop instead of sitting
            in a box, and the name is set over its faded foot, so the person
            reads as the subject of the page rather than as a card on it. */}
        <header className="profile-rise" style={rise(1)}>
          {artist?.imageUrl && failedPortrait !== artist.imageUrl ? (
            <>
              <ProfilePortrait
                key={artist.imageUrl}
                src={artist.imageUrl}
                alt={name}
                onError={() => setFailedPortrait(artist.imageUrl ?? null)}
              />
              <div className="relative -mt-12 px-0.5" style={{ textShadow: "0 1px 14px rgba(0,0,0,0.7)" }}>
                {nameBlock}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4">
              {/* The artist rail's monogram tile, for a person with no portrait. */}
              <div
                aria-hidden
                className="relative shrink-0 size-14 overflow-hidden rounded-sm bg-surface-raised ring-1 ring-inset ring-ink-faint/25"
              >
                <span className="absolute inset-0 flex items-center justify-center font-display text-2xl leading-none text-white/20 select-none">
                  {name.charAt(0)}
                </span>
              </div>
              {nameBlock}
            </div>
          )}
        </header>

        <div className="mt-5 space-y-5">
          {hasIntro && (
            <div className="profile-rise space-y-3" style={rise(2)}>
              <ReferenceLinks references={artist?.references ?? []} />
              {artist?.description && (
                <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line">
                  {artist.description}
                </p>
              )}
            </div>
          )}

          {/* Panels per role — the drawer's related sections exactly: a
              rule, a small-caps header carrying its own count, then the
              strip. The one addition is a jump to the filtered gallery,
              which rides the header line where the count leaves off. */}
          {panelRows.map(({ dimension, label, group, others }, i) => (
            <Fragment key={dimension}>
              <div className="border-t border-white/8" />
              <section className="profile-rise" style={rise(3 + i)}>
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
              </section>
            </Fragment>
          ))}

          <CollaboratorGraph
            name={name}
            allPanels={allPanels}
            onSelectPanel={onSelectPanel}
            onOpenPerson={onOpenPerson}
            style={rise(3 + panelRows.length)}
          />

          {/* Google search fallback */}
          <div className="border-t border-white/8" />
          <div className="profile-rise" style={rise(4 + panelRows.length)}>
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
  );
}
