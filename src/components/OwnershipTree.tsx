import { Fragment, createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { FormerOwner, MinorityStake } from "../types";
import type { OwnerMark, OwnershipStep } from "../utils/owners";
import { describeLink, isBareMark, stepMarks } from "../utils/owners";
import { yearSpan } from "../utils/publishers";
import { useArtistIndex } from "../hooks/useMetadata";
import { resolveAsset } from "./OwnerBadge";
import MarkZoom from "./MarkZoom";
import type { ZoomTarget } from "./MarkZoom";

/** How far each rung steps in from the one above. */
const INDENT = 14;
/** Middle of a rung's first line, where its dot sits: text-xs on a 16px line. */
const DOT_Y = 8;
/** A wordmark's tile is h-7: a rung with a mark centres its dot, and its
 *  name's first line, on that height; a taller card hangs down from the top. */
const SLOT_H = 28;
/** The most faces a rung of people shows; their names are all in the text. */
const MAX_FACES = 6;

const houseLink =
  "text-white/80 hover:text-accent underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-accent transition-colors";

/** Items run together on one wrapping line, with a quiet separator. */
function Run({ label, children }: { label: string; children: ReactNode[] }) {
  return (
    <p className="mt-0.5 text-[11px] leading-relaxed">
      <span className="text-white/30">{label} </span>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-white/20"> · </span>}
          {child}
        </Fragment>
      ))}
    </p>
  );
}

function Former({ owner }: { owner: FormerOwner }) {
  const span = yearSpan(owner.from, owner.until);
  return (
    <span>
      <span className="text-white/55">{owner.name}</span>
      {owner.what && <span className="text-white/35"> ({owner.what})</span>}
      {span && <span className="text-white/40 tabular-nums"> {span}</span>}
      {owner.price && <span className="text-white/40">, {owner.price}</span>}
    </span>
  );
}

/** "Savvy Games Group (owned by …) about 7.5% of the shares, since 2022, $1 billion" */
function Stake({ stake }: { stake: MinorityStake }) {
  const span = yearSpan(stake.since, null);
  const tail = [stake.share, span, stake.price].filter(Boolean).join(", ");
  return (
    <span>
      <span className="text-white/60">{stake.name}</span>
      {stake.what && <span className="text-white/35"> ({stake.what})</span>}
      {tail && <span className="text-white/40 tabular-nums"> {tail}</span>}
    </span>
  );
}

/** Opens a mark enlarged; absent, the marks are plain images. */
const ZoomContext = createContext<((target: ZoomTarget) => void) | null>(null);

/**
 * A mark that enlarges when tapped: a button around the thumbnail, which the
 * enlarged image grows out of. Before the image has loaded there is nothing
 * to enlarge, so a tap does nothing.
 */
