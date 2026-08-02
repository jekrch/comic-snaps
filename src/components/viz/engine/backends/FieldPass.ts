import { Mesh, Program, RenderTarget } from "ogl";
import type { Geometry, OGLRenderingContext, Renderer, Texture } from "ogl";
import { FULLSCREEN_VERT } from "../shaders/common";
import { BLOOM_BLUR_FRAGMENT, BLOOM_THRESHOLD_FRAGMENT } from "../shaders/bloom";
import { FLOW_FRAGMENT, REACT_FRAGMENT } from "../shaders/fields";
import type { PostParams } from "../types";

/**
 * Every buffer the post chain reads that is not the scene or the last frame.
 *
 * Four families, and one reason for all of them: the effects in here cannot be
 * written as a function of the current pixel. A bloom needs the neighbourhood, a
 * slit-scan needs the past, and a flow field or a reaction needs its own previous
 * state. That is exactly the line tier B of the effects backlog drew, and this
 * class is where the frame crosses it.
 *
 * Everything is built on first use and nothing in the constructor. A run that
 * stays on the calm presets never allocates a byte of it, which matters more than
 * it looks: the four families together are several times the size of the frame,
 * and on a phone that is the difference between running and losing the context.
 *
 * The fields deliberately run well under the frame's resolution. For the flow and
 * the reaction that is not a compromise — both are read back as a smooth
 * displacement, and a displacement finer than the eye can follow is wasted work.
 * For the history ring it is: twenty-five full frames would be a hundred
 * megabytes, and a slit-scan's payoff is structural rather than in the detail.
 */

/** Tiles in the history ring, and the grid they are laid out in. Square-ish on
 *  purpose — a long strip of an atlas runs into MAX_TEXTURE_SIZE far sooner. */
const HISTORY_COLS = 5;
const HISTORY_ROWS = 5;
const HISTORY_SLOTS = HISTORY_COLS * HISTORY_ROWS;
/** Longest edge the atlas may reach. Well inside the 4096 that is the floor of
 *  what any WebGL2 device reports, because the atlas is the one texture here
 *  whose size is a multiple of the frame's rather than a fraction. */
const HISTORY_MAX_EDGE = 2048;
/** Tile size relative to the frame, before the cap above bites. */
const HISTORY_TILE_SCALE = 0.25;

/** Flow and reaction buffer size, relative to the frame. */
const FIELD_SCALE = 0.25;
const FIELD_MIN_EDGE = 48;

/**
 * Reaction steps per frame.
 *
 * Fixed against frames rather than against the composition clock, which is the
 * one place in the engine that does not follow the speed control. A step count
 * has no fractional value, so scaling it would quantise the chemistry rather than
 * pace it — and the pattern Gray–Scott settles into is a function of how many
 * steps it has taken, so a varying count would change what the reaction *is*
 * and not merely how fast it got there.
 *
 * Which is also why it comes from the device caps rather than adapting: a phone
 * runs the reaction at half this and reaches the same patterns half as fast,
 * where a count that moved with the frame rate would keep changing them.
 */
const REACT_STEPS = 4;
/** How hard the frame's edges disturb the reaction, once per frame. */
const REACT_SEED = 0.16;

/** Half the frame. The blur that follows hides the difference and the fill cost
 *  is a quarter of it. */
const BLOOM_SCALE = 0.5;

interface PingPong {
  targets: [RenderTarget, RenderTarget];
  program: Program;
  mesh: Mesh;
  /** Index of the target holding the current state. */
  read: number;
}

export class FieldPass {
  private readonly gl: OGLRenderingContext;
  private width = 1;
  private height = 1;

  private bloomTargets: [RenderTarget, RenderTarget] | null = null;
  private thresholdProgram: Program | null = null;
  private thresholdMesh: Mesh | null = null;
  private blurProgram: Program | null = null;
  private blurMesh: Mesh | null = null;

  private flow: PingPong | null = null;
  private react: PingPong | null = null;

