/**
 * The post chain. One shader, every effect gated by its own amount uniform,
 * so a zeroed effect costs a uniform branch and nothing else.
 *
 * The halftone screen frequency arrives pre-multiplied by the render
 * resolution (`uHalftoneFreq`) rather than being fixed in pixels — a screen
 * pinned to pixels moirés badly once the internal resolution drops on mobile.
 */
/** Iterations of the KIFS fold. Shared with the backend, which derives the
 *  renormalisation `uFoldNorm` from it — the two must agree or the figure
 *  drifts off the stage. */
export const FOLD_ITERS = 4;

export const POST_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uFeedback;
uniform vec2 uResolution;
uniform float uAspect;
uniform float uTime;

uniform float uFeedbackAmount;
uniform float uFeedbackScale;
uniform float uFeedbackRotate;
uniform float uHalftone;
uniform vec2 uHalftoneFreq;
uniform float uChroma;
uniform float uPosterize;
uniform float uGrain;
uniform float uVignette;
uniform float uExposure;
uniform float uHueShift;

uniform float uKaleido;
uniform float uKaleidoSegments;
uniform float uKaleidoPhase;
uniform float uTile;
uniform float uWarp;
uniform float uWarpScale;
uniform float uWarpSpeed;
uniform float uRipple;
uniform float uRippleFreq;
uniform float uTwist;
uniform float uBulge;
uniform float uSolarize;

uniform float uDroste;
uniform float uDrosteInner;
uniform float uDrostePeriod;
uniform float uDrosteTwist;
uniform float uDrostePhase;
uniform float uTunnel;
uniform float uTunnelDepth;
uniform float uTunnelPhase;
uniform float uFold;
uniform float uFoldScale;
uniform vec2 uFoldOffset;
uniform float uFoldPhase;
/** 1 / uFoldScale^FOLD_ITERS — the renormalisation that brings the iterated
 *  point back into the stage. Derived on the CPU, like uHalftoneFreq. */
uniform float uFoldNorm;
uniform float uLattice;
uniform float uLatticeScale;
uniform float uQuasi;
uniform float uQuasiFreq;
uniform float uTurbulence;
uniform float uTurbulenceScale;
uniform float uTurbulenceSpeed;
uniform float uDisperse;
uniform float uBlur;
uniform float uBlurSpin;

const float TAU = 6.2831853;
/** Iterations of the KIFS fold. Constant so the loop unrolls: a uniform bound
 *  would leave the compiler no choice but to keep the whole body live. */
const int FOLD_ITERS = ${FOLD_ITERS};
const int BLUR_TAPS = 6;
/** Two, not the three this would want on its own. Dispersion re-runs the whole
 *  coordinate chain per channel, so every octave here is paid for three times
 *  over — and the domain warp below supplies far more of the fine structure
 *  than a third octave would. */
const int FBM_OCTAVES = 2;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

/** Value noise. Cheap on purpose — the fBm below calls it twelve times a
 *  pixel, so a gradient noise here would cost more than everything else in the
 *  chain put together. */
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

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    sum += vnoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

/** Ink coverage of one rotated dot screen. Returns 1 where ink lands. */
float screenDot(vec2 p, float angle, float value) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 cell = fract(q) - 0.5;
  float r = sqrt(clamp(value, 0.0, 1.0)) * 0.62;
  return 1.0 - smoothstep(r - 0.06, r + 0.06, length(cell));
}

vec3 halftone(vec3 c, vec2 uv) {
  vec2 p = uv * uHalftoneFreq;
  // Classic CMY screen angles: 15deg, 75deg, 0deg.
  float ci = screenDot(p, 0.2618, 1.0 - c.r);
  float mi = screenDot(p, 1.3090, 1.0 - c.g);
  float yi = screenDot(p, 0.0, 1.0 - c.b);
  return vec3(1.0 - ci, 1.0 - mi, 1.0 - yi);
}

