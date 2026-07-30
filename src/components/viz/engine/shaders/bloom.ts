/**
 * The bloom prepass: threshold, then a separable Gaussian.
 *
 * Two passes and two half-resolution targets, which is the whole of the cost.
 * The important property is not the shape of the kernel but that it is
 * *mean-preserving* — the weights below sum to exactly 1 — because the post
 * chain subtracts the thresholded highlight from itself by the same amount it
 * adds this back. That cancellation is what makes the bloom energy-normalised,
 * and energy normalisation is the condition of a bloom existing at all beside a
 * feedback path that accumulates with `max()`. See `PostParams.bloom`.
 */

export const BLOOM_THRESHOLD_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform float uThreshold;

void main() {
  // Exactly the quantity the post chain will debit, so the two agree by
  // construction rather than by both happening to use the same constant.
  fragColor = vec4(max(texture(uScene, vUv).rgb - uThreshold, 0.0), 1.0);
}
`;

export const BLOOM_BLUR_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
/** One tap's step, in uv. Horizontal on the first pass, vertical on the second. */
uniform vec2 uStep;

/** Nine-tap Gaussian. Sums to 1 across the whole kernel — see the note above:
 *  a normalisation error here shows up as the frame gaining or losing light. */
const float W0 = 0.2270270;
const float W1 = 0.1945946;
const float W2 = 0.1216216;
const float W3 = 0.0540541;
const float W4 = 0.0162162;

void main() {
  vec3 sum = texture(uSource, vUv).rgb * W0;
  sum += (texture(uSource, vUv + uStep).rgb + texture(uSource, vUv - uStep).rgb) * W1;
  sum += (texture(uSource, vUv + uStep * 2.0).rgb + texture(uSource, vUv - uStep * 2.0).rgb) * W2;
  sum += (texture(uSource, vUv + uStep * 3.0).rgb + texture(uSource, vUv - uStep * 3.0).rgb) * W3;
  sum += (texture(uSource, vUv + uStep * 4.0).rgb + texture(uSource, vUv - uStep * 4.0).rgb) * W4;
  fragColor = vec4(sum, 1.0);
}
`;
