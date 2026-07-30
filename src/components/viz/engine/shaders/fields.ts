/**
 * The two simulated fields the post chain displaces along.
 *
 * Both are ping-pong passes over a buffer that is well under the frame's
 * resolution, and both are here for the same reason: a field carries its own
 * history, so its timescale is a property of the thing rather than a rate that
 * had to be tuned down to read as calm. §6 of the effects backlog asks for
 * exactly that — effects that are slow *by construction* — and a closed-form
 * warp, however gently it is driven, is never one of them.
 *
 * Neither buffer can hold a negative number: `EXT_color_buffer_float` is not
 * universal, so these run in an unsigned target and the flow field lives
 * 0.5-centred in it. At the amplitudes involved the 1/255 quantisation is far
 * below the displacement's own scale.
 */

/** Value noise and its curl. Duplicated from the post chain rather than shared:
 *  these run at a quarter resolution on their own schedule, and pulling them
 *  into a common string would couple two shaders that have no reason to agree. */
const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Curl of a scalar noise potential, which is divergence-free by construction.
 *  That matters here: a field injected with an arbitrary vector noise pumps
 *  itself into corners and stalls, where a divergence-free one only ever stirs. */
vec2 curl(vec2 p) {
  const float e = 0.11;
  float up = vnoise(p + vec2(0.0, e));
  float down = vnoise(p - vec2(0.0, e));
  float right = vnoise(p + vec2(e, 0.0));
  float left = vnoise(p - vec2(e, 0.0));
  return vec2(up - down, left - right) / (2.0 * e);
}
`;

/**
 * Flow: an advected velocity field, fed along the composition's own heading.
 *
 * The heading comes from the parameter drift's heading channel — the same one
 * that decides which way the layers themselves are panning — so the smear and
 * the composition are one schedule. Fed on a schedule of its own it would be the
 * second motion §6 rules out; fed along the current the frame is already moving
 * on, the fluid and the layers agree.
 */
export const FLOW_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;
/** Unit vector, the direction the composition is drifting. */
uniform vec2 uHeading;
uniform float uDecay;
uniform float uScale;
uniform float uTime;
uniform float uAspect;
${NOISE}

void main() {
  vec2 here = texture(uPrev, vUv).rg * 2.0 - 1.0;
  // Semi-Lagrangian advection: read the field from where this parcel came from.
  // One backward step is what turns a standing push into a smear that travels.
  vec2 back = clamp(vUv - here * 0.004, 0.0, 1.0);
  vec2 prev = texture(uPrev, back).rg * 2.0 - 1.0;

  vec2 q = vUv * vec2(uAspect, 1.0) * uScale;
  // The current, plus the eddies in it. The heading alone would push the whole
  // frame one way and read as a pan; the curl alone would stir with no sense of
  // where the piece is going.
  vec2 inject = uHeading * (0.35 + 0.5 * vnoise(q + uTime * 0.03)) + curl(q + uTime * 0.02) * 0.8;

  // A lag rather than a sum: at high decay the field is almost all history, and
  // the history is what the slowness is made of.
  vec2 next = prev * uDecay + inject * (1.0 - uDecay);
  fragColor = vec4(clamp(next, -1.0, 1.0) * 0.5 + 0.5, 0.0, 1.0);
}
`;

/**
 * Gray–Scott reaction–diffusion, seeded from the frame's own luminance edges.
 *
 * The chemistry is the pacing: at these coefficients a pattern takes tens of
 * seconds to organise and does not stop moving once it has, which is the best
 * pacing match on the whole backlog and the one effect here whose slowness
 * cannot be dialled up.
 *
 * Seeded rather than run closed. A closed reaction settles, and a settled field
 * is a displacement map that does not move; fed from the composition's own edges,
 * it is continually disturbed by whatever the piece is doing, on the piece's
 * schedule.
 */
export const REACT_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

/** r is the feedstock A, g is the reagent B. */
uniform sampler2D uPrev;
/** The composite, for the edge seeding. */
uniform sampler2D uSeed;
uniform vec2 uTexel;
uniform float uFeed;
uniform float uKill;
/** Laplacian stencil width, in texels. The knob that sets feature size. */
uniform float uStep;
/** Nonzero on the first iteration of a frame only — the seed is a per-frame
 *  disturbance, and applying it once per iteration would flood the field. */
uniform float uSeedAmount;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
/** The classic dt = 1 coefficients. Stable at this ratio and not at much else. */
const float DIFFUSE_A = 0.16;
const float DIFFUSE_B = 0.08;

void main() {
  vec2 e = uTexel * max(uStep, 1.0);
  vec2 c = texture(uPrev, vUv).rg;

  // Five-point Laplacian, widened to the pattern's own scale rather than run at
  // one texel. Widening the stencil is how the feature size is set; the
  // alternative — dropping the buffer's resolution — would also drop how finely
  // the gradient can be read back, and the gradient is what the frame displaces
  // along.
  vec2 lap =
    texture(uPrev, vUv + vec2(e.x, 0.0)).rg +
    texture(uPrev, vUv - vec2(e.x, 0.0)).rg +
    texture(uPrev, vUv + vec2(0.0, e.y)).rg +
    texture(uPrev, vUv - vec2(0.0, e.y)).rg -
    4.0 * c;

  float reaction = c.r * c.g * c.g;
  float a = c.r + DIFFUSE_A * lap.r - reaction + uFeed * (1.0 - c.r);
  float b = c.g + DIFFUSE_B * lap.g + reaction - (uFeed + uKill) * c.g;

  if (uSeedAmount > 0.0) {
    float here = dot(texture(uSeed, vUv).rgb, LUMA);
    float dx = dot(texture(uSeed, vUv + vec2(uTexel.x, 0.0)).rgb, LUMA) - here;
    float dy = dot(texture(uSeed, vUv + vec2(0.0, uTexel.y)).rgb, LUMA) - here;
    b += clamp(length(vec2(dx, dy)) * 5.0, 0.0, 1.0) * uSeedAmount;
  }

  fragColor = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
}
`;
