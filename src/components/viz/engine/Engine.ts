import type { Panel } from "../../../types";
import type { DeviceCaps, StageMode, VizConfig } from "../vizConfig";
import { deviceCaps, VIZ_MAX_SPEED, VIZ_MIN_SPEED } from "../vizConfig";
import { Director } from "./Director";
import { Rng } from "./rng";
import { WebGLBackend } from "./backends/WebGLBackend";
import { CssBackend } from "./backends/CssBackend";
import type { VizBackend, VizFrame } from "./types";
import { CAST_MAX } from "./cast";
import type { AudioFrame, AudioReactor } from "./AudioReactor";
import type { AudioProbe } from "./audioTrace";

export type BackendKind = "webgl" | "css";

export interface EngineStats {
  fps: number;
  shards: number;
  resident: number;
  pending: number;
  scene: string;
  backend: BackendKind;
  /** Where the quality governor has settled the internal resolution. */
  renderScale: number;
}

interface BackendWithStats extends VizBackend {
  stats?: { resident: number; pending: number };
}

/** Returning to a hidden tab must not lurch the whole composition forward. */
const MAX_DT = 1 / 20;

/**
 * How long after a run starts — or after the governor last moved — before the
 * frame rate is worth believing, in real seconds.
 *
 * The opening seconds of a run are not representative of it: the shard and post
 * programs compile on the first frame, the spatial programs on the first
 * formation, and the first panels upload while all of that is happening. A
 * governor that sampled through any of it would read a stall as a device that
 * cannot keep up and cut the resolution of a run that was about to be fine.
 */
const GOVERNOR_GRACE = 2.5;
/** Seconds between governor decisions once it is past the grace period. */
const GOVERNOR_INTERVAL = 1;
/** Fraction of the target rate below which the governor gives up resolution. */
const GOVERNOR_DROP = 0.82;
/** And above which it starts taking it back. The gap between the two is what
 *  stops a device sitting exactly on the line from oscillating. */
const GOVERNOR_RAISE = 0.95;
/** Consecutive good samples before any is acted on. Asymmetric on purpose: a
 *  drop is a viewer watching a stutter now, a recovery can afford to be sure. */
const GOVERNOR_RAISE_SAMPLES = 4;
/** How far each step moves the scale. Down in bigger strides than up, so the
 *  governor reaches a rate that works quickly and creeps back rather than
 *  ping-ponging across the threshold it just crossed. */
