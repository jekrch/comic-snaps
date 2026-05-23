import { useId, useRef, useState, useEffect, useMemo } from "react";
import { Globe, Eye, Bird } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import type { NeighborMap } from "../adjacency";
import FillerLabels from "./FillerLabels";

export const WORDS = ["SNAPS"];

/** Random splash duration range (seconds, on-screen time). */
const ACTIVE_MIN_SEC = 7;
const ACTIVE_MAX_SEC = 12;
/** Random rest between splashes (seconds). */
const REST_MIN_SEC = 1;
const REST_MAX_SEC = 2;
/** Per-event droplet count range — random 1–3 blobs per splash. */
const DROPLET_MIN = 1;
const DROPLET_MAX = 3;

/** Coverage grid resolution for tracking filled territory cheaply. */
const COVERAGE_COLS = 12;
const COVERAGE_ROWS = 8;
const COVERAGE_TOTAL = COVERAGE_COLS * COVERAGE_ROWS;
/** Phase flips when the active phase's coverage reaches this fraction. */
const FLIP_THRESHOLD = 0.8;
/** Number of candidate rest positions sampled per droplet (best one wins). */
const REST_CANDIDATES = 3;

export const LUCIDE_ICONS: LucideIcon[] = [
  //MessageCircleMore,
  //MessageSquareQuote,
  Bird,
  Globe, Eye
];

const ROTATIONS = [45, 135];
const COLORS = ["#7A8B2A", "#e97d62"];

const STYLIZE_PLACEMENT = true;

export type StampDef =
  | { type: "word"; value: string }
  | { type: "icon"; value: LucideIcon };

/** Build the full pool of possible stamps for external sequencing. */
export function buildStampPool(): StampDef[] {
  const pool: StampDef[] = [];
  for (const word of WORDS) {
    pool.push({ type: "word", value: word });
  }
  for (const icon of LUCIDE_ICONS) {
    pool.push({ type: "icon", value: icon });
  }
  return pool;
}

interface PlacementStyle {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * A simple integer hash that maps an index to a spread-out but
 * deterministic value, used to give each filler varied-looking
 * placement without any randomness.
 */
function deterministicHash(index: number): number {
  let h = index * 2654435761; // Knuth multiplicative hash
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

/** Map an index deterministically into the [min, max) range. */
function deterministicBetween(index: number, salt: number, min: number, max: number): number {
  const h = deterministicHash(index * 7 + salt);
  return min + (h % 10000) / 10000 * (max - min);
}

/** Darken a hex color by mixing it toward black. amount in [0,1]. */
function darkenHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = 1 - amount;
  const dr = Math.max(0, Math.min(255, Math.round(r * f)));
  const dg = Math.max(0, Math.min(255, Math.round(g * f)));
  const db = Math.max(0, Math.min(255, Math.round(b * f)));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

/** A settled, stationary glob that has reached its rest position. */
interface SettledGlob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** A single droplet in one splash event. Emerges → falls → decelerates → rests. */
interface Droplet {
  /** Spawn x-position (pixels). */
  x: number;
  /** Spawn y-position (pixels, may be negative for above-tile entry). */
  y: number;
  /** Ellipse rx when fully formed. */
  rx: number;
  /** Ellipse ry when fully formed. */
  ry: number;
  /** Pixels of vertical fall from spawn to rest position. */
  fallDistance: number;
  /** Horizontal drift while falling (pixels) — equal to finalX - x. */
  driftX: number;
  /** Final resting x-position (pixels). */
  finalX: number;
  /** Final resting y-position (pixels). */
  finalY: number;
  /** Per-droplet emergence stagger (% of activeSec, 0–14). */
  inner: number;
  /** Sinusoidal horizontal wobble amplitude (pixels). */
  wobbleAmp: number;
  /** Wobble frequency — cycles over the full animation. */
  wobbleFreq: number;
  /** Wobble phase offset (radians). */
  wobblePhase: number;
  /** Secondary higher-frequency wobble amplitude (pixels) for organic meander. */
  wobble2Amp: number;
  wobble2Freq: number;
  wobble2Phase: number;
  /**
   * Fall progression. Each entry maps a fraction of the *fall portion* of the
   * animation (t, 0–1) to a fraction of the fall distance covered (f, 0–1).
   * Speeds per segment vary randomly, so the drop stalls at random points on
   * the way down before catching up.
   */
  fallProfile: { t: number; f: number }[];
}

/** Tile-level stable config — doesn't change between events. */
interface LiquidConfig {
  enabled: boolean;
  blurStd: number;
  baseRadius: number;
  darkColor: string;
}

/** One splash event — regenerated each cycle with fresh randomness. */
interface SplashEvent {
  /** Increments on every event so React can remount and restart the CSS animation. */
  id: number;
  /** On-screen drip time (2–5s). */
  activeSec: number;
  /** Rest time after this event before the next one starts (2–4s). */
  restSec: number;
  droplets: Droplet[];
}

/**
 * Mark every grid cell whose center lies inside (or close to) the glob's
 * ellipse. Used to track which areas of the tile are already painted in the
 * current phase. The 1.2 slack accounts for the gooey blur fattening blobs.
 */
function markCoverage(grid: Uint8Array, glob: SettledGlob, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  const cellW = width / COVERAGE_COLS;
  const cellH = height / COVERAGE_ROWS;
  const x0 = Math.max(0, Math.floor((glob.x - glob.rx) / cellW));
  const x1 = Math.min(COVERAGE_COLS - 1, Math.floor((glob.x + glob.rx) / cellW));
  const y0 = Math.max(0, Math.floor((glob.y - glob.ry) / cellH));
  const y1 = Math.min(COVERAGE_ROWS - 1, Math.floor((glob.y + glob.ry) / cellH));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ccx = (cx + 0.5) * cellW;
      const ccy = (cy + 0.5) * cellH;
      const dx = (ccx - glob.x) / glob.rx;
      const dy = (ccy - glob.y) / glob.ry;
      if (dx * dx + dy * dy <= 1.2) {
        grid[cy * COVERAGE_COLS + cx] = 1;
      }
    }
  }
}

