/**
 * The crossing between two composition paths.
 *
 * The flat stack and a spatial formation are mutually exclusive — a frame is
 * drawn by one or the other, and the two never share a buffer — so a change of
 * path is the one transition in the engine that cannot be expressed as a
 * parameter moving. What it needs instead is the oldest trick in the mixer: a
 * still of the last frame the outgoing path drew, dissolved out over the
 * incoming one.
 *
 * A still, and not a live second render, because the alternative is two
 * formations resident at once — two render targets, two sets of slot meshes and
 * twice the panel residency, carried permanently for an event that lasts a
 * second and a quarter. Over that second the outgoing image is losing contrast
 * the whole way down, which is most of what hides the fact that it has stopped
 * moving; and the presets this crosses between move slowly enough (a formation
 * turns in minutes, a layer lives for a minute) that there is very little motion
 * to freeze.
 *
 * Linear, deliberately, where every other easing in the engine is a smoothstep.
 * This mix runs between two *pictures* rather than between two values of a
 * parameter, so the eased version would not look smoother — it would spend the
 * middle of the crossing moving half again as fast, and the middle is where
 * both images are on screen at once and the whole frame's luminance is in
 * flight. §7 budgets that rate, so the crossing holds it flat.
 */
export const HANDOVER_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uPrev;
uniform float uMix;

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  // At zero this is the copy the snapshot itself is taken with, so the two uses
  // are one program and the still is captured through exactly the path it will
  // later be read back through.
  vec3 prev = texture(uPrev, vUv).rgb;
  fragColor = vec4(mix(scene, prev, uMix), 1.0);
}
`;
