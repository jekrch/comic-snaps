import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Shuffle, X } from "lucide-react";
import type { ViewerItem } from "@jekrch/react-viewport-lightbox";
import type { Panel } from "../../types";
import { panelImageUrl } from "../../utils/imageUrl";
import { panelMatchesQuery } from "../../utils/filtering";
import { formatIssue } from "../../utils/issueFormat";
import { fmt, truncate } from "../explainer/explainerConstants";
import { useZoomViewer, ZoomHeader } from "../explainer/explainerPrimitives";
import type { MetricKey } from "../graph/similarityConfig";
import { GUIDE_OVERLAY_Z, STOP_EVENTS, isTopOverlay, useOverlay } from "./overlayStack";
import type { SpecimenStatus } from "./specimen";

/** How a distance reads for each metric, as the lessons write it. */
export function formatDistance(metric: MetricKey | undefined, d: number): string {
  if (metric === "phash") return `${Math.round(d)} bits`;
  if (metric === "color") return d.toFixed(1);
  return fmt(d);
}

interface Slot {
  key: "anchor" | "closest" | "furthest";
  letter: string;
  role: string;
  panel: Panel;
  note: string;
  color: string;
}

function panelLabel(p: Panel): string {
  return p.issue !== undefined && p.issue !== null && p.issue !== "" ? `${p.title} ${formatIssue(p.issue)}` : p.title;
}

/**
 * The worked example every lesson talks about: the anchor panel, and its
 * closest and furthest neighbours by the lesson's method. Sticky in the
 * margin on wide screens, a slim strip under the header on phones. Shuffle
 * draws a new anchor; Pick opens a searchable grid.
 */
export function SpecimenBar({
  anchor,
  status,
  metric,
  methodName,
  compact,
  hidden = false,
  onShuffle,
  onPick,
}: {
  anchor: Panel | null;
  status: SpecimenStatus;
  metric: MetricKey | undefined;
  methodName: string | null;
  compact: boolean;
  hidden?: boolean;
  onShuffle: () => void;
  onPick: () => void;
}) {
  const slots = useMemo<Slot[]>(() => {
    if (!anchor) return [];
    const out: Slot[] = [
      { key: "anchor", letter: "A", role: "Anchor", panel: anchor, note: "anchor", color: "var(--color-ink, #e8e0d8)" },
    ];
    if (status.kind === "ready") {
      const { closest, furthest } = status.specimen;
      out.push(
        { key: "closest", letter: "C", role: "Closest", panel: closest.panel, note: formatDistance(metric, closest.distance), color: "var(--color-accent, #e97d62)" },
        { key: "furthest", letter: "F", role: "Furthest", panel: furthest.panel, note: formatDistance(metric, furthest.distance), color: "rgba(255,255,255,0.5)" }
      );
    }
    return out;
  }, [anchor, status, metric]);

  const items = useMemo<ViewerItem<{ title: string; detail: string }>[]>(
    () =>
      slots.map((s) => ({
        id: s.key,
        src: panelImageUrl(s.panel.image),
        alt: panelLabel(s.panel),
        data: {
          title: panelLabel(s.panel),
          detail: s.key === "anchor" ? "The anchor panel" : `${s.role} by ${methodName ?? "this method"} · ${s.note}`,
        },
      })),
    [slots, methodName]
  );
  const { lightbox, portal } = useZoomViewer(items, "The worked example", (item) => (
    <ZoomHeader title={item.data.title} detail={item.data.detail} />
  ));

  const controls = (
    <div className="guide-specimen-controls">
      <button type="button" className="guide-chip" onClick={onShuffle} title="A different anchor panel">
        <Shuffle size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>Shuffle</span>
      </button>
      <button type="button" className="guide-chip" onClick={onPick} title="Choose the anchor panel">
        <Search size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>Pick</span>
      </button>
    </div>
  );

  if (compact) {
    return (
      <div className={`guide-specimen is-compact${hidden ? " is-tucked" : ""}`} aria-label="Worked example">
        <div className="flex items-center gap-1.5 shrink-0">
          {slots.map((s, i) => (
            <button
              key={s.key}
              type="button"
              {...lightbox.triggerProps(i)}
              className="guide-specimen-thumb is-small"
              style={{ outlineColor: s.color }}
              aria-label={`${s.role}: ${panelLabel(s.panel)}`}
            >
              <img src={panelImageUrl(s.panel.image)} alt="" draggable={false} decoding="async" />
            </button>
          ))}
          {status.kind === "loading" && <span className="guide-caption">…</span>}
        </div>
        <p className="guide-specimen-anchor min-w-0">
          <span className="guide-label">anchor</span> <span className="truncate">{anchor ? panelLabel(anchor) : "…"}</span>
        </p>
        {controls}
        {portal}
      </div>
    );
  }

  return (
    <div className="guide-specimen" aria-label="Worked example">
      <p className="guide-label mb-2">Worked example{methodName ? ` · ${methodName}` : ""}</p>
      <div className="flex items-start gap-2.5">
        {slots.map((s, i) => (
          <figure key={s.key} className="m-0 min-w-0 flex-1 flex flex-col items-center">
            <button
              type="button"
              {...lightbox.triggerProps(i)}
              className="guide-specimen-thumb"
              style={{ outlineColor: s.color }}
              aria-label={`${s.role}: ${panelLabel(s.panel)}`}
              title={panelLabel(s.panel)}
            >
              <img src={panelImageUrl(s.panel.image)} alt="" draggable={false} decoding="async" />
            </button>
            <figcaption className="guide-caption mt-1 text-center w-full" style={{ color: s.color }}>
              <span className="block truncate">{s.role}</span>
              {s.key !== "anchor" && <span style={{ opacity: 0.75 }}>{s.note}</span>}
            </figcaption>
          </figure>
        ))}
        {status.kind === "loading" && <p className="guide-caption self-center">Loading neighbours…</p>}
      </div>
      <p className="guide-caption mt-2 truncate" title={anchor ? panelLabel(anchor) : undefined}>
        {anchor ? truncate(panelLabel(anchor), 40) : "…"}
      </p>
      {controls}
      {portal}
    </div>
  );
}