/**
 * Score a candidate rest position by how much new territory it would paint.
 * `mask` (optional) restricts scoring to cells whose mask value is 1 — used
 * in the light phase to favor positions over already-dark cells.
 */
function scoreCandidate(
  grid: Uint8Array,
  glob: SettledGlob,
  width: number,
  height: number,
  mask: Uint8Array | null,
): number {
  if (width <= 0 || height <= 0) return 0;
  const cellW = width / COVERAGE_COLS;
  const cellH = height / COVERAGE_ROWS;
  const x0 = Math.max(0, Math.floor((glob.x - glob.rx) / cellW));
  const x1 = Math.min(COVERAGE_COLS - 1, Math.floor((glob.x + glob.rx) / cellW));
  const y0 = Math.max(0, Math.floor((glob.y - glob.ry) / cellH));
  const y1 = Math.min(COVERAGE_ROWS - 1, Math.floor((glob.y + glob.ry) / cellH));
  let score = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const idx = cy * COVERAGE_COLS + cx;
      if (grid[idx]) continue;
      if (mask && !mask[idx]) continue;
      const ccx = (cx + 0.5) * cellW;
      const ccy = (cy + 0.5) * cellH;
      const dx = (ccx - glob.x) / glob.rx;
      const dy = (ccy - glob.y) / glob.ry;
      if (dx * dx + dy * dy <= 1.2) score++;
    }
  }
  return score;
}

function coverageRatio(grid: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) count++;
  return count / grid.length;
}