function Zoomable({
  mark,
  label,
  className,
  children,
}: {
  mark: OwnerMark;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const zoom = useContext(ZoomContext);
  if (!zoom) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      aria-label={`Enlarge ${label}`}
      className={`${className} cursor-zoom-in transition-[filter,box-shadow] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      onClick={(e) => {
        const img = e.currentTarget.querySelector("img");
        if (!img?.naturalWidth) return;
        zoom({ mark, label, from: e.currentTarget, natural: { width: img.naturalWidth, height: img.naturalHeight } });
      }}
    >
      {children}
    </button>
  );
}

/** A person's photo, cropped to a disc. Gone if it fails to load. */
function Face({ mark, label, size = "size-7" }: { mark: OwnerMark; label: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Zoomable
      mark={mark}
      label={label}
      className={`block ${size} shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15 hover:ring-white/45`}
    >
      <img
        src={resolveAsset(mark.url)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block size-full object-cover object-[50%_22%]"
        onError={() => setFailed(true)}
      />
    </Zoomable>
  );
}

/** Narrower than this, a mark is shown whole as a card of its own shape
 *  rather than shrunk into the wide tile. */
const CARD_MAX_ASPECT = 1.4;
/** Up to this, a mark counts as upright: taller than wide, or square, which
 *  a picture logo like Drawn & Quarterly's usually is. Either is too detailed
 *  to read as a stamp beside the name. */
const UPRIGHT_MAX_ASPECT = 1.15;
/** An upright card's height, and a square one's width; a bare mark's sit
 *  inside a margin. */
const UPRIGHT = 80;
const UPRIGHT_BARE = 68;
const SQUARE = 72;
const SQUARE_BARE = 60;

const isUpright = (mark: OwnerMark, aspect: number | null) =>
  !mark.portrait && aspect !== null && aspect < UPRIGHT_MAX_ASPECT;

/**
 * The one mark at the head of a rung, in a slot the same width on every rung
 * so the text lines up down the ladder whatever the mark's shape.
 *
 * A wide wordmark sits centred on a tile the height of the name's line.
 * Anything squarer would shrink to a stamp in that tile, so it is shown
 * whole instead, as a card of its own shape. One a little wider than square
 * stays small and overhangs the line. An upright or square one — most
 * houses' images are 2:3 cards with their own ground, the logo in the
 * middle, and some are square pictures — is made big enough to read, like a
 * cover thumbnail, and the rung's details run down beside it (see
 * `MarkedRung`). Either way the ground and the image are dimmed
 * together, so a mark that brings its own white melts into its tile and
 * nothing glares on the dark page. The shape is only known once the image
 * loads; until then the slot stays empty rather than flash the wrong ground.
 */
function Slot({
  mark,
  label,
  aspect,
  onMeasure,
}: {
  mark: OwnerMark;
  /** Who the mark stands for, for the enlarged view. */
  label: string;
  aspect: number | null;
  onMeasure: (aspect: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const line = "shrink-0 w-20 h-7 flex items-center justify-center";
  if (mark.portrait) {
    return (
      <span className={line}>
        <Face mark={mark} label={label} />
      </span>
    );
  }
  if (failed) return <span aria-hidden className="shrink-0 w-20 h-7 rounded-[3px] bg-white/4" />;

  const measure = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) onMeasure(img.naturalWidth / img.naturalHeight);
  };
  const upright = isUpright(mark, aspect);
  const card = aspect !== null && aspect < CARD_MAX_ASPECT;
  // Hovered, a mark comes up to full brightness, as if lifted to be looked at.
  const ground = mark.onDark
    ? "bg-black/60 ring-1 ring-inset ring-white/10 hover:ring-white/30"
    : "bg-white brightness-[.86] hover:brightness-100";
  const bare = isBareMark(mark.url);

  let frame: string;
  let img: string;
  let size: { height: number } | { width: number } | undefined;
  if (upright) {
    frame = `block overflow-hidden rounded-[3px] ring-1 ring-white/10 hover:ring-white/30 ${ground} ${bare ? "p-1.5" : ""}`;
    img = "block object-contain";
    size = aspect! < 1 ? { height: bare ? UPRIGHT_BARE : UPRIGHT } : { width: bare ? SQUARE_BARE : SQUARE };
  } else if (card) {
    // Taller than the line; centred, it overhangs it evenly.
    frame = `block h-9 overflow-hidden rounded-[3px] ring-1 ring-white/10 hover:ring-white/30 ${ground} ${bare ? "p-1" : ""}`;
    img = "block h-full w-auto max-w-13 object-cover";
  } else {
    frame = `flex w-full h-full items-center justify-center rounded-[3px] ${aspect !== null ? `px-2 py-1.25 ${ground}` : ""}`;
    img = `block max-h-full max-w-full object-contain ${aspect === null ? "opacity-0" : ""}`;
  }

  return (
    <span className={upright ? "shrink-0 w-20 flex justify-center" : line}>
      <Zoomable mark={mark} label={label} className={frame}>
        <img
          ref={measure}
          src={resolveAsset(mark.url)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={size}
          className={img}
          onLoad={(e) => measure(e.currentTarget)}
          onError={() => setFailed(true)}
        />
      </Zoomable>
    </span>
  );
}

/**
 * A rung with a mark: the mark beside the name, the details underneath. An
 * upright mark is too tall for that, so it takes a column of its own and the
 * details run down beside it instead. The slot stays put in both, so the
 * image isn't remounted when its shape turns out to be upright.
 */
function MarkedRung({
  mark,
  label,
  head,
  body,
}: {
  mark: OwnerMark;
  label: string;
  head: ReactNode;
  body: ReactNode;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  const upright = isUpright(mark, aspect);
  return (
    <>
      <div className={`flex items-start ${upright ? "gap-3" : "gap-2.5 mb-1"}`}>
        <Slot mark={mark} label={label} aspect={aspect} onMeasure={setAspect} />
        <div className="min-w-0 flex-1">
          {/* Padded so the name's first line is centred on the line's tile
              (and on the dot), and a long name wraps down from there. */}
          <p className="text-xs leading-4" style={{ paddingTop: SLOT_H / 2 - DOT_Y }}>
            {head}
          </p>
          {upright && body}
        </div>
      </div>
      {!upright && body}
    </>
  );
}

/**
 * Who owns a house, as a ladder from the top of the chain down to the house
 * itself, each rung stepped in under the one above. Every company on the way
 * shows what else it holds, the houses on the wall among them, so the page
 * can be read for the kind of family the label sits in.
 */
export default function OwnershipTree({
  steps,
  year,
  onOpenPublisher,
  onOpenPerson,
  isPersonInteractive,
}: {
  steps: OwnershipStep[];
  /** Picks each house's logo for the year, when the tree is about one book. */
  year?: number | null;
  onOpenPublisher: (name: string) => void;
  onOpenPerson?: (name: string, artistId: string | null) => void;
  isPersonInteractive?: (name: string, artistId: string | null) => boolean;
}) {
  const artists = useArtistIndex();
  const portraitOf = (id: string) => artists.byId.get(id)?.imageUrl;
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);

  // "A, B and C", each a link to their page when there is one.
  const peopleList = (people: { name: string; artistId?: string | null }[]) =>
    people.map((p, i) => {
      const id = p.artistId ?? null;
      const sep = i === 0 ? "" : i === people.length - 1 ? " and " : ", ";
      return (
        <Fragment key={`${p.name}-${i}`}>
          {sep}
          {onOpenPerson && isPersonInteractive?.(p.name, id) ? (
            <button type="button" onClick={() => onOpenPerson(p.name, id)} className={houseLink}>
              {p.name}
            </button>
          ) : (
            p.name
          )}
        </Fragment>
      );
    });

  return (
    <ZoomContext.Provider value={setZoom}>
      <ol aria-label="Ownership">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          const { owner, publisher } = step;
          const name = owner?.name ?? publisher?.name ?? "";
          const meta = describeLink(step.link);
          const holdings = owner?.holdings ?? [];
          const earlier = step.link?.earlier ?? [];
          const stakes = owner?.stakes ?? [];
          const marks = stepMarks(step, portraitOf, year);
          // One mark takes the slot by the name; several people's faces run
          // in a row under it, where there is room for them.
          const slot = marks.length === 1 ? marks[0] : null;
          const faces = marks.length > 1 ? marks.slice(0, MAX_FACES) : [];
          const dotY = slot ? SLOT_H / 2 : DOT_Y;

          let nameEl: ReactNode;
          if (last) {
            nameEl = <span className="text-white/90">{name}</span>;
          } else if (publisher) {
            nameEl = (
              <button type="button" onClick={() => onOpenPublisher(publisher.name)} className={houseLink}>
                {name}
              </button>
            );
          } else if (owner?.people?.length) {
            nameEl = <span className="text-white/80">{peopleList(owner.people)}</span>;
          } else if (owner?.url) {
            nameEl = (
              <a href={owner.url} target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-accent transition-colors">
                {name}
              </a>
            );
          } else {
            nameEl = <span className="text-white/80">{name}</span>;
          }

          const kindEl = owner?.kind && <span className="text-white/35"> · {owner.kind}</span>;
          // How it is held, what it is, and what else it holds and held.
          const body = (
            <>
              {meta && <p className="mt-0.5 text-[10px] text-white/40 tabular-nums">{meta}</p>}
              {owner?.note && <p className="mt-0.5 text-[11px] text-white/45 leading-relaxed">{owner.note}</p>}
              {(step.siblings.length > 0 || holdings.length > 0) && (
                <Run label="also">
                  {[
                    ...step.siblings.map((p) => (
                      <button key={p.id} type="button" onClick={() => onOpenPublisher(p.name)} className={houseLink}>
                        {p.name}
                      </button>
                    )),
                    ...holdings.map((h) => (
                      <span key={h.name}>
                        <span className="text-white/60">{h.name}</span>
                        {h.what && <span className="text-white/35"> ({h.what})</span>}
                      </span>
                    )),
                  ]}
                </Run>
              )}
              {stakes.length > 0 && (
                <Run label="stakes">
                  {stakes.map((s, j) => (
                    <Stake key={`${s.name}-${j}`} stake={s} />
                  ))}
                </Run>
              )}
              {earlier.length > 0 && (
                <Run label="before">
                  {earlier.map((o, j) => (
                    <Former key={`${o.name}-${j}`} owner={o} />
                  ))}
                </Run>
              )}
            </>
          );

          return (
            <li
              key={step.key}
              className="relative pl-4"
              style={{ marginLeft: i * INDENT, paddingBottom: last ? 0 : 12 }}
            >
              {/* The stem down to the next rung, and the elbow in from the one
                  above; the two meet at the boundary between rungs. */}
              {!last && (
                <span aria-hidden className="absolute w-px bg-white/12" style={{ left: 3.5, top: dotY + 5, bottom: 0 }} />
              )}
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute border-l border-b border-white/12 rounded-bl-[5px]"
                  style={{ left: 3.5 - INDENT, top: 0, width: INDENT - 3, height: dotY }}
                />
              )}
              <span
                aria-hidden
                className={`absolute size-1.75 rounded-full ${last ? "bg-accent" : "bg-white/30"}`}
                style={{ left: 0.5, top: dotY - 3.5 }}
              />

              {slot ? (
                <MarkedRung
                  mark={slot}
                  label={name}
                  head={
                    <>
                      {nameEl}
                      {kindEl}
                    </>
                  }
                  body={body}
                />
              ) : (
                <>
                  <p className="text-xs leading-4">
                    {nameEl}
                    {kindEl}
                  </p>
                  {faces.length > 0 && (
                    <div className="mt-1.5 mb-0.5 flex flex-wrap gap-1">
                      {faces.map((m) => (
                        <Face key={m.url} mark={m} label={m.name ?? name} />
                      ))}
                    </div>
                  )}
                  {body}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {zoom && <MarkZoom target={zoom} onClose={() => setZoom(null)} />}
    </ZoomContext.Provider>
  );
}
