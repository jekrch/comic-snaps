/**
 * The composite pass: N shards blended onto a base in a single fragment
 * shader, rather than one full-screen pass per shard.
 *
 * Sampler arrays in GLSL ES 3.00 may only be indexed by constant expressions,
 * so the per-shard block is unrolled here with literal indices at build time.
 * The upside is that a scene with 12 layers still costs one screen of fill,
 * which is what keeps the heavier presets viable on mobile.
 *
 * Coordinates: fragments are mapped into "stage space", where y spans 0..1 and
 * x spans 0..aspect, so rotations stay circular without per-shard correction.
 */
export function compositeFragment(maxShards: number): string {
  let blocks = "";
  for (let i = 0; i < maxShards; i++) {
    blocks += `
  if (${i} < uCount) {
    vec4 rect = uRect[${i}];
    vec4 misc = uMisc[${i}];
    vec2 d = p - rect.xy;
    // inverse rotation into the shard's local frame
    vec2 local = vec2(d.x * misc.x + d.y * misc.y, -d.x * misc.y + d.y * misc.x);
    vec2 q = local / max(rect.zw, vec2(1e-4)) + 0.5;
    if (q.x > -0.001 && q.x < 1.001 && q.y > -0.001 && q.y < 1.001) {
      vec4 src = uSrc[${i}];
      vec2 c = clamp(q, 0.0, 1.0);
      vec3 tex = texture(uTex[${i}], sampleUv(src, c)).rgb;
      // Level toward a common key before tint and blend, so a bright page has
      // somewhere to climb instead of saturating the frame — see levelsFor().
      vec2 lvl = uLevels[${i}];
      tex = clamp(tex * lvl.x + lvl.y, 0.0, 1.0);
      vec4 tint = uTint[${i}];
      tex = mix(tex, tex * tint.rgb, tint.a);
      float a = misc.z * edgeMask(q, misc.w);
      col = mix(col, blendPixel(col, tex, uMode[${i}]), a);
    }
  }
`;
  }

  return `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex[${maxShards}];
uniform sampler2D uBase;
uniform float uUseBase;
uniform vec3 uBackground;
uniform float uAspect;
uniform int uCount;

// per shard: centre.xy + size.xy
uniform vec4 uRect[${maxShards}];
// per shard: crop origin.uv + crop size.uv
uniform vec4 uSrc[${maxShards}];
// per shard: cos, sin, opacity, feather
uniform vec4 uMisc[${maxShards}];
// per shard: tone gain, tone lift
uniform vec2 uLevels[${maxShards}];
// per shard: tint.rgb + tint amount
uniform vec4 uTint[${maxShards}];
uniform float uMode[${maxShards}];

vec3 blendPixel(vec3 b, vec3 s, float m) {
  if (m < 0.5) return s;                                    // normal
  if (m < 1.5) return 1.0 - (1.0 - b) * (1.0 - s);          // screen
  if (m < 2.5) return max(b, s);                            // lighten
  if (m < 3.5) return abs(b - s);                           // difference
  if (m < 4.5) return b + s - 2.0 * b * s;                  // exclusion
  if (m < 5.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); // overlay
  if (m < 6.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s)); // hard-light
  return b * s;                                             // multiply
}

/**
 * Map a shard-local position to a texel in its source image.
 *
 * Crop rectangles are expressed bottom-up, matching GL's convention, but
 * ImageBitmap sources ignore UNPACK_FLIP_Y_WEBGL entirely (their orientation
 * is fixed when the bitmap is created), so row 0 of the image sits at v = 0.
 * Flipping here rather than at upload keeps that quirk out of the pool and
 * leaves render-target samples — which really are bottom-up — untouched.
 */
vec2 sampleUv(vec4 src, vec2 q) {
  return vec2(src.x + q.x * src.z, 1.0 - (src.y + q.y * src.w));
}

/** 1 inside the shard, falling to 0 across the feather width in local uv. */
float edgeMask(vec2 q, float feather) {
  if (feather <= 0.0) {
    return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  }
  vec2 lo = smoothstep(vec2(0.0), vec2(feather), q);
  vec2 hi = smoothstep(vec2(0.0), vec2(feather), 1.0 - q);
  return lo.x * lo.y * hi.x * hi.y;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec3 col = mix(uBackground, texture(uBase, vUv).rgb, uUseBase);
${blocks}
  fragColor = vec4(col, 1.0);
}
`;
}
