import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Search, ArrowLeft } from "lucide-react";
import type { Panel, Publisher, Reference } from "../types";
import type { BrowseDimension } from "../utils/filtering";
import type { PublisherIndex } from "../utils/publishers";
import { publisherKindLabel, publisherYears } from "../utils/publishers";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import ReferenceLinks from "./ReferenceLinks";

interface Props {
  open: boolean;
  /** The display name — all there is when the series isn't in the registry. */
  name: string;
  publisher: Publisher | null;
  index: PublisherIndex;
  allPanels: Panel[];
  currentPanelId: string;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  onClose: () => void;
  onBrowse: (dimension: BrowseDimension, value: string) => void;
  /** Put another publisher's page up in place of this one (an imprint, a parent). */
  onOpenPublisher: (name: string) => void;
  /** A founder's page, when there's anything to show for them. */
  onOpenPerson?: (name: string, artistId: string | null) => void;
  isPersonInteractive?: (name: string, artistId: string | null) => boolean;
  overViz?: boolean;
}

/** Stagger slot for one block of the page; see `.profile-rise`. */
const rise = (i: number) => ({ "--i": Math.min(i, 5) }) as CSSProperties;

const linkButton =
  "text-white/70 hover:text-accent underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-accent transition-colors";

interface SeriesEntry {
  slug: string;
  title: string;
  year: number | null;
  imprint: string | null;
  panels: Panel[];
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

/**
 * A publisher's page, opened from a publisher name in the info drawer or on a
 * series row, and shown in the drawer the way a person's page is (see
 * `PersonProfile`): the same column and backdrop, trading places with the
 * details on the same lateral axis.
 *
 * What it adds over the drawer's one line is the run of the collection through
 * this label: every series from them, in the order they started, and every
 * panel, with a jump to the gallery filtered to them.
 */
export default function PublisherProfile({
  open,
  name,
  publisher,
  index,
  allPanels,
  currentPanelId,
  onSelectPanel,
  onClose,
  onBrowse,
  onOpenPublisher,
  onOpenPerson,
  isPersonInteractive,
  overViz = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the page before the viewer or drawer sees it.
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

  // A fresh key per opening, so the staggered entrance replays each time.
  const [openSeq, setOpenSeq] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOpenSeq((s) => s + 1);
  }

  useLayoutEffect(() => {
    if (openSeq > 0 && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [openSeq, name]);

  // A parent's page counts its imprints' panels as its own, the same way the
  // filter does.
  const group = useMemo(
    () => (name ? allPanels.filter((p) => p.publisher === name || p.imprint === name) : []),
    [allPanels, name],
  );
  const others = useMemo(() => group.filter((p) => p.id !== currentPanelId), [group, currentPanelId]);

  // One line per series, oldest first, so the list reads as the label's run
  // through the collection.
  const seriesList = useMemo(() => {
    const bySlug = new Map<string, SeriesEntry>();
    for (const p of group) {
      let entry = bySlug.get(p.slug);
      if (!entry) {
        entry = { slug: p.slug, title: p.title, year: null, imprint: p.imprint ?? null, panels: [] };
        bySlug.set(p.slug, entry);
      }
      entry.panels.push(p);
      if (p.year && (entry.year === null || p.year < entry.year)) entry.year = p.year;
    }
    return [...bySlug.values()].sort(
      (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title),
    );
  }, [group]);

  // Imprints with panels here, each with its count — on a parent's page only.
  const imprints = useMemo(() => {
    if (!publisher || publisher.kind === "imprint") return [];
    const counts = new Map<string, number>();
    for (const p of group) {
      if (p.imprint && p.publisher === name) counts.set(p.imprint, (counts.get(p.imprint) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [group, name, publisher]);

  const parent = publisher?.kind === "imprint" && publisher.parent ? index.byId.get(publisher.parent) ?? null : null;
  const kindLabel = publisher ? publisherKindLabel(publisher, index) : "Publisher";

  const metaParts: string[] = [];
  const years = publisher ? publisherYears(publisher) : null;
  if (years) metaParts.push(years);
  if (publisher?.location) metaParts.push(publisher.location);
  if (publisher?.country) metaParts.push(publisher.country);
  const meta = metaParts.join(" · ");

  const references: Reference[] = [
    ...(publisher?.website ? [{ name: hostLabel(publisher.website), url: publisher.website }] : []),
    ...(publisher?.references ?? []),
  ];
  const founders = publisher?.founders ?? [];
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${name} comics publisher`)}`;

  const nameBlock = (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-white/35 mb-1">
        {parent ? (
          <>
            Imprint of{" "}
            <button
              type="button"
              onClick={() => onOpenPublisher(parent.name)}
              className="uppercase tracking-widest text-white/55 hover:text-accent transition-colors"
            >
              {parent.name}
            </button>
          </>
        ) : (
          kindLabel
        )}
      </p>
      <h2 className="font-display text-xl sm:text-2xl text-white/95 leading-tight">{name}</h2>
      {meta && <p className="text-[11px] text-white/45 mt-1">{meta}</p>}
    </div>
  );

  let slot = 2;

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 z-10 overflow-y-auto info-modal-scroll"
      style={{
        opacity: open ? 1 : 0,
        transform: open ? "translate3d(0,0,0)" : "translate3d(24px,0,0)",
        transition: open
          ? "opacity 0.22s ease-out 0.08s, transform 0.34s cubic-bezier(0.2, 0, 0, 1)"
          : "opacity 0.12s ease-in, transform 0.22s cubic-bezier(0.3, 0, 0.8, 0.15)",
        pointerEvents: open ? "auto" : "none",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`About ${name}`}
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

        {/* A logo is a mark on its own ground, not a photograph, so it sits
            whole in a tile rather than bleeding into the backdrop the way a
            portrait does. */}
        <header className="profile-rise flex items-center gap-4" style={rise(1)}>
          <div
            aria-hidden
            className={`relative shrink-0 size-14 overflow-hidden rounded-sm ring-1 ring-inset ${
              publisher?.imageUrl ? "bg-white/90 ring-white/10" : "bg-surface-raised ring-ink-faint/25"
            }`}
          >
            {publisher?.imageUrl ? (
              <img src={publisher.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain p-1.5" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center font-display text-2xl leading-none text-white/20 select-none">
                {name.charAt(0)}
              </span>
            )}
          </div>
          {nameBlock}
        </header>

        <div className="mt-5 space-y-5">
          {(references.length > 0 || publisher?.description) && (
            <div className="profile-rise space-y-3" style={rise(slot++)}>
              <ReferenceLinks references={references} />
              {publisher?.description && (
                <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line">
                  {publisher.description}
                </p>
              )}
            </div>
          )}

          {(founders.length > 0 || imprints.length > 0) && (
            <div className="profile-rise space-y-1.5" style={rise(slot++)}>
              {founders.length > 0 && (
                <div className="flex gap-3 text-xs leading-relaxed">
                  <span className="w-24 shrink-0 text-white/35">Founded by</span>
                  <span className="text-white/70">
                    {founders.map((f, i) => (
                      <Fragment key={`${f.name}-${i}`}>
                        {i > 0 && ", "}
                        {onOpenPerson && isPersonInteractive?.(f.name, f.artistId) ? (
                          <button type="button" onClick={() => onOpenPerson(f.name, f.artistId)} className={linkButton}>
                            {f.name}
                          </button>
                        ) : (
                          f.name
                        )}
                      </Fragment>
                    ))}
                  </span>
                </div>
              )}
              {imprints.length > 0 && (
                <div className="flex gap-3 text-xs leading-relaxed">
                  <span className="w-24 shrink-0 text-white/35">Imprints</span>
                  <span className="text-white/70">
                    {imprints.map(([imprint, count], i) => (
                      <Fragment key={imprint}>
                        {i > 0 && ", "}
                        <button type="button" onClick={() => onOpenPublisher(imprint)} className={linkButton}>
                          {imprint}
                        </button>
                        <span className="text-white/30"> {count}</span>
                      </Fragment>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {seriesList.length > 0 && (
            <>
              <div className="border-t border-white/8" />
              <section className="profile-rise" style={rise(slot++)}>
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                  <span>Series</span>
                  <span className="text-white/20 normal-case tracking-normal">· {seriesList.length}</span>
                </div>
                <ul className="space-y-0.5">
                  {seriesList.map((s) => (
                    <li key={s.slug}>
                      <button
                        type="button"
                        onClick={() => onSelectPanel(s.panels[0], s.panels)}
                        className="group w-full flex items-baseline gap-2 rounded-sm px-1.5 py-1 -mx-1.5 text-left text-xs hover:bg-white/5 transition-colors"
                      >
                        <span className="w-9 shrink-0 tabular-nums text-white/30">{s.year ?? "—"}</span>
                        <span className="min-w-0 truncate text-white/75 group-hover:text-accent transition-colors">
                          {s.title}
                        </span>
                        {s.imprint && s.imprint !== name && (
                          <span className="shrink-0 truncate text-[10px] text-white/30">{s.imprint}</span>
                        )}
                        <span className="ml-auto shrink-0 tabular-nums text-[10px] text-white/30">
                          {s.panels.length}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {group.length > 0 && (
            <>
              <div className="border-t border-white/8" />
              <section className="profile-rise" style={rise(slot++)}>
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
                  <span>Panels</span>
                  <span className="text-white/20 normal-case tracking-normal">· {group.length}</span>
                  <button
                    type="button"
                    onClick={() => onBrowse("publishers", name)}
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
            </>
          )}

          <div className="border-t border-white/8" />
          <div className="profile-rise" style={rise(slot++)}>
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
