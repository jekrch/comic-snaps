import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { OwnerMark } from "../utils/owners";
import { isBareMark } from "../utils/owners";
import { resolveAsset } from "./OwnerBadge";

/** What was tapped: the mark, who it stands for, and the element it grows out of. */
export interface ZoomTarget {
  mark: OwnerMark;
  label: string;
  /** The thumbnail on the page: the enlarged image grows out of it and
   *  shrinks back into it, and focus returns to it. */
  from: HTMLElement;
  /** The image's own width and height, read off the thumbnail. */
  natural: { width: number; height: number };
}

/** Wider than this, a logo is a wordmark that sits on a tile with a margin. */
const WIDE = 1.4;
const OPEN_MS = 340;
const CLOSE_MS = 240;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

let openCount = 0;
/**
 * Whether an enlarged mark is showing. The publisher page takes Escape in
 * the capture phase ahead of anything opened over it, so it asks this first
 * and lets the enlarged image close instead of the page.
 */
export const isMarkZoomOpen = () => openCount > 0;

/**
 * A Wikimedia thumbnail at a larger standard width, for the enlarged view.
 * Null when the URL isn't one, or is already large.
 */
function largerSrc(url: string): string | null {
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/.+\/)(\d+)px-([^/]+)$/);
  if (!m || Number(m[2]) >= 960) return null;
  return `${m[1]}960px-${m[3]}`;
}

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * A logo or portrait from the ownership tree, enlarged over a blurred page.
 * The image grows out of its thumbnail and shrinks back into it on close;
 * a tap anywhere, the close button, or Escape closes it. A Wikimedia image
 * is swapped for a sharper rendition once that has loaded, at the same
 * shape, so nothing moves when it does.
 */
export default function MarkZoom({ target, onClose }: { target: ZoomTarget; onClose: () => void }) {
  const { mark, label, from, natural } = target;
  const figureRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [src, setSrc] = useState(() => resolveAsset(mark.url));

  const aspect = natural.width / natural.height;
  const tiled = !mark.portrait && (isBareMark(mark.url) || aspect >= WIDE);

  // Fit the viewport, leaving room for the caption, without blowing a small
  // image up past twice its size.
  const pad = tiled ? (aspect >= WIDE ? 32 : 24) : 0;
  const maxW = Math.min(window.innerWidth - 48, 640) - pad * 2;
  const maxH = Math.min(window.innerHeight - 200, 640) - pad * 2;
  const width = Math.max(1, Math.min(maxW, maxH * aspect, Math.max(natural.width * 2, 320)));
  const height = width / aspect;

  useEffect(() => {
    openCount++;
    return () => {
      openCount--;
    };
  }, []);

  useEffect(() => {
    const larger = largerSrc(mark.url);
    if (!larger) return;
    const img = new Image();
    img.onload = () => setSrc(larger);
    img.src = larger;
    return () => {
      img.onload = null;
    };
  }, [mark.url]);

  /** The transform that lays the figure over the thumbnail. */
  const fromFrame = useCallback(() => {
    const fig = figureRef.current;
    if (!fig || !from.isConnected) return null;
    const a = from.getBoundingClientRect();
    const b = fig.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    const scale = Math.max(a.width / b.width, a.height / b.height);
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const radius = mark.portrait ? `${b.width}px` : `${3 / scale}px`;
    return { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: radius };
  }, [from, mark.portrait]);

  useLayoutEffect(() => {
    const fig = figureRef.current;
    if (!fig) return;
    const still = prefersReducedMotion();
    const start = still ? null : fromFrame();
    fig.animate(
      [
        { ...(start ?? { transform: "scale(0.96)" }), opacity: start ? 0.5 : 0 },
        { transform: "none", borderRadius: "12px", opacity: 1 },
      ],
      { duration: still ? 160 : OPEN_MS, easing: EASE }
    );
    scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    captionRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 260, delay: still ? 0 : 140, easing: EASE, fill: "backwards" }
    );
    closeRef.current?.focus({ preventScroll: true });
  }, [fromFrame]);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const still = prefersReducedMotion();
    const end = still ? null : fromFrame();
    figureRef.current?.animate(
      [
        { transform: "none", borderRadius: "12px", opacity: 1 },
        { ...(end ?? { transform: "scale(0.96)" }), opacity: 0 },
      ],
      { duration: CLOSE_MS, easing: EASE, fill: "forwards" }
    );
    scrimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: "ease-in", fill: "forwards" });
    captionRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
    setTimeout(() => {
      onClose();
      if (from.isConnected) from.focus({ preventScroll: true });
    }, CLOSE_MS);
  }, [closing, fromFrame, onClose, from]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [close]);

  // Taps stop here: React carries them through the portal to whatever the
  // tree sits in (a modal's card, the viewer), which mustn't see them.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const ground = mark.onDark ? "bg-neutral-900 ring-1 ring-inset ring-white/10" : "bg-white";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 px-6 cursor-zoom-out select-none"
      style={{ overscrollBehavior: "none", touchAction: "none" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={stop}
      onPointerUp={stop}
      onTouchStart={stop}
      onTouchEnd={stop}
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div
        ref={scrimRef}
        aria-hidden
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        style={{ WebkitBackdropFilter: "blur(12px)" }}
      />

      <div
        ref={figureRef}
        className={`relative overflow-hidden rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10 ${tiled ? ground : "bg-white/5"}`}
        style={{ padding: pad, willChange: "transform" }}
      >
        <img
          src={src}
          alt={label}
          draggable={false}
          className="block object-contain"
          style={{ width, height }}
        />
      </div>

      <div ref={captionRef} className="relative flex flex-col items-center gap-1.5 text-center">
        <span className="font-display text-[13px] tracking-tight text-ink">{label}</span>
        {mark.source && (
          <a
            href={mark.source}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className="font-display text-[10px] uppercase tracking-[0.12em] text-ink-muted hover:text-accent transition-colors cursor-pointer"
          >
            Source ↗
          </a>
        )}
      </div>

      <button
        ref={closeRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className="absolute top-4 right-4 grid place-items-center size-9 rounded-full bg-white/8 hover:bg-white/15 ring-1 ring-white/10 transition-colors cursor-pointer focus:outline-none focus-visible:ring-white/40"
        style={{ top: "max(1rem, env(safe-area-inset-top))" }}
        aria-label="Close"
        title="Close"
      >
        <X size={16} strokeWidth={1.5} className="stroke-ink" />
      </button>
    </div>,
    document.body
  );
}