function buildLiquidConfig(
  enabled: boolean,
  width: number,
  height: number,
  baseColor: string,
): LiquidConfig {
  const darkColor = darkenHex(baseColor, 0.55);
  if (!enabled || width <= 0 || height <= 0) {
    return { enabled: false, blurStd: 0, baseRadius: 0, darkColor };
  }
  const minDim = Math.min(width, height);
  const baseRadius = minDim * 0.13;
  const blurStd = Math.max(3, Math.min(7, baseRadius * 0.4));
  return { enabled: true, blurStd, baseRadius, darkColor };
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Build a per-droplet fall profile: a list of (timeFrac, fallFrac) points
 * across the fall portion of the animation.
 *
 * Speed is defined at a handful of evenly-spaced control points (some
 * normal, some "slow zones"), then smoothstep-interpolated between them
 * and integrated to produce f(t). Densely sampled output keyframes mean
 * CSS's linear interpolation closely tracks the smooth curve, so the
 * drop eases gradually in and out of stalls instead of velocity jumping
 * at segment boundaries.
 */
function generateFallProfile(): { t: number; f: number }[] {
  const controls = 8;
  const speeds: number[] = [];
  for (let i = 0; i < controls; i++) {
    const slow = Math.random() < 0.38;
    speeds.push(slow ? randBetween(0.04, 0.18) : randBetween(0.8, 1.45));
  }
  // Force a deceleration into rest: the last few control points are slow,
  // so the blob eases to a stop at its final position rather than slamming.
  speeds[controls - 3] = Math.min(speeds[controls - 3], randBetween(0.35, 0.6));
  speeds[controls - 2] = randBetween(0.12, 0.25);
  speeds[controls - 1] = randBetween(0.01, 0.05);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const samples = 16;
  const rawF: number[] = [0];
  let acc = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const idxF = t * (controls - 1);
    const i0 = Math.min(controls - 1, Math.floor(idxF));
    const i1 = Math.min(controls - 1, i0 + 1);
    const frac = idxF - i0;
    const speed = speeds[i0] * (1 - smooth(frac)) + speeds[i1] * smooth(frac);
    acc += speed / samples;
    rawF.push(acc);
  }
  const total = rawF[rawF.length - 1];
  const profile: { t: number; f: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    profile.push({ t: i / samples, f: rawF[i] / total });
  }
  return profile;
}

function generateSplashEvent(
  id: number,
  width: number,
  height: number,
  baseRadius: number,
  ownGrid: Uint8Array,
  targetMask: Uint8Array | null,
): SplashEvent {
  const activeSec = randBetween(ACTIVE_MIN_SEC, ACTIVE_MAX_SEC);
  const restSec = randBetween(REST_MIN_SEC, REST_MAX_SEC);

  const margin = baseRadius * 0.6;
  const xRange = Math.max(0, width - margin * 2);
  const yMax = (height * 2) / 3;
  const yRange = Math.max(0, yMax - margin);

  const count = Math.floor(randBetween(DROPLET_MIN, DROPLET_MAX + 1));

  // ~40% of events: blobs enter the tile from above the visible frame
  // (start at a negative y), falling in through the top edge.
  const enterFromAbove = Math.random() < 0.4;

  // Working copy of the coverage grid so candidates within the same event
  // can avoid stacking on each other's intended landing spots.
  const workGrid = new Uint8Array(ownGrid);

  const droplets: Droplet[] = [];
  for (let i = 0; i < count; i++) {
    const sizeBase = randBetween(0.55, 1.9);
    const rx = baseRadius * sizeBase * randBetween(0.8, 1.2);
    const ry = baseRadius * sizeBase * randBetween(0.8, 1.2);
    const spawnX = margin + Math.random() * xRange;
    const spawnY = enterFromAbove
      ? -randBetween(ry * 1.2, ry * 3.5)
      : margin + Math.random() * yRange;

    // Rest position must be below spawn (so the drop actually falls). Keep
    // it inside the tile with a small padding from the edges.
    const restPad = Math.max(rx, ry) * 0.7;
    const restMinX = restPad;
    const restMaxX = Math.max(restPad, width - restPad);
    const restMinY = Math.max(restPad, spawnY + ry * 1.5);
    const restMaxY = Math.max(restMinY, height - restPad);

    // Best-of-3 candidates: a light bias toward territory that adds the most
    // new same-color surface. Random jitter in the score keeps it from being
    // fully greedy — the suboptimal candidate sometimes wins.
    let bestX = (restMinX + restMaxX) / 2;
    let bestY = (restMinY + restMaxY) / 2;
    let bestScore = -Infinity;
    for (let k = 0; k < REST_CANDIDATES; k++) {
      const cx = restMinX + Math.random() * (restMaxX - restMinX);
      const cy = restMinY + Math.random() * (restMaxY - restMinY);
      const raw = scoreCandidate(workGrid, { x: cx, y: cy, rx, ry }, width, height, targetMask);
      const jittered = raw + Math.random() * 1.5;
      if (jittered > bestScore) {
        bestScore = jittered;
        bestX = cx;
        bestY = cy;
      }
    }
    markCoverage(workGrid, { x: bestX, y: bestY, rx, ry }, width, height);

    droplets.push({
      x: spawnX,
      y: spawnY,
      rx,
      ry,
      fallDistance: bestY - spawnY,
      driftX: bestX - spawnX,
      finalX: bestX,
      finalY: bestY,
      inner: randBetween(0, 14),
      // Two stacked sine waves give an organic meander. Amplitudes are
      // sized against baseRadius (not rx) so small blobs don't lurch.
      wobbleAmp: randBetween(baseRadius * 0.35, baseRadius * 0.9),
      wobbleFreq: randBetween(1.5, 3.5),
      wobblePhase: randBetween(0, Math.PI * 2),
      wobble2Amp: randBetween(baseRadius * 0.12, baseRadius * 0.4),
      wobble2Freq: randBetween(3.0, 6.0),
      wobble2Phase: randBetween(0, Math.PI * 2),
      fallProfile: generateFallProfile(),
    });
  }
  return { id, activeSec, restSec, droplets };
}

