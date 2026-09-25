import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import type { Artist, IssueCredits, Panel, Series } from "../types";
import { getCachedMetadata, loadMetadata } from "../utils/metadata";
import {
  ROLE_FAMILIES,
  buildNetwork,
  buildWorksIndex,
  worksWithAll,
  type Collaborator,
  type RoleFamily,
  type Work,
} from "../utils/collaborations";
import { formatIssue } from "../utils/issueFormat";
import { panelImageUrl } from "../utils/imageUrl";

// Role-family hues from the dataviz reference palette's dark steps, validated
// on the app surface (#0a0a0a) as a *cyclic* adjacent set in this order — the
// families sit in contiguous arcs around the graph, so only neighbours touch
// (worst CVD ΔE 17.3, normal-vision 20.9, all ≥ 3:1). Orange is left out: it
// is the accent, and the accent is the person the page is about.
const FAMILY_COLOR: Record<RoleFamily, string> = {
  story: "#3987e5",
  art: "#c98500",
  color: "#9085e9",
  letters: "#199e70",
};
const FAMILY_LABEL: Record<RoleFamily, string> = {
  story: "Story",
  art: "Art",
  color: "Color",
  letters: "Letters",
};
const ACCENT = "#e85d3a";
const SURFACE = "#0a0a0a";
const INK = "rgba(232,228,223,0.85)";
const INK_MUTED = "rgba(232,228,223,0.4)";

/** More than this and the labels stop fitting; the rest still appear in the
 *  work list, just not as nodes. */
const MAX_NODES = 24;
/** Vertical pitch between labels down each side. */
const ROW = 26;
const LABEL_PX = 10;
const WORKS_SHOWN = 6;

type Loaded = { artists: Artist[]; series: Series[]; issues: IssueCredits[] };

function useLoadedMetadata(): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const { artists, series, issues } = getCachedMetadata();
    return artists && series && issues ? { artists, series, issues } : null;
  });
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    loadMetadata()
      .then((data) => {
        if (!cancelled) setLoaded(data);
      })
      .catch(() => {
        // silently ignore — the section just won't appear
      });
    return () => { cancelled = true; };
  }, [loaded]);
  return loaded;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Clip a label to a pixel width with an ellipsis. The full name is always in
 *  the node's accessible label and in the work list below. */