/** Mirror-repeat into 0..1. Identity for coordinates already in range, so a
 *  frame with every distortion at zero comes through untouched. */
vec2 mirrorUv(vec2 p) {
  p = fract(p * 0.5) * 2.0;
  return 1.0 - abs(p - 1.0);
}

/** Screen uv <-> aspect-corrected space centred on the frame, so the radial
 *  effects stay circular on a wide canvas instead of going elliptical. */
vec2 toStage(vec2 uv) { return (uv - 0.5) * vec2(uAspect, 1.0); }
vec2 fromStage(vec2 p) { return p / vec2(uAspect, 1.0) + 0.5; }

/**
 * The coordinate half of the chain: every geometric and undulating effect is a
 * remap of where the frame is sampled, so they all live here and compose in
 * one place.
 *
 * Order is deliberate, in three stages.
 *
 * The *reparameterisations* run first, because they decide what the frame's
 * coordinates mean at all — a tunnel turns radius into depth, a Droste turns it
 * into a repeating strip. Running them ahead of the folds costs nothing (they
 * are smooth and near-bijective, so nothing is torn by them) and buys the fold
 * seams being drawn in the final screen space, where they close.
 *
 * The *symmetry folds* run next, which means everything after them is a
 * function of already-folded coordinates and therefore *inherits* the symmetry
 * — warping after a kaleidoscope keeps the mirror intact, warping before it
 * would tear the seams apart.
 *
 * The smooth *displacements* run last, and they alone are scaled by disp.
 * That is what dispersion moves: three refraction strengths through the same
 * geometry, never three different foldings of it.
 */
