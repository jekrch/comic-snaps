import { Box, Camera, Geometry, Mesh, Program, RenderTarget, Torus, Transform } from "ogl";
import type { OGLRenderingContext, Renderer, Texture } from "ogl";
import type { SolidShape, StageFrame, StageLayout, Vec3 } from "../types";
import { QUAD_FRAGMENT, QUAD_VERTEX, SOLID_FRAGMENT, SOLID_VERTEX } from "../shaders/spatial";
import type { TexturePool } from "../TexturePool";

/** The unit quad every instance is a transform of. */
const QUAD_POSITION = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
const QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** Softness of a quad's border, in its own uv. Small: these are pages, and a
 *  page with no edge is a smudge. Enough only to keep the corners from
 *  aliasing into sparkle as they turn. */
const QUAD_FEATHER = 0.04;

const NEAR_PLANE = 0.1;

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
 * every panel squared off to a common size — or a dozen draw calls. A dozen
 * draw calls for five hundred quads is the cheaper trade by a wide margin, and
 * it leaves `TexturePool` exactly as it was.
 */
export class SpatialPass {
  private readonly gl: OGLRenderingContext;
  private readonly camera: Camera;
  private readonly root = new Transform();
  private readonly quadProgram: Program;
  private readonly solidProgram: Program;
  private readonly solids: Record<SolidShape, Mesh>;
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
        uFeather: { value: QUAD_FEATHER },
        uMorph: { value: 0 },
        uBillboard: { value: 0.5 },
        uScale: { value: 1 },
        uPanelAspect: { value: 0.75 },
        uTime: { value: 0 },
        uBreathe: { value: 0.1 },
        uWrap: { value: 0 },
        uTravel: { value: 0 },
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

    // Opaque first, so the additive quads have something to test against.
    this.drawSolids(stage, pool, target);
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

  private drawSlots(stage: StageFrame, pool: TexturePool, target: RenderTarget): void {
    const uniforms = this.quadProgram.uniforms;
    uniforms.uMorph.value = stage.morph;
    uniforms.uBillboard.value = stage.billboard;
    uniforms.uScale.value = stage.scale;
    uniforms.uTime.value = stage.time;
    uniforms.uBreathe.value = stage.breathe;
    uniforms.uWrap.value = stage.wrap;
    uniforms.uTravel.value = stage.travel;
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
    this.quadProgram.remove();
    this.solidProgram.remove();
    this.target = null;
  }
}
