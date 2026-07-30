import type { Panel } from "../../../types";
import type { VizConfig } from "../vizConfig";
import { deviceCaps, VIZ_MAX_SPEED, VIZ_MIN_SPEED } from "../vizConfig";
import { Director } from "./Director";
import { Rng } from "./rng";
import { WebGLBackend } from "./backends/WebGLBackend";
import { CssBackend } from "./backends/CssBackend";
import type { VizBackend, VizFrame } from "./types";

export type BackendKind = "webgl" | "css";

export interface EngineStats {
  fps: number;
  shards: number;
  resident: number;
  pending: number;
  scene: string;
  backend: BackendKind;
}

interface BackendWithStats extends VizBackend {
  stats?: { resident: number; pending: number };
}

/** Returning to a hidden tab must not lurch the whole composition forward. */
const MAX_DT = 1 / 20;

/**
 * What the frame is actually putting on screen, for the debug readout. Shards on
 * the flat path; on a spatial one the quads of every slot carrying something.
 *
 * A shell scene has no quads at all — its surface is one tube per resident panel —
 * so it counts the surfaces instead. Either way the number answers "how many
 * separate things is the frame made of", which since the formations were thinned
 * out is the number worth watching.
 */
function drawCount(frame: VizFrame): number {
  const stage = frame.stage;
  if (!stage) return frame.shards.length;
  let count = 0;
  for (let i = 0; i < stage.slots.length; i++) {
    if (stage.slots[i].opacity <= 0.002) continue;
    count += stage.shell ? 1 : stage.layout.slots[i]?.count ?? 0;
  }
  return count;
}

/**
 * Owns the clock, the surface, and the backend. The director is deliberately
 * renderer-agnostic — it emits a declarative frame that either backend can
 * consume — so the fallback path shares all of the choreography.
 */
export class VizEngine {
  private readonly container: HTMLElement;
  /** Held by reference: the overlay mutates it in place, so a speed change
   *  takes effect on the next frame without touching the engine. */
  private config: VizConfig;
  private canvas: HTMLCanvasElement | null = null;
  private backend: BackendWithStats | null = null;
  private backendKind: BackendKind = "webgl";
  private readonly director: Director;
  private resizeObserver: ResizeObserver | null = null;
  private frameHandle = 0;
  private lastFrameTime = 0;
  private clock = 0;
  private running = false;
  private disposed = false;
  private fps = 60;
  private lastShardCount = 0;
  private featurePanelId: string | null = null;
  private nextFeatureCheck = 0;

  /** Fired when the panel carrying the frame changes, for the credit line. */
  onFeature: ((panel: Panel | null) => void) | null = null;
  onBackend: ((kind: BackendKind) => void) | null = null;

  constructor(
    container: HTMLElement,
    panels: Panel[],
    config: VizConfig,
    seed: number,
    forceCss = false
  ) {
    this.container = container;
    this.config = config;
    this.director = new Director(panels, config, new Rng(seed), deviceCaps());
    this.createBackend(forceCss);
    this.observeSize();
  }

  private createBackend(forceCss: boolean): void {
    const caps = deviceCaps();
    if (!forceCss) {
      try {
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
        this.container.appendChild(canvas);
        canvas.addEventListener("webglcontextlost", this.handleContextLost);
        this.canvas = canvas;
        this.backend = new WebGLBackend(canvas, caps);
        this.setBackendKind("webgl");
        return;
      } catch {
        this.canvas?.remove();
        this.canvas = null;
      }
    }
    this.backend = new CssBackend(this.container);
    this.setBackendKind("css");
  }

  /**
   * Only the WebGL backend can draw a formation — the fallback positions
   * `<img>` elements, which have no camera and no depth — so a spatial preset
   * degrades to the drift stack there. The director is told rather than the
   * backend left to ignore it, because the choice changes how many panels the
   * run keeps resident and which one the credit line names.
   */
  private setBackendKind(kind: BackendKind): void {
    this.backendKind = kind;
    this.director.setSpatialSupported(kind === "webgl");
    this.onBackend?.(kind);
  }

  private handleContextLost = (event: Event): void => {
    // Preventing the default is what makes a restore possible at all.
    event.preventDefault();
    this.stop();
    this.teardownBackend();
    if (this.disposed) return;
    // Come back on a fresh canvas rather than waiting on a restore that iOS
    // often never delivers.
    setTimeout(() => {
      if (this.disposed) return;
      this.createBackend(false);
      this.applySize();
      this.start();
    }, 250);
  };

  private observeSize(): void {
    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(this.container);
    this.applySize();
  }

  private applySize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.backend?.resize(width, height, 1);
    this.director.setAspect(width / height);
  }

  setConfig(config: VizConfig): void {
    this.config = config;
    this.director.setConfig(config);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private tick = (now: number): void => {
    if (!this.running || this.disposed || !this.backend) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    const seconds = now / 1000;
    const raw = this.lastFrameTime === 0 ? 1 / 60 : seconds - this.lastFrameTime;
    this.lastFrameTime = seconds;
    const dt = Math.min(Math.max(raw, 0), MAX_DT);
    // The clock is the only thing the speed control touches. Everything
    // downstream reads clock seconds, so nothing else has to know about it —
    // and because it scales the rate rather than the absolute time, shards
    // already in flight carry on from where they are instead of jumping.
    // `dt` stays real: the safety governor's limits are wall-clock limits.
    this.clock += dt * this.timeScale;

    // Smoothed, so the debug readout is legible rather than a strobe.
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.08;

    this.backend.requestPanels(this.director.prefetch());

    const frame = this.director.update(this.clock, dt);
    this.lastShardCount = drawCount(frame);
    this.backend.render(frame);

    if (this.clock >= this.nextFeatureCheck) {
      this.nextFeatureCheck = this.clock + 1;
      const panel = this.director.feature(this.clock);
      if ((panel?.id ?? null) !== this.featurePanelId) {
        this.featurePanelId = panel?.id ?? null;
        this.onFeature?.(panel);
      }
    }
  };

  /** Clamped here as well as in the UI, so a hand-written config cannot push
   *  the clock past the rate the safety floors were sized for. */
  private get timeScale(): number {
    const speed = this.config.speed;
    if (!Number.isFinite(speed)) return 1;
    return Math.min(VIZ_MAX_SPEED, Math.max(VIZ_MIN_SPEED, speed));
  }

  get stats(): EngineStats {
    const backendStats = this.backend?.stats ?? { resident: 0, pending: 0 };
    return {
      fps: this.fps,
      shards: this.lastShardCount,
      resident: backendStats.resident,
      pending: backendStats.pending,
      scene: this.director.sceneName,
      backend: this.backendKind,
    };
  }

  get usablePanelCount(): number {
    return this.director.panelCount;
  }

  private teardownBackend(): void {
    this.backend?.dispose();
    this.backend = null;
    this.canvas?.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas?.remove();
    this.canvas = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.teardownBackend();
  }
}
