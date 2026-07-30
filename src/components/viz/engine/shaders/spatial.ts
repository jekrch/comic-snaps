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
// Per instance: which way is "along", in each arrangement. Read only when
// uAlign is up — see the note on SlotLayout.tanA.
in vec3 aTanA;
in vec3 aTanB;
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
uniform float uAlign;
uniform float uScale;
uniform float uPanelAspect;
uniform float uTime;
uniform float uBreathe;
uniform float uWrap;
uniform float uTravel;
uniform float uDisplace;
uniform float uDisplaceScale;
uniform float uDisplacePhase;
uniform float uSwirl;
uniform float uSwirlScale;
uniform float uFogNear;
uniform float uFogFar;

out vec2 vUv;
out vec2 vLocal;
out float vFade;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

vec3 potential(vec3 p) {
  return vec3(vnoise3(p), vnoise3(p + 19.7), vnoise3(p - 7.3));
}

/**
 * Curl of a noise potential — divergence-free by construction, so it stirs the
 * formation without pumping it anywhere. An arbitrary vector noise would pile
 * quads into wherever it happened to converge and leave holes behind them.
 *
 * Six evaluations of a three-component potential, which is eighteen noise
 * lookups. That is a real cost per pixel and nothing at all per vertex: at four
 * vertices an instance the whole formation is a couple of thousand of these a
 * frame, which is the one place in this engine where the expensive thing is free.
 */
vec3 curl3(vec3 p) {
  const float e = 0.35;
  vec3 dx = potential(p + vec3(e, 0.0, 0.0)) - potential(p - vec3(e, 0.0, 0.0));
  vec3 dy = potential(p + vec3(0.0, e, 0.0)) - potential(p - vec3(0.0, e, 0.0));
  vec3 dz = potential(p + vec3(0.0, 0.0, e)) - potential(p - vec3(0.0, 0.0, e));
  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
}

