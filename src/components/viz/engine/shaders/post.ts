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

void main() {
  vec2 uv = vUv;
  vec2 radial = uv - 0.5;

  vec3 col;
  if (uChroma > 0.0) {
    vec2 off = radial * uChroma * 0.012;
    col = vec3(
      texture(uScene, uv + off).r,
      texture(uScene, uv).g,
      texture(uScene, uv - off).b
    );
  } else {
    col = texture(uScene, uv).rgb;
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
