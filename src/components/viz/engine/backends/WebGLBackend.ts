import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from "ogl";
import type { OGLRenderingContext } from "ogl";
import type { Panel } from "../../../../types";
import type { StageFrame, Vec3, VizBackend, VizFrame } from "../types";
import { blendCode } from "../types";
import { TexturePool } from "../TexturePool";
import { FULLSCREEN_VERT } from "../shaders/common";
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
  /** Scene textures currently carrying a mip chain — see `syncSceneMips`. */
  private readonly mipped = new Set<Texture>();
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
        uGrain: { value: 0 },
        uVignette: { value: 0 },
        uExposure: { value: 1 },
        uHueShift: { value: 0 },
        uKaleido: { value: 0 },
        uKaleidoSegments: { value: 6 },
        uKaleidoPhase: { value: 0 },
        uTile: { value: 0 },
        uWarp: { value: 0 },
        uWarpScale: { value: 2.4 },
        uWarpSpeed: { value: 0.35 },
        uRipple: { value: 0 },
        uRippleFreq: { value: 16 },
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
    // Between the scene and post, so the buffers post reads are this frame's
    // rather than the last one's — the reaction in particular is seeded from the
    // composite, and a frame late would have it chasing a picture that has
    // already moved on.
    this.fields.update(frame.post, scene, frame.flowAngle, frame.time);
    this.renderPost(frame, scene);
  }

  /** The spatial path. Returns the texture post should read. */
  private renderStage(spatial: SpatialPass, stage: StageFrame, background: Vec3): Texture {
    // A slot holds its panel for a whole dwell, so the pin set is simply
    // everything the formation is bound to — including the panels whose slots
    // are momentarily faded out, which are about to come back up.
    this.pool.setPinned([
      ...stage.slots.map((slot) => slot.panelId),
      ...stage.solids.map((solid) => solid.panelId),
    ]);
    return spatial.render(stage, background, this.pool);
  }

  /** The flat path, unchanged: N shards blended onto a base, batched. */
  private renderShards(frame: VizFrame): Texture {
    // Only shards whose texture has finished decoding can be drawn; the rest
    // are simply skipped this frame and appear once they land.
    const drawable = frame.shards.filter(
      (shard) => shard.opacity > 0.001 && this.pool.has(shard.panelId)
    );
    this.pool.setPinned(drawable.map((shard) => shard.panelId));

    const uniforms = this.compositeProgram.uniforms;
    uniforms.uAspect.value = this.aspect;
    uniforms.uBackground.value = frame.background;

    let read: RenderTarget | null = null;
    let write = this.targets[0];

    const batches = Math.max(1, Math.ceil(drawable.length / this.maxShards));
    for (let batch = 0; batch < batches; batch++) {
      const slice = drawable.slice(batch * this.maxShards, (batch + 1) * this.maxShards);

      for (let i = 0; i < this.maxShards; i++) {
        const shard = slice[i];
        if (!shard) {
          uniforms.uMisc.value[i][2] = 0;
          uniforms.uTex.value[i] = this.pool.blank;
          continue;
        }
        const texture = this.pool.get(shard.panelId) ?? this.pool.blank;
        const { dstRect, srcRect } = shard;

        uniforms.uTex.value[i] = texture;
        uniforms.uRect.value[i] = [
          dstRect.x + dstRect.w / 2,
          dstRect.y + dstRect.h / 2,
          dstRect.w,
          dstRect.h,
        ];
        uniforms.uSrc.value[i] = [srcRect.x, srcRect.y, srcRect.w, srcRect.h];
        uniforms.uMisc.value[i] = [
          Math.cos(shard.rotation),
          Math.sin(shard.rotation),
          shard.opacity,
          shard.feather,
        ];
        uniforms.uLevels.value[i] = [shard.levels.gain, shard.levels.lift];
        uniforms.uTint.value[i] = [...shard.tint, shard.tintAmount];
        uniforms.uMode.value[i] = blendCode(shard.blendMode);
      }

      uniforms.uCount.value = Math.min(slice.length, this.maxShards);
      uniforms.uBase.value = read ? read.texture : this.pool.blank;
      uniforms.uUseBase.value = read ? 1 : 0;

      this.renderer.render({ scene: this.compositeMesh, target: write, frustumCull: false });

      read = write;
      write = this.targets[read === this.targets[0] ? 1 : 0];
    }

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
    this.syncSceneMips(scene, frame.post.julia > 0);
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
    post.uGrain.value = frame.post.grain;
    post.uVignette.value = frame.post.vignette;
    post.uExposure.value = frame.post.exposure;
    post.uHueShift.value = frame.post.hueShift;
    post.uKaleido.value = frame.post.kaleido;
    post.uKaleidoSegments.value = frame.post.kaleidoSegments;
    post.uKaleidoPhase.value = frame.phases.kaleido;
    post.uTile.value = frame.post.tile;
    post.uWarp.value = frame.post.warp;
    post.uWarpScale.value = frame.post.warpScale;
    post.uWarpSpeed.value = frame.post.warpSpeed;
    post.uRipple.value = frame.post.ripple;
    post.uRippleFreq.value = frame.post.rippleFreq;
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
    // The ring is fed from the finished frame, like the trail. Unlike the trail
    // it keeps being fed once it exists at all, even with the effect at zero: a
    // ring that only filled while slit-scan was running would hand the next
    // pulse a frame from minutes ago, and old content cutting in is exactly what
    // the slow ramp is there to prevent. A quarter-scale blit is cheap enough to
    // pay for that indefinitely.
    if (frame.post.slit > 0 || this.fields.hasHistory) this.fields.capture();
  }

  /** Grab the just-drawn frame off the default framebuffer for next frame. */
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
    const lose = this.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }
}