function generateDeterministicPlacement(index: number): PlacementStyle {
  if (!STYLIZE_PLACEMENT) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  return {
    scale: deterministicBetween(index, 1, 1.1, 2.0),
    offsetX: deterministicBetween(index, 2, 5, 200),
    offsetY: deterministicBetween(index, 3, -12, 12),
  };
}

interface StableStyle {
  rotation: number;
  color: string;
  twist: string;
  placement: PlacementStyle;
  iconInnerX: number;
  iconInnerY: number;
}

function generateStableStyle(stamp: StampDef | null, empty: boolean, fillerIndex: number): StableStyle {
  if (empty || !stamp) {
    return {
      rotation: ROTATIONS[fillerIndex % ROTATIONS.length],
      color: COLORS[fillerIndex % COLORS.length],
      twist: "",
      placement: { scale: 1, offsetX: 0, offsetY: 0 },
      iconInnerX: 0,
      iconInnerY: 0,
    };
  }

  const angle = deterministicBetween(fillerIndex, 10, -3, 3);
  const scale = 1.05 + deterministicBetween(fillerIndex, 11, 0, 0.1);

  return {
    rotation: ROTATIONS[fillerIndex % ROTATIONS.length],
    color: COLORS[fillerIndex % COLORS.length],
    twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
    placement:
      stamp.type === "icon"
        ? generateDeterministicPlacement(fillerIndex)
        : { scale: 1, offsetX: 0, offsetY: 0 },
    iconInnerX: deterministicBetween(fillerIndex, 5, -10, 10),
    iconInnerY: deterministicBetween(fillerIndex, 5, -10, 40),
  };
}

/**
 * Render a Lucide icon offscreen, extract the raw SVG children,
 * and return them as an HTML string suitable for dangerouslySetInnerHTML
 * inside an <svg> mask.
 */
function extractLucideSvgContent(IconComponent: LucideIcon): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);

    let cleaned = false;

    const cleanup = (root: ReturnType<typeof createRoot>) => {
      if (cleaned) return;
      cleaned = true;
      root.unmount();
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    const tryExtract = () => {
      const svg = container.querySelector("svg");
      return svg ? svg.innerHTML : null;
    };

    const root = createRoot(container);

    const observer = new MutationObserver(() => {
      const content = tryExtract();
      if (content) {
        observer.disconnect();
        cleanup(root);
        resolve(content);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    root.render(
      <IconComponent size={24} strokeWidth={2} color="black" fill="none" />
    );

    setTimeout(() => {
      observer.disconnect();
      const content = tryExtract();
      cleanup(root);
      resolve(content ?? "");
    }, 500);
  });
}

function useLucideExtract(IconComponent: LucideIcon | null): string | null {
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    if (!IconComponent) {
      setSvgContent(null);
      return;
    }
    let cancelled = false;
    extractLucideSvgContent(IconComponent).then((content) => {
      if (!cancelled) setSvgContent(content);
    });
    return () => { cancelled = true; };
  }, [IconComponent]);

  return svgContent;
}