void main() {
  vec3 local = mix(aPosA, aPosB, uMorph);
  vec3 surface = mix(aNrmA, aNrmB, uMorph);

  // The endless corridor: the instances stay put and the repeat slides through
  // them, so nothing here ever leaves the range it was built in.
  if (uWrap > 0.0) {
    local.z = mod(local.z + uTravel, uWrap) - uWrap;
  }

  if (uDisplace > 0.0) {
    // Along the surface's own normal, so what this means is decided by the
    // formation: for a sheet it is a swell out of the plane, and for a shell or a
    // sphere it is the whole surface breathing. Three incommensurate travelling
    // waves rather than one — a single sine reads as a rolling shutter, and it
    // is the beat between them that makes a surface look like it has weight.
    //
    // This is the operation the post chain structurally cannot reach. A uv warp
    // moves where the frame is *sampled*; this moves where the geometry *is*, so
    // one sheet can cross another and be occluded by it.
    float w = sin(local.x * uDisplaceScale + uDisplacePhase)
            + 0.6 * sin(local.y * uDisplaceScale * 1.37 - uDisplacePhase * 0.83)
            + 0.35 * sin(local.z * uDisplaceScale * 0.71 + uDisplacePhase * 1.19);
    local += normalize(surface + 1e-5) * w * uDisplace;
  }

  if (uSwirl > 0.0) {
    // Advanced by the displacement's own phase rather than by a clock of its
    // own: a formation running both would otherwise have two schedules moving
    // it, which is the thing the pacing rules single out.
    local += curl3(local * uSwirlScale + vec3(0.0, 0.0, uDisplacePhase * 0.4)) * uSwirl;
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

  if (uAlign > 0.0) {
    // The world up above fixes the plane but gives a roll that has nothing to do
    // with the formation. Invisible for a scatter, and fatal for a ribbon: a
    // strip only reads as a strip if consecutive quads agree which way is along
    // it, and rolled independently they shear into confetti. So the formation's
    // own tangent is projected into the quad's plane and blended in.
    vec3 along = mat3(modelMatrix) * mix(aTanA, aTanB, uMorph);
    vec3 planar = along - n * dot(along, n);
    float span = length(planar);
    if (span > 1e-4) {
      vec3 blend = mix(right, planar / span, uAlign);
      // The two are antiparallel wherever the curve happens to run against the
      // world up, and a normalise of that is a NaN that takes the quad with it.
      float reachAlong = length(blend);
      if (reachAlong > 1e-3) right = blend / reachAlong;
    }
  }

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
 * The wallpaper tube.
 *
 * One grid, one draw per resident panel, and no per-instance anything: where the
 * quad program's job is to place several separate rectangles, this program's job
 * is to make sure there is *nothing* separate in the frame. The geometry is a
 * parameter-space grid — the attribute is only "how far around" and "how far
 * along" — and the cylinder, its profile, its twist and its ripple are all built
 * here from uniforms, which is what lets the corridor change shape without a
 * rebuild.
 *
 * Nothing in here translates. The tube stands still around the camera and the
 * *texture coordinates* scroll, which is both why the flight can never run out of
 * corridor and why it can never deliver anything to the viewer's face.
 */
export const TUBE_VERTEX = `#version 300 es
precision highp float;

// x: fraction around the circumference, y: fraction along the tube.
in vec2 aGrid;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

uniform float uRadius;
uniform float uLength;
uniform float uBack;
uniform float uProfile;
uniform float uTiles;
uniform float uTwist;
uniform float uScroll;
uniform float uRipple;
uniform float uRippleScale;
uniform float uRipplePhase;
uniform float uPanelAspect;

out vec2 vUv;
out float vDist;
out float vGraze;

const float TAU = 6.283185307179586;

void main() {
  float along = aGrid.y;
  float ang = aGrid.x * TAU + along * uTwist;

  // Straight pipe to barrel. Bounded away from zero at both ends so the wall
  // never crosses the axis the camera is sitting on.
  float barrel = 0.5 + 0.85 * sin(along * 3.14159265);
  float r = uRadius * mix(1.0, barrel, uProfile);

  float z = uBack - along * (uBack + uLength);

  // Two ripples, one along the tube and one around it, so the corridor's section
  // is never exactly a circle and the swell never reads as a single pulse.
  if (uRipple > 0.0) {
    r += sin(z * uRippleScale + uRipplePhase) * uRipple;
    r += sin(ang * 3.0 - uRipplePhase * 0.7) * uRipple * 0.4;
  }

  vec3 local = vec3(cos(ang) * r, sin(ang) * r, z);
  vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

  vDist = distance(world, cameraPosition);

  // The wall's own inward normal against the line of sight. Near the camera the
  // wall is edge-on and this goes to zero; down the corridor it turns to face the
  // lens. Used in the fragment stage as a light falloff, which is the cue that
  // says the tube has length — a uniformly bright pipe reads as a flat ring.
  vec3 inward = normalize(mat3(modelMatrix) * vec3(-cos(ang), -sin(ang), 0.0));
  vec3 toEye = normalize(cameraPosition - world);
  vGraze = abs(dot(inward, toEye));

  // Keep the page's proportions on the wall. A tile is the circumference divided
  // by however many copies go round, and its height follows from the panel's own
  // aspect — so the wallpaper is never stretched, whatever radius or length the
  // scene asks for.
  float tileWidth = (TAU * uRadius) / max(uTiles, 0.001);
  float tileHeight = tileWidth / max(uPanelAspect, 0.05);
  vUv = vec2(aGrid.x * uTiles, (along * (uBack + uLength) + uScroll) / tileHeight);
}
`;

export const TUBE_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
in float vDist;
in float vGraze;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uLevels;
uniform vec4 uTint;
uniform float uOpacity;
uniform float uFogFar;

void main() {
  // Mirrored tiling rather than wrapped. A wrapped copy butts its right edge
  // against the next copy's left one and leaves a hard seam every tile — the
  // exact edge this whole surface exists to avoid — where a mirrored one matches
  // its neighbour by construction and the wall has no discontinuity in it at all.
  vec2 m = abs(fract(vUv * 0.5) * 2.0 - 1.0);
  // Row 0 of an ImageBitmap sits at v = 0 — same flip as the quad program.
  vec3 col = texture(uTex, vec2(m.x, 1.0 - m.y)).rgb;
  col = clamp(col * uLevels.x + uLevels.y, 0.0, 1.0);
  col = mix(col, col * uTint.rgb, uTint.a);

  // Into the black at the far end, and dimmed where the wall is edge-on.
  //
  // Both ends of the corridor are grazing — close to the lens the wall is at
  // ninety degrees, and at the vanishing point it is edge-on again — so this
  // brightens a band in between and needs a generous floor, or the middle of the
  // frame goes dark twice over once the fog has had its turn.
  float fog = 1.0 - smoothstep(uFogFar * 0.5, uFogFar, vDist);
  float key = 0.45 + 0.55 * pow(vGraze, 0.45);

  float a = uOpacity * fog * key;
  if (a <= 0.002) discard;
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
