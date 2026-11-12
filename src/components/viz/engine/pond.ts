/**
 * The pond's sources, worked out once a frame rather than once a pixel.
 *
 * Everything about a source except its distance from the pixel — where it sits,
 * how far it reaches, how tight its rings are, how old its drop is, which way it
 * swirls — is a function of the seed, the phase and the clock alone. In the
 * shader that was eight hashes, two sine-cosine pairs and a handful of
 * smoothsteps per source, paid at every pixel of the frame, up to four sources
 * deep and three times over under dispersion. Here it is paid four times a
 * frame. The shader keeps only what genuinely varies across the picture.
 *
 * The hash is the shader's own, carried out in float32 so a seed draws the
 * arrangement it drew when this ran on the GPU. Not bit-for-bit on every device
 * — GPUs are free to contract the multiply-adds, and they differ among
 * themselves already — but the same construction on the same precision, which
 * is as near as the hardware ever agreed with itself.
 */

/**
 * Most sources one pond may run.
 *
 * Four is where interference stops reading as several places and starts reading
 * as a boil: past it the sources overlap everywhere, the rings cancel, and what
 * is left is a shimmer with no centres in it — which is what turbulence is
 * for, and it does it better and for the same money.
 */
export const POND_MAX = 4;

/** How far a source may wander from where the seed put it, stage units. Small:
 *  the drift is there so a long hold does not settle, not so the sources tour
 *  the frame. */
const POND_DRIFT = 0.09;

/**
 * How fast a drop's front travels, as a fraction of the rings' own travel —
 * so also the reciprocal of a packet's life, two ring cycles at unit rate.
 *
 * A half rather than a whole on purpose. With the front locked to the rings
 * the packet would be a bubble with a still pattern inside it; at half, the
 * rings are born at the back of the group, run forward through it and vanish
 * off its leading edge. That is not a stylisation — deep water carries a
 * gravity wave group at exactly half its phase speed, and it is the detail
 * that makes a splash read as a splash.
 */
const POND_DROP = 0.5;

/**
 * The slope budget: the most any one source may bend the frame, as the
 * derivative of its own displacement.
 *
 * This is the number the whole effect is scaled by, and scaling by a *slope*
 * rather than by an amplitude is the point. A radial sine displaces by A and
 * bends by A times its frequency, so an amplitude held fixed while the rings
 * tighten walks straight past 1 — where the map stops being injective and the
 * page starts folding back through itself — and a pond draws far tighter rings
 * than the centred ripple, because its pools are a fraction of the frame and
 * rings need room inside one to read as rings at all. So the amplitude is
 * derived from the frequency instead, and every source gets the same bend
 * whatever spacing it drew.
 *
 * Under 1 rather than at it because sources overlap. The sum is normalised by
 * the root of their count and not by the count itself — see the end of the
 * block in the post shader — so two pools meeting can reach about a root-two
 * multiple of this between them, and this is the largest value at which a sweep
 * of the cycler's own draws finds no folded pixel anywhere in the frame at any
 * phase.
 */
const POND_SLOPE = 0.62;

/** Ceiling on the amplitude the budget above implies, stage units. It only
 *  binds at the loose end — below about a dozen radians a unit the slope is
 *  cheap and the swell is enormous, and a fifteenth of the frame is as much
 *  travel as §6 will pay for however smooth it is. */
const POND_AMP = 0.06;

const TAU = 6.2831853;

const f32 = Math.fround;
const fract32 = (x: number): number => f32(x - Math.floor(x));