function fitLabel(text: string, maxPx: number): string {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = `${LABEL_PX}px ${getComputedStyle(document.body).fontFamily}`;
  }
  const width = (s: string) => (measureCtx ? measureCtx.measureText(s).width : s.length * LABEL_PX * 0.55);
  if (width(text) <= maxPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(text.slice(0, mid).trimEnd() + "…") <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

interface Placed {
  c: Collaborator;
  x: number;
  y: number;
  r: number;
  side: 1 | -1;
}

/**
 * Collaborators down the two sides of an ellipse around the person: the first
 * half top to bottom on the right, the rest bottom to top on the left, so the
 * family-ordered list reads clockwise in unbroken arcs. Spacing is even in y
 * rather than in angle, so labels stack at a fixed pitch and never meet, and
 * the poles are left empty because a horizontal label there would collide
 * with its neighbours.
 */
function layout(collaborators: Collaborator[], width: number) {
  const n = collaborators.length;
  const right = Math.ceil(n / 2);
  const left = n - right;
  const labelRoom = Math.min(130, Math.max(84, width * 0.3));
  const halfSpan = (Math.max(right, 1) - 1) * (ROW / 2);
  const ry = Math.max(48, halfSpan / 0.9);
  const rx = Math.max(40, width / 2 - labelRoom - 14);
  const height = 2 * ry + 40;
  const cx = width / 2;
  const cy = height / 2;

  const place = (i: number, count: number, side: 1 | -1): { x: number; y: number } => {
    const span = (count - 1) * (ROW / 2);
    // Right side runs top → bottom, left side bottom → top.
    const t = count === 1 ? 0 : -span + (i * 2 * span) / (count - 1);
    const y = side === 1 ? t : -t;
    const x = side * rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
    return { x: cx + x, y: cy + y };
  };

  const placed: Placed[] = collaborators.map((c, i) => {
    const side: 1 | -1 = i < right ? 1 : -1;
    const pos = side === 1 ? place(i, right, 1) : place(i - right, left, -1);
    return { c, ...pos, r: Math.min(10, 3.5 + 2.2 * Math.sqrt(c.shared)), side };
  });
  return { placed, height, cx, cy, labelRoom };
}

interface Props {
  name: string;
  allPanels: Panel[];
  onSelectPanel: (panel: Panel, group?: Panel[]) => void;
  /** Put another person's page up in this one's place. */
  onOpenPerson?: (name: string) => void;
  style?: CSSProperties;
}

/**
 * Who this person made pages with, and what: an ego graph of everyone on the
 * same issues in a creative role, and the list of those issues underneath.
 *
 * Selecting people narrows the list to the issues they are *all* on with this
 * person — the intersection — and dims anyone who is on none of those, so the
 * graph answers "who else was in the room". A dotted chord between two
 * collaborators means they also made something together without this person,
 * which is the thread to pull on next.
 */
export default function CollaboratorGraph({ name, allPanels, onSelectPanel, onOpenPerson, style }: Props) {
  const meta = useLoadedMetadata();
  const index = useMemo(
    () => (meta ? buildWorksIndex(allPanels, meta.issues, meta.series, meta.artists) : null),
    [allPanels, meta]
  );
  const network = useMemo(() => (index ? buildNetwork(index, name) : null), [index, name]);

  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [network]);

  const nodes = useMemo(
    () =>
      network
        ? [...network.collaborators]
            .sort((a, b) => b.shared - a.shared)
            .slice(0, MAX_NODES)
            .sort((a, b) => network.collaborators.indexOf(a) - network.collaborators.indexOf(b))
        : [],
    [network]
  );
  const geo = useMemo(() => (width > 0 ? layout(nodes, width) : null), [nodes, width]);

  const works = useMemo(() => (network ? worksWithAll(network, selected) : []), [network, selected]);
  const reach = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of works) for (const k of w.people.keys()) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [works]);

  if (!network || network.collaborators.length === 0) return null;

  const byKey = new Map(network.collaborators.map((c) => [c.key, c]));
  const tiesOf = (key: string) =>
    network.ties
      .filter((t) => t.a === key || t.b === key)
      .map((t) => ({ other: byKey.get(t.a === key ? t.b : t.a)!, elsewhere: t.elsewhere }))
      .sort((a, b) => b.elsewhere - a.elsewhere);

  // Picking someone off the intersection starts a new one with just them,
  // rather than narrowing to nothing.
  const toggle = (key: string) => {
    setShowAll(false);
    setSelected((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : (reach.get(key) ?? 0) > 0 ? [...cur, key] : [key]
    );
  };
  const onNodeKey = (e: ReactKeyboardEvent, key: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(key);
    }
  };

  const active = hovered ?? selected[selected.length - 1] ?? null;
  const activeC = active ? byKey.get(active) : undefined;
  const families = ROLE_FAMILIES.filter((f) => network.collaborators.some((c) => c.family === f));
  const shownWorks = showAll ? works : works.slice(0, WORKS_SHOWN);
  const group = works.flatMap((w) => w.panels);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <>
      <div className="border-t border-white/8" />
      <section className="profile-rise" style={style}>
        <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
          <span>Worked with</span>
          <span className="text-white/20 normal-case tracking-normal">· {network.collaborators.length}</span>
        </div>

        {/* Legend — the family is also where a node sits, so the colour is
            never the only thing saying it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1 text-[10px] text-white/45">
          {families.map((f) => (
            <span key={f} className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full" style={{ background: FAMILY_COLOR[f] }} />
              {FAMILY_LABEL[f]}
            </span>
          ))}
          {network.ties.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <svg aria-hidden width="14" height="6">
                <line x1="0" y1="3" x2="14" y2="3" stroke={INK_MUTED} strokeWidth="1" strokeDasharray="2 2" />
              </svg>
              also together elsewhere
            </span>
          )}
        </div>

        <div ref={wrapRef} className="w-full">
          {geo && (
            <svg
              width={width}
              height={geo.height}
              role="group"
              aria-label={`${name}'s collaborators`}
              className="block select-none"
              // Cleared on leaving the graph, not each node, so crossing the gap
              // between two names doesn't flash the hint in between.
              onPointerLeave={() => setHovered(null)}
            >
              {/* Chords first, so spokes and nodes sit over them. */}
              {network.ties.map((t) => {
                const a = geo.placed.find((p) => p.c.key === t.a);
                const b = geo.placed.find((p) => p.c.key === t.b);
                if (!a || !b) return null;
                const lit = active === t.a || active === t.b;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const qx = geo.cx + (mx - geo.cx) * 0.3;
                const qy = geo.cy + (my - geo.cy) * 0.3;
                return (
                  <path
                    key={`${t.a}-${t.b}`}
                    d={`M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`}
                    fill="none"
                    stroke={lit ? INK : INK_MUTED}
                    strokeOpacity={lit ? 0.7 : 0.35}
                    strokeWidth={lit ? 1.25 : 1}
                    strokeDasharray="2 3"
                    style={{ transition: "stroke-opacity 0.15s" }}
                  />
                );
              })}

              {geo.placed.map(({ c, x, y }) => {
                const dim = (reach.get(c.key) ?? 0) === 0;
                const lit = active === c.key || selected.includes(c.key);
                return (
                  <line
                    key={c.key}
                    x1={geo.cx}
                    y1={geo.cy}
                    x2={x}
                    y2={y}
                    stroke={FAMILY_COLOR[c.family]}
                    strokeWidth={Math.min(3, 1 + 0.5 * (c.shared - 1))}
                    strokeOpacity={dim ? 0.08 : lit ? 0.85 : 0.35}
                    strokeLinecap="round"
                    style={{ transition: "stroke-opacity 0.15s" }}
                  />
                );
              })}

              <circle cx={geo.cx} cy={geo.cy} r={8} fill={ACCENT} stroke={SURFACE} strokeWidth={2}>
                <title>{name}</title>
              </circle>

              {geo.placed.map(({ c, x, y, r, side }) => {
                const count = reach.get(c.key) ?? 0;
                const dim = count === 0;
                const isSelected = selected.includes(c.key);
                const lit = active === c.key || isSelected;
                const label = fitLabel(c.name, geo.labelRoom - 26);
                return (
                  <g
                    key={c.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${c.name}, ${c.roles.join(", ").toLowerCase()}, ${plural(c.shared, "shared issue")}`}
                    onClick={() => toggle(c.key)}
                    onKeyDown={(e) => onNodeKey(e, c.key)}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(c.key)}
                    onFocus={() => setHovered(c.key)}
                    onBlur={() => setHovered(null)}
                    className="cursor-pointer outline-none"
                    opacity={dim ? 0.3 : 1}
                    style={{ transition: "opacity 0.15s" }}
                  >
                    {/* A hit target well past the mark and its label. */}
                    <rect
                      x={side === 1 ? x - r - 4 : x - geo.labelRoom}
                      y={y - ROW / 2}
                      width={geo.labelRoom + r + 4}
                      height={ROW}
                      fill="transparent"
                    />
                    {isSelected && (
                      <circle cx={x} cy={y} r={r + 3.5} fill="none" stroke={INK} strokeWidth={1.5} />
                    )}
                    {active === c.key && !isSelected && (
                      <circle cx={x} cy={y} r={r + 3.5} fill="none" stroke={INK_MUTED} strokeWidth={1} />
                    )}
                    <circle cx={x} cy={y} r={r} fill={FAMILY_COLOR[c.family]} stroke={SURFACE} strokeWidth={2} />
                    <text
                      x={x + side * (r + 7)}
                      y={y}
                      dy="0.35em"
                      textAnchor={side === 1 ? "start" : "end"}
                      fontSize={LABEL_PX}
                      fill={lit ? "rgba(255,255,255,0.95)" : "rgba(232,228,223,0.7)"}
                    >
                      {side === 1 ? (
                        <>
                          {label}
                          <tspan fill={INK_MUTED}> {count}</tspan>
                        </>
                      ) : (
                        <>
                          <tspan fill={INK_MUTED}>{count} </tspan>
                          {label}
                        </>
                      )}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Readout — what the hovered (or last picked) person did, and who
            they also work with. On touch this is the tooltip. A fixed three
            lines, clamped, so what changes on hover never moves the list below. */}
        <p className="h-[4.125em] line-clamp-3 mt-1 text-[11px] leading-snug text-white/45">
          {activeC ? (
            <>
              <span className="text-white/85">{activeC.name}</span>
              {" · "}
              {activeC.roles.join(", ")}
              {" · "}
              {plural(activeC.shared, "shared issue")}
              {(() => {
                const ties = tiesOf(activeC.key);
                if (ties.length === 0) return null;
                return (
                  <>
                    {" · also with "}
                    {ties.slice(0, 3).map((t, i) => (
                      <Fragment key={t.other.key}>
                        {i > 0 && ", "}
                        <span className="text-white/70">{t.other.name}</span>
                        {t.elsewhere > 1 && ` (${t.elsewhere})`}
                      </Fragment>
                    ))}
                    {ties.length > 3 && ` +${ties.length - 3}`}
                  </>
                );
              })()}
            </>
          ) : (
            "Pick names to see the issues they made with " + name + " — pick more to narrow to the ones they're all on."
          )}
        </p>

        {/* The intersection being looked at. */}
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {selected.map((k) => {
              const c = byKey.get(k);
              if (!c) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  className="inline-flex items-center gap-1 rounded-full pl-2 pr-1.5 py-0.5 text-[11px] text-white/80 bg-white/6 hover:bg-white/10 transition-colors"
                  aria-label={`Remove ${c.name}`}
                >
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: FAMILY_COLOR[c.family] }} />
                  {c.name}
                  <X size={11} className="text-white/40" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-[10px] text-white/35 hover:text-white/70 transition-colors px-1"
            >
              Clear
            </button>
            {selected.length === 1 && onOpenPerson && byKey.get(selected[0]) && (
              <button
                type="button"
                onClick={() => onOpenPerson(byKey.get(selected[0])!.name)}
                className="ml-auto text-[10px] text-accent hover:text-accent-dim transition-colors"
              >
                Open their page →
              </button>
            )}
          </div>
        )}

        {/* The shared issues themselves. */}
        <div className="flex items-center gap-1.5 mt-4 mb-2 text-[10px] uppercase tracking-widest text-white/30">
          <span>{selected.length > 0 ? "Together on" : "Shared issues"}</span>
          <span className="text-white/20 normal-case tracking-normal">· {works.length}</span>
        </div>
        <ul className="space-y-3">
          {shownWorks.map((w) => (
            <WorkRow
              key={w.key}
              work={w}
              selfKey={network.selfKey}
              selected={selected}
              onToggle={toggle}
              onOpen={(p) => onSelectPanel(p, group)}
            />
          ))}
        </ul>
        {works.length > WORKS_SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="mt-2 text-[10px] text-accent hover:text-accent-dim transition-colors"
          >
            {showAll ? "Show fewer" : `Show all ${works.length}`}
          </button>
        )}
      </section>
    </>
  );
}

function WorkRow({
  work,
  selfKey,
  selected,
  onToggle,
  onOpen,
}: {
  work: Work;
  selfKey: string;
  selected: string[];
  onToggle: (key: string) => void;
  onOpen: (panel: Panel) => void;
}) {
  const cover = work.panels[0];
  const people = [...work.people.values()];
  return (
    <li className="flex gap-3">
      <button
        type="button"
        onClick={() => onOpen(cover)}
        className="relative shrink-0 h-16 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
        style={{ aspectRatio: `${cover.width} / ${cover.height}`, maxWidth: "7rem" }}
        title={`${work.title} ${formatIssue(work.issue)}`}
      >
        <img src={panelImageUrl(cover.image)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        {work.panels.length > 1 && (
          <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/70 px-1 text-[9px] text-white/75">
            {work.panels.length}
          </span>
        )}
      </button>
      <div className="min-w-0 text-xs leading-relaxed">
        <p className="text-white/80">
          {work.title} {formatIssue(work.issue)}
          {work.year > 0 && <span className="text-white/35"> · {work.year}</span>}
        </p>
        <div className="space-y-0.5 mt-0.5">
          {ROLE_FAMILIES.map((f) => {
            const inFamily = people.filter((p) => p.families.includes(f));
            if (inFamily.length === 0) return null;
            return (
              <p key={f} className="flex gap-2 text-[11px]">
                <span className="w-12 shrink-0 inline-flex items-center gap-1 text-white/35">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: FAMILY_COLOR[f] }} />
                  {FAMILY_LABEL[f]}
                </span>
                <span className="text-white/60">
                  {inFamily.map((p, i) => (
                    <Fragment key={p.key}>
                      {i > 0 && ", "}
                      {p.key === selfKey ? (
                        <span className="text-white/35">{p.name}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggle(p.key)}
                          aria-pressed={selected.includes(p.key)}
                          className={`underline decoration-dotted underline-offset-2 transition-colors ${
                            selected.includes(p.key)
                              ? "text-white/95 decoration-accent"
                              : "text-white/65 decoration-white/20 hover:text-accent hover:decoration-accent"
                          }`}
                        >
                          {p.name}
                        </button>
                      )}
                    </Fragment>
                  ))}
                </span>
              </p>
            );
          })}
        </div>
      </div>
    </li>
  );
}
