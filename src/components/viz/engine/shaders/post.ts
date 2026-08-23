import { JULIA_WRAP } from "../julia";

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

/**
 * Iterations of the Julia orbit.
 *
 * Two things set this. It is the effect's resolution limit — the set is a
 * genuine fractal, so every iteration added resolves finer filaments and none of
 * them ever finishes the figure — and past about thirty the filigree stops
 * visibly gaining at a screenful of pixels.
 *
 * The rest is the flight's. Each preimage it travels adds one step to every
 * orbit before that orbit exits, so a wrap spanning JULIA_WRAP of them needs
 * that many iterations in hand or the deepest part of every cycle runs out of
 * loop and comes back as a flat, unresolved band. The count therefore has to
 * move with JULIA_WRAP, and the two are only independent-looking.
 *
 * The loop exits early on escape or capture, so the cost is only paid in the
 * region that is actually the set.
 */
export const JULIA_ITERS = 40;

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
uniform float uVignette;
uniform float uExposure;
uniform float uHueShift;
/** Channel level at which the landing's shoulder starts. 1 disables it. */
uniform float uShoulder;

uniform float uPane;
uniform float uPaneGrid;
uniform float uPaneBreathe;
uniform float uPanePhase;
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
uniform float uJulia;
uniform float uJuliaZoom;
/** Half the seed's multiplier, where the walk currently has it — the seed itself
 *  is c = m - m^2. One map for the whole frame, and see the note in the Julia
 *  branch for why nothing per-pixel is allowed to move it. */
uniform vec2 uJuliaM;
/** The repelling fixed point the flight heads into, and the two coefficients
 *  that carry the frame toward it — see the note in the backend. All complex. */
uniform vec2 uJuliaBeta;
uniform vec2 uJuliaStep;
uniform vec2 uJuliaWarp;
uniform vec2 uJuliaWarp3;
uniform float uJuliaTrap;
uniform float uJuliaSpread;
uniform float uJuliaAnchor;
uniform float uJuliaBind;
uniform float uJuliaDepth;
uniform float uJuliaEdge;
/** Side of the facets the page is carried in, before the exponential the Julia
 *  branch puts it through. 0 lets the displacement run continuously. */
uniform float uJuliaFacet;
/** Share of the facets cut out as plain windows onto the page. Needs facets to
 *  have a shape, so it does nothing while uJuliaFacet is 0. */
uniform float uJuliaPlate;
/** Wedges the plates' own view is mirrored into, before the floor — 0 leaves it
 *  the plain still frame it was. See plateView. */
uniform float uJuliaPlateFold;
/** How much of the page is carried in the set's own cells rather than by the
 *  displacement — see the note where the cells are cut. */
uniform float uJuliaChunk;
/** How finely the page is diced before the cells carry it. Low is a few large
 *  pieces, high is a mosaic. */
uniform float uJuliaChunkGrid;
/** Where the flight's own fixed point sits, in stage units. Drifts, so the
 *  vanishing point is not pinned to the middle of the frame forever. */
uniform vec2 uJuliaCenter;
uniform float uQuasi;
uniform float uQuasiFreq;
uniform float uTurbulence;
uniform float uTurbulenceScale;
uniform float uTurbulenceSpeed;
uniform float uMelt;
uniform float uMeltLevel;
uniform float uMeltAngle;
uniform float uWake;
uniform float uWakeSpread;
uniform float uWakeLead;
uniform float uCaustics;
uniform float uCausticsScale;
uniform float uCausticsSpeed;
uniform float uNeon;
uniform float uNeonHue;
uniform float uNeonSpread;
uniform float uNeonWidth;
uniform float uSheen;
uniform float uSheenBands;
uniform float uSheenDrift;
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
const int JULIA_ITERS = ${JULIA_ITERS};
const int JULIA_WRAP = ${JULIA_WRAP};
/** How near the attractor an orbit has to get before it counts as finished.
 *  Coarse on purpose: the multiplier can be as slow as 0.9 a step, and a tighter
 *  disc would leave most of the interior still travelling when the iteration cap
 *  arrives — which is the flat region this exists to remove. */
const float JULIA_CAPTURE = 0.12;
/**
 * How far the melt may push the frame, as a multiple of the feature it is
 * reading — see the block itself. The Jacobian guard, and the reason this is a
 * constant rather than a tunable: it is what keeps a panel readable, not a
 * matter of taste about how far the picture should run.
 *
 * Measured rather than guessed, over real pages, by scripts/melt-jacobian.py.
 * At this value 99.9% of the frame stays inside the readable band at every
 * grain the cycler draws, and under a thousandth of it folds. The cliff is
 * close and it is steep: 2.4 puts eight times as much of the frame through a
 * fold and drops two and a half points of readability, for a third more travel.
 * Re-run the bench before moving it.
 */
const float MELT_REACH = 1.35;
/**
 * Peak the neon's emission is held to. Under white paper, deliberately: nothing
 * the glow puts on screen may be brighter than what an ordinary light panel
 * already puts there, so it cannot arm the max() trail any harder than the
 * frame does on its own.
 */
const float NEON_LEVEL = 0.9;
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

/** Complex multiply. The Julia iteration and its derivative are the only things
 *  here that need one. */
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

/**
 * Mip level the scene should be read at, written by the Julia branch of
 * distortFold() and left at 0 by everything else.
 *
 * A global because distortFold() returns a coordinate and this is a *rate* — how
 * hard the map is compressing the frame at this pixel — and the fetch needs
 * both. It cannot be an implicit derivative: at the boundary of an escape-time
 * set neighbouring pixels take orbits that separate exponentially, so the
 * hardware's screen-space difference is not a footprint but noise, and a frame
 * sampled by it sparkles. The orbit's own derivative is the real footprint, and
 * the iteration is already carrying it.
 */
float gSceneLod = 0.0;

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
 * What the plates look through — the frame itself, or a coarse mirror of it
 * turning about the point the flight is heading into.
 *
 * The plates are windows onto an undistorted page and that is their whole
 * worth, but undistorted also meant *still*: the one part of a mode whose
 * subject is travel that never moved, and against a frame flying into itself
 * a still window does not read as a window, it reads as the picture the
 * fractal is being drawn on. Which is the wrong way round. The figure is
 * supposed to be the thing that is there.
 *
 * So the plates get a motion of their own, and it is a fold rather than a pan
 * because a fold moves the picture without going anywhere: mirrored into a
 * handful of wedges and turned slowly, the page sweeps and reflects through
 * itself continuously and is never anywhere but where it started. A pan would
 * have to arrive from somewhere and leave for somewhere, at a rate this mode
 * has no room for.
 *
 * Coarse — a handful of wedges, not the dozen a rosette wants. A quarter of the
 * plane is still a piece of comic with a face's worth of room in it, and the
 * plates are the one place here that has to stay legible; at a dozen the
 * windows would be showing the same ornament as the figure around them, which
 * is the frame having nothing in it that says what it is an ornament *of*.
 *
 * Centred on the flight's own vanishing point rather than on the frame, which
 * is what keeps this from being a second motion competing with the first. The
 * mirror's focus is the point the fractal is descending onto, so wherever the
 * drift carries that point the background swings about it — one motion, seen
 * twice, rather than two.
 */
