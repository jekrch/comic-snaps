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
  /*
   * Row 0 of an ImageBitmap sits at v = 0 — same flip as the quad program.
   *
   * At an explicit gradient, for the surface program's reason one step milder.
   * The mirror is continuous, so there is no jump to misread — but its
   * derivative flips sign at every fold, and at the vanishing point of a
   * corridor the folds arrive several to a pixel, where the hardware's estimate
   * is noise. Reading it off vUv, which is smooth the length of the tube,
   * gives every fragment the level its actual footprint deserves — which is the
   * far end of the corridor, and the whole reason the chain is there.
   */
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec3 col = textureGrad(
    uTex,
    vec2(m.x, 1.0 - m.y),
    vec2(dx.x, -dx.y),
    vec2(dy.x, -dy.y)
  ).rgb;
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
 * The papered surface — the program the reworked scenes are built on.
 *
 * One grid, one draw per resident panel, and no per-instance anything, exactly
 * as the tube. The reasoning is the tube's as well: a quad has a rim, a frame
 * full of rims is a scatter of cards in the dark, and the only way to make the
 * picture *be* comic art rather than be sprinkled with it is to give it no edges
 * at all. What is new is that the surface can be seen from outside, so it is a
 * shape rather than a room — and a shape can turn, which a corridor cannot.
 *
 * Three things share this one program.
 *
 * **The geometry is a uniform.** The attribute is only "how far around" and "how
 * far along"; `surfacePoint` sweeps that pair into a closed body, a drape or a
 * band, and every dimension of each is a uniform. So a drum can round into a
 * sphere, a gem can flatten into a plate, and a band can wind up its own twist,
 * all without a rebuild — the same trade the tube makes, for the same reason.
 *
 * **The normal is a difference, not an attribute.** `surfacePoint` is evaluated
 * three times a vertex and the normal comes out of the cross product. That is
 * the only way to keep it honest through a shape that is changing every frame,
 * and it costs three evaluations of some trigonometry at a few thousand
 * vertices — nothing at all beside a post chain that touches every pixel a dozen
 * times.
 *
 * **The crops are a hash of the cell.** The surface is diced into `uCells`
 * faces, each of which samples its own sub-rectangle of the one resident page.
 * A rotating body is therefore a dozen unrelated details of a single comic page
 * arriving one after another as it turns, which is the whole idea: out of
 * context, but all of one context.
 */
