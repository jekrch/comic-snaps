/**
 * The post chain. One shader, every effect gated by its own amount uniform,
 * so a zeroed effect costs a uniform branch and nothing else.
 *
 * The halftone screen frequency arrives pre-multiplied by the render
 * resolution (`uHalftoneFreq`) rather than being fixed in pixels — a screen
 * pinned to pixels moirés badly once the internal resolution drops on mobile.
 */
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
uniform float uTile;
uniform float uWarp;
uniform float uWarpScale;
uniform float uWarpSpeed;
uniform float uRipple;
uniform float uRippleFreq;
uniform float uTwist;
uniform float uBulge;
uniform float uSolarize;

const float TAU = 6.2831853;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
 * Order is deliberate. The symmetry folds run first, which means everything
 * after them is a function of already-folded coordinates and therefore
 * *inherits* the symmetry — warping after a kaleidoscope keeps the mirror
 * intact, warping before it would tear the seams apart.
 */
vec2 distort(vec2 uv) {
  if (uKaleido > 0.0) {
    vec2 k = toStage(uv);
    float seg = TAU / max(2.0, uKaleidoSegments);
    // A slow intrinsic spin: a static kaleidoscope reads as a wallpaper, and
    // the turn is what makes the fold legible as one.
    float a = mod(atan(k.y, k.x) + uTime * 0.06, seg);
    // Mirror within the wedge so neighbouring segments meet without a seam.
    a = abs(a - seg * 0.5);
    uv = mix(uv, fromStage(vec2(cos(a), sin(a)) * length(k)), uKaleido);
  }

  // Tiling is a scale, not a blend: one copy at 0 is the identity, so the grid
  // grows continuously out of an undisturbed frame rather than cutting in.
  if (uTile > 0.0) uv = mirrorUv((uv - 0.5) * (1.0 + uTile * 3.0) + 0.5);

  vec2 p = toStage(uv);
  float r = length(p);

  if (uBulge != 0.0) p *= 1.0 - uBulge * (1.0 - smoothstep(0.0, 0.8, r));

  if (uTwist != 0.0) {
    // Rotation falls off with radius, which is what shears the frame into a
    // spiral instead of just turning it.
    float a = uTwist * (0.6 - r);
    float c = cos(a);
    float s = sin(a);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  if (uRipple > 0.0) {
    p += (p / max(r, 1e-4)) * sin(r * uRippleFreq - uTime * 1.7) * uRipple * 0.045;
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
    ) * uWarp * 0.055;
  }

  return mirrorUv(uv);
}

void main() {
  vec2 uv = vUv;
  vec2 radial = uv - 0.5;
  vec2 suv = distort(uv);

  vec3 col;
  if (uChroma > 0.0) {
    vec2 off = radial * uChroma * 0.012;
    col = vec3(
      texture(uScene, suv + off).r,
      texture(uScene, suv).g,
      texture(uScene, suv - off).b
    );
  } else {
    col = texture(uScene, suv).rgb;
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
