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
/** Thresholded and blurred copy of the scene, in scene space — so it is indexed
 *  by the same distorted coordinate the scene is. */
uniform sampler2D uBloomTex;
/** Advected flow field and the Gray-Scott chemicals, both 0.5-centred where
 *  they carry a signed value. */
uniform sampler2D uFlowTex;
uniform sampler2D uReactTex;
/** Ring of recent frames, tiled into one atlas. */
uniform sampler2D uHistory;
uniform vec2 uResolution;
/** Resolution of the flow and reaction fields, which run well below the frame. */
uniform vec2 uFieldResolution;
uniform float uAspect;
uniform float uTime;

uniform float uFeedbackAmount;
uniform float uFeedbackScale;
uniform float uFeedbackRotate;
uniform float uFeedbackDroste;
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
uniform float uBloom;
uniform float uBloomThreshold;

uniform float uFlow;
uniform float uReact;

uniform float uSlit;
uniform float uSlitAxis;
uniform float uSlitLuma;
uniform float uSlitDepth;
/** Tiles across and down the history atlas, and how many of them are live. */
uniform vec2 uHistoryGrid;
uniform float uHistoryCount;
/** Tile holding the most recently captured frame. */
uniform float uHistoryCursor;

uniform float uMisreg;
uniform float uMisregSpread;
uniform float uMoire;
uniform float uMoireSpread;
uniform float uBenday;
uniform float uKrackle;
uniform float uKrackleScale;
uniform float uKrackleThreshold;
uniform float uBleed;
uniform float uBleedRadius;
uniform float uPaper;

const float TAU = 6.2831853;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
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

/**
 * Coverage of one plate — one screen, or two a few degrees apart.
 *
 * Two screens that nearly agree beat against each other at a period far longer
 * than either of them, which is a rosette the size of a fist rather than of a
 * dot. Averaged rather than overprinted so the plate carries the same ink either
 * way, and identity at a delta of zero because both terms are then the same
 * screen. The delta itself drifts, and that drift is the whole effect: the
 * rosettes swim, from two things that are each standing still.
 */
float plate(vec2 p, float angle, float value) {
  if (uMoire <= 0.0) return screenDot(p, angle, value);
  float d = uMoire * uMoireSpread * (0.62 + 0.38 * sin(uTime * 0.011));
  return 0.5 * (screenDot(p, angle - d, value) + screenDot(p, angle + d, value));
}

vec3 halftone(vec3 c, vec2 uv) {
  vec2 p = uv * uHalftoneFreq;
  // Classic CMY screen angles: 15deg, 75deg, 0deg.
  float ci = plate(p, 0.2618, 1.0 - c.r);
  float mi = plate(p, 1.3090, 1.0 - c.g);
  float yi = plate(p, 0.0, 1.0 - c.b);
  return vec3(1.0 - ci, 1.0 - mi, 1.0 - yi);
}

/**
 * Distance to the nearest feature point of a jittered lattice — worley noise.
 *
 * The points orbit their cells slowly rather than sitting still, so the
 * neighbourhood relations change and the cells genuinely reorganise. A static
 * lattice would read as a texture laid over the frame; a moving one reads as
 * something happening in it.
 */
float worley(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float best = 4.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = vec2(hash21(i + g), hash21(i + g + 37.3));
      vec2 o = 0.5 + 0.42 * sin(uTime * 0.06 + TAU * h);
      best = min(best, length(g + o - f));
    }
  }
  return best;
}

/**
 * Where one plate has drifted to, in frame fractions.
 *
 * Each plate takes its own pair of incommensurate rates, so no two of them ever
 * line back up and the register never returns to true. Divided by the aspect on
 * x so the drift is the same distance on screen in both directions rather than
 * being stretched by a wide canvas.
 */
vec2 plateDrift(float seed) {
  float a = uTime * (0.0131 + seed * 0.0041) + seed * 2.39;
  float b = uTime * (0.0097 + seed * 0.0063) + seed * 1.71;
  return vec2(sin(a) / uAspect, cos(b)) * uMisregSpread * uMisreg;
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

  // The two displacements that are read rather than computed. They sit last
  // among the smooth ones — so dispersion refracts them like everything else
  // here — and they are the only lines in this function that touch a texture.
  if (uFlow > 0.0) {
    // 0.5-centred: the field is signed and there is no universally available
    // float target to keep it in, so it lives biased in an unsigned one.
    vec2 v = texture(uFlowTex, uv).rg * 2.0 - 1.0;
    uv += v * uFlow * disp * 0.075;
  }

  if (uReact > 0.0) {
    // Along the chemical's gradient, so the frame refracts *through* the pattern
    // rather than being masked by it — the reaction is a lens, not a stencil.
    // Central differences rather than forward: a forward difference has a
    // half-texel bias, which at zero gradient is a standing displacement of the
    // whole frame instead of none.
    vec2 e = 1.4 / uFieldResolution;
    float gx = texture(uReactTex, uv + vec2(e.x, 0.0)).g - texture(uReactTex, uv - vec2(e.x, 0.0)).g;
    float gy = texture(uReactTex, uv + vec2(0.0, e.y)).g - texture(uReactTex, uv - vec2(0.0, e.y)).g;
    uv += vec2(gx, gy) * uReact * disp * 0.9;
  }

  return mirrorUv(uv);
}

