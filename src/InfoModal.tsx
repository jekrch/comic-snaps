import { useCallback, useEffect, useState } from "react";

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

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/80 backdrop-blur-sm" : "bg-black/0 backdrop-blur-0"}
      `}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="About Comic Snaps"
    >
      <div
        className={`
          relative transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 scale-100" : "opacity-0 scale-95"}
        `}
        style={{
          background: "var(--color-surface-raised)",
          border: "1px solid rgba(74, 71, 69, 0.25)",
          borderRadius: "6px",
          width: "100%",
          maxWidth: "280px",
          margin: "0 24px",
          padding: "58px 40px 66px",
          textAlign: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            top: "14px",
            right: "14px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-ink-faint)",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-ink-muted)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-ink-faint)")}
          title="Close"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>

        {/* Title */}
        <h2
          className="tracking-tight"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "15px",
            color: "var(--color-ink)",
          }}
        >
          COMIC SNAPS
        </h2>

        {/* Accent rule */}
        <div
          style={{
            width: "24px",
            height: "2px",
            background: "var(--color-accent)",
            margin: "20px auto 0",
            borderRadius: "1px",
            opacity: 0.7,
          }}
        />

        {/* Links */}
        <div
          style={{
            marginTop: "32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <a
            href="https://github.com/jekrch/comic-snaps"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              fontSize: "14px",
              color: "var(--color-ink)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-ink)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-ink-muted)")}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            jekrch/comic-snaps
          </a>

          <a
            href="https://www.jacobkrch.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "12px",
              color: "var(--color-ink)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-ink-muted)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-ink-faint)")}
          >
            jacobkrch.com
          </a>
        </div>
      </div>
    </div>
  );
}