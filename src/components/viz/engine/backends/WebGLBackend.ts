import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from "ogl";
import type { OGLRenderingContext } from "ogl";
import type { Panel } from "../../../../types";
import type { DrawShard, StageFrame, Vec3, VizBackend, VizFrame } from "../types";
import { blendCode } from "../types";
import { TexturePool } from "../TexturePool";
import { FULLSCREEN_VERT } from "../shaders/common";
import { HANDOVER_FRAGMENT } from "../shaders/handover";
import { compositeFragment } from "../shaders/layer";
import { FOLD_ITERS, POST_FRAGMENT } from "../shaders/post";
import { SpatialPass } from "./SpatialPass";
import { FieldPass } from "./FieldPass";
import type { DeviceCaps } from "../../vizConfig";
import { juliaFrame } from "../julia";

type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

function vec4(): Vec4 {
  return [0, 0, 0, 0];
}

/** Frames between ring captures while slit-scan is *not* running — see
 *  `captureHistory`. One means every frame, which is what it was. */
const HISTORY_IDLE_STRIDE = 3;

/**
 * Frames drawn before the warm-up starts pulling programs forward — see `warm`.
 *
 * Not zero, because the opening frames have costs of their own that should not
 * be competing with these: the composite and post programs make their first
 * draw, which is where a driver that deferred their real compilation does it,
 * and the first panels are landing at one upload a frame. A couple of frames of
 * clearance puts the warm-up after that and still nowhere near the moment a
 * preset switch would otherwise trigger it.
 */
const WARM_FIRST_FRAME = 3;

/** Identity tone levels, so an untouched slot is a pass-through rather than a
 *  black one — unlike the vec4 uniforms, zero is not the neutral value here. */
function unitLevels(): Vec2 {
  return [1, 0];
}

/**
 * WebGL2 backend.
 *
 * Per frame:
 *   composite(shards, base) -> targetA        (batched; ping-pongs if > cap)
 *   post(composite, feedback) -> screen
 *   copyTexSubImage2D(screen) -> feedback     for the next frame's trails
 *
 * The feedback capture is a GPU-side copy off the default framebuffer rather
 * than a fourth render pass, which is why there is no separate feedback FBO.
 *
 * A frame carrying a `stage` swaps the first line for `SpatialPass` — quads in
 * a real projection rather than shards on a flat one — and leaves the rest
 * exactly as it is. That is the point of routing it through a texture: the
 * whole post chain, feedback included, lands on a formation without knowing
 * that formations exist.
 *
 * The one thing that texture cannot hide is the moment the frame changes which
 * of the two produced it, since neither path has any idea the other exists. A
 * frame carrying a `handover` therefore inserts one more line before post,
 * dissolving the still of the outgoing path over the incoming one — see
 * `applyHandover`.
 */
export class WebGLBackend implements VizBackend {
  private readonly renderer: Renderer;
  private readonly gl: OGLRenderingContext;
  private readonly pool: TexturePool;
  private readonly compositeProgram: Program;
  private readonly compositeMesh: Mesh;
  private readonly postProgram: Program;
  private readonly postMesh: Mesh;
  private targets: [RenderTarget, RenderTarget];
  private feedback: Texture;
  /** Which of `targets` the shard path last composited into, so the crossing can
   *  pick the other one to write its mix into. Null on a spatial frame, whose
   *  scene texture belongs to the spatial pass and leaves both free. */
  private sceneTarget: RenderTarget | null = null;
  /**
   * The crossing between paths: a still of the outgoing one, and the program
   * that both takes it and reads it back. All three are built on the first
   * switch and never on a run that stays on one preset, which is the same
   * bargain the spatial pass makes one field down.
   */
  private handoverProgram: Program | null = null;
  private handoverMesh: Mesh | null = null;
  private snapshot: RenderTarget | null = null;
  /** Whether `snapshot` holds a frame rather than the black it was born with. */
  private captured = false;
  private readonly geometry: Triangle;
  /** Scene textures currently carrying a mip chain — see `syncSceneMips`. */
  private readonly mipped = new Set<Texture>();
  /**
   * The lazily-built programs, in the order the warm-up pulls them forward, one
   * per frame — see `warm`. Drained by `shift`, so an empty queue is a run that
   * has nothing left to build.
   *
   * Ordered by how abruptly the frame that would otherwise build them arrives.
   * The crossing is first because it is the only one whose own frame is a
   * dissolve already underway — a stall there is a visible hitch *in* the effect
   * that exists to hide the change of path.
   */
  private readonly warmQueue: Array<() => void> = [
    () => this.ensureHandover(),
    () => this.ensureSpatial(),
    () => this.spatial?.warmSurface(),
    () => this.spatial?.warmShell(),
  ];
  /** Frames drawn, counted only until the warm queue is empty. */
  private frames = 0;
  /** Frames since the last ring capture — see `captureHistory`. */
  private historyIdle = 0;
  /**
   * Reused across frames by `renderShards` and `renderStage`.
   *
   * The draw itself allocated nothing, but assembling it allocated a great deal:
   * a filter, a map and a slice per batch, and then five fresh arrays for every
   * shard — sixty-odd objects a frame, which at thirty frames a second is a
   * couple of thousand a second of pure garbage. None of it is a spike big
   * enough to drop a frame on its own; together it is a steady minor-GC pressure
   * that on a phone's small nursery arrives as periodic jitter — and jitter is
   * the one thing the quality governor cannot see, since it reads a smoothed
   * rate that a brief collection barely moves.
   */
  private readonly drawable: DrawShard[] = [];
  private readonly pinnedIds: string[] = [];
  private readonly maxShards: number;
  /**
   * Built on the first spatial frame, not in the constructor. Two reasons, and
   * the second is the important one: a run that never leaves the flat presets
   * should not pay for two shader compiles it will never use, and a failure to
   * build the spatial programs must not take the flat path down with it.
   */
  private spatial: SpatialPass | null = null;
  private spatialFailed = false;
  /**
   * The buffers behind bloom, slit-scan, the flow field and the reaction. Built
   * here rather than lazily like the spatial pass, because it is itself lazy —
   * the object allocates nothing until a frame asks for one of its four
   * families, so a run that never leaves the calm presets pays for a class
   * instance and no GPU memory at all.
   */
  private readonly fields: FieldPass;

