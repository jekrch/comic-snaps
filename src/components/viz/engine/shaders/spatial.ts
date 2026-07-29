/**
 * The spatial pass: instanced panel quads in a real projection, plus the
 * opaque solids they can hide behind.
 *
 * Two departures from the composite shader, both forced by there being a third
 * dimension:
 *
 * **Blending is the GPU's, not the shader's.** The flat path resolves blend
 * modes itself because it composites shards in a fixed order in one pass. Here
 * the draw order is whatever the slots happen to be in, and sorting several
 * hundred quads back-to-front every frame to make an ordered blend meaningful
 * would cost more than the quads do. Additive over black is order-independent,
 * so the sort disappears — and additive over black is what `screen` already
 * collapses to, which is the blend the drift stack reaches for anyway.
 *
 * **Colour is premultiplied.** `fragColor = vec4(c * a, a)` with `ONE, ONE` is
 * the additive accumulation above; it also means a quad's alpha carries its
 * energy, so the fog and the breath attenuate light rather than merely making
 * it transparent over something.
 */

/**
 * Quad instances.
 *
 * Everything about where an instance goes is derived here from static
 * attributes and a handful of uniforms — the morph between the pair of
 * formations, the wrap that makes a finite tube endless, the turn to face the
 * camera. The CPU sets eleven uniforms and draws; it never touches a position.
 */
export const QUAD_VERTEX = `#version 300 es
precision highp float;

in vec2 position;
in vec2 uv;
// Per instance: the two arrangements, morphed between.
in vec3 aPosA;
in vec3 aNrmA;
in vec3 aPosB;
in vec3 aNrmB;
// Per instance: half-size, in-plane tilt, breath rate, breath phase.
in vec4 aQuad;
// Per instance: crop origin.uv + crop size.uv
in vec4 aCrop;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

uniform float uMorph;
uniform float uBillboard;
uniform float uScale;
uniform float uPanelAspect;
uniform float uTime;
uniform float uBreathe;
uniform float uWrap;
uniform float uTravel;
uniform float uFogNear;
uniform float uFogFar;

out vec2 vUv;
out vec2 vLocal;
out float vFade;

void main() {
  vec3 local = mix(aPosA, aPosB, uMorph);
  vec3 surface = mix(aNrmA, aNrmB, uMorph);

  // The endless corridor: the instances stay put and the repeat slides through
  // them, so nothing here ever leaves the range it was built in.
  if (uWrap > 0.0) {
    local.z = mod(local.z + uTravel, uWrap) - uWrap;
  }

  vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
  vec3 face = normalize(mat3(modelMatrix) * surface + 1e-5);

  // Between lying on the formation's own surface and turning to meet the eye.
  // Wallpaper at 0, a swarm of billboards at 1, and the interesting values are
  // in between — a page that is *nearly* facing you still shows its edge, which
  // is the only cue that says it is a plane in space rather than a sprite.
  vec3 toCamera = normalize(cameraPosition - world);
  vec3 blended = mix(face, toCamera, uBillboard);
  // The two cancel when a quad on the far side of a sphere faces directly away
  // from the eye and the mix is even — normalising that is a NaN, and a NaN
  // here takes the whole quad with it. Facing the camera is the right answer
  // in that case anyway: it is the term the blend was heading toward.
  float reach = length(blended);
  vec3 n = reach > 1e-3 ? blended / reach : toCamera;
  // Any up vector will do except one parallel to n, which would collapse the
  // cross product; the swap keeps the basis stable as a quad passes overhead.
  vec3 up = abs(n.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(up, n));
  vec3 rise = cross(n, right);

  // Keep the crop's proportions and the quad's area at once: a wide fragment
  // gets wider *and* shorter, so one panel is never visually heavier than
  // another merely for having been cropped along its long edge.
  float ratio = max((aCrop.z / max(aCrop.w, 1e-4)) * uPanelAspect, 1e-3);
  float k = sqrt(ratio);
  vec2 extent = aQuad.x * uScale * vec2(k, 1.0 / k);

  float tilt = aQuad.y;
  float ct = cos(tilt);
  float st = sin(tilt);
  vec2 q = position * extent;
  vec2 r = vec2(q.x * ct - q.y * st, q.x * st + q.y * ct);
  vec3 offset = right * r.x + rise * r.y;

  gl_Position = projectionMatrix * viewMatrix * vec4(world + offset, 1.0);

  // Row 0 of an ImageBitmap sits at v = 0 — see sampleUv() in layer.ts, which
  // flips for exactly the same reason and must stay in step with this.
  vUv = vec2(aCrop.x + uv.x * aCrop.z, 1.0 - (aCrop.y + uv.y * aCrop.w));
  vLocal = uv;

  // Instances breathe on their own rate as well as their own phase. A shared
  // rate would sum several hundred quads into one slow pulse of the whole
  // frame's luminance, which is the one shape the pacing rules out; spread
  // rates never sum to a beat at all.
  float breath = 0.5 + 0.5 * sin(uTime * uBreathe * aQuad.z + aQuad.w);
  breath *= breath;

  // Fades at both ends: into the dark at the far end, and back out at the near
  // one so nothing swells through the lens.
  float d = distance(world + offset, cameraPosition);
  float lead = uFogNear > 0.0 ? smoothstep(uFogNear * 0.25, uFogNear, d) : 1.0;
  float trail = 1.0 - smoothstep(uFogFar * 0.7, uFogFar, d);
  vFade = breath * lead * trail;
}
`;

