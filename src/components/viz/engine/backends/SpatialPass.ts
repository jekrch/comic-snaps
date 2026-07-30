import { Box, Camera, Geometry, Mesh, Program, RenderTarget, Torus, Transform } from "ogl";
import type { OGLRenderingContext, Renderer, Texture } from "ogl";
import type { SolidShape, StageFrame, StageLayout, Vec3 } from "../types";
import {
  QUAD_FRAGMENT,
  QUAD_VERTEX,
  SOLID_FRAGMENT,
  SOLID_VERTEX,
  TUBE_FRAGMENT,
  TUBE_VERTEX,
} from "../shaders/spatial";
import type { TexturePool } from "../TexturePool";

/** The unit quad every instance is a transform of. */
const QUAD_POSITION = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
const QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

const NEAR_PLANE = 0.1;

/**
 * Resolution of the wallpaper tube's grid: segments around, segments along.
 *
 * Around has to be high enough that the silhouette of the wall against the frame
 * edge is a curve rather than a polygon, and along has to be high enough that the
 * radial ripple — which moves vertices, not texels — is a smooth swell. Both are
 * cheap: this is one draw of a few thousand vertices, against a post chain that
 * touches every pixel a dozen times.
 */
const TUBE_AROUND = 96;
const TUBE_ALONG = 64;

/** The tube's parameter grid: one vec2 per vertex, everything else derived in the
 *  vertex shader from uniforms so the corridor can change shape for free. */
function tubeGeometry(gl: OGLRenderingContext): Geometry {
  const cols = TUBE_AROUND + 1;
  const rows = TUBE_ALONG + 1;
  const grid = new Float32Array(cols * rows * 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 2;
      grid[i] = col / TUBE_AROUND;
      grid[i + 1] = row / TUBE_ALONG;
    }
  }

  // 16-bit is enough and universally supported: the grid is a few thousand
  // vertices, an order of magnitude under the limit.
  const index = new Uint16Array(TUBE_AROUND * TUBE_ALONG * 6);
  let at = 0;
  for (let row = 0; row < TUBE_ALONG; row++) {
    for (let col = 0; col < TUBE_AROUND; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index[at++] = a;
      index[at++] = c;
      index[at++] = d;
      index[at++] = a;
      index[at++] = d;
      index[at++] = b;
    }
  }

  return new Geometry(gl, {
    aGrid: { size: 2, data: grid },
    index: { data: index },
  });
}

/**
 * The 3D half of the WebGL backend.
 *
 * Owns the camera, the instanced quad meshes, and the solids — everything the
 * flat composite pass has no concept of. It renders into its own depth-enabled
 * target and hands the texture back, which is the whole of its contract with
 * the rest of the backend: post reads a texture and does not care what drew it,
 * so every effect in the post chain applies to a spatial scene unchanged.
 *
 * One mesh per panel slot rather than one draw for the whole formation. GLSL ES
 * 3.00 will not index a sampler array by a per-instance attribute, so the
 * alternatives were a texture array — a second decode path, a second pool, and
 * every panel squared off to a common size — or one draw per resident panel.
 * With a formation holding three or four of them that is a handful of draw calls
 * for the whole scene, and it leaves `TexturePool` exactly as it was.
 */
