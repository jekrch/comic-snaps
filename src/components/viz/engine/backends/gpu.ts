import type { OGLRenderingContext, Program, RenderTarget, Renderer } from "ogl";

/**
 * Teardown and carry-over helpers for the GPU objects ogl builds but never
 * frees.
 *
 * ogl's RenderTarget has no teardown at all — dropping one leaves its
 * framebuffer, its colour textures and its depth renderbuffer behind — and
 * `Program.remove` deletes the program but not the two shaders attached to it.
 * `loseContext` at dispose does reclaim all of it eventually, but on iOS a
 * synthetic loss keeps the context's own storage until the canvas is collected,
 * and anything freed only by that is memory the rest of the app is still
 * paying for after the run has closed.
 */

/** Every GL object a RenderTarget owns. Safe on a target already freed. */
export function deleteTarget(gl: OGLRenderingContext, target: RenderTarget | null | undefined): void {
  if (!target) return;
  for (const texture of target.textures ?? []) gl.deleteTexture(texture.texture);
  if (target.depthTexture) gl.deleteTexture(target.depthTexture.texture);
  if (target.depthBuffer) gl.deleteRenderbuffer(target.depthBuffer);
  if (target.stencilBuffer) gl.deleteRenderbuffer(target.stencilBuffer);
  if (target.depthStencilBuffer) gl.deleteRenderbuffer(target.depthStencilBuffer);
  if (target.buffer) gl.deleteFramebuffer(target.buffer);
}

/** The program and both of its shaders. */
export function deleteProgram(gl: OGLRenderingContext, program: Program | null | undefined): void {
  if (!program) return;
  program.remove();
  if (program.vertexShader) gl.deleteShader(program.vertexShader);
  if (program.fragmentShader) gl.deleteShader(program.fragmentShader);
}

/**
 * Resample one texture into another of a different size, on the GPU.
 *
 * What a resize uses to carry state across rather than starting the new buffer
 * from black. The buffers that hold the *past* — the feedback trail, the frame
 * ring, the reaction, a crossing's still — cannot be recomputed from the
 * current frame, so a resize that reallocates them empty shows up on screen:
 * as a black frame through slit-scan, a colour cast through the wake, or the
 * trails vanishing and regrowing. The quality governor resizes mid-run, so that
 * was not an edge case.
 *
 * Two throwaway framebuffers and one linear blit. A resize is rare enough that
 * building them per call costs nothing worth caching. Returns false if either
 * side will not attach, in which case the caller falls back to whatever it did
 * before.
 */
export function copyTexture(
  renderer: Renderer,
  src: WebGLTexture,
  srcWidth: number,
  srcHeight: number,
  dst: WebGLTexture,
  dstWidth: number,
  dstHeight: number
): boolean {
  const gl = renderer.gl as unknown as WebGL2RenderingContext;
  const read = gl.createFramebuffer();
  const draw = gl.createFramebuffer();
  let ok = false;
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    ok =
      gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE &&
      gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) {
      gl.blitFramebuffer(
        0,
        0,
        srcWidth,
        srcHeight,
        0,
        0,
        dstWidth,
        dstHeight,
        gl.COLOR_BUFFER_BIT,
        gl.LINEAR
      );
    }
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(read);
    gl.deleteFramebuffer(draw);
    // The raw binds above went around ogl's cache, which would otherwise skip a
    // bind it actually needs.
    renderer.state.framebuffer = null;
  }
  return ok;
}
