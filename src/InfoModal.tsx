import { useCallback, useEffect, useState } from "react";
import { X, Github } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function InfoModal({ onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    // letters fade immediately; give the rest of the modal time to finish
    setTimeout(() => setVisible(false), 80);
    setTimeout(onClose, 300);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const active = visible && !closing;

  return (
    <>
      {/* Sway keyframes */}
      <style>{`
        @keyframes letterSway {
          0%, 100% { transform: rotate(-7deg) translate(-8%, 4%); }
          50%      { transform: rotate(-5.5deg) translate(-7%, 3.5%); }
        }
      `}</style>

      <div
        className={`
          fixed inset-0 z-50 flex items-center justify-center overflow-hidden
          transition-all duration-250 ease-out
          ${active ? "bg-black/80 backdrop-blur-sm" : "bg-black/0 backdrop-blur-none"}
        `}
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
        aria-label="About Comic Snaps"
      >
        {/* Background typographic element */}
        <div
          className="absolute select-none pointer-events-none top-0"
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-display), monospace",
            fontSize: "clamp(80px, 75vw, 620px)",
            fontWeight: 300,
            lineHeight: 0.85,
            color: "var(--color-accent)",
            letterSpacing: "-0.06em",
            whiteSpace: "nowrap",
            opacity: active ? 0.37 : 0,
            animation: active ? "letterSway 6s ease-in-out infinite" : "none",
            transform: "rotate(-7deg) translate(-8%, 4%)",
            // fade out fast on close, fade in at normal speed
            transition: closing
              ? "opacity 100ms ease-out"
              : "opacity 250ms ease-out",
          }}
        >
          <span>C</span>
          <span style={{ marginLeft: "-0.12em", position: "relative", top: "0.38em" }}>S</span>
        </div>

        <div
          className={`
            relative w-full max-w-[280px] mx-6 px-10 pt-[58px] pb-[66px]
            text-center rounded-md
            border border-[var(--color-border,rgba(74,71,69,0.25))]
            bg-[var(--color-surface-raised)]
            transition-all duration-250 ease-out
            ${active ? "opacity-100 scale-100" : "opacity-0 scale-95"}
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 bg-transparent border-none cursor-pointer
                       text-[var(--color-ink-muted)] hover:text-[var(--color-ink-faint)]
                       transition-colors duration-150"
            title="Close"
          >
            <X size={13} strokeWidth={1.5} />
          </button>

          {/* Title */}
          <h2
            className="tracking-tight text-[15px] text-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            COMIC SNAPS
          </h2>

          {/* Accent rule */}
          <div className="w-6 h-0.5 bg-[var(--color-accent)] mx-auto mt-5 rounded-sm opacity-70" />

          {/* Links */}
          <div className="mt-8 flex flex-col items-center gap-4">
            <a
              href="https://github.com/jekrch/comic-snaps"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-[7px] text-xs
                         text-[var(--color-ink)] hover:text-[var(--color-ink-muted)]
                         no-underline transition-colors duration-150"
            >
              <Github size={15} />
              jekrch/comic-snaps
            </a>

            <a
              href="https://www.jacobkrch.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--color-ink)] hover:text-[var(--color-ink-faint)]
                         no-underline transition-colors duration-150"
            >
              jacobkrch.com
            </a>
          </div>
        </div>
      </div>
    </>
  );
}