vec2 plateView(vec2 uv) {
  if (uJuliaPlateFold <= 0.0) return uv;
  // Three wedges at the bottom of the slider, six at the top.
  float seg = TAU / floor(uJuliaPlateFold * 4.0 + 2.5);
  vec2 p = toStage(uv) - uJuliaCenter;
  // Authored rather than exposed, on the same grounds as the flight's drift:
  // there is one rate worth having. A turn in five minutes, so the pattern
  // comes round about once a minute and a half at four wedges — under the
  // drift it is centred on, which is itself an order under the flight.
  float a = mod(atan(p.y, p.x) + uTime * 0.021, seg);
  // Mirror within the wedge so neighbours meet without a seam.
  a = abs(a - seg * 0.5);
  return mirrorUv(fromStage(vec2(cos(a), sin(a)) * length(p) + uJuliaCenter));
}

/**
 * The coordinate half of the chain: every geometric and undulating effect is a
 * remap of where the frame is sampled, so they all live here and compose in
 * one place.
 *
 * Order is deliberate, in three stages — four, counting the panes, which are
 * ahead of all of it and are described where they are cut. The first two are
 * this function; the third is distortDisplace below.
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
 * Nothing here reads the refraction strength, and that is why it is a function
 * of its own rather than the top of one long chain: dispersion moves three
 * strengths through the *same* geometry, never three foldings of it, so under a
 * dispersing preset this ran three times and returned the same coordinate three
 * times. With the fractal below that is not a rounding error — it is the Julia
 * orbit, forty iterations of complex arithmetic a pixel, paid for twice over to
 * arrive back where it started. Split, it is computed once and the three
 * channels part company at distortDisplace, which is the only stage that ever
 * distinguished them.
 *
 * Also the one that writes gSceneLod, which the split makes honest: the mip
 * level belongs to the fold, so there is now exactly one place it is set and
 * exactly one value it can have.
 */