export const QUAD_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vLocal;
in float vFade;
out vec4 fragColor;

uniform sampler2D uTex;
// tone gain, tone lift — the same mul-add levelling the composite applies
uniform vec2 uLevels;
uniform vec4 uTint;
uniform float uOpacity;
uniform float uFeather;

void main() {
  float a = vFade * uOpacity;
  if (uFeather > 0.0) {
    vec2 lo = smoothstep(vec2(0.0), vec2(uFeather), vLocal);
    vec2 hi = smoothstep(vec2(0.0), vec2(uFeather), 1.0 - vLocal);
    a *= lo.x * lo.y * hi.x * hi.y;
  }
  // Cheaper than blending a hundred invisible quads, and with depth writes off
  // there is nothing for an early-out to get wrong.
  if (a <= 0.002) discard;

  vec3 col = texture(uTex, vUv).rgb;
  col = clamp(col * uLevels.x + uLevels.y, 0.0, 1.0);
  col = mix(col, col * uTint.rgb, uTint.a);

  fragColor = vec4(col * a, a);
}
`;

/**
 * Solids drifting in the middle distance.
 *
 * The only opaque thing in the frame, and therefore the only thing that writes
 * depth. That is the whole point of them: a page behind a torus is *gone*,
 * which is the one statement about depth that a warped flat frame can never
 * make, however convincing its perspective.
 */
export const SOLID_VERTEX = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SOLID_FRAGMENT = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec3 cameraPosition;
uniform vec4 uCrop;
uniform vec2 uLevels;
uniform vec4 uTint;
uniform float uOpacity;
uniform float uFogFar;

void main() {
  vec3 col = texture(uTex, vec2(uCrop.x + vUv.x * uCrop.z, 1.0 - (uCrop.y + vUv.y * uCrop.w))).rgb;
  col = clamp(col * uLevels.x + uLevels.y, 0.0, 1.0);
  col = mix(col, col * uTint.rgb, uTint.a);

  // One fixed key light. Enough to read the form as a form — a solid lit
  // flatly is a silhouette, and a silhouette is indistinguishable from the
  // hole it punches in the quads behind it.
  vec3 n = normalize(vNormal);
  float key = 0.32 + 0.68 * max(dot(n, normalize(vec3(0.45, 0.75, 0.5))), 0.0);

  // Into the same black the quads fade into, so the two agree about distance.
  float fog = 1.0 - smoothstep(uFogFar * 0.7, uFogFar, distance(vWorld, cameraPosition));

  fragColor = vec4(col * key * fog * uOpacity, 1.0);
}
`;
