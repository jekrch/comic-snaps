import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Search, ArrowLeft } from "lucide-react";
import type { Panel, Publisher, Reference } from "../types";
import type { BrowseDimension } from "../utils/filtering";
import type { DecadeCount, PublisherIndex } from "../utils/publishers";
import { panelsByDecade, publisherKindLabel, publisherLogoFor, publisherYears, yearSpan } from "../utils/publishers";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";
import type { ArtistIndex } from "../hooks/useMetadata";
import { useOwnershipIndex, useSeriesById } from "../hooks/useMetadata";
import { ownershipChain } from "../utils/owners";
import ReferenceLinks from "./ReferenceLinks";
import OwnershipTree from "./OwnershipTree";
import { isMarkZoomOpen } from "./MarkZoom";
import { attachDragScroll } from "../hooks/useDragScroll";

interface Props {
  open: boolean;
  /** The display name — all there is when the series isn't in the registry. */
  name: string;
  publisher: Publisher | null;
  index: PublisherIndex;
  artistIndex: ArtistIndex;
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

interface ArtistEntry {
  name: string;
  artistId: string | null;
  portrait: string | null;
  panels: Panel[];
  /** Other houses their panels on the wall came from, most panels first. */
  elsewhere: string[];
}

/** Artists shown before "Show all". */
const ARTISTS_SHOWN = 8;

const resolveAsset = (url: string) => (/^https?:\/\//.test(url) ? url : `${import.meta.env.BASE_URL}${url}`);

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

/** A section's small-caps heading, with an optional count and action. */
function SectionHead({ label, count, children }: { label: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
      <span>{label}</span>
      {count !== undefined && <span className="text-white/20 normal-case tracking-normal">· {count}</span>}
      {children}
    </div>
  );
}

/**
 * The publisher's panels by decade as a row of columns, every decade from the
 * first to the last in place so the gaps show. A column opens its decade's
 * panels in the viewer.
 */
function DecadeBar({
  rows,
  currentYear,
  onSelectPanel,
}: {
  rows: DecadeCount[];
  currentYear: number | null;
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
}) {
  const max = Math.max(...rows.map((r) => r.panels.length));
  const currentDecade = currentYear ? Math.floor(currentYear / 10) * 10 : null;
  return (
    <div className="flex items-end gap-1 h-20" role="list" aria-label="Panels by decade">
      {rows.map((r) => {
        const n = r.panels.length;
        const here = r.decade === currentDecade;
        const label = `${r.decade}s: ${n} panel${n === 1 ? "" : "s"}`;
        return (
          <button
            key={r.decade}
            type="button"
            role="listitem"
            disabled={n === 0}
            onClick={() => onSelectPanel(r.panels[0], r.panels)}
            title={label}
            aria-label={label}
            className="group flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1 disabled:cursor-default"
          >
            <span className="text-[9px] tabular-nums text-white/0 group-hover:text-white/50 group-focus-visible:text-white/50 transition-colors">
              {n || ""}
            </span>
            <span
              className={`w-full max-w-7 rounded-xs transition-colors ${
                n === 0
                  ? "bg-white/5"
                  : here
                    ? "bg-accent"
                    : "bg-white/25 group-hover:bg-accent/80"
              }`}
              style={{ height: n === 0 ? 2 : `${Math.max(8, (n / max) * 100) * 0.5}px` }}
            />
            <span className={`text-[9px] tabular-nums ${here ? "text-white/60" : "text-white/30"}`}>
              {`'${String(r.decade).slice(2)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
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
  artistIndex,
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

  // Escape closes the page before the viewer or drawer sees it — unless an
  // ownership mark is enlarged over it, which closes first.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isMarkZoomOpen()) {
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

  // One cover per series, in the series list's order: the series' own first
  // cover, or its Comic Vine image when it has no downloaded covers.
  const seriesById = useSeriesById();
  const covers = useMemo(
    () =>
      seriesList.flatMap((s) => {
        const record = seriesById.get(s.slug);
        const url = record?.coverImages?.[0] ?? record?.imageUrl;
        return url ? [{ entry: s, url: resolveAsset(url) }] : [];
      }),
    [seriesList, seriesById],
  );

  // Everyone whose art is on the wall under this label, most panels first,
  // with the other houses they turn up under.
  const artists = useMemo(() => {
    const groupIds = new Set(group.map((p) => p.id));
    const byName = new Map<string, Panel[]>();
    for (const p of group) {
      const list = byName.get(p.artist);
      if (list) list.push(p);
      else byName.set(p.artist, [p]);
    }
    const elsewhere = new Map<string, Map<string, number>>();
    for (const p of allPanels) {
      if (groupIds.has(p.id) || !p.publisher || !byName.has(p.artist)) continue;
      let counts = elsewhere.get(p.artist);
      if (!counts) elsewhere.set(p.artist, (counts = new Map()));
      counts.set(p.publisher, (counts.get(p.publisher) ?? 0) + 1);
    }
    return [...byName.entries()]
      .map(([artist, panels]): ArtistEntry => {
        const record = artistIndex.byName.get(artist) ?? null;
        return {
          name: artist,
          artistId: record?.id ?? null,
          portrait: record?.imageUrl || null,
          panels,
          elsewhere: [...(elsewhere.get(artist) ?? new Map<string, number>()).entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([pub]) => pub),
        };
      })
      .sort((a, b) => b.panels.length - a.panels.length || a.name.localeCompare(b.name));
  }, [group, allPanels, artistIndex]);
  const [showAllArtists, setShowAllArtists] = useState(false);
  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) {
    setPrevName(name);
    setShowAllArtists(false);
  }
  const shownArtists = showAllArtists ? artists : artists.slice(0, ARTISTS_SHOWN);

  // The panel the page was opened over, for marking its era.
  const currentYear = useMemo(() => {
    const p = allPanels.find((x) => x.id === currentPanelId);
    return p && group.includes(p) && p.year > 0 ? p.year : null;
  }, [allPanels, currentPanelId, group]);
  const decades = useMemo(() => panelsByDecade(group), [group]);
  const logos = publisher?.logos ?? [];
  const currentLogo = publisherLogoFor(publisher, currentYear);
  const editors = publisher?.editors ?? [];
  const events = publisher?.events ?? [];

  const ownershipIndex = useOwnershipIndex();
  const ownership = useMemo(
    () => (publisher ? ownershipChain(publisher, index, ownershipIndex) : null),
    [publisher, index, ownershipIndex],
  );

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

        {/* The label's books on the wall, by their covers: one per series, in
            the order the series started, each opening its panels. */}
        {covers.length > 0 && (
          <div
            ref={attachDragScroll}
            className="profile-rise mt-4 flex gap-1.5 overflow-x-auto pb-1 info-related-scroll drag-scroll"
            style={rise(slot++)}
            aria-label="Covers"
          >
            {covers.map(({ entry, url }) => (
              <button
                key={entry.slug}
                type="button"
                onClick={() => onSelectPanel(entry.panels[0], entry.panels)}
                title={entry.title}
                className="relative shrink-0 h-28 aspect-2/3 overflow-hidden rounded-sm bg-white/5 ring-1 ring-inset ring-white/10 hover:ring-white/40 transition-shadow"
              >
                <img src={url} alt={entry.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

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

          {(founders.length > 0 || editors.length > 0 || imprints.length > 0) && (
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
              {editors.length > 0 && (
                <div className="flex gap-3 text-xs leading-relaxed">
                  <span className="w-24 shrink-0 text-white/35">Editors</span>
                  <ul className="min-w-0 text-white/70">
                    {editors.map((e, i) => {
                      const span = yearSpan(e.from, e.until);
                      return (
                        <li key={`${e.name}-${i}`}>
                          {onOpenPerson && isPersonInteractive?.(e.name, e.artistId) ? (
                            <button type="button" onClick={() => onOpenPerson(e.name, e.artistId)} className={linkButton}>
                              {e.name}
                            </button>
                          ) : (
                            e.name
                          )}
                          <span className="text-white/35">
                            {" · "}
                            {e.role}
                            {span && `, ${span}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
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

          {/* Its marks over the years, the one on the open panel's cover
              ringed. Each opens the file it came from, for its credit. */}
          {logos.length > 1 && (
            <section className="profile-rise" style={rise(slot++)}>
              <SectionHead label="Logos" />
              <div ref={attachDragScroll} className="flex gap-3 overflow-x-auto pb-1 info-related-scroll drag-scroll">
                {logos.map((logo, i) => {
                  const span = yearSpan(logo.from, logo.until);
                  const here = logo === currentLogo;
                  return (
                    <a
                      key={`${logo.url}-${i}`}
                      href={logo.source ?? logo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={here ? `${span} · the mark on this panel's era` : span}
                      className="group shrink-0 flex flex-col items-center gap-1"
                    >
                      <span
                        className={`relative block h-14 w-24 overflow-hidden rounded-sm bg-white/90 ring-inset transition-shadow ${
                          here ? "ring-2 ring-accent" : "ring-1 ring-white/10 group-hover:ring-white/40"
                        }`}
                      >
                        <img
                          src={logo.url}
                          alt={`${name} logo${span ? `, ${span}` : ""}`}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-contain p-1.5"
                        />
                      </span>
                      <span className={`text-[9px] tabular-nums ${here ? "text-accent" : "text-white/40"}`}>
                        {span || "—"}
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* Milestones, oldest first, on a rule. The year of the open panel
              gets the accent, so it can be read against the history. */}
          {events.length > 0 && (
            <section className="profile-rise" style={rise(slot++)}>
              <SectionHead label="History" />
              <ol className="ml-1 border-l border-white/10 space-y-1.5">
                {events.map((e, i) => {
                  const here = e.year === currentYear;
                  return (
                    <li key={`${e.year}-${i}`} className="relative pl-3.5 flex gap-2.5 text-xs leading-relaxed">
                      <span
                        aria-hidden
                        className={`absolute -left-[3.5px] top-[7px] size-1.5 rounded-full ${here ? "bg-accent" : "bg-white/30"}`}
                      />
                      <span className={`w-8 shrink-0 tabular-nums ${here ? "text-accent" : "text-white/35"}`}>{e.year}</span>
                      <span className="min-w-0 text-white/65">{e.text}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* What the wall holds from them: when, and by whom. */}
          {group.length > 0 && artists.length > 0 && (
            <>
              <div className="border-t border-white/8" />
              <section className="profile-rise space-y-4" style={rise(slot++)}>
                {decades.length > 1 && (
                  <div>
                    <SectionHead label="On the wall, by decade" />
                    <DecadeBar rows={decades} currentYear={currentYear} onSelectPanel={onSelectPanel} />
                  </div>
                )}
                <div>
                  <SectionHead label="Artists" count={artists.length} />
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {shownArtists.map((a) => {
                      const canOpen = !!onOpenPerson && (isPersonInteractive?.(a.name, a.artistId) ?? true);
                      return (
                        <li key={a.name} className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            disabled={!canOpen}
                            onClick={() => onOpenPerson?.(a.name, a.artistId)}
                            aria-label={`About ${a.name}`}
                            className="relative shrink-0 size-8 overflow-hidden rounded-full bg-white/8 ring-1 ring-inset ring-white/10 enabled:hover:ring-white/40 transition-shadow"
                          >
                            {a.portrait ? (
                              <img src={a.portrait} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <span className="absolute inset-0 flex items-center justify-center font-display text-sm text-white/30 select-none">
                                {a.name.charAt(0)}
                              </span>
                            )}
                          </button>
                          <div className="min-w-0 flex-1 leading-tight">
                            {canOpen ? (
                              <button
                                type="button"
                                onClick={() => onOpenPerson?.(a.name, a.artistId)}
                                className="block max-w-full truncate text-left text-xs text-white/75 hover:text-accent transition-colors"
                              >
                                {a.name}
                              </button>
                            ) : (
                              <span className="block truncate text-xs text-white/75">{a.name}</span>
                            )}
                            {a.elsewhere.length > 0 && (
                              <p className="truncate text-[10px] text-white/30">
                                also{" "}
                                {a.elsewhere.map((pub, i) => (
                                  <Fragment key={pub}>
                                    {i > 0 && ", "}
                                    <button
                                      type="button"
                                      onClick={() => onOpenPublisher(pub)}
                                      className="hover:text-accent transition-colors"
                                    >
                                      {pub}
                                    </button>
                                  </Fragment>
                                ))}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onSelectPanel(a.panels[0], a.panels)}
                            title={`${a.name}'s panels from ${name}`}
                            className="shrink-0 tabular-nums text-[10px] text-white/30 hover:text-accent transition-colors px-1"
                          >
                            {a.panels.length}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {artists.length > ARTISTS_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllArtists((v) => !v)}
                      className="mt-2 text-[10px] text-accent hover:text-accent-dim transition-colors"
                    >
                      {showAllArtists ? "Show fewer" : `Show all ${artists.length}`}
                    </button>
                  )}
                </div>
              </section>
            </>
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
                  <div ref={attachDragScroll} className="flex gap-2 overflow-x-auto pb-1 info-related-scroll drag-scroll">
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

          {/* Who's above the label, top of the chain down to it, and what
              else each company on the way holds. */}
          {ownership && (
            <>
              <div className="border-t border-white/8" />
              <section className="profile-rise" style={rise(slot++)}>
                <SectionHead label="Ownership">
                  {ownership[0].owner?.status && (
                    <span className="text-white/55">· {ownership[0].owner.status}</span>
                  )}
                </SectionHead>
                <OwnershipTree
                  steps={ownership}
                  year={currentYear}
                  onOpenPublisher={onOpenPublisher}
                  onOpenPerson={onOpenPerson}
                  isPersonInteractive={isPersonInteractive}
                />
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
