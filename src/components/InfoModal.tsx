import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { X, Github } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function InfoModal({ onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const patternId = useId();
  const maskId = useId();
  const fadeId = useId();

  // randomise on mount, same as HatchFiller
  const { rotation, color } = useMemo(() => {
    const rotations = [45, 135];
    const colors = ["#e97d62", "#7A8B2A"];
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    return { rotation: pick(rotations), color: pick(colors) };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
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
      <style>{`
        @keyframes hatchDrift {
          0%, 100% { transform: rotate(-5deg) scale(1.15) translate(-4%, 3%); }
          50%       { transform: rotate(-3.5deg) scale(1.18) translate(-3%, 2%); }
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
        {/* ── Hatch-pattern backdrop ── */}
        <div
          className="absolute inset-0 pointer-events-none select-none"
          aria-hidden="true"
          style={{
            opacity: active ? 0.32 : 0,
            animation: active ? "hatchDrift 10s ease-in-out infinite" : "none",
            transform: "rotate(-5deg) scale(1.15) translate(-4%, 3%)",
            transition: "opacity 280ms ease-out",
          }}
        >
          <svg
            width="100%"
            height="100%"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
            style={{ overflow: "visible" }}
          >
            <defs>
              <pattern
                id={patternId}
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${rotation})`}
              >
                <line
                  x1="0" y1="0" x2="0" y2="7"
                  stroke={color}
                  strokeWidth="5"
                  strokeOpacity="1"
                />
              </pattern>

              {/* Radial fade: solid centre → transparent edges */}
              <radialGradient id={fadeId} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="white" stopOpacity="1" />
                <stop offset="55%" stopColor="white" stopOpacity="0.85" />
                <stop offset="80%" stopColor="white" stopOpacity="0.35" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </radialGradient>

              <mask id={maskId}>
                {/* Perimeter fade layer */}
                <rect width="100%" height="100%" fill={`url(#${fadeId})`} />
                {/* Oversized CS letters — knocked out */}
                <text
                  x="5%"
                  y="75%"
                  dominantBaseline="auto"
                  textAnchor="start"
                  fontFamily="var(--font-display), monospace"
                  fontWeight="300"
                  fontSize="800"
                  letterSpacing="-0.06em"
                  fill="black"
                >
                  C
                </text>
                <text
                  x="38%"
                  y="95%"
                  dominantBaseline="auto"
                  textAnchor="start"
                  fontFamily="var(--font-display), monospace"
                  fontWeight="300"
                  fontSize="800"
                  letterSpacing="-0.06em"
                  fill="black"
                >
                  S
                </text>
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill={`url(#${patternId})`}
              mask={`url(#${maskId})`}
            />
          </svg>
        </div>

        {/* ── Modal card ── */}
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
          <div className="mt-8 flex flex-col items-center gap-2">
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