interface HatchFillerProps {
  empty?: boolean;
  /** When provided, the filler uses this stamp instead of picking randomly. */
  assignedStamp?: StampDef | null;
  /**
   * Deterministic index used to cycle colors, rotations, and placement
   * styles. Assigned by MasonryGrid in layout order.
   */
  fillerIndex?: number;
  /** Adjacent panel info for rendering artist labels. */
  neighbors?: NeighborMap | null;
  /** Override the hatch color (bypasses the deterministic COLORS cycle). */
  colorOverride?: string | null;
}

export default function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
  colorOverride = null,
}: HatchFillerProps) {
  const patternId = useId();
  const darkPatternId = useId();
  const maskId = useId();
  const gooFilterId = useId();
  const liquidMaskId = useId();
  const lightMaskId = useId();
  const animId = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    update();
    const t1 = setTimeout(update, 150);
    const t2 = setTimeout(update, 500);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const stampRef = useRef<StampDef | null>(null);
  if (stampRef.current === null && !empty) {
    if (assignedStamp) {
      stampRef.current = assignedStamp;
    } else {
      const pool = buildStampPool();
      stampRef.current = pool[fillerIndex % pool.length];
    }
  }
  const stamp = stampRef.current;

  const styleRef = useRef<StableStyle | null>(null);
  if (styleRef.current === null) {
    styleRef.current = generateStableStyle(stamp, empty, fillerIndex);
  }
  const { rotation, color, twist, placement, iconInnerX, iconInnerY } = styleRef.current;

  // Allow external color override (e.g. FooterPyramid random colors)
  const resolvedColor = colorOverride ?? color;

  const iconSvgContent = useLucideExtract(
    stamp?.type === "icon" ? stamp.value : null
  );

  const patternContent = (
    <pattern
      id={patternId}
      width="8"
      height="8"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${rotation})`}
    >
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="8"
        stroke={resolvedColor}
        strokeWidth="8"
        strokeOpacity="0.68"
      />
    </pattern>
  );

  // Liquid runs on any hatched filler — the dark shade is derived from the
  // resolved line color, so green tiles get dark-green ink, orange tiles
  // get dark-orange ink, etc.
  const liquidEligible = !empty && !reducedMotion;

  const liquid = useMemo(
    () => buildLiquidConfig(liquidEligible, size.width, size.height, resolvedColor),
    [liquidEligible, size.width, size.height, resolvedColor],
  );

  // Per-event randomized state — fresh positions and timings each splash.
  const [event, setEvent] = useState<SplashEvent | null>(null);
  // Phase: 'dark' globs accumulate first; once dark coverage hits 80%,
  // 'light' globs start forming in the dark areas. When the light layer
  // restores ~80% of the screen to light, both layers reset and we begin
  // a fresh dark cycle.
  const [phase, setPhase] = useState<"dark" | "light">("dark");
  const [settledDark, setSettledDark] = useState<SettledGlob[]>([]);
  const [settledLight, setSettledLight] = useState<SettledGlob[]>([]);
  // Grids are refs (not state) — they're read inside the lifecycle timer
  // and don't need to drive re-renders on their own.
  const darkGridRef = useRef<Uint8Array>(new Uint8Array(COVERAGE_TOTAL));
  const lightGridRef = useRef<Uint8Array>(new Uint8Array(COVERAGE_TOTAL));

  useEffect(() => {
    if (!liquid.enabled || size.width <= 0 || size.height <= 0) {
      setEvent(null);
      return;
    }
    let activeTimer: ReturnType<typeof setTimeout> | null = null;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let nextId = 0;
    let currentPhase: "dark" | "light" = phase;

    const fire = () => {
      nextId += 1;
      // In dark phase: target is the whole tile (no mask). In light phase:
      // we only score cells already covered by dark — so the light blobs
      // are biased toward landing inside the dark territory.
      const ownGrid = currentPhase === "dark" ? darkGridRef.current : lightGridRef.current;
      const targetMask = currentPhase === "dark" ? null : darkGridRef.current;
      const e = generateSplashEvent(
        nextId,
        size.width,
        size.height,
        liquid.baseRadius,
        ownGrid,
        targetMask,
      );
      setEvent(e);

      // When the animation finishes, commit the droplets to the settled
      // layer for this phase, update the grid, and possibly flip phase.
      activeTimer = setTimeout(() => {
        const newSettled: SettledGlob[] = e.droplets.map((d) => ({
          x: d.finalX,
          y: d.finalY,
          rx: d.rx,
          ry: d.ry,
        }));
        for (const g of newSettled) {
          markCoverage(ownGrid, g, size.width, size.height);
        }
        if (currentPhase === "dark") {
          setSettledDark((prev) => [...prev, ...newSettled]);
          if (coverageRatio(darkGridRef.current) >= FLIP_THRESHOLD) {
            currentPhase = "light";
            setPhase("light");
          }
        } else {
          setSettledLight((prev) => [...prev, ...newSettled]);
          if (coverageRatio(lightGridRef.current) >= FLIP_THRESHOLD) {
            // Full rotation complete — reset both layers and start over.
            currentPhase = "dark";
            darkGridRef.current = new Uint8Array(COVERAGE_TOTAL);
            lightGridRef.current = new Uint8Array(COVERAGE_TOTAL);
            setSettledDark([]);
            setSettledLight([]);
            setPhase("dark");
          }
        }
      }, e.activeSec * 1000);

      nextTimer = setTimeout(fire, (e.activeSec + e.restSec) * 1000);
    };

    // Initial offset 0–restMax so different tiles don't all start in sync.
    const initialDelay = Math.random() * REST_MAX_SEC * 1000;
    nextTimer = setTimeout(fire, initialDelay);
    return () => {
      if (activeTimer) clearTimeout(activeTimer);
      if (nextTimer) clearTimeout(nextTimer);
    };
    // We intentionally don't depend on `phase` — we hold a local
    // `currentPhase` so phase flips happen mid-effect without restarting
    // the whole timer chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liquid.enabled, liquid.baseRadius, size.width, size.height]);

  const darkPatternContent = liquid.enabled ? (
    <pattern
      id={darkPatternId}
      width="8"
      height="8"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${rotation})`}
    >
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="8"
        stroke={liquid.darkColor}
        strokeWidth="8"
        strokeOpacity="0.95"
      />
    </pattern>
  ) : null;


  const isSmall = Math.min(size.width, size.height) < 300;

  const baseIconSize = Math.min(size.width, size.height) * 0.7;
  const effectiveScale = isSmall
    ? Math.min(placement.scale, 1.3)   // cap scale on mobile
    : placement.scale;
  const iconSize = Math.min(
    baseIconSize * effectiveScale,
    Math.min(size.width, size.height) * 0.95
  );

  // Tighten offset influence on small screens
  const offsetDamping = isSmall ? 0.3 : 1.0;
  const rawCx = size.width / 2 + (placement.offsetX / 100) * size.width * offsetDamping;
  const rawCy = size.height / 2 + (placement.offsetY / 100) * size.height * offsetDamping;


  const half = iconSize / 2;

  // More generous margin
  const margin = half * (isSmall ? 0.7 : 0.3);
  const cx = Math.max(margin, Math.min(size.width - margin, rawCx));
  const cy = Math.max(margin, Math.min(size.height - margin, rawCy));

  const fontSize = 80;

  let maskContent: React.ReactNode = null;

  if (!empty && stamp?.type === "word") {
    maskContent = (
      <text
        className="hatch-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="900"
        fontSize={fontSize}
        letterSpacing="0em"
        fill="black"
      >
        {stamp.value}
      </text>
    );
  } else if (!empty && stamp?.type === "icon" && iconSvgContent) {
    const patchedContent = iconSvgContent.replace(
      /stroke="currentColor"/g,
      'stroke="black"'
    );

    maskContent = (
      <g
        className="hatch-text"
        transform={`translate(${cx - half}, ${cy - half})`}
      >
        <svg
          x={iconInnerX}
          y={iconInnerY}
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          overflow="visible"
          fill="none"
          stroke="black"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: patchedContent }}
        />
      </g>
    );
  }

  return (
    <div ref={containerRef} className="hatch-root relative w-full h-full rounded-sm overflow-hidden">
      <style>{`
        .hatch-text {
          transform: ${twist};
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
        }
        .hatch-root:hover .hatch-text {
          transform: scale(1.2) rotate(0deg);
        }
        .filler-labels {
          opacity: 0;
          transform: scale(0.92);
          transition: opacity 0.25s ease-out, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
          pointer-events: none;
        }
        .hatch-root:hover .filler-labels {
          opacity: 1;
          transform: scale(1);
        }
        ${liquid.enabled && event ? event.droplets.map((d, i) => {
          // Single-shot animation. The droplet emerges, falls, decelerates,
          // and settles at (finalX, finalY) with scale (1,1). After
          // settling, the active ellipse is replaced by a static settled
          // one at the same coordinates (no visible pop).
          const a = d.inner;
          const fall = d.fallDistance;
          const fromAbove = d.y < 0;
          // Two stacked sines layered on top of linear drift. Wobble is
          // damped to 0 by the end of the fall so the rest position is
          // exactly (finalX, finalY) — matches the static ellipse handoff.
          const wobbleAt = (pct: number) =>
            Math.sin((pct / 100) * d.wobbleFreq * 2 * Math.PI + d.wobblePhase) * d.wobbleAmp
            + Math.sin((pct / 100) * d.wobble2Freq * 2 * Math.PI + d.wobble2Phase) * d.wobble2Amp;
          const xAt = (driftFrac: number, pct: number, wobbleMul: number) =>
            (d.driftX * driftFrac + wobbleAt(pct) * wobbleMul).toFixed(1);
          const yAt = (frac: number) => (fall * frac).toFixed(1);
          // Emit fall keyframes from the profile. The fall portion spans
          // emergeEnd% → 100% of the animation. The last point lands at
          // (driftX, fall) — i.e. exactly at the resting position.
          const fallKeyframes = (emergeEnd: number) => {
            const fallSpan = 100 - emergeEnd;
            const pts = d.fallProfile;
            return pts.map((p, idx) => {
              const isLast = idx === pts.length - 1;
              const pct = emergeEnd + fallSpan * p.t;
              // Local velocity in fall-fraction per time-fraction. v ≈ 1
              // average; <1 stalled (bulges), >1 racing (stretches).
              let vIn = 1;
              let vOut = 1;
              if (idx > 0) {
                const prev = pts[idx - 1];
                const dt = p.t - prev.t;
                if (dt > 0) vIn = (p.f - prev.f) / dt;
              }
              if (idx < pts.length - 1) {
                const next = pts[idx + 1];
                const dt = next.t - p.t;
                if (dt > 0) vOut = (next.f - p.f) / dt;
              }
              if (idx === 0) vIn = vOut;
              if (idx === pts.length - 1) vOut = vIn;
              const v = Math.max(0, Math.min(2.4, (vIn + vOut) / 2));
              // At rest (isLast) force relaxed scale (1,1) so the handoff
              // to the static settled ellipse is seamless.
              const sx = isLast ? 1 : 1.22 - 0.218 * v;
              const sy = isLast ? 1 : 0.82 + 0.25 * v;
              // Wobble damps to 0 over the fall — fully zero by p.t=1.
              const wobbleMul = 1 - p.t * p.t;
              return `${pct.toFixed(1)}% { transform: translate(${xAt(p.f, pct, wobbleMul)}px, ${yAt(p.f)}px) scale(${sx.toFixed(2)}, ${sy.toFixed(2)}); }`;
            }).join("\n          ");
          };
          const body = fromAbove
            ? `
          0% { transform: translate(${xAt(0, 0, 1)}px, 0) scale(1); }
          ${a.toFixed(1)}% { transform: translate(${xAt(0, a, 1)}px, 0) scale(1); }
          ${fallKeyframes(a)}
            `
            : `
          0% { transform: translate(0, 0) scale(0); }
          ${a.toFixed(1)}% { transform: translate(0, 0) scale(0); }
          ${(a + 4).toFixed(1)}% { transform: translate(0, 0) scale(0.5, 0.4); }
          ${(a + 10).toFixed(1)}% { transform: translate(0, 0) scale(1, 0.95); }
          ${(a + 18).toFixed(1)}% { transform: translate(0, 0) scale(0.95, 1.08); }
          ${fallKeyframes(a + 18)}
            `;
          return `
        @keyframes drop-${animId}-${i} { ${body} }
        .drop-${animId}-${i} {
          transform-box: fill-box;
          transform-origin: center;
          animation: drop-${animId}-${i} ${event.activeSec.toFixed(2)}s linear 1 both;
          will-change: transform;
        }
        ` ;}).join("") : ""}
      `}</style>
      <svg
        className="hatch-container"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          {patternContent}
          {darkPatternContent}
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {maskContent}
          </mask>
          {liquid.enabled && (
            <>
              {/* Gooey filter — blur + alpha threshold turns overlapping
                  ellipses into a single continuous liquid silhouette. */}
              <filter
                id={gooFilterId}
                x="-20%"
                y="-20%"
                width="140%"
                height="160%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur in="SourceGraphic" stdDeviation={liquid.blurStd} result="blur" />
                <feColorMatrix
                  in="blur"
                  mode="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
                />
              </filter>
              {/* Dark splash mask: settled phase-A globs + currently
                  animating droplets (if phase is dark). Filter-merged
                  ellipses become a single white "fluid" silhouette over
                  black, which masks the dark pattern fill below. */}
              <mask id={liquidMaskId}>
                <rect width="100%" height="100%" fill="black" />
                <g
                  key={`dark-${event?.id ?? 0}`}
                  filter={`url(#${gooFilterId})`}
                  fill="white"
                >
                  {settledDark.map((g, i) => (
                    <ellipse
                      key={`s${i}`}
                      cx={g.x}
                      cy={g.y}
                      rx={g.rx}
                      ry={g.ry}
                    />
                  ))}
                  {phase === "dark" && event &&
                    event.droplets.map((d, i) => (
                      <ellipse
                        key={`a${i}`}
                        className={`drop-${animId}-${i}`}
                        cx={d.x}
                        cy={d.y}
                        rx={d.rx}
                        ry={d.ry}
                      />
                    ))}
                </g>
              </mask>
              {/* Light splash mask: settled phase-B globs + currently
                  animating droplets (if phase is light). Used to paint
                  fresh light hatch on top of the dark layer — "erasing"
                  dark territory and rotating the cycle back. */}
              <mask id={lightMaskId}>
                <rect width="100%" height="100%" fill="black" />
                <g
                  key={`light-${event?.id ?? 0}`}
                  filter={`url(#${gooFilterId})`}
                  fill="white"
                >
                  {settledLight.map((g, i) => (
                    <ellipse
                      key={`s${i}`}
                      cx={g.x}
                      cy={g.y}
                      rx={g.rx}
                      ry={g.ry}
                    />
                  ))}
                  {phase === "light" && event &&
                    event.droplets.map((d, i) => (
                      <ellipse
                        key={`a${i}`}
                        className={`drop-${animId}-${i}`}
                        cx={d.x}
                        cy={d.y}
                        rx={d.rx}
                        ry={d.ry}
                      />
                    ))}
                </g>
              </mask>
            </>
          )}
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--color-surface-raised, #1a1a1a)"
        />
        <g mask={`url(#${maskId})`}>
          {/* Base hatch — always present, never animated. */}
          <rect
            width="100%"
            height="100%"
            fill={`url(#${patternId})`}
          />
          {/* Dark splash layer (phase A): dark hatch pattern visible only
              where the dark splash silhouette is opaque. The base hatch
              underneath stays perfectly static; only the dark *shading*
              moves. Settled globs are static ellipses inside the mask —
              only the in-flight droplet animates, keeping per-frame work
              small even after many globs have accumulated. */}
          {liquid.enabled &&
            (settledDark.length > 0 || (phase === "dark" && event !== null)) && (
              <rect
                width="100%"
                height="100%"
                fill={`url(#${darkPatternId})`}
                mask={`url(#${liquidMaskId})`}
              />
            )}
          {/* Light splash layer (phase B): light hatch pattern painted on
              top of the dark layer, restoring the original shade inside
              dark territory. When this layer covers ~80% of the tile,
              both layers reset and the dark cycle begins again. */}
          {liquid.enabled &&
            (settledLight.length > 0 || (phase === "light" && event !== null)) && (
              <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                mask={`url(#${lightMaskId})`}
              />
            )}
        </g>
      </svg>

      {neighbors && (
        <FillerLabels
          neighbors={neighbors}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  );
}