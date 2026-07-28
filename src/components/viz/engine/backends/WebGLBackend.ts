import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from "ogl";
import type { OGLRenderingContext } from "ogl";
import type { Panel } from "../../../../types";
import type { VizBackend, VizFrame } from "../types";
import { blendCode } from "../types";
import { TexturePool } from "../TexturePool";
import { FULLSCREEN_VERT } from "../shaders/common";
import { compositeFragment } from "../shaders/layer";
import { POST_FRAGMENT } from "../shaders/post";
import type { DeviceCaps } from "../../vizConfig";

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
  private readonly maxShards: number;

  private width = 1;
  private height = 1;
  private aspect = 1;
  private disposed = false;

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
        uResolution: { value: [1, 1] },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uFeedbackAmount: { value: 0 },
        uFeedbackScale: { value: 1 },
        uFeedbackRotate: { value: 0 },
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
        uTile: { value: 0 },
        uWarp: { value: 0 },
        uWarpScale: { value: 2.4 },
        uWarpSpeed: { value: 0.35 },
        uRipple: { value: 0 },
        uRippleFreq: { value: 16 },
        uTwist: { value: 0 },
        uBulge: { value: 0 },
        uSolarize: { value: 0 },
      },
    });
    this.postMesh = new Mesh(this.gl, { geometry, program: this.postProgram });

    this.targets = [this.makeTarget(1, 1), this.makeTarget(1, 1)];
    this.feedback = this.makeFeedback(1, 1);
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
    this.renderer.setSize(width, height);
    this.width = Math.max(1, Math.round(width * this.caps.renderScale));
    this.height = Math.max(1, Math.round(height * this.caps.renderScale));
    this.aspect = this.width / this.height;
    for (const target of this.targets) target.setSize(this.width, this.height);
    this.gl.deleteTexture(this.feedback.texture);
    this.feedback = this.makeFeedback(this.width, this.height);
  }

  isReady(panelId: string): boolean {
    return this.pool.has(panelId);
  }

  requestPanels(panels: Panel[]): void {
    for (const panel of panels) this.pool.request(panel);
  }

  render(frame: VizFrame): void {
    if (this.disposed) return;

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

    const post = this.postProgram.uniforms;
    post.uScene.value = read!.texture;
    post.uFeedback.value = this.feedback;
    post.uResolution.value = [this.width, this.height];
    post.uAspect.value = this.aspect;
    post.uTime.value = frame.time;
    post.uFeedbackAmount.value = frame.post.feedbackAmount;
    post.uFeedbackScale.value = frame.post.feedbackScale;
    post.uFeedbackRotate.value = frame.post.feedbackRotate;
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
    post.uTile.value = frame.post.tile;
    post.uWarp.value = frame.post.warp;
    post.uWarpScale.value = frame.post.warpScale;
    post.uWarpSpeed.value = frame.post.warpSpeed;
    post.uRipple.value = frame.post.ripple;
    post.uRippleFreq.value = frame.post.rippleFreq;
    post.uTwist.value = frame.post.twist;
    post.uBulge.value = frame.post.bulge;
    post.uSolarize.value = frame.post.solarize;

    // No target: straight to the default framebuffer.
    this.renderer.render({ scene: this.postMesh, frustumCull: false });

    if (frame.post.feedbackAmount > 0) this.captureFeedback();
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
    this.gl.deleteTexture(this.feedback.texture);
    this.compositeProgram.remove();
    this.postProgram.remove();
    const lose = this.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }
}