  private width = 1;
  private height = 1;
  private aspect = 1;
  private disposed = false;
  /** Live internal-resolution multiplier. Starts at `caps.renderScale` and is
   *  moved by the engine's governor; `caps.renderScale` stays the ceiling. */
  private renderScale: number;
  /** Last CSS size seen, so a scale change can re-derive the buffers without
   *  waiting for the container to move. */
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(canvas: HTMLCanvasElement, private readonly caps: DeviceCaps) {
    this.renderer = new Renderer({
      canvas,
      dpr: caps.renderScale,
      alpha: false,
      antialias: false,
      depth: false,
      // Every pass writes every pixel, so clearing is pure bandwidth cost.
      autoClear: false,
      powerPreference: "high-performance",
    });
    this.gl = this.renderer.gl;
    if (!this.renderer.isWebgl2) {
      throw new Error("WebGL2 unavailable");
    }

    this.maxShards = caps.maxShardsPerPass;
    this.renderScale = caps.renderScale;
    this.pool = new TexturePool(this.gl, caps.texturePoolSize, caps.textureMaxEdge);

    const geometry = new Triangle(this.gl);
    this.geometry = geometry;

    this.compositeProgram = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: compositeFragment(this.maxShards),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: new Array(this.maxShards).fill(this.pool.blank) },
        uBase: { value: this.pool.blank },
        uUseBase: { value: 0 },
        uBackground: { value: [0, 0, 0] },
        uAspect: { value: 1 },
        uCount: { value: 0 },
        uRect: { value: Array.from({ length: this.maxShards }, vec4) },
        uSrc: { value: Array.from({ length: this.maxShards }, vec4) },
        uMisc: { value: Array.from({ length: this.maxShards }, vec4) },
        uLevels: { value: Array.from({ length: this.maxShards }, unitLevels) },
        uTint: { value: Array.from({ length: this.maxShards }, vec4) },
        uMode: { value: new Array(this.maxShards).fill(0) },
      },
    });
    this.compositeMesh = new Mesh(this.gl, { geometry, program: this.compositeProgram });

    this.postProgram = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: POST_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: this.pool.blank },
        uFeedback: { value: this.pool.blank },
        uBloomTex: { value: this.pool.blank },
        uFlowTex: { value: this.pool.blank },
        uReactTex: { value: this.pool.blank },
        uHistory: { value: this.pool.blank },
        uResolution: { value: [1, 1] },
        uFieldResolution: { value: [1, 1] },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uFeedbackAmount: { value: 0 },
        uFeedbackScale: { value: 1 },
        uFeedbackRotate: { value: 0 },
        uFeedbackDroste: { value: 0 },
        uHalftone: { value: 0 },
        uHalftoneFreq: { value: [1, 1] },
        uChroma: { value: 0 },
        uPosterize: { value: 0 },
        uVignette: { value: 0 },
        uExposure: { value: 1 },
        uHueShift: { value: 0 },
        uShoulder: { value: 1 },
        uPane: { value: 0 },
        uPaneGrid: { value: 2 },
        uPaneBreathe: { value: 0 },
        uPanePhase: { value: 0 },
        uKaleido: { value: 0 },
        uKaleidoSegments: { value: 6 },
        uKaleidoPhase: { value: 0 },
        uTile: { value: 0 },
        uWarp: { value: 0 },
        uWarpScale: { value: 2.4 },
        uWarpSpeed: { value: 0.35 },
        uRipple: { value: 0 },
        uRippleFreq: { value: 16 },
        uPond: { value: 0 },
        uPondFreq: { value: 12 },
        uPondSources: { value: 3 },
        uPondReach: { value: 0.45 },
        uPondBurst: { value: 0 },
        uPondSwirl: { value: 0 },
        uPondPhase: { value: 0 },
        uPondSeed: { value: 0 },
        uTwist: { value: 0 },
        uBulge: { value: 0 },
        uSolarize: { value: 0 },
        uDroste: { value: 0 },
        uDrosteInner: { value: 0.06 },
        uDrostePeriod: { value: 1.9 },
        uDrosteTwist: { value: 0 },
        uDrostePhase: { value: 0 },
        uTunnel: { value: 0 },
        uTunnelDepth: { value: 0.35 },
        uTunnelPhase: { value: 0 },
        uFold: { value: 0 },
        uFoldScale: { value: 1.22 },
        uFoldOffset: { value: [0.62, 0.34] },
        uFoldPhase: { value: 0 },
        uFoldNorm: { value: 1 },
        uLattice: { value: 0 },
        uLatticeScale: { value: 3 },
        uJulia: { value: 0 },
        uJuliaZoom: { value: 1.1 },
        uJuliaM: { value: [0, 0] },
        uJuliaBeta: { value: [1, 0] },
        uJuliaStep: { value: [1, 0] },
        uJuliaWarp: { value: [0, 0] },
        uJuliaWarp3: { value: [0, 0] },
        uJuliaTrap: { value: 0.5 },
        uJuliaSpread: { value: 0.8 },
        uJuliaAnchor: { value: 0 },
        uJuliaBind: { value: 0 },
        uJuliaDepth: { value: 0 },
        uJuliaEdge: { value: 0 },
        uJuliaFacet: { value: 0 },
        uJuliaPlate: { value: 0 },
        uJuliaPlateFold: { value: 0 },
        uJuliaChunk: { value: 0 },
        uJuliaChunkGrid: { value: 0 },
        uJuliaCenter: { value: [0, 0] },
        uQuasi: { value: 0 },
        uQuasiFreq: { value: 14 },
        uTurbulence: { value: 0 },
        uTurbulenceScale: { value: 2.2 },
        uTurbulenceSpeed: { value: 0.12 },
        uDeck: { value: 0 },
        uDeckDepth: { value: 3 },
        uDeckSpread: { value: 0.08 },
        uDeckTurn: { value: 0.12 },
        uDeckSeed: { value: 0 },
        uMobius: { value: 0 },
        uMobiusShift: { value: 0.28 },
        uMobiusPhase: { value: 0 },
        uRelief: { value: 0 },
        uReliefLevel: { value: 5 },
        uReliefPhase: { value: 0 },
        uContour: { value: 0 },
        uContourBands: { value: 7 },
        uKeyplate: { value: 0 },
        uKeyplateLevel: { value: 4 },
        uMelt: { value: 0 },
        uMeltLevel: { value: 6 },
        uMeltAngle: { value: Math.PI / 2 },
        uWake: { value: 0 },
        uWakeSpread: { value: 0.25 },
        uWakeLead: { value: 0 },
        uCaustics: { value: 0 },
        uCausticsScale: { value: 3.4 },
        uCausticsSpeed: { value: 0.05 },
        uNeon: { value: 0 },
        uNeonHue: { value: 0.55 },
        uNeonSpread: { value: 0.5 },
        uNeonWidth: { value: 1.6 },
        uSheen: { value: 0 },
        uSheenBands: { value: 3.5 },
        uSheenDrift: { value: 0.02 },
        uDisperse: { value: 0 },
        uBlur: { value: 0 },
        uBlurSpin: { value: 0 },
        uBloom: { value: 0 },
        uBloomThreshold: { value: 0.68 },
        uFlow: { value: 0 },
        uReact: { value: 0 },
        uSlit: { value: 0 },
        uSlitAxis: { value: 0 },
        uSlitLuma: { value: 0 },
        uSlitDepth: { value: 0.6 },
        uHistoryGrid: { value: [1, 1] },
        uHistoryCount: { value: 1 },
        uHistoryCursor: { value: 0 },
        uMisreg: { value: 0 },
        uMisregSpread: { value: 0.006 },
        uMoire: { value: 0 },
        uMoireSpread: { value: 0.09 },
        uBenday: { value: 0 },
        uKrackle: { value: 0 },
        uKrackleScale: { value: 26 },
        uKrackleThreshold: { value: 0.62 },
        uBleed: { value: 0 },
        uBleedRadius: { value: 1.6 },
        uPaper: { value: 0 },
      },
    });
    this.postMesh = new Mesh(this.gl, { geometry, program: this.postProgram });

    this.fields = new FieldPass(this.renderer, geometry, this.pool.blank, caps.reactSteps);
    this.targets = [this.makeTarget(1, 1), this.makeTarget(1, 1)];
    this.feedback = this.makeFeedback(1, 1);
  }

  /** Null once, and null for good, if the spatial programs will not build. */
  private ensureSpatial(): SpatialPass | null {
    if (this.spatial || this.spatialFailed) return this.spatial;
    try {
      this.spatial = new SpatialPass(this.renderer);
      this.spatial.resize(this.width, this.height);
    } catch (error) {
      this.spatialFailed = true;
      console.error("viz: spatial pass unavailable", error);
    }
    return this.spatial;
  }

  private makeTarget(width: number, height: number): RenderTarget {
    return new RenderTarget(this.gl, {
      width,
      height,
      depth: false,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
    });
  }

  private makeFeedback(width: number, height: number): Texture {
    const texture = new Texture(this.gl, {
      width,
      height,
      // Must match the default framebuffer, which has no alpha plane —
      // copyTexSubImage2D rejects a destination with components the source
      // lacks.
      format: this.gl.RGB,
      internalFormat: this.gl.RGB,
      generateMipmaps: false,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
      wrapS: this.gl.CLAMP_TO_EDGE,
      wrapT: this.gl.CLAMP_TO_EDGE,
      flipY: false,
    });
    texture.update();
    return texture;
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.renderer.dpr = this.renderScale;
    this.renderer.setSize(width, height);
    // Floored rather than rounded so these agree exactly with the drawing
    // buffer ogl just sized, which truncates — a one-pixel disagreement would
    // put `uResolution` and the viewport out of step with the framebuffer.
    const nextWidth = Math.max(1, Math.floor(width * this.renderScale));
    const nextHeight = Math.max(1, Math.floor(height * this.renderScale));
    // A resize that lands on the same buffer size is anything but free — it
    // reallocates every target and rebuilds the history atlas. The observer
    // fires on sub-pixel container changes and on every mount of the chrome
    // around the surface, so the early return is what keeps a layout nudge from
    // being a dropped frame.
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.aspect = this.width / this.height;
    for (const target of this.targets) target.setSize(this.width, this.height);
    // Resized with the rest, and its contents dropped: a still of the frame at
    // the old size is not a still of this one, and a crossing that has lost what
    // it was crossing against should fall back to the cut rather than dissolve
    // out of a black buffer.
    this.snapshot?.setSize(this.width, this.height);
    this.captured = false;
    this.spatial?.resize(this.width, this.height);
    this.fields.resize(this.width, this.height);
    this.gl.deleteTexture(this.feedback.texture);
    this.feedback = this.makeFeedback(this.width, this.height);
  }

  /**
   * Move the internal resolution without touching the CSS size — the canvas
   * keeps filling the container and the compositor upscales what it is given.
   *
   * Clamped to the device ceiling so a governor cannot supersample a phone past
   * what its caps allow, and no-ops on a scale that rounds to the same buffer,
   * so a governor nudging by hundredths does not reallocate on every step.
   */
  setRenderScale(scale: number): void {
    if (this.disposed) return;
    const next = Math.min(this.caps.renderScale, Math.max(0.25, scale));
    if (Math.abs(next - this.renderScale) < 1e-4) return;
    this.renderScale = next;
    this.resize(this.cssWidth, this.cssHeight);
  }

  isReady(panelId: string): boolean {
    return this.pool.has(panelId);
  }

  requestPanels(panels: Panel[]): void {
    for (const panel of panels) this.pool.request(panel);
  }

  render(frame: VizFrame): void {
    if (this.disposed) return;
    // Ahead of the draw, so a panel that lands this frame is drawable this
    // frame — and metered, so a burst of decodes finishing together is spread
    // across frames instead of blocking one of them.
    this.pool.flush(this.caps.uploadsPerFrame);
    const spatial = frame.stage ? this.ensureSpatial() : null;
    // Without the spatial pass the shard path still runs, and a spatial frame
    // carries no shards — so the degraded result is the background, not a
    // stalled frame or a half-drawn one.
    const scene =
      spatial && frame.stage
        ? this.renderStage(spatial, frame.stage, frame.background)
        : this.renderShards(frame);
    // Ahead of the fields, not after them: the trail, the bloom and the reaction
    // are all seeded from the composite, and seeding them from the incoming path
    // alone would put a hard cut through every one of them under a crossing that
    // has none.
    const composed = this.applyHandover(frame, scene);
    // Between the scene and post, so the buffers post reads are this frame's
    // rather than the last one's — the reaction in particular is seeded from the
    // composite, and a frame late would have it chasing a picture that has
    // already moved on.
    this.fields.update(frame.post, composed, frame.flowAngle, frame.time);
    this.renderPost(frame, composed);
    // Last, so a compile that overruns lands after this frame has been handed
    // over rather than in front of it.
    this.warm();
  }

  /**
   * Build one lazily-built program per frame, over the opening of a run.
   *
   * Everything in the queue is built on the first frame that needs it, which is
   * the right call for memory — a run that never leaves the flat presets should
   * not allocate the spatial pass — and the wrong one for timing. ogl reads
   * LINK_STATUS as soon as it links, so every one of these is a synchronous
   * stall of tens to hundreds of milliseconds, and the frame it lands on is
   * never an idle one: it is the frame a formation arrives on, or the frame a
   * crossing between the two paths begins. That is a dropped frame exactly where
   * the composition is doing something.
   *
   * Pulling them forward does not raise the average rate at all. What it does is
   * move the stalls to the opening seconds, where the frame is fading up out of
   * nothing and the quality governor is still inside GOVERNOR_GRACE — which is
   * to say, to the one moment in a run where a hitch has nothing to interrupt
   * and no consequence beyond itself.
   *
   * One per frame rather than all four at once: four compiles in a single task
   * is a freeze at the very start of the run, and the whole point is to spend
   * this where it does not read as one.
   *
   * Only the programs, and deliberately not the buffers behind them. The spatial
   * pass's target and every field in `FieldPass` stay lazy, because those are
   * megabytes on a device whose context is lost when it runs out of them — and
   * unlike a compile, an allocation on the frame that needs it is not a stall
   * worth pre-paying for.
   */
  private warm(): void {
    if (this.warmQueue.length === 0) return;
    if (++this.frames < WARM_FIRST_FRAME) return;
    this.warmQueue.shift()!();
  }

  /**
   * Cross the frame against the path it replaced.
   *
   * Two jobs on one program. On the capture frame a still is taken of the last
   * frame the outgoing path drew; on every frame after it that still is mixed
   * back over the incoming scene at a weight the director decays to nothing.
   *
   * Before post rather than after it, so the crossing happens in the frame's own
   * colours and every effect in the chain then lands on the result. Post is
   * still ramping between the two presets while this runs, and a crossing done
   * downstream of it would be two pictures that had each been through a
   * different half of that ramp.
   */
  private applyHandover(frame: VizFrame, scene: Texture): Texture {
    const handover = frame.handover;
    if (!handover) return scene;
    const program = this.ensureHandover();
    const mesh = this.handoverMesh;
    const snapshot = this.ensureSnapshot();
    // Nothing to cross with. The cut is what the run had before this existed, so
    // it is also the right thing to degrade to.
    if (!program || !mesh || !snapshot) return scene;

    // Whichever of the pair the shard path did not just composite into. On a
    // spatial frame it never touched either.
    const write = this.targets[this.sceneTarget === this.targets[0] ? 1 : 0];

    // The crossing already running, if there is one. Done before the capture
    // below rather than after it, so a switch made inside another switch is
    // stilled as the viewer is seeing it — see `Director.handover`.
    let composed = scene;
    if (this.captured && handover.mix > 0) {
      program.uniforms.uScene.value = scene;
      program.uniforms.uPrev.value = snapshot.texture;
      program.uniforms.uMix.value = handover.mix;
      this.renderer.render({ scene: mesh, target: write, frustumCull: false });
      composed = write.texture;
    }

    if (handover.capture) {
      // Through the same program at a mix of nothing, which is a copy: the still
      // is written by exactly the path it will be read back through, so a
      // crossing that has run a full cycle is reading its own output format
      // rather than something a second code path produced.
      program.uniforms.uScene.value = composed;
      program.uniforms.uPrev.value = composed;
      program.uniforms.uMix.value = 0;
      this.renderer.render({ scene: mesh, target: snapshot, frustumCull: false });
      this.captured = true;
    }

    return composed;
  }

  private ensureHandover(): Program | null {
    if (!this.handoverProgram) {
      this.handoverProgram = new Program(this.gl, {
        vertex: FULLSCREEN_VERT,
        fragment: HANDOVER_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uScene: { value: this.pool.blank },
          uPrev: { value: this.pool.blank },
          uMix: { value: 0 },
        },
      });
      this.handoverMesh = new Mesh(this.gl, {
        geometry: this.geometry,
        program: this.handoverProgram,
      });
    }
    return this.handoverProgram;
  }

  private ensureSnapshot(): RenderTarget | null {
    if (!this.snapshot) this.snapshot = this.makeTarget(this.width, this.height);
    return this.snapshot;
  }

  /** The spatial path. Returns the texture post should read. */
  private renderStage(spatial: SpatialPass, stage: StageFrame, background: Vec3): Texture {
    // A slot holds its panel for a whole dwell, so the pin set is simply
    // everything the formation is bound to — including the panels whose slots
    // are momentarily faded out, which are about to come back up. Gathered into
    // the same reused buffer the flat path uses; only one of the two runs on any
    // given frame.
    const pinned = this.pinnedIds;
    pinned.length = 0;
    for (const slot of stage.slots) pinned.push(slot.panelId);
    for (const solid of stage.solids) pinned.push(solid.panelId);
    this.pool.setPinned(pinned);
    // The formation renders into the spatial pass's own target, so both of the
    // composite targets are free for a crossing to mix into.
    this.sceneTarget = null;
    return spatial.render(stage, background, this.pool);
  }

  /**
   * The flat path: N shards blended onto a base, batched.
   *
   * Every array here is reused across frames — see `drawable`. ogl's own
   * redundancy cache clones what it is handed rather than holding a reference to
   * it, so mutating the uniform values in place is seen as a change and uploaded
   * exactly as a fresh array was.
   */
  private renderShards(frame: VizFrame): Texture {
    // Only shards whose texture has finished decoding can be drawn; the rest
    // are simply skipped this frame and appear once they land.
    const drawable = this.drawable;
    const pinned = this.pinnedIds;
    drawable.length = 0;
    pinned.length = 0;
    for (const shard of frame.shards) {
      if (shard.opacity <= 0.001 || !this.pool.has(shard.panelId)) continue;
      drawable.push(shard);
      pinned.push(shard.panelId);
    }
    this.pool.setPinned(pinned);

    const uniforms = this.compositeProgram.uniforms;
    uniforms.uAspect.value = this.aspect;
    uniforms.uBackground.value = frame.background;

    let read: RenderTarget | null = null;
    let write = this.targets[0];

    const batches = Math.max(1, Math.ceil(drawable.length / this.maxShards));
    for (let batch = 0; batch < batches; batch++) {
      const start = batch * this.maxShards;
      const count = Math.max(0, Math.min(this.maxShards, drawable.length - start));

      for (let i = 0; i < this.maxShards; i++) {
        if (i >= count) {
          uniforms.uMisc.value[i][2] = 0;
          uniforms.uTex.value[i] = this.pool.blank;
          continue;
        }
        const shard = drawable[start + i];
        const texture = this.pool.get(shard.panelId) ?? this.pool.blank;
        const { dstRect, srcRect } = shard;

        uniforms.uTex.value[i] = texture;
        const rect = uniforms.uRect.value[i];
        rect[0] = dstRect.x + dstRect.w / 2;
        rect[1] = dstRect.y + dstRect.h / 2;
        rect[2] = dstRect.w;
        rect[3] = dstRect.h;

        const src = uniforms.uSrc.value[i];
        src[0] = srcRect.x;
        src[1] = srcRect.y;
        src[2] = srcRect.w;
        src[3] = srcRect.h;

        const misc = uniforms.uMisc.value[i];
        misc[0] = Math.cos(shard.rotation);
        misc[1] = Math.sin(shard.rotation);
        misc[2] = shard.opacity;
        misc[3] = shard.feather;

        const levels = uniforms.uLevels.value[i];
        levels[0] = shard.levels.gain;
        levels[1] = shard.levels.lift;

        const tint = uniforms.uTint.value[i];
        tint[0] = shard.tint[0];
        tint[1] = shard.tint[1];
        tint[2] = shard.tint[2];
        tint[3] = shard.tintAmount;

        uniforms.uMode.value[i] = blendCode(shard.blendMode);
      }

      uniforms.uCount.value = count;
      uniforms.uBase.value = read ? read.texture : this.pool.blank;
      uniforms.uUseBase.value = read ? 1 : 0;

      this.renderer.render({ scene: this.compositeMesh, target: write, frustumCull: false });

      read = write;
      write = this.targets[read === this.targets[0] ? 1 : 0];
    }

    this.sceneTarget = read;
    return read!.texture;
  }

  /**
   * Whether the scene texture needs a mip chain this frame, and building or
   * retiring one.
   *
   * Only the Julia map asks for it. That map compresses whole regions of the
   * page into a filament a pixel wide, and a single bilinear tap of a 1080-line
   * frame at that rate is one arbitrary texel out of thousands — which changes
   * completely from frame to frame as the figure drifts, so the fractal's own
   * structure arrives as a boiling sparkle rather than as a picture. A chain
   * turns that into the *average* of the region, which is what the eye reads as
   * fine detail resolving.
   *
   * Built here rather than at construction because a chain costs a full extra
   * pass over the frame every time it is regenerated, and only one preset in the
   * engine has any use for it. It is retired again on the way out, and that part
   * matters more than it looks: a texture left on a mip filter with a stale chain
   * is not merely slower, it is *wrong* — the next preset to minify the frame,
   * `tile` above all, would read levels last written several seconds ago.
   *
   * ogl's own texture path cannot do either half of this. Its RenderTarget
   * hardcodes `generateMipmaps: false`, and asking the Texture to reapply its
   * filters routes through `update()`, which for a render target re-uploads a
   * null image — that is, throws away the frame just rendered into it. So the
   * two GL calls are made directly, with `bind()` used to keep ogl's own idea of
   * which texture is bound on unit 0 honest.
   */
  private syncSceneMips(scene: Texture, wanted: boolean): void {
    const gl = this.gl;
    if (wanted) {
      this.renderer.activeTexture(0);
      scene.bind();
      gl.generateMipmap(gl.TEXTURE_2D);
      if (scene.minFilter !== gl.LINEAR_MIPMAP_LINEAR) {
        this.setMinFilter(scene, gl.LINEAR_MIPMAP_LINEAR);
        this.mipped.add(scene);
      }
      return;
    }

    // Every texture that was ever put on a mip filter, not merely the one this
    // frame happens to be reading. The shard path ping-pongs between two targets
    // and the spatial path has a third, so which texture arrives here changes
    // with the batch count and the mode — and a target left behind on a mip
    // filter is one whose chain stops being regenerated while it is still being
    // sampled from.
    if (this.mipped.size === 0) return;
    for (const texture of this.mipped) {
      this.renderer.activeTexture(0);
      texture.bind();
      this.setMinFilter(texture, gl.LINEAR);
    }
    this.mipped.clear();
  }

  /** Sets the filter through GL and keeps ogl's two copies of it in step, so a
   *  later `update()` — which a render target never takes, but which is one line
   *  away from being taken — does not quietly set it back. */
  private setMinFilter(texture: Texture, filter: number): void {
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, filter);
    texture.minFilter = filter;
    texture.state.minFilter = filter;
  }

  /** The post chain, over whichever path produced the scene texture. */
  private renderPost(frame: VizFrame, scene: Texture): void {
    const post = this.postProgram.uniforms;
    const fields = this.fields.textures;
    // Four effects read the frame at a level other than its own: the fractal, at
    // whatever rate its orbit is compressing by; the melt, at the level its
    // grain names; the keyplate, at the level it splits the drawing from the
    // colour on; and the relief, at the grain of its terrain. Any one of them
    // needs the chain, and between them this is no longer a single-preset cost —
    // three are in the cycler's pool, so any run with psychedelia up can ask for
    // it, and a run in a liquid or a light movement will ask often.
    this.syncSceneMips(
      scene,
      frame.post.julia > 0 ||
        frame.post.melt > 0 ||
        frame.post.keyplate > 0 ||
        frame.post.relief > 0
    );
    post.uScene.value = scene;
    post.uFeedback.value = this.feedback;
    post.uBloomTex.value = fields.bloom;
    post.uFlowTex.value = fields.flow;
    post.uReactTex.value = fields.react;
    post.uHistory.value = fields.history;
    post.uResolution.value = [this.width, this.height];
    post.uFieldResolution.value = this.fields.fieldResolution;
    post.uAspect.value = this.aspect;
    post.uTime.value = frame.time;
    post.uFeedbackAmount.value = frame.post.feedbackAmount;
    post.uFeedbackScale.value = frame.post.feedbackScale;
    post.uFeedbackRotate.value = frame.post.feedbackRotate;
    post.uFeedbackDroste.value = frame.post.feedbackDroste;
    post.uHalftone.value = frame.post.halftone;
    // Screen frequency derives from the render resolution, not from pixels, so
    // dropping the internal resolution on mobile does not introduce moire.
    const cells = 90 / Math.max(0.2, frame.post.halftoneScale);
    post.uHalftoneFreq.value = [cells * this.aspect, cells];
    post.uChroma.value = frame.post.chroma;
    post.uPosterize.value = frame.post.posterize;
    post.uVignette.value = frame.post.vignette;
    post.uExposure.value = frame.post.exposure;
    post.uHueShift.value = frame.post.hueShift;
    post.uShoulder.value = frame.post.shoulder;
    post.uPane.value = frame.post.pane;
    post.uPaneGrid.value = frame.post.paneGrid;
    post.uPaneBreathe.value = frame.post.paneBreathe;
    post.uPanePhase.value = frame.phases.pane;
    post.uKaleido.value = frame.post.kaleido;
    post.uKaleidoSegments.value = frame.post.kaleidoSegments;
    post.uKaleidoPhase.value = frame.phases.kaleido;
    post.uTile.value = frame.post.tile;
    post.uWarp.value = frame.post.warp;
    post.uWarpScale.value = frame.post.warpScale;
    post.uWarpSpeed.value = frame.post.warpSpeed;
    post.uRipple.value = frame.post.ripple;
    post.uRippleFreq.value = frame.post.rippleFreq;
    post.uPond.value = frame.post.pond;
    post.uPondFreq.value = frame.post.pondFreq;
    // Floored to a whole source here rather than in the shader: the loop takes
    // this as a bound, and a preset sliding the slider should add a drop at the
    // moment the number says so instead of half a frame either side of it.
    post.uPondSources.value = Math.floor(frame.post.pondSources);
    post.uPondReach.value = frame.post.pondReach;
    post.uPondBurst.value = frame.post.pondBurst;
    post.uPondSwirl.value = frame.post.pondSwirl;
    post.uPondPhase.value = frame.phases.pond;
    post.uPondSeed.value = frame.post.pondSeed;
    post.uTwist.value = frame.post.twist;
    post.uBulge.value = frame.post.bulge;
    post.uSolarize.value = frame.post.solarize;
    post.uDroste.value = frame.post.droste;
    post.uDrosteInner.value = frame.post.drosteInner;
    post.uDrostePeriod.value = frame.post.drostePeriod;
    post.uDrosteTwist.value = frame.post.drosteTwist;
    post.uDrostePhase.value = frame.phases.droste;
    post.uTunnel.value = frame.post.tunnel;
    post.uTunnelDepth.value = frame.post.tunnelDepth;
    post.uTunnelPhase.value = frame.phases.tunnel;
    post.uFold.value = frame.post.fold;
    post.uFoldScale.value = frame.post.foldScale;
    post.uFoldOffset.value = [frame.post.foldOffsetX, frame.post.foldOffsetY];
    post.uFoldPhase.value = frame.phases.fold;
    // The iterated zoom compounds, so the point has to be brought back into
    // the stage by exactly what the loop multiplied it by — derived here rather
    // than recomputed per pixel, same as uHalftoneFreq.
    post.uFoldNorm.value = 1 / Math.pow(Math.max(1, frame.post.foldScale), FOLD_ITERS);
    post.uLattice.value = frame.post.lattice;
    post.uLatticeScale.value = frame.post.latticeScale;
    post.uJulia.value = frame.post.julia;
    post.uJuliaZoom.value = frame.post.juliaZoom;
    const julia = juliaFrame(frame.post.juliaShape, frame.phases.julia, frame.phases.juliaTravel);
    post.uJuliaM.value = julia.m;
    post.uJuliaBeta.value = julia.beta;
    post.uJuliaStep.value = julia.step;
    post.uJuliaWarp.value = julia.warp;
    post.uJuliaWarp3.value = julia.warp3;
    post.uJuliaTrap.value = frame.post.juliaTrap;
    post.uJuliaSpread.value = frame.post.juliaSpread;
    post.uJuliaAnchor.value = frame.post.juliaAnchor;
    post.uJuliaBind.value = frame.post.juliaBind;
    post.uJuliaDepth.value = frame.post.juliaDepth;
    post.uJuliaEdge.value = frame.post.juliaEdge;
    post.uJuliaFacet.value = frame.post.juliaFacet;
    post.uJuliaPlate.value = frame.post.juliaPlate;
    post.uJuliaPlateFold.value = frame.post.juliaPlateFold;
    post.uJuliaChunk.value = frame.post.juliaChunk;
    post.uJuliaChunkGrid.value = frame.post.juliaChunkGrid;
    /*
     * Where the frame sits over the fixed point, in stage units — half the
     * frame's height at full drift.
     *
     * Two rates in an irrational ratio rather than one, so the path is a figure
     * that never closes: a circle would bring the frame back to the same place
     * every circuit, and at three minutes that is a period a viewer can learn.
     * The phase is integrated by the director, so the speed control bends this
     * with everything else instead of teleporting it.
     */
    const drift = frame.phases.juliaDrift;
    const driftAmp = frame.post.juliaDrift * 0.5;
    post.uJuliaCenter.value = [
      driftAmp * Math.sin(drift),
      driftAmp * Math.sin(drift * 1.6180339 + 1.1),
    ];
    post.uQuasi.value = frame.post.quasi;
    post.uQuasiFreq.value = frame.post.quasiFreq;
    post.uTurbulence.value = frame.post.turbulence;
    post.uTurbulenceScale.value = frame.post.turbulenceScale;
    post.uTurbulenceSpeed.value = frame.post.turbulenceSpeed;
    post.uDisperse.value = frame.post.disperse;
    post.uBlur.value = frame.post.blur;
    post.uBlurSpin.value = frame.post.blurSpin;
    post.uBloom.value = frame.post.bloom;
    post.uBloomThreshold.value = frame.post.bloomThreshold;
    post.uFlow.value = frame.post.flow;
    post.uReact.value = frame.post.react;
    post.uDeck.value = frame.post.deck;
    post.uDeckDepth.value = frame.post.deckDepth;
    post.uDeckSpread.value = frame.post.deckSpread;
    post.uDeckTurn.value = frame.post.deckTurn;
    post.uDeckSeed.value = frame.post.deckSeed;
    post.uMobius.value = frame.post.mobius;
    post.uMobiusShift.value = frame.post.mobiusShift;
    post.uMobiusPhase.value = frame.phases.mobius;
    post.uRelief.value = frame.post.relief;
    post.uReliefLevel.value = frame.post.reliefLevel;
    post.uReliefPhase.value = frame.phases.relief;
    post.uContour.value = frame.post.contour;
    post.uContourBands.value = frame.post.contourBands;
    post.uKeyplate.value = frame.post.keyplate;
    post.uKeyplateLevel.value = frame.post.keyplateLevel;
    post.uMelt.value = frame.post.melt;
    post.uMeltLevel.value = frame.post.meltLevel;
    post.uMeltAngle.value = frame.post.meltAngle;
    post.uWake.value = frame.post.wake;
    post.uWakeSpread.value = frame.post.wakeSpread;
    post.uWakeLead.value = frame.post.wakeLead;
    post.uCaustics.value = frame.post.caustics;
    post.uCausticsScale.value = frame.post.causticsScale;
    post.uCausticsSpeed.value = frame.post.causticsSpeed;
    post.uNeon.value = frame.post.neon;
    post.uNeonHue.value = frame.post.neonHue;
    post.uNeonSpread.value = frame.post.neonSpread;
    post.uNeonWidth.value = frame.post.neonWidth;
    post.uSheen.value = frame.post.sheen;
    post.uSheenBands.value = frame.post.sheenBands;
    post.uSheenDrift.value = frame.post.sheenDrift;
    post.uSlit.value = frame.post.slit;
    post.uSlitAxis.value = frame.post.slitAxis;
    post.uSlitLuma.value = frame.post.slitLuma;
    post.uSlitDepth.value = frame.post.slitDepth;
    post.uHistoryGrid.value = this.fields.historyGrid;
    post.uHistoryCount.value = this.fields.historyCount;
    post.uHistoryCursor.value = this.fields.historyCursor;
    post.uMisreg.value = frame.post.misreg;
    post.uMisregSpread.value = frame.post.misregSpread;
    post.uMoire.value = frame.post.moire;
    post.uMoireSpread.value = frame.post.moireSpread;
    post.uBenday.value = frame.post.benday;
    post.uKrackle.value = frame.post.krackle;
    post.uKrackleScale.value = frame.post.krackleScale;
    post.uKrackleThreshold.value = frame.post.krackleThreshold;
    post.uBleed.value = frame.post.bleed;
    post.uBleedRadius.value = frame.post.bleedRadius;
    post.uPaper.value = frame.post.paper;

    // No target: straight to the default framebuffer.
    this.renderer.render({ scene: this.postMesh, frustumCull: false });

    if (frame.post.feedbackAmount > 0) this.captureFeedback();
    // Both readers of the ring keep it live, and the wake needs it far more
    // urgently than the slit does: a slit reading a stale tile shows an old
    // frame, where a wake reading one shows a *plate* of an old frame, which is
    // a colour cast over the whole picture rather than a band of it.
    this.captureHistory(frame.post.slit > 0 || frame.post.wake > 0);
  }

  /**
   * Feed the frame ring — every frame while slit-scan is running, and at a
   * stride once it stops.
   *
   * The ring has to keep being fed with the effect at zero: one that only filled
   * while slit-scan was running would hand the next pulse a frame from minutes
   * ago, and old content cutting in is exactly what the slow ramp exists to
   * prevent. But that argument is about the *age* of what is in the ring, not
   * about the rate it is filled at, and paying a full-frame read plus a blit on
   * every frame for the rest of a run buys nothing once the ring is warm. At the
   * stride the oldest tile is a couple of seconds old rather than a fraction of
   * one, which is just as far from "minutes ago", for a third of the bandwidth.
   *
   * The switch back to every frame leaves the ring briefly non-uniform in time —
   * recent tiles a frame apart, older ones a stride apart — so the trail's depth
   * axis is momentarily stretched at its far end. It costs a ring's worth of
   * frames to clear, which is well under a second, against an effect that
   * MIN_EFFECT_RAMP will not let reach visible strength for one and a half. The
   * stretch is gone before there is anything on screen to see it in.
   */
  private captureHistory(live: boolean): void {
    if (live) {
      this.historyIdle = 0;
      this.fields.capture();
      return;
    }
    if (!this.fields.hasHistory) return;
    if (++this.historyIdle < HISTORY_IDLE_STRIDE) return;
    this.historyIdle = 0;
    this.fields.capture();
  }

  /**
   * Grab the just-drawn frame off the default framebuffer for next frame.
   *
   * 1:1, and deliberately. Capturing at a fraction of the frame — a blit into a
   * smaller texture, as the history ring does — is the obvious saving here and a
   * much smaller one than it looks: what it removes is part of the *write*, on a
   * copy whose read is a full frame either way, against a post pass that is
   * already moving many times this per frame. It does not touch the cost that
   * actually distinguishes this call, which is forcing the tile buffer to
   * resolve mid-frame — that is a fixed cost and a smaller destination does not
   * reduce it. Softening the trail for a couple of percent of one frame's
   * bandwidth is not a trade worth making.
   */
  private captureFeedback(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.feedback.texture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // The raw binds above bypassed ogl's unit cache; force it to re-bind.
    this.renderer.state.textureUnits = [];
  }

  get stats(): { resident: number; pending: number } {
    return { resident: this.pool.residentCount, pending: this.pool.pendingCount };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.dispose();
    this.spatial?.dispose();
    this.fields.dispose();
    this.gl.deleteTexture(this.feedback.texture);
    this.compositeProgram.remove();
    this.postProgram.remove();
    this.handoverProgram?.remove();
    const lose = this.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }
}