export const SURFACE_VERTEX = `#version 300 es
precision highp float;

// x: fraction around (or across), y: fraction along.
in vec2 aGrid;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

// 0 closed body, 1 drape, 2 band — see SurfaceBody.
uniform int uBody;
uniform vec3 uSize;
uniform float uSides;
uniform float uRound;
uniform float uCap;
uniform float uTwist;
uniform float uBurst;
uniform float uRipple;
uniform float uRippleScale;
uniform float uRipplePhase;
uniform vec2 uCells;
// One grid step, so the normal's finite difference matches the tessellation
// rather than being an arbitrary epsilon.
uniform vec2 uStep;
uniform vec2 uKnot;

out vec2 vGrid;
out vec3 vWorld;
out vec3 vNormal;

const float TAU = 6.283185307179586;
const float PI = 3.141592653589793;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/**
 * How far this cell's plate has swollen off the body.
 *
 * A bump that is zero on the cell's own boundary, so neighbouring plates part
 * company in the middle and the surface is still one piece at the seam. That is
 * what lets the body come apart without the mesh having to be torn into
 * per-cell geometry: what opens between the plates is a valley rather than a
 * hole, the gutter darkens the bottom of it, and the reading is the same.
 */
float plate(vec2 g) {
  if (uBurst <= 0.0) return 0.0;
  vec2 f = fract(g * uCells);
  float bump = sin(f.x * PI) * sin(f.y * PI);
  // Squared, so the plate is flat across most of its face and falls away only
  // near the edges — a segment lifting, rather than a blister.
  bump *= bump;
  float amount = 0.35 + 0.65 * hash21(floor(g * uCells) + 3.7);
  return bump * amount * uBurst;
}

/** A point on the tube of a torus, and the surface normal there. The band is
 *  swept in this frame rather than off a finite-difference basis: a curve's own
 *  normal flips wherever its tangent crosses the world up, and a band that flips
 *  is a band with a crease across it. The torus normal never does. */
vec3 torusAt(float s) {
  float around = uKnot.x * s;
  float tube = uKnot.y * s;
  float ring = 2.0 + cos(tube);
  return vec3(ring * cos(around), sin(tube), ring * sin(around)) * uSize.z;
}

vec3 torusNormal(float s) {
  float around = uKnot.x * s;
  float tube = uKnot.y * s;
  return vec3(cos(tube) * cos(around), sin(tube), cos(tube) * sin(around));
}

vec3 surfacePoint(vec2 g) {
  if (uBody == 1) {
    // A drape: the grid left flat and thrown into travelling folds. Larger than
    // the frame by construction, so there is no silhouette anywhere in it and
    // the picture is full bleed at every moment of the run.
    float x = (g.x - 0.5) * uSize.x;
    float y = (g.y - 0.5) * uSize.y;
    // Three incommensurate waves rather than one. A single sine is a corrugation
    // and reads as a flag; the beat between three is cloth, because no two
    // crests ever arrive together twice.
    float z = sin(x * uRippleScale + uRipplePhase) * uRipple;
    z += sin(y * uRippleScale * 0.71 - uRipplePhase * 0.83) * uRipple * 0.72;
    z += sin((x + y * 0.6) * uRippleScale * 1.93 + uRipplePhase * 1.31) * uRipple * 0.33;
    // And a bowl, so the cloth curls away at its edges instead of ending. With
    // the camera inside the curl there is no edge to find in any direction.
    z -= (x * x * 0.6 + y * y) * uTwist;
    return vec3(x, y, z);
  }

  if (uBody == 2) {
    // A band: a wide strip swept along a torus knot, rolling about its own
    // centre line as it goes. Wide enough that passing the camera fills the
    // frame — the whole failure of a ribbon of quads was that it never could.
    float s = g.x * TAU;
    vec3 centre = torusAt(s);
    vec3 nrm = torusNormal(s);
    vec3 along = normalize(torusAt(s + 0.01) - torusAt(s - 0.01));
    // Perpendicular to the curve and lying in the torus surface. Both terms are
    // continuous everywhere on the knot, so the frame cannot flip.
    vec3 across = normalize(cross(along, nrm));
    float roll = s * uTwist;
    float w = (g.y - 0.5) * uSize.x;
    vec3 lie = across * cos(roll) + nrm * sin(roll);
    // The strip fluttering about its own centre line — one edge lifting as the
    // other drops, strongest at the edges and zero along the middle.
    //
    // Odd in g.y rather than even, and it has to be. The roll is a half-integer
    // number of turns, so after one circuit the frame has rotated by pi and the
    // strip meets itself with its two edges swapped — which is what makes this a
    // Möbius band and what makes it close at all. A displacement that lifted
    // *both* edges the same way would not survive that swap: it would arrive at
    // the seam pointing the wrong way and tear the band open by twice its own
    // amplitude. An odd one flips with the frame and meets itself exactly.
    float wave = sin(s * uRippleScale + uRipplePhase) * uRipple * (g.y - 0.5) * 2.0;
    return centre + lie * w + cross(lie, along) * wave;
  }

  // A closed body of revolution, and the one the crops were designed around.
  float y = (g.y - 0.5) * 2.0;
  float ang = g.x * TAU + g.y * uTwist;

  // Regular polygon of circumradius 1, rounded toward a circle. This is what
  // gives the object *sides* — a face wide enough to carry a whole crop flat,
  // with a hard corner where it hands over to the next one.
  float wedge = PI / max(uSides, 3.0);
  float poly = cos(wedge) / max(cos(mod(ang, 2.0 * wedge) - wedge), 0.2);
  float section = mix(poly, 1.0, clamp(uRound, 0.0, 1.0));

  // Superellipse along the axis: 1 is a cut gem, 2 a sphere, 5 a drum. The
  // second half of the shape, and the reason one branch covers all of them.
  float cap = pow(max(1.0 - pow(abs(y), uCap), 0.0), 1.0 / uCap);

  float r = uSize.x * section * cap;
  if (uRipple > 0.0) {
    r += sin(y * uRippleScale * 3.0 + uRipplePhase) * uRipple;
    r += sin(ang * 3.0 - uRipplePhase * 0.7) * uRipple * 0.45;
  }

  vec3 p = vec3(cos(ang) * r, y * uSize.y, sin(ang) * r);
  // Outward, roughly: radial where the body is straight-sided and tipped toward
  // the poles where it closes. Good enough to lift a plate along, and it costs
  // nothing beside the exact normal the vertex stage is about to difference.
  vec3 outward = normalize(vec3(cos(ang) * cap, y * 0.85, sin(ang) * cap) + 1e-5);
  // Sheared to match the facets, exactly as vGrid is at the end of main() — a
  // plate that swelled on the raw parameter would part company from the gutter
  // that is supposed to be falling into the valley it opens.
  return p + outward * plate(vec2(g.x + g.y * uTwist / TAU, g.y));
}

void main() {
  vec3 local = surfacePoint(aGrid);
  vec3 du = surfacePoint(aGrid + vec2(uStep.x, 0.0)) - local;
  vec3 dv = surfacePoint(aGrid + vec2(0.0, uStep.y)) - local;

  // Degenerate wherever the parameterisation pinches — the poles of a body, and
  // any row the ripple happens to flatten. Facing the eye is the harmless answer
  // there: it is a handful of vertices, and the alternative is a NaN that takes
  // every triangle touching them with it.
  vec3 raw = cross(du, dv);
  float len = length(raw);
  vec3 n = len > 1e-7 ? raw / len : vec3(0.0, 0.0, 1.0);

  vec4 world = modelMatrix * vec4(local, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * n;

  // The cell grid follows the facets rather than the parameter.
  //
  // A body's shear moves where its corners *are* — see ang above — so a cell
  // grid left on the raw parameter would slide off them, and every gutter would
  // end up running down the middle of a face instead of along the edge between
  // two. Sheared by exactly the same amount, the two stay locked; and because
  // the shift is exactly one whole turn apart at the seam, whole cells still
  // wrap into whole cells there.
  vGrid = uBody == 0 ? vec2(aGrid.x + aGrid.y * uTwist / TAU, aGrid.y) : aGrid;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SURFACE_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vGrid;
in vec3 vWorld;
in vec3 vNormal;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec3 cameraPosition;
uniform vec2 uLevels;
uniform vec4 uTint;
uniform float uOpacity;
uniform vec2 uCells;
uniform float uZoom;
uniform float uGutter;
uniform float uSeed;
uniform float uPanelAspect;
uniform float uCellAspect;
uniform float uRim;
uniform float uSolid;
uniform float uFogNear;
uniform float uFogFar;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = normalize(cameraPosition - vWorld);
  float facing = dot(n, toEye);

  // Only the near side of a closed body, decided here rather than by the cull
  // state. Winding through surfacePoint depends on which branch built the
  // grid; which side faces the camera does not, so this is the test that cannot
  // be got backwards — and it is exact for a convex body, which these are.
  if (uSolid > 0.5 && facing < 0.0) discard;
  if (facing < 0.0) n = -n;

  // Which face of the object this is. The seam column belongs to the first cell
  // rather than to a phantom one past the end.
  vec2 scaled = vGrid * uCells;
  vec2 cell = floor(scaled);
  cell = mod(cell, uCells);
  vec2 f = clamp(scaled - floor(scaled), 0.0, 1.0);

  // The crop this face wears: a sub-rectangle of the one resident page, its
  // proportions matched to the cell so nothing is stretched, its position drawn
  // per cell so no two faces show the same thing. Same page on all of them —
  // that is the point. A body turning is then one page read as a dozen
  // unrelated details, none of them where they belong.
  float ratio = uCellAspect / max(uPanelAspect, 0.05);
  vec2 size = ratio > 1.0 ? vec2(1.0, 1.0 / ratio) : vec2(ratio, 1.0);
  size *= clamp(uZoom, 0.05, 1.0);
  vec2 origin = vec2(hash21(cell + uSeed), hash21(cell.yx * 1.7 + uSeed + 11.3));
  vec2 uv = origin * (1.0 - size) + f * size;

  /*
   * Row 0 of an ImageBitmap sits at v = 0 — same flip as every other program.
   *
   * Sampled at an explicit gradient rather than the hardware's own, because the
   * coordinate above is discontinuous by design: at every cell boundary f
   * wraps from one to zero and origin jumps to a different hash. A derivative
   * taken across that reads as most of the page in one pixel, which selects the
   * coarsest level in the chain — so the panel textures having a chain at all
   * would draw a blurred grey line along every seam of every surface. The
   * gradient of the continuous map underneath the dicing is the true one, and it
   * is what the whole cell should be sampled at.
   */
  vec2 gx = dFdx(scaled) * size;
  vec2 gy = dFdy(scaled) * size;
  vec3 col = textureGrad(
    uTex,
    vec2(uv.x, 1.0 - uv.y),
    vec2(gx.x, -gx.y),
    vec2(gy.x, -gy.y)
  ).rgb;
  col = clamp(col * uLevels.x + uLevels.y, 0.0, 1.0);
  col = mix(col, col * uTint.rgb, uTint.a);

  // The gutter between faces. The one edge worth having on a surface built to
  // have none: it reads as the black between panels rather than as the rim of a
  // card, and where the plates have lifted it is the bottom of the valley
  // between them.
  vec2 edge = min(f, 1.0 - f);
  float gutter = uGutter > 0.0 ? smoothstep(0.0, uGutter, min(edge.x, edge.y)) : 1.0;

  // One fixed key, as on the solids, plus a grazing rim. The rim is doing most
  // of the work of saying the object is round: a body lit only by a key reads as
  // a flat cut-out wherever the key happens to be even.
  float key = 0.4 + 0.6 * max(dot(n, normalize(vec3(0.42, 0.72, 0.55))), 0.0);
  float rim = pow(1.0 - clamp(abs(facing), 0.0, 1.0), 3.0) * uRim;

  // Fades at both ends: into the dark down the far side of the object, and back
  // out at the near one so that nothing ever swells through the lens.
  //
  // The near fade is what lets these scenes put the camera as close as they do.
  // A shape that overflows the frame is the entire correction being made here,
  // and the price of it is that a lobe of a knot or a plate standing off a body
  // occasionally comes within a unit of the eye — where without this it would
  // clip through the near plane and tear a hole in the picture.
  float d = distance(vWorld, cameraPosition);
  float fog = 1.0 - smoothstep(uFogFar * 0.55, uFogFar, d);
  if (uFogNear > 0.0) fog *= smoothstep(uFogNear * 0.2, uFogNear, d);

  // Clamped, and this is the washout governor for the whole path: the surface
  // fills the frame, the feedback trail accumulates with max(), and a rim that
  // was allowed to add on top of a full key would re-open exactly what bd1d4c5
  // closed.
  float a = uOpacity * fog * gutter * clamp(key + rim, 0.0, 1.0);
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