/** `hash21` from the post shader, step for step in float32. */
function hash21(x: number, y: number): number {
  let px = fract32(f32(f32(x) * f32(123.34)));
  let py = fract32(f32(f32(y) * f32(456.21)));
  const lift = f32(f32(px * f32(px + f32(45.32))) + f32(py * f32(py + f32(45.32))));
  px = f32(px + lift);
  py = f32(py + lift);
  return fract32(f32(px * py));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface PondInput {
  /** Live sources, already floored. */
  sources: number;
  seed: number;
  freq: number;
  reach: number;
  swirl: number;
  /** Travel of the rings, in cycles — `phases.pond`. */
  phase: number;
  /** The post shader's `uTime`. */
  time: number;
  aspect: number;
}

/**
 * Per-source uniforms, packed for the post shader. Allocated once by the
 * caller and refilled every frame, so the post pass stays allocation-free.
 *
 * - `src[i]`  = centre.xy (stage units), reach, ring frequency
 * - `wave[i]` = ring travel in radians, drop age, drop window, amplitude
 * - `turn[i]` = cos and sin of the swirl rotation applied to the push
 *
 * Slots at or past `sources` are left as they were: the shader's loop breaks
 * before reading them.
 */
export interface PondUniforms {
  src: number[][];
  wave: number[][];
  turn: number[][];
}

export function makePondUniforms(): PondUniforms {
  const make = (size: number) => Array.from({ length: POND_MAX }, () => new Array(size).fill(0));
  return { src: make(4), wave: make(4), turn: make(2) };
}

export function fillPondUniforms(
  input: PondInput,
  srcs: PondUniforms["src"],
  waves: PondUniforms["wave"],
  turns: PondUniforms["turn"]
): void {
  const count = Math.min(POND_MAX, input.sources);
  for (let i = 0; i < count; i++) {
    const id = f32(f32(i * 3) + f32(f32(input.seed) * 61));
    /*
     * Placed in the frame and then carried into the stage, rather than drawn
     * in stage coordinates directly: the hash gives a point in the unit
     * square whatever the aspect is, so the same seed reads as the same
     * arrangement on a phone held upright and on a television.
     */
    const homeX = (hash21(id, 1.73) - 0.5) * input.aspect;
    const homeY = hash21(id, 5.31) - 0.5;
    const hf = hash21(id, 9.11);
    const hr = hash21(id, 2.47);
    const hd = hash21(id, 6.73);
    const hs = hash21(id, 3.97);
    const hw = hash21(id, 8.29);
    const hv = hash21(id, 4.13);
    /*
     * Sources wander on slow circles of their own. On the clock rather than on
     * the travel phase, and that is not an oversight: the phase wraps, and a
     * wrap is invisible in a sine and a step in a position.
     */
    const turn = hr * TAU + input.time * (0.02 + (0.05 - 0.02) * hd);
    const reach = Math.max(input.reach * (0.6 + (1.4 - 0.6) * hf), 1e-3);
    const freq = input.freq * (0.7 + (1.45 - 0.7) * hs);
    // Half of them run inward. Two sources facing each other read as two
    // things happening; two running the same way read as one thing repeated,
    // which is the whole argument against a single centred ripple.
    const dir = hd < 0.5 ? -1 : 1;
    /*
     * Halves, unity and three halves — never anything between. The phase is
     * wrapped against POND_CYCLE and only a rate that divides it evenly
     * survives the wrap: an arbitrary multiplier would put a step into the
     * rings every time the phase came round, at whatever amount the effect
     * happened to be running.
     */
    const rate = (0.5 + 0.5 * Math.floor(hv * 3)) * dir;
    const travel = input.phase * rate;
    const age = travel * POND_DROP + hf - Math.floor(travel * POND_DROP + hf);
    // Born and gone smoothly. A packet that arrived at full size would be the
    // one discontinuity this effect is able to produce.
    const window = smoothstep(0, 0.12, age) * (1 - smoothstep(0.5, 1, age));
    // Turned off radial by the swirl, each source its own way round: at a
    // right angle the rings drag the picture around themselves instead of
    // pushing it in and out, and a pond of that is four slow whirlpools.
    const swirl = input.swirl * 1.5708 * (hw < 0.5 ? -1 : 1);

    const src = srcs[i];
    src[0] = homeX + Math.cos(turn) * POND_DRIFT;
    src[1] = homeY + Math.sin(turn) * POND_DRIFT;
    src[2] = reach;
    src[3] = freq;

    const wave = waves[i];
    wave[0] = travel * TAU;
    wave[1] = age;
    wave[2] = window;
    // Amplitude out of the slope budget and the source's own spacing — see
    // POND_SLOPE. The core fade stays in the shader: it is the one factor here
    // that depends on how far the pixel is from the source.
    wave[3] = Math.min(POND_SLOPE / freq, POND_AMP);

    const rot = turns[i];
    rot[0] = Math.cos(swirl);
    rot[1] = Math.sin(swirl);
  }
}