const PICK_LIMIT = 60;

/** A searchable grid of the pool, for choosing the anchor. */
export function AnchorPicker({
  pool,
  current,
  onPick,
  onClose,
}: {
  pool: Panel[];
  current: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useOverlay(true, "picker");

  const results = useMemo(() => {
    const q = query.trim();
    const hits = q ? pool.filter((p) => panelMatchesQuery(p, q)) : pool;
    return { list: hits.slice(0, PICK_LIMIT), total: hits.length };
  }, [pool, query]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(id)) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, onClose]);

  return createPortal(
    <div
      className="guide-picker"
      style={{ zIndex: GUIDE_OVERLAY_Z }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose the anchor panel"
      {...STOP_EVENTS}
    >
      <div className="guide-picker-scrim" onClick={onClose} aria-hidden="true" />
      <div className="guide-picker-card">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border,rgba(74,71,69,0.25))]">
          <Search size={14} strokeWidth={1.5} className="shrink-0 stroke-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, artist, year, tag…"
            className="guide-picker-input"
            aria-label="Search the panels"
          />
          <button type="button" onClick={onClose} className="guide-icon-btn" aria-label="Close" title="Close">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
        <div className="guide-picker-grid info-modal-scroll">
          {results.list.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`guide-picker-item${p.id === current ? " is-current" : ""}`}
              onClick={() => onPick(p.id)}
              title={panelLabel(p)}
            >
              <img src={panelImageUrl(p.image)} alt="" loading="lazy" decoding="async" draggable={false} />
              <span className="guide-caption truncate block">{panelLabel(p)}</span>
            </button>
          ))}
          {results.list.length === 0 && <p className="guide-caption p-4">Nothing matches that.</p>}
        </div>
        {results.total > results.list.length && (
          <p className="guide-caption px-4 py-2 border-t border-[var(--color-border,rgba(74,71,69,0.25))]">
            Showing {results.list.length} of {results.total}. Type to narrow it down.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
