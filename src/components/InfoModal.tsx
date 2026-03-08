import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { X, Github, ChevronDown, ExternalLink } from "lucide-react";

// Tab primitives

export type InfoTab = "about" | "sorts";

interface TabDef {
  key: InfoTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: "about", label: "About" },
  { key: "sorts", label: "Sort Modes" },
];

function TabBar({
  activeTab,
  onSelect,
}: {
  activeTab: InfoTab;
  onSelect: (tab: InfoTab) => void;
}) {
  return (
    <div
      className="flex pr-10 border-b border-[var(--color-border,rgba(74,71,69,0.25))]"
      role="tablist"
    >
      {TABS.map(({ key, label }) => {
        const active = activeTab === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(key)}
            className="flex-1 bg-transparent border-none cursor-pointer
                       py-3.5 px-5 text-[11px] tracking-[0.08em] uppercase
                       text-leftx transition-colors duration-150"
            style={{
              fontFamily: "var(--font-display)",
              color: active
                ? "var(--color-ink)"
                : "var(--color-ink-muted, rgba(160,155,150,0.6))",
              boxShadow: active
                ? "inset 0 -2px 0 var(--color-accent, #e97d62)"
                : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TabPanel({
  active,
  className = "",
  children,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      className={`absolute inset-0 ${className}`}
      style={{
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

// Collapsible sort description

const COLLAPSED_HEIGHT = 66; // ~6 lines at 11px

function SortEntry({
  label,
  body,
  link,
}: {
  label: string;
  body: React.ReactNode;
  link?: { text: string; href: string };
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsExpander, setNeedsExpander] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setNeedsExpander(el.scrollHeight > COLLAPSED_HEIGHT + 4);
    }
  }, [body]);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3
          className="text-[11px] tracking-[0.06em] text-ink m-0 shrink-0"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {label}
        </h3>

        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] no-underline
                       transition-colors duration-150 min-w-0"
            style={{
              color: "var(--color-accent, #e97d62)",
              opacity: 0.65,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}
          >
            <ExternalLink size={9} className="shrink-0" style={{ marginTop: "1px" }} />
            <span className="truncate">{link.text}</span>
          </a>
        )}
      </div>

      <div
        ref={contentRef}
        style={{
          maxHeight: !needsExpander || expanded ? "none" : `${COLLAPSED_HEIGHT}px`,
          overflow: "hidden",
          position: "relative",
          transition: "max-height 250ms ease",
        }}
      >
        <div
          className="text-[12px] leading-relaxed m-0"
          style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
        >
          {body}
        </div>

        {/* Fade-out mask when collapsed */}
        {needsExpander && !expanded && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 28,
              background:
                "linear-gradient(to bottom, transparent, var(--color-surface-raised, #1a1816))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {needsExpander && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="bg-transparent border-none cursor-pointer p-0 mt-1
                     inline-flex items-center gap-1 text-[10px]
                     transition-colors duration-150"
          style={{ color: "var(--color-accent, #e97d62)", opacity: 0.75 }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
        >
          <ChevronDown
            size={12}
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
            }}
          />
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

// Sort descriptions

const SORT_DESCRIPTIONS: {
  label: string;
  body: React.ReactNode;
  link?: { text: string; href: string };
}[] = [
    {
      label: "NEWEST / OLDEST",
      body: (
        <p className="m-0">
          We start with plain old chronological order by date added. Boring, like a good default should be.
        </p>
      ),
    },
    {
      label: "PHASH",
      body: (
        <p className="m-0">
          This stands for perceptual hash. It's basically a fingerprint of each panel's luminance
          features. Adjacent panels share similar layouts and brightness patterns regardless of color
          or content. This is good for identifying near-duplicate images, but honestly I don't find
          the results with disparate images to be that interesting here.
        </p>
      ),
      link: { text: "pHash.org", href: "https://www.phash.org/" },
    },
    {
      label: "COLOR",
      body: (
        <>
          <p className="m-0">
            This splits panels into color vs black-and-white using a colorfulness score derived from
            the CIELAB color space: specifically the spread of the a* and b* channels, which represent
            green-red and blue-yellow. Without that split, panels that read as black-and-white to our
            eyes would still land somewhere on the hue spectrum and break up the intuitive flow (since even grayscale pixels can have faint chroma values).
          </p>
          <p className="mt-2 mb-0">
            I thought this was an interesting case of how 'colorfulness' can be more of a human,
            perceptual judgment than an objective property of light. Within each group, panels are
            sorted by the hue angle of their dominant color, producing a spectrum from reds
            through oranges into yellows and beyond.
          </p>
        </>
      ),
      link: {
        text: "CIELAB color space",
        href: "https://en.wikipedia.org/wiki/CIELAB_color_space",
      },
    },
    {
      label: "SigLIP",
      body: (
        <p className="m-0">
          OK things get more interesting here, where we're sorting by semantic similarity via a
          vision-language model. SigLIP encodes holistic visual meaning: i.e. composition, subject
          matter, mood, and style all blended into one vector. Adjacent panels will be alike in varied
          respects: traffic noise, depictions of sadness, a hammer, etc. The axes of similarity vary
          wildly, but it's fun to guess at the points of connection.
        </p>
      ),
      link: {
        text: "google/siglip-base-patch16-224",
        href: "https://huggingface.co/google/siglip-base-patch16-224",
      },
    },
    {
      label: "DINOv2",
      body: (
        <p className="m-0">
          This captures structural and perceptual similarity from a self-supervised vision model.
          DINOv2 focuses on spatial layout, shapes, and visual texture without any language grounding.
          It tends to group panels by composition and form rather than narrative content.
        </p>
      ),
      link: {
        text: "facebook/dinov2-base",
        href: "https://huggingface.co/facebook/dinov2-base",
      },
    },
    {
      label: "VGG-16 Gram",
      body: (
        <p className="m-0">
          Here we focus on style and texture similarity from Gram-matrix features of a VGG-16
          network. You might notice connections based on line quality, hatching patterns, and tonal
          rendering. Panels by the same artist or in similar techniques will likely cluster together.
        </p>
      ),
      link: {
        text: "Gatys et al., A Neural Algorithm of Artistic Style",
        href: "https://arxiv.org/abs/1508.06576",
      },
    },
  ];

// Modal

interface Props {
  onClose: () => void;
  initialTab?: InfoTab;
  onTabChange?: (tab: InfoTab) => void;
}

export default function InfoModal({ onClose, initialTab = "about", onTabChange }: Props) {
  const [closing, setClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<InfoTab>(initialTab);
  const patternId = useId();
  const maskId = useId();
  const fadeId = useId();

  const { rotation, color } = useMemo(() => {
    const rotations = [45, 135];
    const colors = ["#e97d62", "#7A8B2A"];
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    return { rotation: pick(rotations), color: pick(colors) };
  }, []);

  // Lock scroll with position:fixed (gives solid bg behind Safari toolbar)
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";
    const prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "rgba(0, 0, 0, 0.95)";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      document.body.style.backgroundColor = prevBg;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 300);
  }, [onClose, closing]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  // Decorative hatch ornament — mirrors the backdrop's SVG hatch language

  function HatchDivider() {
    const id = useId();
    const patId = `${id}-pat`;
    const maskId = `${id}-mask`;
    const gradId = `${id}-grad`;

    const { angle, stroke } = useMemo(() => {
      const angles = [45, -45, 135, -135];
      const strokes = ["#e97d62"];
      const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
      return { angle: pick(angles), stroke: pick(strokes) };
    }, []);

    return (
      <div
        className="mx-auto my-5"
        style={{ width: 220, height: 20, opacity: 0.45 }}
        aria-hidden="true"
      >
        <svg
          width="220"
          height="20"
          viewBox="0 0 220 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id={patId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform={`rotate(${angle})`}
            >
              <line
                x1="0" y1="0" x2="0" y2="6"
                stroke={stroke}
                strokeWidth="2.5"
              />
            </pattern>

            <linearGradient id={gradId} x1="0" y1="0.5" x2="1" y2="0.5">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="25%" stopColor="white" stopOpacity="1" />
              <stop offset="75%" stopColor="white" stopOpacity="1" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>

            <mask id={maskId}>
              <rect width="220" height="20" fill={`url(#${gradId})`} />
            </mask>
          </defs>

          <rect
            width="220"
            height="20"
            fill={`url(#${patId})`}
            mask={`url(#${maskId})`}
          />
        </svg>
      </div>
    );
  }

  return (
    <>
      {/* Overlay container */}
      <div
        className="fixed z-50 flex items-center justify-center"
        style={{
          top: "-100px",
          left: 0,
          right: 0,
          bottom: "-100px",
          overscrollBehavior: "none",
          touchAction: "none",
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
        }}
        onTouchMove={(e) => e.preventDefault()}
        role="dialog"
        aria-modal="true"
        aria-label="About Comic Snaps"
      >
        {/* Faux-blur scrim */}
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.80)",
            animation: closing
              ? "scrimOut 280ms ease-out forwards"
              : "scrimIn 250ms ease-out forwards",
          }}
          aria-hidden="true"
        />

        {/* Hatch-pattern backdrop */}
        <div
          className="absolute inset-0 select-none"
          aria-hidden="true"
          style={{
            willChange: "opacity",
            opacity: 0,
            animation: closing
              ? "hatchFadeOut 280ms ease-out forwards"
              : "hatchFadeIn 400ms ease-out forwards, hatchDrift 10s ease-in-out 400ms infinite",
            transform: "rotate(-5deg) scale(1.15) translate(-4%, 3%)",
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
                <rect width="100%" height="100%" fill={`url(#${fadeId})`} />
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

        {/* Modal card */}
        <div
          className="relative w-full max-w-[420px] mx-6 rounded-md
                     border border-[var(--color-border,rgba(74,71,69,0.25))]
                     bg-[var(--color-surface-raised)]"
          style={{
            animation: closing
              ? "modalExit 250ms ease-out forwards"
              : "modalEnter 250ms ease-out forwards",
          }}
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* Close */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 bg-transparent border-none cursor-pointer
                       transition-colors duration-150 z-10"
            title="Close"
          >
            <X size={16} strokeWidth={1.5} className="stroke-ink-muted hover:stroke-ink-faint" />
          </button>

          <TabBar activeTab={activeTab} onSelect={(tab) => {
            setActiveTab(tab);
            onTabChange?.(tab);
          }} />

          {/* Tab content (fixed height — matches sorts tab) */}
          <div style={{ height: "min(80vh, 620px)" }} className="relative">

            {/* About */}
            <TabPanel active={activeTab === "about"} className="flex items-center pb-10 justify-center">
              <div className="px-10 text-center">

                {/* <div className="w-12 h-0.5 bg-accent mx-auto mb-5 rounded-sm opacity-70" /> */}
                {/* <HatchDivider /> */}

                {/* Title */}
                <h2
                  className="tracking-tight text-[18px] text-ink/80"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {/* <span className="text-[#7A8B2A]/40 mr-3">*</span> */}
                  COMIC SNAPS
                  {/* <span className="text-[#7A8B2A]/40 ml-3">*</span> */}
                </h2>

                <HatchDivider />

                {/* Description */}
                <p
                  className="mt-4 text-[12px] leading-relaxed"
                  style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
                >
                  This is just a place to collect neat panels from comic books and explore different axes of visual and semantic similarity.
                </p>

                {/* Accent rule */}
                {/* <div className="w-12 h-0.5 bg-accent mx-auto mt-5 rounded-sm opacity-70" /> */}

                <HatchDivider />
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
            </TabPanel>

            {/* Sorts */}
            <TabPanel active={activeTab === "sorts"} className="overflow-y-auto info-modal-scroll">
              <div className="px-6 pt-5 pb-6">
                <p
                  className="text-[12px] leading-relaxed mb-5"
                  style={{ color: "var(--color-ink-muted, rgba(160,155,150,0.7))" }}
                >
                  Each sort type reorders the gallery by a different axis of similarity.
                  I use several neat models for this, which you can read about below.
                  Their embeddings are precomputed at build time. So nothing runs in your sweaty browser.
                </p>

                <div className="flex flex-col gap-6">
                  {SORT_DESCRIPTIONS.map(({ label, body, link }) => (
                    <SortEntry key={label} label={label} body={body} link={link} />
                  ))}
                </div>
              </div>
            </TabPanel>

          </div>
        </div>
      </div>
    </>
  );
}