/**
 * One tile of the frame ring, in atlas uv.
 *
 * Inset by a fraction of the tile because the atlas is one texture with LINEAR
 * filtering: a tap at a tile's border would otherwise reach into the frame
 * stored next to it, and the neighbour in the atlas is an unrelated moment.
 */
vec3 slice(vec2 uv, float slot) {
  float wrapped = mod(slot, uHistoryCount);
  vec2 cell = vec2(mod(wrapped, uHistoryGrid.x), floor(wrapped / uHistoryGrid.x));
  vec2 tile = 1.0 / uHistoryGrid;
  vec2 inset = tile * 0.012;
  return texture(uHistory, cell * tile + mix(inset, tile - inset, clamp(uv, 0.0, 1.0))).rgb;
}

/**
 * The frame age back through the ring, 0 being the one just captured.
 *
 * Blended between the two nearest slices rather than snapped to one. A discrete
 * choice would put uHistoryCount hard steps across the frame, which reads as a
 * fault in the picture; blended, the same ring reads as the picture having
 * depth in time.
 */
vec3 history(vec2 uv, float age) {
  float back = age * (uHistoryCount - 1.0);
  float nearest = floor(back);
  // The cursor holds the newest tile, so walking into the past is subtraction.
  return mix(
    slice(uv, uHistoryCursor - nearest),
    slice(uv, uHistoryCursor - nearest - 1.0),
    back - nearest
  );
}

/**
 * One sample of the scene. split false is the fast path: with no channel
 * separation asked for there is one fetch here rather than three.
 *
 * Misregistration adds a fourth. Cyan coverage is one minus red, so the three
 * colour plates *are* the channel split already — what a printed page has that
 * the split does not is the black. So the grey component is removed from the
 * three colour plates (undercolour removal, which is what a press actually does)
 * and printed back from its own sample. That is the difference between an effect
 * visible only in the colour and one visible on the line art, which is most of
 * what a comic page is made of.
 */
