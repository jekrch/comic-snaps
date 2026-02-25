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
    setVisible(false);
    setTimeout(onClose, 250);
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
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${active ? "bg-black/80 backdrop-blur-sm" : "bg-black/0 backdrop-blur-none"}
      `}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="About Comic Snaps"
    >
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
  );
}