vec2 distortFold(vec2 uv) {
  /*
   * The panes: the view backing up until several mirrored copies of the frame
   * fit across the screen. First, and deliberately so — everything below is
   * then computed in pane-local coordinates, so each pane carries a *complete*
   * copy of whatever the frame is doing rather than a piece of it. Four
   * quadrants each running their own kaleidoscope is only reachable from here;
   * the same mirror-tile at the end of the chain -- uTile -- folds the frame
   * once and then repeats what is inside one wedge.
   *
   * That is the one exception to the ordering note above, and it is exact
   * rather than tolerated: what tears a fold's seams is a map that breaks its
   * angular periodicity, and this is a mirrored similarity — the rosette is
   * redrawn whole in every cell, seams closing where they always did.
   *
   * The breath is evaluated here rather than on the CPU because what the
   * director integrates is the *rate*: a phase is a position in the cycle, and
   * one shaped by a cosine opens and closes with zero velocity at both ends,
   * which is what keeps a zoom of a whole octave from starting with a lurch.
   */
  float pane = clamp(uPane + uPaneBreathe * (0.5 - 0.5 * cos(uPanePhase * TAU)), 0.0, 1.0);
  if (pane > 0.0) {
    /*
     * Geometric in the pull-back, so the view recedes at a constant *rate* of
     * magnification rather than a constant rate of scale — an octave covered
     * linearly reads as a zoom that gives up halfway.
     *
     * Centred on the frame, which is what makes the identity at zero and is
     * also why the count only lands exactly on odd grids: mirror-tiling about
     * the middle of a cell puts one whole copy in the centre of the screen with
     * its reflections growing in around it. At 2 that is a centre frame and
     * mirrored halves at the edges; at 3 it is nine copies, aligned. Both read
     * as the same gesture, which is the frame backing away from the viewer and
     * finding itself repeated.
     */
    uv = mirrorUv((uv - 0.5) * pow(max(1.0, uPaneGrid), pane) + 0.5);
  }

  /* The frame as it was composited, before any of this. Kept for the Julia
   * plates, which are the one thing in the chain whose whole purpose is to be
   * *undistorted* — and undistorted means per pane, so the panes are already in
   * it: a window cut in the figure shows the frame its own cell is drawn from,
   * not one from the cell next door. */
  vec2 plain = uv;
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

  /*
   * The Julia set, read by orbit trap. Last of the geometric maps, and the only
   * one that is a true fractal rather than a symmetry — see the note on the
   * parameter.
   *
   * Each pixel is a starting point in the complex plane. It is iterated under
   * z -> z^2 + c, and what the frame is sampled at is not where the point ended
   * up but where its orbit came *closest to a circle* — the orbit trap. Points
   * whose orbits pass near the same place get the same crop of the page, and
   * the locus of such points is the set's own filigree, so the picture is drawn
   * along the fractal's structure rather than merely being distorted by it.
   *
   * Two things fall out of the same loop rather than needing work of their own.
   * The derivative dz/dz0, carried alongside, is exactly how much the map is
   * compressing the frame at this pixel, which is the mip level the fetch wants.
   * And the escape test exits the loop for every point outside the set, which is
   * most of the frame — so the full iteration count is only paid where the set
   * actually is.
   */
  if (uJulia > 0.0) {
    // Three, because the stage is a unit high — half a unit either side of the
    // centre — and a Julia set of this family lives inside about a radius of
    // 1.5. So a zoom of 1 is the whole figure in the frame, and the small values
    // this mode actually runs at are a neighbourhood of the fixed point the
    // flight below is heading into.
    float s = 3.0 * uJuliaZoom;
    /*
     * Offset before scaled, which is what makes the drift a move of the *camera*
     * rather than of the set: the fixed point stays where it is in the plane and
     * the frame is placed around it, so the flight is still the same descent
     * onto the same point and only its position on screen has changed.
     *
     * The wrap does not mind. What comes back to itself every JULIA_WRAP turns
     * is the map from w to the picture, so any coordinate handed to it that is
     * merely continuous in time is continuous across the seam too. What the
     * drift does cost is a little of the seam's precision — the two correction
     * terms are a series about w = 0, and a frame carried off that point is a
     * frame whose far corner sits further out in it than it used to. The clamp
     * a few lines down is what keeps that from ever being more than a smudge.
     */
    vec2 w = (toStage(uv) - uJuliaCenter) * s;

    /*
     * The flight, and the reason it can run forever.
     *
     * The frame is centred on the repelling fixed point of the map, and the
     * approach to it is a scaling by lambda^-u where lambda is that point's
     * multiplier. That number is not chosen for looks: the set is exactly
     * invariant under the inverse map, and near the fixed point the inverse map
     * *is* multiplication by 1/lambda — so after one whole unit of u the picture
     * is the picture it started from, and the phase can be wrapped there with
     * nothing to see. Endless magnification out of a bounded number.
     *
     * Bounded is the point. A zoom that genuinely accumulated would run out of
     * float somewhere past a million and have to cut back; this one never leaves
     * a single octave of the plane, so it can fly for an hour.
     *
     * The two curved terms are what make the wrap invisible rather than merely
     * close. Multiplication by lambda is only the *linearisation* of the inverse
     * map, and these are the second and third order of the Koenigs chart that
     * conjugates one to the other — arriving from the CPU already folded into
     * two coefficients, both exactly zero when the flight is stopped. They are
     * damped by the radius because a series about the fixed point has no
     * business being trusted at the rim of a wide view.
     */
    vec2 w2 = cmul(w, w);
    vec2 corr = cmul(uJuliaWarp, w2) + cmul(uJuliaWarp3, cmul(w2, w));
    float lim = 0.5 * length(w);
    corr *= min(1.0, lim / max(length(corr), 1e-6));
    vec2 z = uJuliaBeta + cmul(uJuliaStep, w) + corr;
    // Seeded at the mapping's own scale rather than at 1: dz is held with
    // respect to the *frame's* coordinate, which is what makes it a screen-space
    // footprint rather than a plane-space one. Only its magnitude survives to
    // the mip level below — the phase cancels out of |dz| — so the flight's
    // rotation is left out of it.
    vec2 dz = vec2(s * length(uJuliaStep), 0.0);

    /*
     * The page, driving the figure.
     *
     * Without this the panels are wallpaper: the figure has its own shape, the
     * art is merely what the shape is filled with, and a new panel changes the
     * colours and nothing else. Here the frame is read at two scales and the
     * difference between them — the page's own structure, at the size of a
     * figure or a speech balloon, with overall brightness divided out — moves
     * where the trap sits. So the filaments run differently where the panel has
     * a shape in it, and a change of panel moves the drawn edges.
     *
     * Both taps come out of the mip chain the backend is already keeping for the
     * fetch, so the whole coupling costs two of the cheapest samples available.
     *
     * What the page is deliberately *not* allowed to touch is the seed, and that
     * restraint is the whole reason this mode can fly at all. Perturbing the
     * seed per pixel was the obvious way to make the art bend the figure, and it
     * worked, and it quietly destroyed the wrap: the flight is a descent onto one
     * map's fixed point, and a pixel given its own map is descending onto a fixed
     * point that is not there. Measured at the seam, the picture moved by half a
     * frame at every turn — the loop that no amount of care about the geometry
     * could account for. Everything driven from here is a *sampling* choice
     * instead: where along the orbit the page is picked up, and which contour
     * carries which crop. Both change the drawn figure. Neither moves the set,
     * so both survive the wrap exactly.
     */
    float drive = 0.0;
    if (uJuliaBind > 0.0) {
      // Named around near/far, which some drivers still treat as spoken for.
      vec3 pageNear = textureLod(uScene, uv, 4.0).rgb;
      vec3 pageFar = textureLod(uScene, uv, 7.0).rgb;
      drive = clamp((dot(pageNear, LUMA) - dot(pageFar, LUMA)) * 3.0, -1.0, 1.0) * uJuliaBind;
    }
    vec2 m = uJuliaM;
    vec2 c = m - cmul(m, m);
    // Where along each orbit the page is picked up. Nearly half either way at
    // full drive, which is enough to move a filament clear of where it was — the
    // trap set is what the filaments are *drawn along*, so moving it redraws
    // them without touching the dynamics that put them there.
    float trapR = uJuliaTrap * (1.0 + drive * 0.45);

    /*
     * The guard, and it is what makes the wrap invisible rather than merely
     * geometrically close.
     *
     * The trap is a minimum over the orbit, and one turn of the flight prepends
     * exactly one point to every orbit — so the minimum is only unchanged if the
     * prepended point never wins. It is not a harmless point: it lands inside
     * the frame's own neighbourhood of the fixed point, which for a large part
     * of the picture is the *nearest* the orbit ever comes to the trap ring. So
     * for those pixels the sample is the starting point, the map is affine in
     * the frame, and every wrap snaps it back by a whole factor of lambda. Which
     * is a picture that zooms and then jerks home.
     *
     * Excluding the neighbourhood itself fixes it exactly, rather than closely:
     * the excluded set is defined by *where a point is*, not by which step it is,
     * so prepending a point inside it changes nothing at all. Both orbits then
     * trap over the identical set.
     */
    // The drift is in it because this is the radius of the *frame's* own
    // neighbourhood of the fixed point, and a frame carried off centre reaches
    // further into the plane than a centred one of the same size.
    float guard = (0.5 * sqrt(1.0 + uAspect * uAspect) + length(uJuliaCenter)) * s;

    vec2 trap = z;
    vec2 trapD = dz;
    float best = 1e9;

    /*
     * Depth: how many steps this pixel's orbit survives before it either leaves
     * or settles. The field that makes the flight read as travel rather than as
     * a picture being scaled up.
     *
     * Without it most of the frame is an *affine* function of the pixel — orbits
     * that escape at once trap where they started, orbits that converge trap on
     * the attractor — so flying in moves those regions the only way an affine
     * map can move, which is to say it enlarges them. That is a zoom, and it is
     * what a zoom looks like. Depth is not affine anywhere: its level sets are
     * the escape-time contours, they wrap the set at every scale, and under the
     * flight they sweep outward through the frame and are replaced from the
     * centre. That is what moving into something looks like.
     *
     * It also costs the wrap nothing, which is the reason this particular field
     * and not another. One turn of the flight is exactly one preimage, a preimage
     * is exactly one extra step before the same exit, so depth rises by exactly
     * one per cycle — and anything read off it with period one comes back to
     * itself at the wrap.
     *
     * Both exits are the same statement about a different destination, and both
     * are smoothed by how far past the test the orbit landed. Without that they
     * would be integers, and integer bands crawling outward is a set of hard
     * rings rather than a structure.
     */
    float nu = float(JULIA_ITERS);
    // Bands per unit of frame at the exit — the depth field's own gradient,
    // which is the one thing here that the trap's derivative does not already
    // account for and that the mip level below needs.
    float grad = 4.0;
    // Rate the interior converges at, which is |log|mu||: the attracting fixed
    // point of this family is m itself, and its multiplier is twice it.
    float muLog = max(0.05, -log(min(0.98, length(2.0 * m))));

    /*
     * Where the orbit left, in polar about whatever it left towards — the
     * escape circle on the way out, the attractor on the way in.
     *
     * The argument is the second coordinate of the set's own grid, and the one
     * the depth field cannot supply: depth says how far into the figure a pixel
     * is and says nothing about where *around* it, so a picture cut by depth
     * alone is rings. Paired with the exit argument it is cells. The radius is
     * here only to turn the orbit's derivative into that argument's own rate,
     * which is what the fetch below needs and what nothing else is carrying.
     *
     * Zero until an orbit actually finishes. The handful of pixels that neither
     * escape nor settle inside the iteration cap are the deepest filigree, and
     * a cell coordinate read off an unfinished orbit is a constant — one flat
     * chunk over the most structured part of the frame — so they are excluded
     * outright rather than given a plausible-looking answer.
     */
    float exitArg = 0.0;
    float exitRad = 1.0;
    float exitD = 0.0;
    float exited = 0.0;

    for (int i = 0; i < JULIA_ITERS; i++) {
      // The derivative of the step about to be taken, so it uses the incoming z:
      // z' = z^2 + c gives dz' = 2 z dz.
      dz = 2.0 * cmul(z, dz);
      z = cmul(z, z) + c;
      vec2 off = z - uJuliaBeta;
      if (dot(off, off) > guard * guard) {
        // Round or square, and everything in between. A circular trap set draws
        // the page along arcs, which is why the figure reads as fluid however
        // fractal the geometry under it is; the same construction against the
        // Chebyshev norm traps on a square, and a square's sides are straight
        // lines. It is the one knob here that changes what the filaments *are*
        // rather than where they run.
        float dist = mix(length(z), max(abs(z.x), abs(z.y)), uJuliaEdge);
        float d = abs(dist - trapR);
        if (d < best) {
          best = d;
          trap = z;
          trapD = dz;
        }
      }
      float rr = dot(z, z);
      // Bailout, at radius 4 rather than the 2 that decides escape. The extra
      // ring is not caution about the test — past 2 the orbit is certainly
      // leaving — it is one more step for the trap to be found on the way out,
      // which the widest trap circle on the slider needs and which costs nothing
      // for the interior, where the orbit never gets here at all.
      if (rr > 16.0) {
        float lz = 0.5 * log(rr);
        nu = float(i) - log2(lz / 1.3862944);
        grad = length(dz) / max(1e-3, 0.6931472 * lz * sqrt(rr));
        exitArg = atan(z.y, z.x);
        exitRad = sqrt(rr);
        exitD = length(dz);
        exited = 1.0;
        break;
      }
      // Capture. The orbit has arrived at the attractor and will only spiral
      // closer, so it is as finished as an escaping one — and counting it means
      // the interior carries the same structure as the outside rather than being
      // the one flat region in the frame.
      vec2 toM = z - m;
      float dc = length(toM);
      if (dc < JULIA_CAPTURE) {
        nu = float(i) - log(JULIA_CAPTURE / dc) / muLog;
        grad = length(dz) / max(1e-3, muLog * dc);
        // Same pair, about the attractor instead. The interior is not
        // self-similar the way the outside is — near an attracting fixed point
        // the map is a rotation and a shrink, so the cells there are a spiral
        // of a fixed count per band rather than a count that doubles — but it
        // is a grid, it is the set's own, and it converges where the interior
        // converges.
        exitArg = atan(toM.y, toM.x);
        exitRad = max(dc, 1e-4);
        exitD = length(dz);
        exited = 1.0;
        break;
      }
    }
    /*
     * Where the page is read, and the floor under how far it may be enlarged.
     *
     * The trap term alone has no lower bound on its derivative: wherever orbits
     * converge — the whole interior of the set — neighbouring pixels land on the
     * same trap point, and a region that maps to one point is one texel of comic
     * blown up to fill it. That is the soft grey blob, and it is a property of
     * the map rather than of the sampling, so no amount of filtering fixes it.
     *
     * The anchor is a fraction of the plain frame added to the trap coordinate.
     * It cannot be flattened by the dynamics, so the enlargement is bounded by
     * its reciprocal — at a third, no part of the page is ever shown more than
     * three times its own size. It is also independent of the flight and of the
     * seed, which is what keeps the wrap seamless: it is the same field at every
     * point of the cycle.
     */
    /*
     * What depth is worth: a different crop of the page in every contour of the
     * escape time, and under the flight these contours are what sweeps outward
     * past the eye.
     *
     * The crop comes back to itself over JULIA_WRAP contours rather than over
     * one, which is the same span the flight's own wrap uses — anything shorter
     * would be a pattern repeating inside a picture that does not, and it was
     * the strongest periodic signal in the frame when it was one.
     *
     * The other half of that number is legibility, and it is the larger half. A
     * crop that turned a full circle between one contour and the next varied as
     * fast as the contours themselves do, which near the boundary is faster than
     * the pixels — so the page arrived as an average of everywhere at once. Over
     * five contours the same excursion is spread across five, and the sampling is
     * coherent enough over most of the frame for the art to be read as art.
     */
    // The page has a second say here, on the same field and the same terms: it
    // shifts which contour carries which crop, so the banding is laid out by the
    // panel rather than by the arithmetic alone. Inside the period, so the wrap
    // is untouched.
    float bandTurn = (nu + drive * 0.8) * TAU / float(JULIA_WRAP);

    /*
     * Everything the fractal contributes to where the page is read, gathered
     * into one displacement — and beside it, how fast that displacement varies,
     * in texels of page crossed per pixel of frame. The trap's rate is its own
     * derivative, carried down the orbit; the band's is the depth field's
     * gradient through the rate the crop turns at.
     */
    vec2 band = vec2(cos(bandTurn), sin(bandTurn)) * (uJuliaDepth * 0.5);
    vec2 off = trap * uJuliaSpread + band;
    float offJac =
      length(trapD) * uJuliaSpread + uJuliaDepth * 0.5 * grad * TAU / float(JULIA_WRAP);
    // How much of the frame's own footprint the sample carries. One while the
    // displacement runs free; the facets below cut it to nearly nothing inside
    // a facet and hand the whole of it to the joins.
    float offSlope = 1.0;
    // Coverage of the plates cut below, 0 outside them and 1 within.
    float plate = 0.0;

    /*
     * The facets, and they are the answer to a mode whose page arrived as colour
     * and texture and never as comic.
     *
     * The obvious suspect was resolution, and measured, it is innocent: the
     * displacement above moves the sample by well under a texel per pixel across
     * most of the frame, so the fetch is already reading the page sharp. The
     * fault is at the other end of the scale. Legibility is not a property of
     * one pixel, it is a property of a *region* — a face is a face because two
     * hundred pixels of frame carry two hundred neighbouring texels of page —
     * and at half a texel per pixel this displacement rewrites the crop by a
     * tenth of the page across the width of that face, which is more than the
     * anchor moves in the same span. Every pixel sharp, every feature gone. Turn
     * the rate down far enough to fix that and the fractal goes with it, because
     * a displacement too slow to break a face is too slow to be seen.
     *
     * So the displacement is *flattened* rather than slowed. A staircase with
     * rounded risers holds it constant across the tread and spends its whole
     * excursion in the join: within one facet the map is exactly the anchor, an
     * affine crop of the page at its own scale, which is a face or a balloon or
     * a run of lettering and unmistakably one. The excursion between facets is
     * untouched — the staircase rises by exactly one tread per tread — so the
     * figure still runs through as much of the page as it ever did, and the
     * facets themselves are the level sets of the trap and the escape time,
     * which is to say they are fractal, and their joins are the filaments.
     *
     * Rounded rather than square because the flight has to be continuous. A hard
     * floor is a picture that snaps a whole region onto a new crop the instant
     * the level set crosses it; the smoothstep spends a fifth of each tread
     * getting there, so facets flow into their neighbours instead. That fifth is
     * the one part of the frame that is smeared, and it is exactly the part the
     * lod below is told about — the riser's own slope, which is analytic, so the
     * joins are blurred by precisely their own compression and no more.
     *
     * Free of the wrap. The staircase is a function of a displacement that
     * already comes back to itself every JULIA_WRAP turns, and a function of a
     * periodic thing has its period.
     */
    if (uJuliaFacet > 0.0) {
      // Facet side, in stage units — a fiftieth of the frame at the bottom of
      // the slider, a quarter of it at the top.
      float q = 0.02 * exp2(3.6 * uJuliaFacet);
      /*
       * The one case the flattening cannot rescue: where the displacement varies
       * so fast that a whole facet is thinner than a pixel, the staircase is
       * below the sampling rate and reads as noise rather than as facets. That
       * is a hundredth of the frame at this preset's altitude — the deepest
       * filaments — and there the excursion is damped instead, which hands those
       * pixels back to the anchor's plain crop. Resolution-aware, because
       * whether a facet is thin is a question about pixels and the internal
       * resolution moves with the device.
       */
      float cap = q * uResolution.y / 3.0;
      float k = 1.0 / (1.0 + offJac / max(cap, 1e-4));
      off *= k;
      offJac *= k;

      /*
       * The plates, cut from the displacement before it is flattened rather than
       * from the facets it is flattened into — which is not a detail, it is the
       * difference between a coverage and a lottery.
       *
       * Keyed to the facets, the plates were a hash of the facet's own index,
       * and the whole frame only holds twenty or thirty facets: the displacement
       * runs over about one stage unit and a facet is a sixth of one. Thirty
       * coin flips do not make a coverage. Measured across the flight it came
       * out at six percent of the frame at one point of the descent and *none*
       * at another, which for the one feature here whose job is to be reliably
       * legible is the wrong failure to have.
       *
       * Against the displacement itself the coverage is exact and needs no luck:
       * the triangular wave below is uniform over its period by construction, so
       * the share of the frame inside the window is the window's own width, and
       * two axes of it multiply to the coverage asked for. The regions are
       * bounded by level sets of the trap and the escape time, so they are
       * fractal curves, and they sit at the facets' own scale because they are
       * cut with the facets' own quantum — a window in the middle of each cell,
       * with the figure left standing between them.
       */
      if (uJuliaPlate > 0.0) {
        // Per axis, so the two together cover the fraction asked for.
        float win = sqrt(uJuliaPlate);
        // 0 at the middle of a cell, 1 at its edge.
        vec2 g = abs(fract(off / q) - 0.5) * 2.0;
        vec2 inWin = 1.0 - smoothstep(win - 0.02, win + 0.02, g);
        plate = inWin.x * inWin.y;
      }

      vec2 t = off / q;
      vec2 base = floor(t);
      vec2 f = t - base;
      /*
       * Riser width, as a fraction of a tread, and narrow rather than gentle.
       *
       * A wide riser is a gentler join but it is also a larger part of the frame
       * spent in transit, and in transit is precisely where the page is being
       * dragged past the sample faster than the fetch can follow. Measured over
       * a scanline, widening this from a tenth to a quarter takes the frame that
       * sits in a run of a hundred coherent pixels or more from two thirds to a
       * half, and the smeared fraction from a fifth to two fifths. It is the
       * rare knob where both ends of the trade point the same way, and the only
       * thing lost by narrowing it is that the joins are harder — which on a
       * fractal figure reads as an edge, and edges are wanted here.
       */
      float rise = 0.12;
      vec2 e = clamp((f - (1.0 - rise)) / rise, 0.0, 1.0);
      off = q * (base + e * e * (3.0 - 2.0 * e));
      // Slope of that riser, which is the smoothstep's own derivative: zero
      // across the tread, and 1.5 / rise at the middle of the join.
      vec2 slope = 6.0 * e * (1.0 - e) / rise;
      offSlope = max(slope.x, slope.y);

      /*
       * The plates, and they are a different answer to the same question than
       * everything above — an admission, really, that the question could not be
       * answered where it was being asked.
       *
       * Facets make the fractal's own sampling legible, and measured, they do:
       * the run of frame carrying one coherent crop goes from a median of thirty
       * pixels to a median of a hundred and fifty. It is not enough, and the
       * reason it is not enough is everything the figure is wearing. The crop
       * arrives at twice its own size, inside a wedge of a six-fold mirror, with
       * a feedback trail over it — and a hundred and fifty pixels of doubled,
       * mirrored panel is an ornament made out of a comic, not a comic. There is
       * no setting of the numbers above that gets past that, because the mirror
       * and the magnification are the mode.
       *
       * So a share of the facets stop carrying the figure at all and become
       * windows. Inside one the coordinate is the frame's own, untouched by the
       * fold, the trap, the anchor and the flight alike: the panel, where the
       * panel actually is, at the size it actually is. Every plate shows the
       * same coordinate as every other, so the plates are not a scatter of
       * different crops — they are one image, seen through a stencil the fractal
       * cut. What the eye does with that is reassemble it, which is the whole
       * point: the figure can be as strange as it likes as long as something in
       * the frame says what it is strange *about*.
       *
       * The cut itself is a cut and not a blend. A coordinate mixed halfway
       * between the frame and the far side of a fractal is a coordinate pointing
       * nowhere, and a wide join is a wide band of that; a narrow one costs a
       * few pixels of smear at the border and buys an edge, which is what a
       * plate wants anyway.
       *
       * Where they are cut from is the note further down, at the cut itself.
       */
    }

    vec2 target = mirrorUv(fromStage(off + toStage(uv) * uJuliaAnchor));
    // Every term that moves the sample, summed: the fractal displacement at
    // whatever slope it is being carried at, and the anchor, which is the one
    // that cannot vanish.
    //
    // The displacement is a sum of two terms for a reason worth keeping: depth
    // runs away to infinity at the boundary of the set — that is what the
    // boundary *is* — so the contours there are finer than any pixel, and a
    // frame sampled through them without saying so sparkles exactly where the
    // structure is most interesting.
    float jac = offJac * offSlope + uJuliaAnchor;

    /*
     * The chunks, and they are a different proposition from everything above:
     * not the page displaced along the figure, but the page *cut up and dealt
     * out to the figure's own cells*.
     *
     * Every construction before this one starts from the frame and moves it —
     * the trap displaces it, the bands re-crop it, the facets flatten the
     * excursion, the plates give some of it up entirely — and all of them share
     * a ceiling: the panel is behind the fractal, in pieces the fractal chose
     * but at a scale that is the frame's, so what the set does to the picture is
     * always ornament laid over a photograph. What was wanted instead is for the
     * art to be the material the figure is *built from*, in pieces big enough to
     * recognise at the rim and finer as the flight goes in.
     *
     * The set has a coordinate system for exactly this and it is not the frame's.
     * Escape time says how deep into the figure a pixel is; the argument of the
     * orbit where it left says where around it. Together they are a grid whose
     * lines are the equipotentials and the external rays — the set's own — and
     * the page is laid straight into its cells, one whole panel to a cell.
     *
     * What that buys is the ladder, and it costs nothing to get because it is
     * how the dynamics are built. Every escape contour doubles the argument's
     * winding, so one band in holds twice as many cells as the band outside it
     * and each is half the size: the same panel, whole, recurring at half its
     * scale one contour deeper and half again the contour after. Where the
     * contours are wide that is a handful of big legible pieces. Approaching the
     * boundary they pile up without limit and so does the subdivision, which is
     * the intricacy — made of panel rather than laid over it.
     *
     * Cell by cell it is a hard cut rather than a blend, and it is the one place
     * in this branch where that is free: the joins are where one copy's edge
     * meets the next one's, and they lie along equipotentials and external rays,
     * which are fractal curves. The figure's own edges, drawn by the page
     * running out.
     *
     * Free of the wrap, and more cheaply than anything else here. One turn of
     * the flight prepends one step to every orbit, so an orbit exits at the same
     * place having taken one step longer: the exit argument is *unchanged* and
     * depth rises by exactly one. So the cells are the same cells and the page
     * has only moved a whole number of bands through them, which a coordinate
     * wrapped to the band count does not notice. The whole construction is
     * periodic in a single turn, rather than in the five the flight itself
     * needs.
     */
    if (uJuliaChunk > 0.0) {
      /*
       * Cells around one winding of the argument, and bands down.
       *
       * Only the ratio between them is a matter of judgement, and it is not a
       * free one: the map from the frame to (argument, depth) is conformal, so a
       * cell's shape on screen is exactly the shape it has in those coordinates,
       * and a cell carries the page. Get the ratio wrong and every copy of the
       * panel in the frame is stretched or squashed by the same factor, all run.
       *
       * The conformal pair is the argument itself against the log of the
       * potential, and depth is that log over log 2 — so a cell measures
       * TAU / kx by log2 / ky, and asking those to sit in the frame's own aspect
       * fixes ky given kx. Which leaves one honest control: how many copies go
       * round a winding.
       */
      float kx = floor(2.0 + 6.0 * uJuliaChunkGrid);
      float ky = max(1.0, floor(kx * uAspect / 9.0648 + 0.5));

      /*
       * The cell coordinate, and the page laid straight into it.
       *
       * Both factors have to be whole numbers and for the same reason twice
       * over. The argument comes back to itself after a winding, so kx of them
       * across a winding closes; depth rises by exactly one a turn of the
       * flight, so ky bands to the unit closes. Fractions of either would leave
       * a seam that walked — round the figure in the one case, through the wrap
       * in the other.
       *
       * The page has the same say here that it has over the depth banding, and
       * on the same terms: it shifts which cell of the set carries which part of
       * the panel, so the dealing is laid out by the art and not by the
       * arithmetic alone. Inside the period, so the wrap is untouched.
       */
      vec2 chunkUv = fract(vec2(exitArg / TAU * kx, (nu + drive * 0.25) * ky));

      /*
       * How fast the cells run, per unit of frame. The band's rate is the depth
       * gradient the loop already had to compute; the argument's is the orbit's
       * own derivative over where it left, which is the same quantity in polar.
       * Neither is a screen-space difference, and at the boundary of an
       * escape-time set that distinction is the whole ballgame.
       *
       * It is also the magnification, exactly and without a conversion: one cell
       * is one whole page, so cells per unit of frame *is* page per unit of
       * frame. A cell a quarter of the frame across shows the panel at a quarter
       * of its size.
       */
      vec2 cells = vec2(exitD / max(exitRad, 1e-4) / TAU * kx, grad * ky);
      float chunkJac = max(cells.x, cells.y);

      /*
       * And the floor under all of it: a cell is a piece of comic only while
       * there are pixels enough in it to hold one.
       *
       * Inward the cells halve at every contour, so this is not an edge case to
       * be guarded — it is the ladder's own bottom, and it arrives long before
       * the sampling breaks. A whole panel dealt into forty pixels is not a
       * small panel, it is a smudge with a panel's colours, and a frame of those
       * is the texture this mode has spent every other setting trying to stop
       * being. So the ladder is climbed only as far as it stays legible: cells
       * above about a sixth of the frame carry a copy, and below that the pixels
       * go back to the displacement above, which has its own floor under how far
       * the page may be enlarged and is the better answer down there anyway.
       *
       * The handover is one rung of the ladder wide and no wider, which is the
       * same argument the plates make about their own border and it applies
       * harder here. What is being crossfaded is two *coordinates*, and a
       * coordinate halfway between a cell's copy and the far side of a trap
       * points at neither — so every pixel in the band is a crop of the page
       * that nothing asked for. Narrow, it is a rim a contour thick, and a
       * ratio of two either side of the threshold means one band of the set is
       * ever in transit at a time. Hard would be better still if the ladder
       * held still, and it does not: the cells grow as they sweep outward, so a
       * threshold with no width is a whole band popping from one sampling to
       * another as it crosses.
       *
       * Which is also the gradient that was wanted rather than a concession to
       * get it. Big legible pieces where the contours are wide, halving inward
       * as they crowd, dissolving into the figure's own filaments where they
       * crowd past reading — the panel going from chunk to filigree along the
       * flight, instead of being a picture the fractal sits on.
       *
       * Measured as a share of the frame rather than in pixels, which is where
       * this parts company with the facet cap above. That one asks whether the
       * sampling can follow, which is a question about pixels and moves with the
       * device. This one asks whether a whole picture can be read, and a picture
       * is read at the size it takes up — a panel an eighth of the frame across
       * is the same panel on a phone and on a wall.
       */
      float cellFrac = 1.0 / max(chunkJac, 1e-4);
      float take = uJuliaChunk * exited * smoothstep(0.11, 0.22, cellFrac);
      // Both ends of this are in-frame coordinates already, so the mix is a
      // bounded morph rather than a sweep across the page.
      target = mix(target, chunkUv, take);
      jac = mix(jac, chunkJac, take);
    }

    // Mirrored before the blend, not after, on the same reasoning as the tunnel:
    // both ends of the mix are then in-frame coordinates, so ramping the effect
    // in is a bounded morph rather than a sweep through however many repeats lie
    // between here and the trap.
    uv = mix(uv, target, uJulia);
    // Scaled by the blend as well, because a half-strength mix compresses the
    // frame half as hard, and floored at 1 because there is no detail above
    // level 0 to ask for.
    gSceneLod = log2(max(1.0, jac * uJulia));
    // Inside a plate the map is a rigid motion of the frame, so there is nothing
    // to average and the page is read at the one level that has all of it.
    if (plate > 0.0) {
      uv = mix(uv, plateView(plain), plate);
      gSceneLod *= 1.0 - plate;
    }
  }

  return uv;
}