vec3 fetch(vec2 uvR, vec2 uvG, vec2 uvB, vec2 uvK, bool split) {
  if (!split) return texture(uScene, uvG).rgb;
  vec3 c = vec3(
    texture(uScene, uvR).r,
    texture(uScene, uvG).g,
    texture(uScene, uvB).b
  );
  if (uMisreg <= 0.0) return c;
  float grey = min(min(c.r, c.g), c.b);
  vec3 k = texture(uScene, uvK).rgb;
  // Identity when the plates are in register: the black comes back from the
  // same place it was lifted from, so the sum is exactly what it was.
  return clamp(c - grey + min(min(k.r, k.g), k.b), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 radial = uv - 0.5;

  vec2 suvG = distort(uv, 1.0);
  vec2 suvR = suvG;
  vec2 suvB = suvG;
  vec2 suvK = suvG;
  // Misregistration is a per-plate offset, so it needs the split whether or not
  // anything else asked for one.
  bool split = uChroma > 0.0 || uDisperse > 0.0 || uMisreg > 0.0;

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
  if (uMisreg > 0.0) {
    suvR += plateDrift(0.0);
    suvG += plateDrift(1.0);
    suvB += plateDrift(2.0);
    suvK = suvG + plateDrift(3.0);
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
      col += fetch(suvR + o, suvG + o, suvB + o, suvK + o, split);
    }
    col /= float(BLUR_TAPS);
  } else {
    col = fetch(suvR, suvG, suvB, suvK, split);
  }

  if (uBleed > 0.0) {
    // Ink spreads *out* of a line into absorbent stock rather than smearing
    // along it, so this is a min over the neighbourhood and not a mean: the
    // darks grow and the lights give way, which is the whole asymmetry of the
    // thing. Four taps, on the green plate's coordinate — bleed is the behaviour
    // of the paper under all four inks, not of one of them.
    vec2 e = uBleedRadius / uResolution;
    vec3 ink = col;
    ink = min(ink, texture(uScene, suvG + vec2(e.x, 0.0)).rgb);
    ink = min(ink, texture(uScene, suvG - vec2(e.x, 0.0)).rgb);
    ink = min(ink, texture(uScene, suvG + vec2(0.0, e.y)).rgb);
    ink = min(ink, texture(uScene, suvG - vec2(0.0, e.y)).rgb);
    col = mix(col, ink, uBleed);
  }

  if (uBloom > 0.0) {
    // Energy-normalised, and placed here — before the trail and the tone work —
    // so that col is still the scene at this coordinate and the debit below is
    // against the same neighbourhood the credit was blurred from.
    //
    // The highlight loses exactly what lands around it. A blur preserves its
    // input's mean, so the two sum to nothing over the frame and this cannot
    // raise total luminance, which is what lets a bloom coexist with the max()
    // accumulation in the feedback path at all.
    vec3 over = max(col - uBloomThreshold, 0.0);
    vec3 spread = texture(uBloomTex, suvG).rgb;
    col += (spread - over) * uBloom;
  }

  if (uSlit > 0.0) {
    // Where in the ring this pixel reads from. Vertical at one end and radial at
    // the other: the classic slit-scan and a tunnel through time are the same
    // construction reading a different coordinate, so they are one knob.
    float lum = dot(col, LUMA);
    float axis = mix(uv.y, clamp(length(toStage(uv)) / 0.72, 0.0, 1.0), uSlitAxis);
    float age = clamp(mix(axis, 1.0 - lum, uSlitLuma), 0.0, 1.0) * uSlitDepth;
    // Indexed by the distorted coordinate, like the scene: the history is in
    // scene space, so the folds and the warp land on the past as well as on now.
    col = mix(col, history(suvG, age), uSlit);
  }

  if (uFeedbackAmount > 0.0) {
    float ca = cos(uFeedbackRotate);
    float sa = sin(uFeedbackRotate);
    vec2 f = vec2(radial.x * ca - radial.y * sa, radial.x * sa + radial.y * ca);
    f = f / max(uFeedbackScale, 0.001) + 0.5;
    if (uFeedbackDroste > 0.0) {
      // The trail read in log-polar with the log radius wrapped. Same cost as
      // the zoom above, and the difference is everything: a scaled trail recedes
      // and is gone, where a wrapped one arrives again from the rim forever, so
      // the smear becomes a corridor. The stride is the frame's own regress
      // period so that running both has them agree about how far apart copies
      // sit rather than beating against each other.
      vec2 d = toStage(uv);
      float a = atan(d.y, d.x) + uFeedbackRotate;
      float inner = log(max(uDrosteInner, 1e-3));
      float period = max(uDrostePeriod, 0.15);
      // The per-frame zoom is what drives the corridor inward; without it the
      // wrap is a static remap of the trail rather than a flight down it.
      float lr = log(max(length(d), 1e-4)) - log(max(uFeedbackScale, 0.001));
      float ring = mod(lr - inner, period);
      f = mix(f, fromStage(vec2(cos(a), sin(a)) * exp(inner + ring)), uFeedbackDroste);
    }
    vec3 prev = texture(uFeedback, clamp(f, 0.0, 1.0)).rgb;
    // max() rather than mix(): trails stay bright instead of greying the frame
    col = max(col, prev * uFeedbackAmount);
  }

  if (uHueShift != 0.0) col = hueRotate(col, uHueShift);
  // Living Ben-Day: the screen's cells follow the distorted frame rather than a
  // grid pinned to the glass, so the dots flow with whatever is bending the
  // picture instead of the picture sliding underneath a static screen.
  if (uHalftone > 0.0) col = mix(col, halftone(col, mix(uv, suvG, uBenday)), uHalftone);

  if (uKrackle > 0.0) {
    // Cells punched out of the highlights with their rims left standing, so what
    // survives is the lattice's boundary — which is the crackle. Keyed off this
    // pixel's own tone, so the field is in screen space along with the
    // luminance it is reading: a lattice that travelled with the geometry would
    // land its blobs somewhere other than the highlights that summoned them.
    float lum = dot(col, LUMA);
    float hot = smoothstep(uKrackleThreshold, min(1.0, uKrackleThreshold + 0.22), lum);
    float cell = worley(uv * vec2(uAspect, 1.0) * uKrackleScale);
    float blob = 1.0 - smoothstep(0.26, 0.40, cell);
    col *= 1.0 - blob * hot * uKrackle;
  }

  // Tone fold: highlights invert and mid-tones peak, the darkroom solarisation.
  // Sits before posterize so the quantiser sees the final tone curve.
  if (uSolarize > 0.0) col = mix(col, 1.0 - abs(1.0 - 2.0 * col), uSolarize);

  if (uPosterize > 0.0) {
    float levels = mix(64.0, 4.0, clamp(uPosterize, 0.0, 1.0));
    col = floor(col * levels + 0.5) / levels;
  }

  col *= uExposure;

  if (uPaper > 0.0) {
    // Two stretched noises: fibres lie along the web the stock came off, with
    // some crossing it. Distinct from grain, which is per-pixel and belongs to
    // the camera — this is the material the ink went onto, so it sits below the
    // exposure and above nothing.
    float fibre =
      vnoise(uv * vec2(180.0 * uAspect, 22.0)) * 0.6 +
      vnoise(uv * vec2(31.0 * uAspect, 260.0)) * 0.4;
    col *= 1.0 - uPaper * 0.32 * (1.0 - fibre);
    // Newsprint was never white, and it holds cyan worst of the three.
    col = mix(col, col * vec3(1.03, 0.985, 0.91), uPaper);
  }

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