vec2 distort(vec2 uv, float disp) {
  if (uTunnel > 0.0) {
    vec2 t = toStage(uv);
    // The floor on radius matters: 1/r at the vanishing point is an infinite
    // frequency, and the scene texture has no mipmaps to fall back on, so
    // without it the centre pixel shimmers between whole stripes every frame.
    // It is also what bounds how many rings deep the tube can get.
    float rr = max(length(t), 0.06);
    // Depth rides the blend as well as the blend riding it. At full strength
    // the tube is eight rings deep, and a straight mix would sweep all eight
    // of them out through the frame as the effect ramped in — which is a
    // strobe by another name however long the ramp is. Scaling the depth too
    // makes the rings *grow* out of a flat frame instead of flying past it.
    float depth = uTunnelDepth * uTunnel;
    // mirrorUv on the target, not just on the result: both ends of the blend
    // are then in-frame coordinates, so the ramp is a bounded morph rather
    // than a excursion through however many repeats lie in between.
    uv = mix(uv, mirrorUv(vec2(atan(t.y, t.x) / TAU, depth / rr + uTunnelPhase)), uTunnel);
  }

  if (uDroste > 0.0) {
    vec2 d = toStage(uv);
    float a = atan(d.y, d.x);
    float lr = log(max(length(d), 1e-4));
    float inner = log(max(uDrosteInner, 1e-3));
    float period = max(uDrostePeriod, 0.15);
    // Shearing the log strip against the angle is what turns the rings into a
    // spiral. Scaled so a whole uDrosteTwist advances an exact number of
    // repeats per turn, which is the condition for the seam to land on itself.
    float sheared = lr - uDrosteTwist * period * a / TAU;
    float ring = mod(sheared - inner - uDrostePhase, period);
    uv = mix(uv, fromStage(vec2(cos(a), sin(a)) * exp(inner + ring)), uDroste);
  }

  if (uFold > 0.0) {
    vec2 f = toStage(uv);
    for (int i = 0; i < FOLD_ITERS; i++) {
      f = abs(f);
      f = rot(f, uFoldPhase);
      f -= uFoldOffset;
      f *= uFoldScale;
    }
    // Bounded before the blend, for the reason given on the tunnel: four
    // compounding zooms can throw a point several frames clear of the stage.
    uv = mix(uv, mirrorUv(fromStage(f * uFoldNorm)), uFold);
  }

  if (uLattice > 0.0) {
    // Fold into the fundamental domain of the hexagonal triangle group: mirror
    // into a quadrant, mirror across the 30 degree line, then translate the
    // remainder back into the cell. What is left tiles the plane by reflection.
    const vec3 hk = vec3(-0.8660254, 0.5, 0.5773503);
    vec2 l = abs(toStage(uv) * uLatticeScale);
    l -= 2.0 * min(dot(hk.xy, l), 0.0) * hk.xy;
    l -= vec2(clamp(l.x, -hk.z * 0.5, hk.z * 0.5), 0.5);
    uv = mix(uv, fromStage(l), uLattice);
  }

  if (uKaleido > 0.0) {
    vec2 k = toStage(uv);
    float seg = TAU / max(2.0, uKaleidoSegments);
    // A slow spin: a static kaleidoscope reads as a wallpaper, and the turn is
    // what makes the fold legible as one. The angle arrives already integrated
    // on the CPU, so the rate can change — or reverse — without the frame
    // jumping to a new phase.
    float a = mod(atan(k.y, k.x) + uKaleidoPhase, seg);
    // Mirror within the wedge so neighbouring segments meet without a seam.
    a = abs(a - seg * 0.5);
    uv = mix(uv, fromStage(vec2(cos(a), sin(a)) * length(k)), uKaleido);
  }

  // Tiling is a scale, not a blend: one copy at 0 is the identity, so the grid
  // grows continuously out of an undisturbed frame rather than cutting in.
  if (uTile > 0.0) uv = mirrorUv((uv - 0.5) * (1.0 + uTile * 3.0) + 0.5);

  vec2 p = toStage(uv);
  float r = length(p);

  if (uBulge != 0.0) p *= 1.0 - uBulge * disp * (1.0 - smoothstep(0.0, 0.8, r));

  if (uTwist != 0.0) {
    // Rotation falls off with radius, which is what shears the frame into a
    // spiral instead of just turning it.
    p = rot(p, uTwist * disp * (0.6 - r));
  }

  if (uRipple > 0.0) {
    p += (p / max(r, 1e-4)) * sin(r * uRippleFreq - uTime * 1.7) * uRipple * disp * 0.045;
  }

  if (uQuasi > 0.0) {
    // Five plane waves at 36 degree steps: the sum is five-fold symmetric and
    // never repeats. Displacing along its *gradient* rather than radially is
    // what makes it read as refraction through a lattice — a radial push would
    // just be another ripple centred on the viewer.
    vec2 g = vec2(0.0);
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 0.6283185 + uTime * 0.015;
      vec2 d = vec2(cos(a), sin(a));
      g -= d * sin(dot(p, d) * uQuasiFreq);
    }
    p += g * uQuasi * disp * 0.01;
  }
  uv = fromStage(p);

  if (uWarp > 0.0) {
    // Two incommensurate sines per axis: one alone reads as a rolling shutter,
    // the pair reads as liquid.
    float t = uTime * uWarpSpeed;
    vec2 q = uv * uWarpScale;
    uv += vec2(
      sin(q.y * 3.1 + t * 1.3) + 0.5 * sin(q.y * 5.7 - t * 0.7),
      cos(q.x * 2.7 - t * 1.1) + 0.5 * cos(q.x * 6.3 + t * 0.9)
    ) * uWarp * disp * 0.055;
  }

  if (uTurbulence > 0.0) {
    // fBm sampled at a position fBm itself displaced. One level of that is the
    // difference between noise that looks like static and noise that looks
    // like marbled ink, and it is the reason this costs what it costs.
    float t = uTime * uTurbulenceSpeed;
    vec2 q = uv * uTurbulenceScale;
    vec2 w = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3 - t)));
    vec2 v = vec2(fbm(q + 3.1 * w + vec2(1.7, 9.2)), fbm(q + 3.1 * w + vec2(8.3, 2.8)));
    uv += (v - 0.5) * uTurbulence * disp * 0.14;
  }

  return mirrorUv(uv);
}