  private historyTarget: RenderTarget | null = null;
  private historyFbo: WebGLFramebuffer | null = null;
  private historyCols = HISTORY_COLS;
  private historyTile: [number, number] = [1, 1];
  /**
   * Tile the newest frame went into. Starts at the *last* slot so that the first
   * capture's pre-increment lands on 0 — the shader reduces its slot index modulo
   * how many tiles are live, and with the ring one deep that modulo is always 0,
   * so the first frame written has to be the one at index 0 or it reads the black
   * the atlas was cleared to instead.
   */
  private cursor = HISTORY_SLOTS - 1;
  private filled = 0;
  /** Set once and for good if the atlas will not attach. Without it a refused
   *  framebuffer would be rebuilt and refused again every frame. */
  private historyFailed = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly geometry: Geometry,
    /** Stand-in for a sampler nothing has filled yet. */
    private readonly blank: Texture,
    private readonly reactSteps: number = REACT_STEPS
  ) {
    this.gl = renderer.gl;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    const [fw, fh] = this.fieldSize;
    for (const pass of [this.flow, this.react]) {
      if (!pass) continue;
      for (const target of pass.targets) target.setSize(fw, fh);
      // A resized field is an uninitialised one, and for the reaction that is
      // not a cosmetic problem: Gray–Scott on a zeroed buffer has no feedstock
      // and stays flat forever.
      this.seed(pass);
    }
    if (this.bloomTargets) {
      const w = Math.max(1, Math.round(this.width * BLOOM_SCALE));
      const h = Math.max(1, Math.round(this.height * BLOOM_SCALE));
      for (const target of this.bloomTargets) target.setSize(w, h);
    }
    // Rebuilt rather than resized: the tile grid is derived from the frame, and
    // the frames already in the ring were captured at the old one. A resize is
    // also the one thing that can un-refuse the atlas, so a past failure is
    // forgotten here rather than being permanent for the session.
    if (this.historyTarget || this.historyFailed) {
      this.historyFailed = false;
      this.rebuildHistory();
    }
  }

  /** Advance every buffer the frame asks for. Call before the post pass. */
  update(post: PostParams, scene: Texture, flowAngle: number, time: number): void {
    if (post.bloom > 0) this.renderBloom(post, scene);
    if (post.flow > 0) this.renderFlow(post, flowAngle, time);
    if (post.react > 0) this.renderReact(post, scene);
  }

  /** What the post program should bind. Blank for anything not running, so a
   *  disabled effect costs a bound 1×1 texture and no allocation at all. */
  get textures(): { bloom: Texture; flow: Texture; react: Texture; history: Texture } {
    return {
      bloom: this.bloomTargets ? this.bloomTargets[0].texture : this.blank,
      flow: this.flow ? this.flow.targets[this.flow.read].texture : this.blank,
      react: this.react ? this.react.targets[this.react.read].texture : this.blank,
      history: this.historyTarget ? this.historyTarget.texture : this.blank,
    };
  }

  get fieldResolution(): [number, number] {
    return this.fieldSize;
  }

  get historyGrid(): [number, number] {
    return [this.historyCols, HISTORY_ROWS];
  }

  /** Tiles that have actually been written. Floored at 1 so the shader's `mod`
   *  never divides by zero on the opening frames. */
  get historyCount(): number {
    return Math.max(1, this.filled);
  }

  get historyCursor(): number {
    return this.cursor;
  }

  /** Whether the ring has been allocated. Once it has, it is worth keeping fed
   *  whatever the frame is asking for — see the caller. */
  get hasHistory(): boolean {
    return this.historyTarget !== null;
  }

  private get fieldSize(): [number, number] {
    return [
      Math.max(FIELD_MIN_EDGE, Math.round(this.width * FIELD_SCALE)),
      Math.max(FIELD_MIN_EDGE, Math.round(this.height * FIELD_SCALE)),
    ];
  }

  // --- bloom ----------------------------------------------------------------

  private renderBloom(post: PostParams, scene: Texture): void {
    const targets = this.ensureBloom();
    const threshold = this.thresholdProgram!;
    const blur = this.blurProgram!;

    threshold.uniforms.uScene.value = scene;
    threshold.uniforms.uThreshold.value = post.bloomThreshold;
    this.renderer.render({ scene: this.thresholdMesh!, target: targets[1], frustumCull: false });

    // Separable, so the radius costs two nine-tap passes rather than eighty-one
    // samples. Expressed against the short edge in both directions, which is
    // what keeps the spread round on a wide canvas.
    const radius = Math.max(0.0005, post.bloomRadius) / 4;
    blur.uniforms.uSource.value = targets[1].texture;
    blur.uniforms.uStep.value = [radius * (this.height / this.width), 0];
    this.renderer.render({ scene: this.blurMesh!, target: targets[0], frustumCull: false });

    blur.uniforms.uSource.value = targets[0].texture;
    blur.uniforms.uStep.value = [0, radius];
    this.renderer.render({ scene: this.blurMesh!, target: targets[1], frustumCull: false });

    // The vertical pass wrote targets[1]; `textures` reads targets[0], so the
    // two are swapped rather than copied.
    const swap = targets[0];
    targets[0] = targets[1];
    targets[1] = swap;
  }

  private ensureBloom(): [RenderTarget, RenderTarget] {
    if (this.bloomTargets) return this.bloomTargets;
    const w = Math.max(1, Math.round(this.width * BLOOM_SCALE));
    const h = Math.max(1, Math.round(this.height * BLOOM_SCALE));
    this.bloomTargets = [this.makeTarget(w, h), this.makeTarget(w, h)];

    this.thresholdProgram = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: BLOOM_THRESHOLD_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { uScene: { value: this.blank }, uThreshold: { value: 0.7 } },
    });
    this.thresholdMesh = new Mesh(this.gl, {
      geometry: this.geometry,
      program: this.thresholdProgram,
    });

    this.blurProgram = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: BLOOM_BLUR_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { uSource: { value: this.blank }, uStep: { value: [0, 0] } },
    });
    this.blurMesh = new Mesh(this.gl, { geometry: this.geometry, program: this.blurProgram });

    return this.bloomTargets;
  }

  // --- flow -----------------------------------------------------------------

  private renderFlow(post: PostParams, flowAngle: number, time: number): void {
    const pass = (this.flow ??= this.makeFlow());
    const uniforms = pass.program.uniforms;
    uniforms.uPrev.value = pass.targets[pass.read].texture;
    uniforms.uHeading.value = [Math.cos(flowAngle), Math.sin(flowAngle)];
    uniforms.uDecay.value = Math.min(0.999, Math.max(0, post.flowDecay));
    uniforms.uScale.value = post.flowScale;
    uniforms.uTime.value = time;
    uniforms.uAspect.value = this.width / this.height;
    this.advance(pass);
  }

  private makeFlow(): PingPong {
    const [w, h] = this.fieldSize;
    const program = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: FLOW_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: this.blank },
        uHeading: { value: [1, 0] },
        uDecay: { value: 0.97 },
        uScale: { value: 2.6 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
      },
    });
    const pass: PingPong = {
      targets: [this.makeTarget(w, h), this.makeTarget(w, h)],
      program,
      mesh: new Mesh(this.gl, { geometry: this.geometry, program }),
      read: 0,
    };
    // 0.5 is zero velocity in the biased encoding, so a fresh field is at rest
    // rather than pushing the frame hard one way on its first frame.
    this.clear(pass, [0.5, 0.5, 0, 1]);
    return pass;
  }

  // --- reaction -------------------------------------------------------------

  private renderReact(post: PostParams, scene: Texture): void {
    const pass = (this.react ??= this.makeReact());
    const [w, h] = this.fieldSize;
    const uniforms = pass.program.uniforms;
    uniforms.uSeed.value = scene;
    uniforms.uTexel.value = [1 / w, 1 / h];
    uniforms.uFeed.value = post.reactFeed;
    uniforms.uKill.value = post.reactKill;
    uniforms.uStep.value = Math.max(1, post.reactScale);

    for (let step = 0; step < this.reactSteps; step++) {
      uniforms.uPrev.value = pass.targets[pass.read].texture;
      // Only the first step of a frame takes the seed. Applied every step it
      // would be four times the disturbance and the field would flood.
      uniforms.uSeedAmount.value = step === 0 ? REACT_SEED : 0;
      this.advance(pass);
    }
  }

  private makeReact(): PingPong {
    const [w, h] = this.fieldSize;
    const program = new Program(this.gl, {
      vertex: FULLSCREEN_VERT,
      fragment: REACT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: this.blank },
        uSeed: { value: this.blank },
        uTexel: { value: [1 / w, 1 / h] },
        uFeed: { value: 0.037 },
        uKill: { value: 0.062 },
        uStep: { value: 1.6 },
        uSeedAmount: { value: 0 },
      },
    });
    const pass: PingPong = {
      targets: [this.makeTarget(w, h), this.makeTarget(w, h)],
      program,
      mesh: new Mesh(this.gl, { geometry: this.geometry, program }),
      read: 0,
    };
    this.seed(pass);
    return pass;
  }

  /** Full of feedstock and empty of reagent — the resting state Gray–Scott has
   *  to start from. A zeroed buffer has nothing to consume and never reacts. */
  private seed(pass: PingPong): void {
    this.clear(pass, [1, 0, 0, 1]);
  }

  // --- history ring ---------------------------------------------------------

  /**
   * Copy the just-drawn frame into the next tile of the ring.
   *
   * `blitFramebuffer` rather than the `copyTexSubImage2D` the feedback path uses,
   * for one reason: a copy is 1:1 and a blit scales. The tiles are a quarter of
   * the frame on each edge, so a copy would need a downsample pass of its own to
   * feed it, where the blit does the filtering on the way across.
   */
  capture(): void {
    const gl = this.gl as unknown as WebGL2RenderingContext;
    this.ensureHistory();
    if (!this.historyFbo) return;

    this.cursor = (this.cursor + 1) % HISTORY_SLOTS;
    this.filled = Math.min(HISTORY_SLOTS, this.filled + 1);

    const [tw, th] = this.historyTile;
    const x = (this.cursor % this.historyCols) * tw;
    // Row 0 of the atlas is the bottom in GL's convention, which is also where
    // the default framebuffer's row 0 is — so no flip is needed here, and the
    // shader indexes tiles in the same order this writes them.
    const y = Math.floor(this.cursor / this.historyCols) * th;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.historyFbo);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      x,
      y,
      x + tw,
      y + th,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // The raw binds above bypassed ogl's own cache, which would otherwise think
    // the atlas is still bound and skip the next bind it actually needs.
    this.renderer.state.framebuffer = null;
  }

  private ensureHistory(): void {
    if (!this.historyTarget && !this.historyFailed) this.rebuildHistory();
  }

  private rebuildHistory(): void {
    const gl = this.gl as unknown as WebGL2RenderingContext;
    this.disposeHistory();

    // Tile size is a quarter of the frame, or whatever keeps the atlas inside
    // HISTORY_MAX_EDGE — whichever is smaller. The cap is what stops a 4×
    // device-pixel-ratio desktop from asking for a texture no GPU guarantees.
    const scale = Math.min(
      HISTORY_TILE_SCALE,
      HISTORY_MAX_EDGE / (HISTORY_COLS * this.width),
      HISTORY_MAX_EDGE / (HISTORY_ROWS * this.height)
    );
    const tw = Math.max(1, Math.floor(this.width * scale));
    const th = Math.max(1, Math.floor(this.height * scale));
    this.historyTile = [tw, th];
    this.historyCols = HISTORY_COLS;

    this.historyTarget = this.makeTarget(tw * HISTORY_COLS, th * HISTORY_ROWS);
    // Black, so the tiles nothing has written yet read as the dark rather than
    // as whatever the driver left in the allocation.
    this.renderer.bindFramebuffer(this.historyTarget);
    this.renderer.setViewport(this.historyTarget.width, this.historyTarget.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.renderer.bindFramebuffer();

    // A framebuffer of our own over the same texture: the blit needs a draw
    // target, and ogl's RenderTarget already has one but does not expose it in a
    // form `blitFramebuffer` can be pointed at alongside a read binding.
    this.historyFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.historyFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.historyTarget.texture.texture,
      0
    );
    // Checked rather than assumed. The atlas is the one texture here sized as a
    // multiple of the frame instead of a fraction, so it is the one that can be
    // refused — and a slit-scan reading an incomplete framebuffer would be a
    // black frame with no indication of why.
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderer.state.framebuffer = null;

    if (!complete) {
      console.error("viz: frame history unavailable at", this.historyTarget.width);
      this.historyFailed = true;
      this.disposeHistory();
      return;
    }

    this.cursor = HISTORY_SLOTS - 1;
    this.filled = 0;
  }

  // --- shared ---------------------------------------------------------------

  private makeTarget(width: number, height: number): RenderTarget {
    return new RenderTarget(this.gl, {
      width,
      height,
      depth: false,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
    });
  }

  /** Draw one step and swap, so the shader's `uPrev` is never the target it is
   *  writing — which on some drivers is undefined and on all of them is wrong. */
  private advance(pass: PingPong): void {
    const write = pass.read === 0 ? 1 : 0;
    this.renderer.render({ scene: pass.mesh, target: pass.targets[write], frustumCull: false });
    pass.read = write;
  }

  private clear(pass: PingPong, colour: [number, number, number, number]): void {
    const gl = this.gl;
    for (const target of pass.targets) {
      this.renderer.bindFramebuffer(target);
      this.renderer.setViewport(target.width, target.height);
      gl.clearColor(colour[0], colour[1], colour[2], colour[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.renderer.bindFramebuffer();
    pass.read = 0;
  }

  private disposeHistory(): void {
    if (this.historyFbo) {
      (this.gl as unknown as WebGL2RenderingContext).deleteFramebuffer(this.historyFbo);
      this.historyFbo = null;
    }
    // The texture, not only the framebuffer over it. ogl's RenderTarget has no
    // teardown of its own, so dropping the reference leaves the allocation
    // behind — and at up to 2048² this is the largest texture the engine owns.
    // Every rebuild stranded one: a rotated phone, a surface sent to a second
    // window and back, a governor step. On a device with a few hundred MB of
    // GPU memory to give that is a context loss with a delay on it rather than
    // a leak you can wait out.
    if (this.historyTarget) {
      this.gl.deleteTexture(this.historyTarget.texture.texture);
      this.historyTarget = null;
    }
  }

  dispose(): void {
    this.disposeHistory();
    for (const target of this.bloomTargets ?? []) {
      this.gl.deleteTexture(target.texture.texture);
    }
    for (const pass of [this.flow, this.react]) {
      for (const target of pass?.targets ?? []) this.gl.deleteTexture(target.texture.texture);
    }
    this.thresholdProgram?.remove();
    this.blurProgram?.remove();
    this.flow?.program.remove();
    this.react?.program.remove();
    this.bloomTargets = null;
    this.flow = null;
    this.react = null;
  }
}