export class SpatialPass {
  private readonly gl: OGLRenderingContext;
  private readonly camera: Camera;
  private readonly root = new Transform();
  private readonly quadProgram: Program;
  private readonly solidProgram: Program;
  private readonly solids: Record<SolidShape, Mesh>;
  /** Built on the first frame that asks for a shell, so a run that only ever
   *  sees quad formations never pays for the grid. */
  private tube: Mesh | null = null;
  private tubeProgram: Program | null = null;
  private slotMeshes: Mesh[] = [];
  private revision = -1;
  private target: RenderTarget | null = null;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: Renderer) {
    this.gl = renderer.gl;
    this.camera = new Camera(this.gl, { near: NEAR_PLANE, far: 100 });

    this.quadProgram = new Program(this.gl, {
      vertex: QUAD_VERTEX,
      fragment: QUAD_FRAGMENT,
      transparent: true,
      // Quads are seen from both sides as the formation turns through them.
      cullFace: null,
      depthTest: true,
      // Additive needs no order, so it needs no depth writes — but it still
      // *tests*, which is what lets the solids eclipse what is behind them.
      depthWrite: false,
      uniforms: {
        uTex: { value: null },
        uLevels: { value: [1, 0] },
        uTint: { value: [1, 1, 1, 0] },
        uOpacity: { value: 1 },
        // Set per frame from the scene — at these quad sizes the border is a
        // compositional choice rather than an anti-aliasing constant.
        uFeather: { value: 0.05 },
        uMorph: { value: 0 },
        uBillboard: { value: 0.5 },
        uAlign: { value: 0 },
        uScale: { value: 1 },
        uPanelAspect: { value: 0.75 },
        uTime: { value: 0 },
        uBreathe: { value: 0.1 },
        uWrap: { value: 0 },
        uTravel: { value: 0 },
        uDisplace: { value: 0 },
        uDisplaceScale: { value: 1 },
        uDisplacePhase: { value: 0 },
        uSwirl: { value: 0 },
        uSwirlScale: { value: 0.5 },
        uFogNear: { value: 0 },
        uFogFar: { value: 30 },
      },
    });
    // Premultiplied additive: see the note at the top of shaders/spatial.ts.
    this.quadProgram.setBlendFunc(this.gl.ONE, this.gl.ONE);

    this.solidProgram = new Program(this.gl, {
      vertex: SOLID_VERTEX,
      fragment: SOLID_FRAGMENT,
      transparent: false,
      cullFace: this.gl.BACK,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTex: { value: null },
        uCrop: { value: [0, 0, 1, 1] },
        uLevels: { value: [1, 0] },
        uTint: { value: [1, 1, 1, 0] },
        uOpacity: { value: 1 },
        uFogFar: { value: 30 },
      },
    });

    this.solids = {
      torus: new Mesh(this.gl, {
        geometry: new Torus(this.gl, { radius: 0.7, tube: 0.28, radialSegments: 24, tubularSegments: 48 }),
        program: this.solidProgram,
        frustumCulled: false,
      }),
      box: new Mesh(this.gl, {
        geometry: new Box(this.gl, { width: 1, height: 1, depth: 1 }),
        program: this.solidProgram,
        frustumCulled: false,
      }),
    };
    for (const mesh of Object.values(this.solids)) mesh.setParent(this.root);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // Only if it exists: a run that never reaches a spatial preset never pays
    // for the depth buffer.
    this.target?.setSize(this.width, this.height);
  }

  /**
   * Draw one spatial frame and return the texture post should read.
   *
   * Always a full frame, even when nothing in it could be drawn: the clear
   * happens before the slots are consulted, so a formation whose panels are
   * still decoding is the background rather than the last frame's contents.
   */
  render(stage: StageFrame, background: Vec3, pool: TexturePool): Texture {
    const target = this.ensureTarget();

    if (stage.layout.revision !== this.revision) {
      this.buildSlots(stage.layout);
      this.revision = stage.layout.revision;
    }

    this.camera.perspective({
      fov: stage.fov,
      aspect: this.width / this.height,
      near: NEAR_PLANE,
      // Just past the fog, so the far plane never clips something still visible
      // and never wastes depth precision on what has already faded out.
      far: stage.fogFar * 1.3,
    });
    this.camera.position.set(stage.eye[0], stage.eye[1], stage.eye[2]);
    this.camera.lookAt([stage.look[0], stage.look[1], stage.look[2]]);

    this.root.rotation.set(stage.spin[0], stage.spin[1], stage.spin[2]);
    this.root.updateMatrixWorld();

    this.clear(target, background);

    // Opaque first, so the additive surfaces have something to test against.
    this.drawSolids(stage, pool, target);
    if (stage.shell) this.drawShell(stage, pool, target);
    this.drawSlots(stage, pool, target);

    return target.texture;
  }

  private ensureTarget(): RenderTarget {
    if (!this.target) {
      this.target = new RenderTarget(this.gl, {
        width: this.width,
        height: this.height,
        // The one buffer in the engine that needs it. The flat path composites
        // in a fixed order and has nothing to occlude.
        depth: true,
        minFilter: this.gl.LINEAR,
        magFilter: this.gl.LINEAR,
      });
    }
    return this.target;
  }

  /**
   * Unlike every other pass here, this one does not write every pixel — most of
   * a spatial frame is the dark between things — so it is the only one that has
   * to clear. Done by hand because the renderer was created without a depth
   * buffer on the default framebuffer, and ogl's own clear takes that to mean
   * no target has one either.
   */
  private clear(target: RenderTarget, background: Vec3): void {
    const gl = this.gl;
    this.renderer.bindFramebuffer(target);
    this.renderer.setViewport(target.width, target.height);
    this.renderer.setDepthMask(true);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private drawSolids(stage: StageFrame, pool: TexturePool, target: RenderTarget): void {
    const uniforms = this.solidProgram.uniforms;
    uniforms.uFogFar.value = stage.fogFar;

    for (const solid of stage.solids) {
      const texture = pool.get(solid.panelId);
      if (!texture || solid.opacity <= 0.002) continue;

      const mesh = this.solids[solid.shape];
      mesh.position.set(solid.position[0], solid.position[1], solid.position[2]);
      mesh.rotation.set(solid.rotation[0], solid.rotation[1], solid.rotation[2]);
      mesh.scale.set(solid.scale, solid.scale, solid.scale);
      // The root's own matrix is already current; this folds the placement just
      // written into it, for this draw only.
      mesh.updateMatrixWorld();

      uniforms.uTex.value = texture;
      uniforms.uLevels.value = [solid.levels.gain, solid.levels.lift];
      uniforms.uTint.value = [...solid.tint, solid.tintAmount];
      uniforms.uOpacity.value = solid.opacity;

      this.renderer.render({
        scene: mesh,
        camera: this.camera,
        target,
        update: false,
        sort: false,
        frustumCull: false,
      });
    }
  }

  /**
   * Draw the wallpaper tube once per resident panel.
   *
   * One geometry, one program, and the slot loop from `drawSlots` — a slot's
   * opacity envelope is doing the crossfade of an entire wall here rather than of
   * a hundred small quads, which is why the vault's preset has to make its slots
   * sum to one. See the note there.
   */
  private drawShell(stage: StageFrame, pool: TexturePool, target: RenderTarget): void {
    const shell = stage.shell;
    if (!shell) return;

    const mesh = this.ensureTube();
    const uniforms = mesh.program.uniforms;
    uniforms.uRadius.value = shell.radius;
    uniforms.uLength.value = shell.length;
    uniforms.uBack.value = shell.back;
    uniforms.uProfile.value = shell.profile;
    uniforms.uTiles.value = shell.tiles;
    uniforms.uTwist.value = shell.twist;
    uniforms.uScroll.value = shell.scroll;
    uniforms.uRipple.value = shell.ripple;
    uniforms.uRippleScale.value = shell.rippleScale;
    uniforms.uRipplePhase.value = shell.ripplePhase;
    uniforms.uFogFar.value = stage.fogFar;

    for (const slot of stage.slots) {
      if (slot.opacity <= 0.002) continue;
      const texture = pool.get(slot.panelId);
      if (!texture) continue;

      uniforms.uTex.value = texture;
      uniforms.uLevels.value = [slot.levels.gain, slot.levels.lift];
      uniforms.uTint.value = [...slot.tint, slot.tintAmount];
      uniforms.uOpacity.value = slot.opacity;
      uniforms.uPanelAspect.value = slot.aspect;

      this.renderer.render({
        scene: mesh,
        camera: this.camera,
        target,
        update: false,
        sort: false,
        frustumCull: false,
      });
    }
  }

  private ensureTube(): Mesh {
    if (!this.tube) {
      this.tubeProgram = new Program(this.gl, {
        vertex: TUBE_VERTEX,
        fragment: TUBE_FRAGMENT,
        transparent: true,
        // Seen from the inside, and the ripple can turn a facet inside out.
        cullFace: null,
        depthTest: true,
        depthWrite: false,
        uniforms: {
          uTex: { value: null },
          uLevels: { value: [1, 0] },
          uTint: { value: [1, 1, 1, 0] },
          uOpacity: { value: 1 },
          uRadius: { value: 2.5 },
          uLength: { value: 26 },
          uBack: { value: 2 },
          uProfile: { value: 0 },
          uTiles: { value: 2 },
          uTwist: { value: 0 },
          uScroll: { value: 0 },
          uRipple: { value: 0 },
          uRippleScale: { value: 0.5 },
          uRipplePhase: { value: 0 },
          uPanelAspect: { value: 0.75 },
          uFogFar: { value: 30 },
        },
      });
      // Premultiplied additive, exactly as the quads: two slots mid-crossfade
      // have to add up to one wall rather than compositing one over the other.
      this.tubeProgram.setBlendFunc(this.gl.ONE, this.gl.ONE);
      this.tube = new Mesh(this.gl, {
        geometry: tubeGeometry(this.gl),
        program: this.tubeProgram,
        frustumCulled: false,
      });
      this.tube.setParent(this.root);
    }
    return this.tube;
  }

  private drawSlots(stage: StageFrame, pool: TexturePool, target: RenderTarget): void {
    const uniforms = this.quadProgram.uniforms;
    uniforms.uMorph.value = stage.morph;
    uniforms.uBillboard.value = stage.billboard;
    uniforms.uAlign.value = stage.align;
    uniforms.uScale.value = stage.scale;
    uniforms.uFeather.value = stage.feather;
    uniforms.uTime.value = stage.time;
    uniforms.uBreathe.value = stage.breathe;
    uniforms.uWrap.value = stage.wrap;
    uniforms.uTravel.value = stage.travel;
    uniforms.uDisplace.value = stage.displace;
    uniforms.uDisplaceScale.value = stage.displaceScale;
    uniforms.uDisplacePhase.value = stage.displacePhase;
    uniforms.uSwirl.value = stage.swirl;
    uniforms.uSwirlScale.value = stage.swirlScale;
    uniforms.uFogNear.value = stage.fogNear;
    uniforms.uFogFar.value = stage.fogFar;

    const count = Math.min(this.slotMeshes.length, stage.slots.length);
    for (let i = 0; i < count; i++) {
      const slot = stage.slots[i];
      if (slot.opacity <= 0.002) continue;
      const texture = pool.get(slot.panelId);
      // A slot whose panel has not decoded yet simply is not drawn, exactly as
      // an undecoded shard is skipped on the flat path.
      if (!texture) continue;

      uniforms.uTex.value = texture;
      uniforms.uLevels.value = [slot.levels.gain, slot.levels.lift];
      uniforms.uTint.value = [...slot.tint, slot.tintAmount];
      uniforms.uOpacity.value = slot.opacity;
      uniforms.uPanelAspect.value = slot.aspect;

      this.renderer.render({
        scene: this.slotMeshes[i],
        camera: this.camera,
        target,
        update: false,
        sort: false,
        frustumCull: false,
      });
    }
  }

  /** Upload a new arrangement. Called only when the layout's revision moves —
   *  which for a formation that is merely morphing is never. */
  private buildSlots(layout: StageLayout): void {
    this.disposeSlots();

    this.slotMeshes = layout.slots.map((slot) => {
      const geometry = new Geometry(this.gl, {
        position: { size: 2, data: QUAD_POSITION },
        uv: { size: 2, data: QUAD_UV },
        index: { data: QUAD_INDEX },
        aPosA: { size: 3, data: slot.posA, instanced: 1 },
        aNrmA: { size: 3, data: slot.nrmA, instanced: 1 },
        aPosB: { size: 3, data: slot.posB, instanced: 1 },
        aNrmB: { size: 3, data: slot.nrmB, instanced: 1 },
        aTanA: { size: 3, data: slot.tanA, instanced: 1 },
        aTanB: { size: 3, data: slot.tanB, instanced: 1 },
        aQuad: { size: 4, data: slot.quad, instanced: 1 },
        aCrop: { size: 4, data: slot.crop, instanced: 1 },
      });
      const mesh = new Mesh(this.gl, {
        geometry,
        program: this.quadProgram,
        frustumCulled: false,
      });
      mesh.setParent(this.root);
      return mesh;
    });
  }

  private disposeSlots(): void {
    for (const mesh of this.slotMeshes) {
      mesh.setParent(null);
      mesh.geometry.remove();
    }
    this.slotMeshes = [];
  }

  dispose(): void {
    this.disposeSlots();
    for (const mesh of Object.values(this.solids)) mesh.geometry.remove();
    this.tube?.geometry.remove();
    this.tubeProgram?.remove();
    this.tube = null;
    this.tubeProgram = null;
    this.quadProgram.remove();
    this.solidProgram.remove();
    this.target = null;
  }
}