/** One sample of the scene. split false is the fast path: with no channel
 *  separation asked for there is one fetch here rather than three. */
vec3 fetch(vec2 uvR, vec2 uvG, vec2 uvB, bool split) {
  if (!split) return texture(uScene, uvG).rgb;
  return vec3(
    texture(uScene, uvR).r,
    texture(uScene, uvG).g,
    texture(uScene, uvB).b
  );
}

void main() {
  vec2 uv = vUv;
  vec2 radial = uv - 0.5;

  vec2 suvG = distort(uv, 1.0);
  vec2 suvR = suvG;
  vec2 suvB = suvG;
  bool split = uChroma > 0.0 || uDisperse > 0.0;

  // Dispersion re-runs the chain at two other refraction strengths. The chain
  // is pure arithmetic — no fetches — so three of it costs far less than the
  // texture bandwidth already in flight, and it is the only way to get the
  // channels genuinely bent apart rather than merely offset.
  if (uDisperse > 0.0) {
    suvR = distort(uv, 1.0 + uDisperse);
    suvB = distort(uv, 1.0 - uDisperse);
  }
  if (uChroma > 0.0) {
    vec2 off = radial * uChroma * 0.012;
    suvR += off;
    suvB -= off;
  }

  vec3 col;
  if (uBlur > 0.0) {
    // Radial at 0, tangential at 1. Both scale with radius on their own, so the
    // centre stays sharp and the corners streak — which is what makes it read
    // as the frame moving rather than as it being out of focus.
    vec2 dir = mix(radial, vec2(-radial.y, radial.x), uBlurSpin) * uBlur * 0.12;
    col = vec3(0.0);
    for (int i = 0; i < BLUR_TAPS; i++) {
      // Centred on the sample, so the blur has no net displacement of its own.
      vec2 o = dir * (float(i) / float(BLUR_TAPS - 1) - 0.5);
      col += fetch(suvR + o, suvG + o, suvB + o, split);
    }
    col /= float(BLUR_TAPS);
  } else {
    col = fetch(suvR, suvG, suvB, split);
  }

  if (uFeedbackAmount > 0.0) {
    float ca = cos(uFeedbackRotate);
    float sa = sin(uFeedbackRotate);
    vec2 f = vec2(radial.x * ca - radial.y * sa, radial.x * sa + radial.y * ca);
    f = f / max(uFeedbackScale, 0.001) + 0.5;
    vec3 prev = texture(uFeedback, clamp(f, 0.0, 1.0)).rgb;
    // max() rather than mix(): trails stay bright instead of greying the frame
    col = max(col, prev * uFeedbackAmount);
  }

  if (uHueShift != 0.0) col = hueRotate(col, uHueShift);
  if (uHalftone > 0.0) col = mix(col, halftone(col, uv), uHalftone);

  // Tone fold: highlights invert and mid-tones peak, the darkroom solarisation.
  // Sits before posterize so the quantiser sees the final tone curve.
  if (uSolarize > 0.0) col = mix(col, 1.0 - abs(1.0 - 2.0 * col), uSolarize);

  if (uPosterize > 0.0) {
    float levels = mix(64.0, 4.0, clamp(uPosterize, 0.0, 1.0));
    col = floor(col * levels + 0.5) / levels;
  }

  col *= uExposure;

  if (uVignette > 0.0) {
    float d = length(radial * vec2(uAspect, 1.0)) * 1.05;
    col *= clamp(1.0 - uVignette * d * d, 0.0, 1.0);
  }

  if (uGrain > 0.0) {
    col += (hash21(uv * uResolution + fract(uTime) * 137.0) - 0.5) * uGrain;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