const GOVERNOR_STEP_DOWN = 0.12;
const GOVERNOR_STEP_UP = 0.05;

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
  /**
   * The window the container lives in, which is not necessarily the window this
   * code is running in: the run can be portalled into a second window on
   * another display (see `useShowWindow`). Everything tied to a surface — the
   * frame clock, the elements, the size observer — is taken from here rather
   * than from the globals, so the run is paced by the display it is actually on
   * and stops when *that* window is hidden rather than when this one is.
   */
  private readonly view: Window;
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
  private castIds: string[] = [];
  private nextFeatureCheck = 0;
  private readonly caps: DeviceCaps;
  /** Live internal resolution, moved by `governQuality`. */
  private renderScale: number;
  /** Wall-clock seconds, of the same origin as `lastFrameTime`. */
  private governorNext = 0;
  private governorGood = 0;
  /** Real time of the last *drawn* frame, for the pacing cap. Separate from
   *  `lastFrameTime`, which a skipped frame deliberately does not advance. */
  private lastDrawTime = 0;
  /**
   * Live audio, or null when the run is not listening.
   *
   * Owned by the overlay rather than by this object, and handed in. An
   * `AudioContext` produces numbers rather than pixels, so it has no reason to
   * belong to the document the canvas is in — and this engine is rebuilt every
   * time the run changes windows, which would otherwise mean re-prompting for a
   * microphone on every `w` keypress.
   */
  private reactor: AudioReactor | null = null;
  /** Waiting on the next drawn frame. See `captureStill`. */
  private stillWaiting: ((blob: Blob | null) => void)[] = [];
  private stillMaxEdge = 2200;
  /** True when the capture is what restarted a paused run, and has to stop it. */
  private stillResumed = false;

  /** Fired when the panels carrying the frame change — most prominent first,
   *  for the credit line and the stack behind it. */
  onCast: ((panels: Panel[]) => void) | null = null;
  onBackend: ((kind: BackendKind) => void) | null = null;

  constructor(
    container: HTMLElement,
    panels: Panel[],
    config: VizConfig,
    seed: number,
    forceCss = false
  ) {
    this.container = container;
    this.view = container.ownerDocument.defaultView ?? window;
    this.config = config;
    this.caps = deviceCaps(this.view);
    this.renderScale = this.caps.renderScale;
    this.director = new Director(panels, config, new Rng(seed), this.caps);
    this.createBackend(forceCss);
    this.observeSize();
  }

  private createBackend(forceCss: boolean): void {
    const caps = this.caps;
    if (!forceCss) {
      try {
        const canvas = this.container.ownerDocument.createElement("canvas");
        canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
        this.container.appendChild(canvas);
        canvas.addEventListener("webglcontextlost", this.handleContextLost);
        this.canvas = canvas;
        const backend = new WebGLBackend(canvas, caps);
        this.backend = backend;
        // A backend rebuilt after a lost context comes up at the device
        // ceiling. Handing it back the scale the governor had already settled
        // on means the run does not have to relearn the device — and a context
        // lost under memory pressure is precisely the moment not to go back to
        // asking for the most.
        backend.setRenderScale(this.renderScale);
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
    this.view.setTimeout(() => {
      if (this.disposed) return;
      this.createBackend(false);
      this.applySize();
      this.start();
    }, 250);
  };

  private observeSize(): void {
    // The container's own realm, so a surface in another window is measured by
    // the observer that runs with that window's rendering rather than ours.
    const Observer =
      (this.view as Partial<Window & typeof globalThis>).ResizeObserver ?? ResizeObserver;
    const observer = new Observer(() => this.applySize());
    observer.observe(this.container);
    this.resizeObserver = observer;
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

  /**
   * Tell the run which path a switch is heading for, at the moment the reader
   * asks rather than when the config ramp delivers it — see
   * `Director.expectStage`. Purely a prefetch hint: nothing is drawn from it.
   */
  expectStage(kind: StageMode): void {
    this.director.expectStage(kind);
  }

  /**
   * Lock the run onto one panel, or let it run on. Held, every layer born from
   * here carries the same panel: the composition keeps moving, the imagery
   * stays put. See `Director.setFocus`.
   */
  setFocus(panel: Panel | null): void {
    this.director.setFocus(panel);
    // The cast is sampled once a clock second, which is fine for a run that
    // turns over on its own and far too slow to be the answer to a keypress.
    this.nextFeatureCheck = 0;
  }

  /** The panel the run would bring up next, for a step past the newest one seen. */
  nextPanel(): Panel | null {
    return this.director.nextPick();
  }

  /** Attach the run to a listener, or detach it. Re-attached after every
   *  rebuild, since the reactor outlives this object. */
  setAudioReactor(reactor: AudioReactor | null): void {
    this.reactor = reactor;
  }

  /** The last analysed frame, for the tuning panel's meters. Null while the
   *  run is not listening — which is the default and the common case. */
  get audio(): AudioFrame | null {
    return this.reactor?.active ? this.reactor.frame : null;
  }

  /**
   * Attach the reach readout, or detach it. Re-attached after every rebuild,
   * since the panel that owns it outlives this object the way the reactor does.
   */
  setAudioProbe(probe: AudioProbe | null): void {
    this.director.setAudioProbe(probe);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.lastDrawTime = 0;
    // Nothing measured across a stop is worth carrying over it: a paused run,
    // a backgrounded tab and a still capture all read as a stalled frame rate.
    this.governorNext = 0;
    this.governorGood = 0;
    this.frameHandle = this.view.requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) this.view.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private tick = (now: number): void => {
    if (!this.running || this.disposed || !this.backend) return;
    this.frameHandle = this.view.requestAnimationFrame(this.tick);

    const seconds = now / 1000;
    if (!this.shouldDraw(seconds)) return;

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
    this.governQuality(seconds);

    // Pulled here rather than pushed on a timer of its own, so the analysis
    // advances on exactly the frames the composition is drawn on. `dt` and not
    // the clock: the music does not follow the speed control.
    // Set per frame rather than on `setConfig`: the reactor outlives the engine
    // across a backend rebuild, so a value pushed once could be lost, and it is
    // a scalar assignment on a path that is already doing an FFT.
    this.reactor?.setLatency(this.config.audioLatency / 1000);
    this.director.setAudioFrame(this.reactor?.active ? this.reactor.sample(dt) : null);

    this.backend.requestPanels(this.director.prefetch());

    const frame = this.director.update(this.clock, dt);
    this.lastShardCount = drawCount(frame);
    this.backend.render(frame);

    // Read straight off the back of the draw, in the same task: the drawing
    // buffer is not preserved — asking for it would cost every frame of the run
    // a copy — so it is only readable before the compositor takes it away.
    if (this.stillWaiting.length > 0) this.takeStill();

    if (this.clock >= this.nextFeatureCheck) {
      this.nextFeatureCheck = this.clock + 1;
      // The order the stack is already showing is handed back in, so a sample
      // that finds the same panels at the same weights leaves them where they
      // are rather than re-sorting them under the reader's eye.
      const cast = this.director.cast(this.clock, CAST_MAX, this.castIds);
      const ids = cast.map((panel) => panel.id);
      if (ids.length !== this.castIds.length || ids.some((id, i) => id !== this.castIds[i])) {
        this.castIds = ids;
        this.onCast?.(cast);
      }
    }
  };

  /**
   * Frame pacing. See `DeviceCaps.maxFps`.
   *
   * A skipped frame leaves `lastFrameTime` alone, so the composition clock
   * advances by the interval that actually elapsed rather than losing the time
   * the skip covered — the run is drawn less often, not run slower.
   *
   * The 0.9 slack is what keeps a 60fps cap from halving itself on a 60Hz
   * display: callbacks arrive a fraction under the nominal interval often
   * enough that an exact comparison would reject every other one.
   */
  private shouldDraw(seconds: number): boolean {
    const maxFps = this.caps.maxFps;
    if (maxFps <= 0) return true;
    if (this.lastDrawTime === 0) {
      this.lastDrawTime = seconds;
      return true;
    }
    if (seconds - this.lastDrawTime < (1 / maxFps) * 0.9) return false;
    this.lastDrawTime = seconds;
    return true;
  }

  /**
   * Trade internal resolution for frame time, in both directions.
   *
   * The post chain is one long fragment program run over every pixel of the
   * frame, so resolution is the one parameter that buys frame time roughly in
   * proportion to itself — and the only one that can be moved without changing
   * what the composition *is*. Cutting effects, panels or motion to hit a rate
   * would make a phone show a different piece; cutting resolution makes it show
   * the same piece a little softer, under a filter chain that is already
   * screening and smearing it.
   *
   * Which also makes this the answer to thermal throttling rather than just to
   * slow devices: an iPhone that has been running the visualiser for five
   * minutes is not the device that started it, and a fixed scale chosen for
   * either one is wrong for the other.
   */
  private governQuality(seconds: number): void {
    if (!this.backend?.setRenderScale) return;
    if (this.governorNext === 0) {
      this.governorNext = seconds + GOVERNOR_GRACE;
      return;
    }
    if (seconds < this.governorNext) return;
    this.governorNext = seconds + GOVERNOR_INTERVAL;

    const target = this.caps.maxFps > 0 ? this.caps.maxFps : 60;
    const floor = this.caps.minRenderScale;
    const ceiling = this.caps.renderScale;

    if (this.fps < target * GOVERNOR_DROP && this.renderScale > floor) {
      this.governorGood = 0;
      this.setRenderScale(Math.max(floor, this.renderScale - GOVERNOR_STEP_DOWN));
      return;
    }

    if (this.fps > target * GOVERNOR_RAISE && this.renderScale < ceiling) {
      if (++this.governorGood < GOVERNOR_RAISE_SAMPLES) return;
      this.governorGood = 0;
      this.setRenderScale(Math.min(ceiling, this.renderScale + GOVERNOR_STEP_UP));
      return;
    }

    this.governorGood = 0;
  }

  private setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.backend?.setRenderScale?.(scale);
    // The step itself reallocates every target, which is a stall — and one that
    // would otherwise be the next sample's evidence that the device is still
    // too slow. Sit out a grace period rather than reading our own cost back.
    this.governorNext += GOVERNOR_GRACE - GOVERNOR_INTERVAL;
  }

  /**
   * A still of the frame currently on screen, for the page break to cut apart
   * on the way out. Null on the fallback backend, which has no canvas to read —
   * the break plays on plain black there.
   *
   * Resolved from inside the frame loop rather than here, because the pixels
   * only exist for the length of the task that drew them.
   */
  captureStill(maxEdge = 2200): Promise<Blob | null> {
    if (this.disposed || !this.canvas || this.backendKind !== "webgl") {
      return Promise.resolve(null);
    }
    this.stillMaxEdge = maxEdge;
    return new Promise<Blob | null>((resolve) => {
      this.stillWaiting.push(resolve);
      // A paused run is not drawing, so there would be nothing in the buffer to
      // read. One frame puts something there and leaves it paused.
      if (!this.running) {
        this.start();
        this.stillResumed = true;
      }
    });
  }

  private takeStill(): void {
    const waiting = this.stillWaiting.splice(0);
    if (this.stillResumed) {
      this.stillResumed = false;
      this.stop();
    }

    const canvas = this.canvas;
    if (!canvas || canvas.width < 1 || canvas.height < 1) {
      waiting.forEach((resolve) => resolve(null));
      return;
    }

    // Copied down to a flat 2D canvas first: the encode is the expensive half,
    // and the still is about to be flown off the screen in pieces.
    //
    // Deliberately *this* document rather than the surface's. When the run is
    // being shown in a second window, that window is about to close and the
    // still is what the page it was driven from breaks apart — so the blob has
    // to belong to the document that will still be there to look at it.
    const shrink = Math.min(1, this.stillMaxEdge / Math.max(canvas.width, canvas.height));
    const still = document.createElement("canvas");
    still.width = Math.max(1, Math.round(canvas.width * shrink));
    still.height = Math.max(1, Math.round(canvas.height * shrink));
    const ctx = still.getContext("2d");
    if (!ctx) {
      waiting.forEach((resolve) => resolve(null));
      return;
    }
    ctx.drawImage(canvas, 0, 0, still.width, still.height);
    still.toBlob((blob) => waiting.forEach((resolve) => resolve(blob)), "image/jpeg", 0.9);
  }

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
      renderScale: this.renderScale,
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
    // Anything waiting on a frame that will now never be drawn.
    this.stillWaiting.splice(0).forEach((resolve) => resolve(null));
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.teardownBackend();
  }
}
