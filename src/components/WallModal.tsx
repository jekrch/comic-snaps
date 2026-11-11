import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const EXIT_MS = 240;

interface Props {
  /** Small caps over the title. */
  eyebrow?: string;
  title: ReactNode;
  /** Sits left of the title: a logo tile, say. */
  lead?: ReactNode;
  label: string;
  onClose: () => void;
  /** Lets the body close the modal with its exit animation and then act,
   *  e.g. hand off to the viewer once the scroll lock is released. */
  children: ReactNode | ((close: (then?: () => void) => void) => ReactNode);
  /** Pinned under the scrolling body, always in view. Same forms as `children`. */
  footer?: ReactNode | ((close: (then?: () => void) => void) => ReactNode);
}

/**
 * A small dialog over the wall, in the same idiom as the info modal and the
 * metric explainer: scrim, raised card, scale-in.
 *
 * Portaled to the body because the wall's cards sit inside the view swap's
 * transformed wrappers, where `position: fixed` would pin to the wrapper
 * rather than the viewport. Pointer events are stopped at the root as well,
 * since React bubbles them through a portal to the card that opened it.
 */
export default function WallModal({ eyebrow, title, lead, label, onClose, children, footer }: Props) {
  const [closing, setClosing] = useState(false);

  // Lock scroll before the first paint (see InfoModal for why on iOS).
  useLayoutEffect(() => {
    const scrollY = window.scrollY;
    const s = document.body.style;
    s.position = "fixed";
    s.top = `-${scrollY}px`;
    s.left = "0";
    s.right = "0";
    s.overflow = "hidden";
    return () => {
      s.position = "";
      s.top = "";
      s.left = "";
      s.right = "";
      s.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  const close = useCallback(
    (then?: () => void) => {
      if (closing) return;
      setClosing(true);
      setTimeout(() => {
        onClose();
        // After the unmount has released the scroll lock, so whatever opens
        // next takes its own lock from the real scroll position.
        if (then) setTimeout(then, 0);
      }, EXIT_MS);
    },
    [closing, onClose]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return createPortal(
    <div
      className="fixed z-[60] flex items-center justify-center"
      style={{ top: "-100px", left: 0, right: 0, bottom: "-100px", overscrollBehavior: "none", touchAction: "none" }}
      onPointerUp={stop}
      onPointerDown={stop}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onTouchMove={(e) => e.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.82)",
          animation: closing ? `scrimOut ${EXIT_MS}ms ease-out forwards` : "scrimIn 220ms ease-out forwards",
        }}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-[460px] mx-4 rounded-md flex flex-col
                   border border-[var(--color-border,rgba(74,71,69,0.25))]
                   bg-[var(--color-surface-raised,#1a1816)]"
        style={{
          maxHeight: "min(82vh, 680px)",
          animation: closing ? `modalExit ${EXIT_MS}ms ease-out forwards` : "modalEnter 230ms ease-out forwards",
        }}
        onClick={stop}
        onTouchEnd={stop}
        onTouchStart={stop}
        onTouchMove={stop}
      >
        <div className="shrink-0 flex items-center gap-3 px-5 pt-5 pb-3 border-b border-[var(--color-border,rgba(74,71,69,0.25))]">
          {lead}
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="m-0 mb-1 font-display text-[10px] uppercase tracking-[0.1em] text-accent/70">{eyebrow}</p>
            )}
            <h2 className="m-0 font-display text-[15px] tracking-tight text-ink leading-snug">{title}</h2>
          </div>
          <button
            type="button"
            onClick={() => close()}
            className="self-start shrink-0 -mr-1 p-1 bg-transparent border-none cursor-pointer"
            title="Close"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} className="stroke-ink-muted hover:stroke-ink" />
          </button>
        </div>

        <div className="info-modal-scroll min-h-0 overflow-y-auto px-5 py-4" style={{ overscrollBehavior: "contain" }}>
          {typeof children === "function" ? children(close) : children}
        </div>

        {footer && (
          <div className="shrink-0 px-5 py-3 border-t border-[var(--color-border,rgba(74,71,69,0.25))]">
            {typeof footer === "function" ? footer(close) : footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