/**
 * The third stage: the smooth displacements, and they alone are scaled by disp.
 *
 * That is what dispersion moves — three refraction strengths through the one
 * geometry distortFold already established, which is why this takes the folded
 * coordinate rather than the screen's and is the only part of the chain run per
 * channel.
 *
 * The two field reads at the end are the only lines in either half that touch a
 * texture, and they sit last so that dispersion refracts them like everything
 * else here.
 */
vec2 distortDisplace(vec2 uv, float disp) {
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

  // The three displacements that are read rather than computed. They sit last
  // among the smooth ones — so dispersion refracts them like everything else
  // here — and they are the only lines in this function that touch a texture.
  // Which also means dispersion pays for each of them three times over: two
  // tiny field textures that cache well, and one mip of the frame.
  if (uMelt > 0.0) {
    /*
     * The picture running under its own weight, displaced along one heading by
     * the page's own tone.
     *
     * Read at a mip level rather than off the frame, and displaced by a
     * *fraction of the feature it read*, which is the whole of what makes this
     * legible rather than a shredder. A displacement whose amplitude is fixed
     * while its field gets finer has a gradient that grows without limit — and
     * that gradient is precisely the sampling Jacobian, so past about half a
     * frame of it neighbouring pixels are reading unrelated parts of the panel
     * and the art is gone. Tying the reach to the level's own texel makes the
     * Jacobian a function of uMelt alone: the melt travels further at a
     * coarser grain because there is more picture moving together, and the
     * panel stays as readable at one grain as at another.
     *
     * Signed about mid-grey, so light and dark run opposite ways and the mean
     * displacement over a frame is nothing. An unsigned field would slide the
     * whole picture along the heading, which is a pan and not a melt.
     */
    float span = exp2(uMeltLevel) / uResolution.y;
    float tone = dot(textureLod(uScene, uv, uMeltLevel).rgb, LUMA) - 0.5;
    uv += vec2(cos(uMeltAngle), sin(uMeltAngle)) * tone * uMelt * disp * span * MELT_REACH;
  }

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
 * Explicit level of detail rather than the implicit one. At level 0 — which is
 * what every effect but the Julia map asks for — this is exactly the sample it
 * was before, because the scene target is filtered LINEAR and has no chain to
 * walk; the backend only builds one when the fractal is running.
 *
 * Misregistration adds a fourth. Cyan coverage is one minus red, so the three
 * colour plates *are* the channel split already — what a printed page has that
 * the split does not is the black. So the grey component is removed from the
 * three colour plates (undercolour removal, which is what a press actually does)
 * and printed back from its own sample. That is the difference between an effect
 * visible only in the colour and one visible on the line art, which is most of
 * what a comic page is made of.
 */
vec3 fetch(vec2 uvR, vec2 uvG, vec2 uvB, vec2 uvK, bool split, float lod) {
  if (!split) return textureLod(uScene, uvG, lod).rgb;
  vec3 c = vec3(
    textureLod(uScene, uvR, lod).r,
    textureLod(uScene, uvG, lod).g,
    textureLod(uScene, uvB, lod).b
  );
  if (uMisreg <= 0.0) return c;
  float grey = min(min(c.r, c.g), c.b);
  vec3 k = textureLod(uScene, uvK, lod).rgb;
  // Identity when the plates are in register: the black comes back from the
  // same place it was lifted from, so the sum is exactly what it was.
  return clamp(c - grey + min(min(k.r, k.g), k.b), 0.0, 1.0);
}

/**
 * The frame's landing, in place of a clamp.
 *
 * A per-channel clamp is what turns "bright" into "muddy". It clips each
 * channel on its own, so it does not merely cap a colour, it *rotates* it:
 * (1.4, 1.1, 0.6) is an orange, and clipping makes it (1.0, 1.0, 0.6), a
 * yellow. Every bright colour in the frame is pulled toward whichever corner of
 * the cube it happened to overshoot, and a stack full of overlaps arrives at
 * the same few flat, wrong colours at once. What is wanted is not less light
 * but light that still says which pictures made it.
 *
 * So the roll-off is applied to the peak channel and the whole colour is scaled
 * by the ratio: below the knee nothing moves at all, and above it the remaining
 * headroom is spent asymptotically, so 1.0 is approached and never reached.
 * Scaling is the point — every channel moves by the same factor, so the ratios
 * between them come out exactly as they went in. Hue and saturation both
 * survive intact, the result is inside the cube by construction rather than by
 * a second correction, and what an overbright colour spends is its brightness,
 * which is the thing there was too much of.
 *
 * At 1 the shoulder is gone and this is a plain gamut fit — still by ratio, and
 * still not the per-channel clip.
 */
vec3 land(vec3 c) {
  c = max(c, 0.0);
  float knee = clamp(uShoulder, 0.0, 1.0);
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= knee) return c;

  float head = max(1.0 - knee, 1e-3);
  float mapped = knee + head * (1.0 - exp(-(peak - knee) / head));
  return min(c * (mapped / peak), 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 radial = uv - 0.5;

  // The geometry, once. Everything the three channels share — the panes, the
  // reparameterisations, the folds and the fractal — lives here, so the fold is
  // computed one time however many refraction strengths are asked for below.
  vec2 folded = distortFold(uv);
  // Written by the fold and by nothing else, so it is the level for all three
  // channels by construction: they are refracted through the same geometry, so
  // they compress the frame by the same amount.
  float lod = gSceneLod;

  vec2 suvG = distortDisplace(folded, 1.0);
  vec2 suvR = suvG;
  vec2 suvB = suvG;
  vec2 suvK = suvG;
  // Misregistration is a per-plate offset, so it needs the split whether or not
  // anything else asked for one.
  bool split = uChroma > 0.0 || uDisperse > 0.0 || uMisreg > 0.0;

  // Dispersion re-runs the displacements at two other refraction strengths, and
  // only the displacements: they are the whole of what a refraction strength
  // means, and they are the cheap end of the chain — smooth arithmetic plus at
  // most two field reads, against a fold that may be carrying a forty-iteration
  // orbit. Bending the channels apart here rather than merely offsetting them is
  // what makes this dispersion instead of chromatic aberration.
  if (uDisperse > 0.0) {
    suvR = distortDisplace(folded, 1.0 + uDisperse);
    suvB = distortDisplace(folded, 1.0 - uDisperse);
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
      col += fetch(suvR + o, suvG + o, suvB + o, suvK + o, split, lod);
    }
    col /= float(BLUR_TAPS);
  } else {
    col = fetch(suvR, suvG, suvB, suvK, split, lod);
  }

  if (uBleed > 0.0) {
    // Ink spreads *out* of a line into absorbent stock rather than smearing
    // along it, so this is a min over the neighbourhood and not a mean: the
    // darks grow and the lights give way, which is the whole asymmetry of the
    // thing. Four taps, on the green plate's coordinate — bleed is the behaviour
    // of the paper under all four inks, not of one of them.
    vec2 e = uBleedRadius / uResolution;
    vec3 ink = col;
    ink = min(ink, textureLod(uScene, suvG + vec2(e.x, 0.0), lod).rgb);
    ink = min(ink, textureLod(uScene, suvG - vec2(e.x, 0.0), lod).rgb);
    ink = min(ink, textureLod(uScene, suvG + vec2(0.0, e.y), lod).rgb);
    ink = min(ink, textureLod(uScene, suvG - vec2(0.0, e.y), lod).rgb);
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

  if (uWake > 0.0) {
    /*
     * The colour plates read at different moments. Green stays at now and the
     * other two lag, so a frame that is not moving comes back out of this
     * unchanged plate for plate — every colour it makes was made by something
     * moving, which is why it can run deep without costing a single line of the
     * drawing.
     *
     * uWakeLead swaps which of red and blue lags furthest. At either end the
     * fringe is red one side of a moving edge and blue the other; in the middle
     * both plates lag together and the fringe is magenta behind the movement
     * with green ahead of it.
     *
     * Indexed by the distorted coordinate, like the slit above: the ring holds
     * finished frames, so the folds and the warp land on the past too.
     */
    // Named around the reserved-word risk: near and far are not keywords in
    // ESSL 3.00, but they are close enough to ones that some compilers have
    // opinions about, and this is a shader nobody can step through.
    float deep = uWakeSpread;
    float shallow = uWakeSpread * 0.42;
    vec3 slow = history(suvG, mix(deep, shallow, uWakeLead));
    vec3 quick = history(suvG, mix(shallow, deep, uWakeLead));
    col = mix(col, vec3(slow.r, col.g, quick.b), uWake);
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

  if (uNeon > 0.0) {
    /*
     * The drawing lit up: the frame's own edges found by central differences on
     * luminance, and given emission.
     *
     * Four taps on the green plate's coordinate at the frame's own mip level, so
     * what it finds is the linework the frame is actually showing rather than
     * one from a sharper copy of it. Weighted toward the dark side of each
     * boundary because a comic's edges are nearly all *ink* — without that this
     * lights the join between two bright fills just as eagerly as the line the
     * artist drew, and reads as an edge-detect filter instead of as a drawing.
     *
     * The hue turns with the gradient's own direction, so a single outline runs
     * through the spectrum as it travels around a figure: the colour is the
     * drawing's geometry rather than a wash laid over it. At a spread of 1 the
     * ring closes on itself and there is no seam at all; below that there is one
     * direction across which the hue steps, which is a soft colour boundary and
     * not a break in the picture.
     */
    vec2 e = uNeonWidth / uResolution;
    float lx0 = dot(textureLod(uScene, suvG - vec2(e.x, 0.0), lod).rgb, LUMA);
    float lx1 = dot(textureLod(uScene, suvG + vec2(e.x, 0.0), lod).rgb, LUMA);
    float ly0 = dot(textureLod(uScene, suvG - vec2(0.0, e.y), lod).rgb, LUMA);
    float ly1 = dot(textureLod(uScene, suvG + vec2(0.0, e.y), lod).rgb, LUMA);
    vec2 g = vec2(lx1 - lx0, ly1 - ly0);
    float edge = smoothstep(0.04, 0.4, length(g)) * (1.0 - smoothstep(0.4, 0.95, dot(col, LUMA)));
    // The epsilon is not cosmetic: atan(0, 0) is undefined by the spec, a flat
    // region has exactly that gradient, and a NaN here would survive the mix
    // below even at an edge weight of zero — which is a field of black speckle
    // across every empty part of the page.
    float turn = atan(g.y, g.x + 1e-6) / TAU;
    vec3 tint = 0.5 + 0.5 * cos(TAU * (uNeonHue + turn * uNeonSpread) + vec3(0.0, 2.0944, 4.1888));
    col = mix(col, tint * NEON_LEVEL, edge * uNeon);
  }

  if (uSheen > 0.0) {
    /*
     * Thin-film iridescence keyed to the frame's own tone — a slick, where the
     * optical path that decides the colour is the picture's brightness.
     *
     * The film has its own luminance subtracted before it is applied, so what is
     * added is pure chroma summing to no light at all. That is the bloom's
     * guarantee arrived at from the other side, and it is what lets this run at
     * any depth over a trail that keeps its maximum rather than decaying to it:
     * the frame after this is exactly as bright as the frame before it, pixel
     * for pixel, and no edge has moved.
     *
     * Windowed to the mid-tones. Ink and paper are the two values a comic states
     * everything with, and leaving both of them alone is why a page can be
     * turned to oil and still be read.
     */
    float lum = dot(col, LUMA);
    vec3 film = cos(TAU * (lum * uSheenBands + uTime * uSheenDrift) + vec3(0.0, 2.0944, 4.1888));
    film -= dot(film, LUMA);
    col += film * uSheen * (4.0 * lum * (1.0 - lum)) * 0.5;
  }

  if (uHueShift != 0.0) col = hueRotate(col, uHueShift);
  // Living Ben-Day: the screen's cells follow the distorted frame rather than a
  // grid pinned to the glass, so the dots flow with whatever is bending the
  // picture instead of the picture sliding underneath a static screen.
  if (uHalftone > 0.0) col = mix(col, halftone(col, mix(uv, suvG, uBenday)), uHalftone);

  if (uCaustics > 0.0) {
    /*
     * Light through moving water: two ridged noises sliding across each other,
     * with the net being where their ridges coincide. The interference is why
     * the drift rate reads low — what a viewer follows moves several times
     * faster than either layer does.
     *
     * Strictly at or below unity. The ridges are left exactly as the frame drew
     * them and everything between them is shadowed, so this only ever removes
     * light: the bright net is the *un*-shadowed picture. That is the whole
     * reason it can sit at any depth beside the max() trail, and it costs
     * nothing visually — a caustic is read by its contrast, not by whether the
     * page it is on has got dimmer.
     *
     * In scene coordinates, so the net refracts along with the page under it.
     * Screen space would be a light rig in front of the glass; this is light in
     * the same water.
     */
    vec2 q = toStage(suvG) * uCausticsScale;
    float t = uTime * uCausticsSpeed;
    float a = 1.0 - abs(vnoise(q + vec2(t, -t * 0.73)) * 2.0 - 1.0);
    float b = 1.0 - abs(vnoise(q * 1.63 + vec2(-t * 0.61, t * 0.44)) * 2.0 - 1.0);
    float web = pow(clamp(a * b, 0.0, 1.0), 2.2);
    col *= 1.0 - uCaustics * 0.5 * (1.0 - web);
  }

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
    // some crossing it. This is the material the ink went onto rather than
    // anything the camera did, so it sits below the exposure and above nothing.
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

  col = land(col);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
