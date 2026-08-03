import type { AudioFrame } from "./AudioReactor";
import type { AudioBinding } from "./audioBind";
import type { PostParams } from "./types";

/**
 * What the music actually delivers to the frame — the instrument §7 of
 * `docs/visualizer-audio-reach.md` asks for, and the one thing the feature has
 * never had.
 *
 * ## Why this exists
 *
 * The meters in `VizAudioMeters` draw the *analysis*, which is the half that has
 * worked since phase 0. Nothing has ever drawn the other half. Two rounds of
 * mis-tuning came out of that gap: v1 read as a flinch and was slowed down until
 * it was inert, and the reason the second state was inert — a cascade of one-pole
 * filters passing 0.5% of the beat to the geometry — took an afternoon of
 * arithmetic to establish from the source. It would have been one glance at this.
 *
 * So this measures the delivered signal rather than the channel, in the two units
 * the document keeps arguing in:
 *
 * - **Reach**, the range a parameter covers over the window against the value the
 *   composition authored. This is the "is anything happening at all" question,
 *   and it is what would have shown `grain` moving by 0.03 and the geometry
 *   moving by nothing.
 * - **Peak rate**, absolute change per second. This is the safety budget, and it
 *   is deliberately *not* normalised by anything: the whole thesis of §2 is that
 *   depth may rise while peak velocity does not, and a rate expressed relative to
 *   each parameter's own depth cannot express that.
 *
 * ## Where it measures
 *
 * Either side of `AudioBinding.applyPost`, so "authored" is whatever the LFOs,
 * the drift and the cycler arrived at and the difference is the audio pass alone
 * — which is the isolation §10's table was produced by hand under. Before
 * `SafetyGovernor.apply`, deliberately: this answers what the binding asked for,
 * and a governor that clamps it is a separate finding worth being able to see as
 * a discrepancy rather than one that quietly hides here.
 *
 * ## Cost
 *
 * Nothing constructs this unless the tuning panel is open, and `Director` holds
 * null otherwise, so the shipping path is untouched — the same rule the reactor
 * itself follows. Attached, it is a few dozen comparisons per frame and no
 * allocation: the rows are owned here and handed out by reference, the way
 * `AudioFrame` is.
 */

/** Seconds the running range and peak rate are taken over. Ten, per §7 — long
 *  enough to hold a bar at any tempo the reactor will track and a phrase at
 *  none, short enough that a change made while tuning shows up before the
 *  attention that made it has moved on. */
const WINDOW = 10;
/**
 * Buckets the window is split into.
 *
 * A true sliding extremum needs a monotonic deque per parameter; bucketing makes
 * a sample O(1) and a read O(BUCKETS) for a window that is accurate to a tenth of
 * its length, which is far inside what any of this is read to.
 */
const BUCKETS = 10;
const BUCKET_SECONDS = WINDOW / BUCKETS;

/** Denominator floor for reach, so a parameter the preset authored at 0 — most
 *  of the press family — reports a large relative reach rather than a division
 *  by zero. It is large by construction and saying so is the point. */
const REACH_FLOOR = 1e-4;

/** Frames of trace held before recording stops itself: three minutes at 60fps.
 *  Past that the spectrum has everything it will ever have and the download is
 *  becoming a nuisance. */
const MAX_ROWS = 10800;

/**
 * The parameters the binding touches, in the order the hierarchy puts them —
 * fast row, bar row, geometry — because reading them in that order is how the
 * design is checked. A row that is flat where its neighbours move is either a
 * preset that authored it at zero or a binding that is not arriving, and the
 * grouping is what makes those two distinguishable at a glance.
 */
const FAST_ROW = [
  "feedbackScale",
  "feedbackRotate",
  "hueShift",
  "chroma",
  "grain",
  "misreg",
  "bleed",
  "krackle",
] as const;

const BAR_ROW = ["feedbackAmount", "bloom", "vignette"] as const;

const GEOMETRY_ROW = [
  "bulge",
  "twist",
  "ripple",
  "warp",
  "kaleido",
  "disperse",
] as const;

type TrackedPost = (typeof FAST_ROW | typeof BAR_ROW | typeof GEOMETRY_ROW)[number];

const TRACKED_POST: readonly TrackedPost[] = [...FAST_ROW, ...BAR_ROW, ...GEOMETRY_ROW];

/**
 * The three channels that do not live in `PostParams`.
 *
 * They are the whole bar row of the hierarchy and the reason the rewrite
 * happened, so leaving them out of the instrument that measures the rewrite
 * would be a strange omission. Each is a gain around 1, so 1 is their authored
 * value by construction.
 */
const GEOMETRY_GAINS = ["pulse", "flight", "spin"] as const;

/** Which row of §2's hierarchy a reading belongs to, for the readout's grouping. */
export type ReachRow = "fast" | "bar" | "geometry";

/** One parameter's delivered signal. Mutated in place and handed out by
 *  reference — a reader consumes it within the frame that produced it. */
export interface Reach {
  key: string;
  row: ReachRow;
  /** What the composition asked for, before the audio pass. */
  authored: number;
  /** What it got. */
  delivered: number;
  /** Extremes over the window. */
  low: number;
  high: number;
  /** `(high - low)` against the authored value. 0 means the music is not
   *  touching this parameter at all. */
  reach: number;
  /** Absolute change per second, peak over the window. The rate budget. */
  peakRate: number;
}

/** Bucketed extremes and peak rate for one parameter. */
class Track {
  private readonly lo = new Float64Array(BUCKETS);
  private readonly hi = new Float64Array(BUCKETS);
  private readonly rate = new Float64Array(BUCKETS);
  private slot = 0;
  private previous = Number.NaN;

  constructor() {
    this.clear();
  }

  clear(): void {
    this.lo.fill(Number.POSITIVE_INFINITY);
    this.hi.fill(Number.NEGATIVE_INFINITY);
    this.rate.fill(0);
    this.slot = 0;
    this.previous = Number.NaN;
  }

  /** Retire the oldest bucket. `previous` deliberately survives, so the rate
   *  across a bucket boundary is measured rather than skipped. */
  rotate(): void {
    this.slot = (this.slot + 1) % BUCKETS;
    this.lo[this.slot] = Number.POSITIVE_INFINITY;
    this.hi[this.slot] = Number.NEGATIVE_INFINITY;
    this.rate[this.slot] = 0;
  }

  sample(delivered: number, dt: number): void {
    if (delivered < this.lo[this.slot]) this.lo[this.slot] = delivered;
    if (delivered > this.hi[this.slot]) this.hi[this.slot] = delivered;
    if (!Number.isNaN(this.previous) && dt > 0) {
      const per = Math.abs(delivered - this.previous) / dt;
      if (per > this.rate[this.slot]) this.rate[this.slot] = per;
    }
    this.previous = delivered;
  }

  /** Extremes across every live bucket, into the row handed to the reader. */
  resolve(into: Reach): void {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let rate = 0;
    for (let i = 0; i < BUCKETS; i++) {
      if (this.lo[i] < low) low = this.lo[i];
      if (this.hi[i] > high) high = this.hi[i];
      if (this.rate[i] > rate) rate = this.rate[i];
    }
    // Before the first sample lands there is no range, and reporting ±Infinity
    // to a readout that is about to draw a bar would be worse than reporting
    // the value it has.
    into.low = low === Number.POSITIVE_INFINITY ? into.delivered : low;
    into.high = high === Number.NEGATIVE_INFINITY ? into.delivered : high;
    into.reach = (into.high - into.low) / Math.max(Math.abs(into.authored), REACH_FLOOR);
    into.peakRate = rate;
  }
}

/** Channel names dumped to the trace, in the order the binding computes them. */
const CHANNELS = [
  "grid",
  "amplitude",
  "beatPulse",
  "barBreath",
  "phrase",
  "fast",
  "swell",
  "shimmer",
  "tide",
  "accent",
  "luma",
  "hue",
  "barPhase",
] as const;

/** Analysis columns, so the delivered spectrum can be read against the input
 *  that produced it rather than on its own. */
const FEATURES = [
  "level",
  "low",
  "lowMid",
  "mid",
  "high",
  "flux",
  "onset",
  "onsetStrength",
  "beatPhase",
  "beatCount",
  "bpm",
  "confidence",
  "silent",
] as const;

export class AudioProbe {
  private readonly rows: Reach[] = [];
  private readonly byKey = new Map<string, Reach>();
  private readonly tracks = new Map<string, Track>();
  private readonly authoredSnapshot = new Map<string, number>();

  private bucketClock = 0;
  private dt = 1 / 60;
  private frame: AudioFrame | null = null;

  /** Rows are filled by `deliver` and read by the panel between frames. */
  private trace: number[][] = [];
  private tracing = false;
  private traceClock = 0;

  constructor() {
    for (const key of TRACKED_POST) this.add(key, rowOf(key));
    for (const key of GEOMETRY_GAINS) this.add(key, "bar");
  }

  private add(key: string, row: ReachRow): void {
    const reach: Reach = {
      key,
      row,
      authored: 0,
      delivered: 0,
      low: 0,
      high: 0,
      reach: 0,
      peakRate: 0,
    };
    this.rows.push(reach);
    this.byKey.set(key, reach);
    this.tracks.set(key, new Track());
  }

  /** Every parameter's current reading, by reference. Resolved on demand rather
   *  than per frame: the panel reads this an order of magnitude less often than
   *  the engine writes it. */
  read(): readonly Reach[] {
    for (const reach of this.rows) this.tracks.get(reach.key)?.resolve(reach);
    return this.rows;
  }

  get recording(): boolean {
    return this.tracing;
  }

  get frames(): number {
    return this.trace.length;
  }

  /** Real seconds of trace held. */
  get seconds(): number {
    return this.traceClock;
  }

  startTrace(): void {
    this.trace = [];
    this.traceClock = 0;
    this.tracing = true;
  }

  stopTrace(): void {
    this.tracing = false;
  }

  /**
   * Handed the analysis and the real frame delta, before the post chain runs.
   *
   * Split from `deliver` because the two happen either side of three other
   * passes over the parameters, and because the frame the analysis produced is
   * needed whether or not a post chain is built — a run with no panels in it
   * still advances every channel.
   */
  observe(frame: AudioFrame | null, dt: number): void {
    this.frame = frame;
    this.dt = dt;
    this.bucketClock += dt;
    if (this.bucketClock >= BUCKET_SECONDS) {
      this.bucketClock = 0;
      for (const track of this.tracks.values()) track.rotate();
    }
  }

  /** Snapshot what the composition authored, immediately before the audio pass. */
  authored(post: PostParams): void {
    for (const key of TRACKED_POST) this.authoredSnapshot.set(key, post[key]);
  }

  /**
   * Take the delivered values, immediately after the audio pass, and commit a
   * trace row if one is being recorded.
   *
   * The three gains are read off the binding rather than out of `post` because
   * they never enter it: `pulse` is applied to the resolved draw rectangle and
   * the other two to the spatial phases. Slot 0 for the pulse, which is the
   * offset the first layer of the stack reads — every other layer is the same
   * shape moved in time, so one of them is the whole gesture.
   */
  deliver(post: PostParams, binding: AudioBinding): void {
    const dt = this.dt;
    for (const key of TRACKED_POST) {
      const reach = this.rowFor(key);
      reach.authored = this.authoredSnapshot.get(key) ?? post[key];
      reach.delivered = post[key];
      this.tracks.get(key)?.sample(post[key], dt);
    }

    const gains: Record<(typeof GEOMETRY_GAINS)[number], number> = {
      pulse: binding.pulse(0),
      flight: binding.flight,
      spin: binding.spin,
    };
    for (const key of GEOMETRY_GAINS) {
      const reach = this.rowFor(key);
      reach.authored = 1;
      reach.delivered = gains[key];
      this.tracks.get(key)?.sample(gains[key], dt);
    }

    if (!this.tracing) return;
    if (this.trace.length >= MAX_ROWS) {
      this.tracing = false;
      return;
    }

    this.traceClock += dt;
    const frame = this.frame;
    const channels = binding.channels;
    const row: number[] = [this.traceClock];
    for (const key of FEATURES) {
      const value = frame ? frame[key] : 0;
      row.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    for (const key of CHANNELS) row.push(channels[key]);
    // Deviations rather than values: what the spectrum in §7 is taken of is the
    // audio contribution, and an authored value that the LFOs are already moving
    // would otherwise put the composition's own drift into every column.
    for (const key of TRACKED_POST) {
      row.push(post[key] - (this.authoredSnapshot.get(key) ?? post[key]));
    }
    for (const key of GEOMETRY_GAINS) row.push(gains[key] - 1);
    this.trace.push(row);
  }

  /**
   * The trace as CSV — one row per drawn frame, every channel and every
   * delivered deviation.
   *
   * Deliberately the whole thing rather than a summary. §7's acceptance
   * criterion is the *amplitude spectrum* of each column, which needs the
   * samples: the delivered spectrum should carry energy at the beat rate, the
   * bar rate and the section rate, and the finding that started this document is
   * that it carried none above 0.4 Hz.
   */
  csv(): string {
    const header = [
      "t",
      ...FEATURES,
      ...CHANNELS.map((key) => `ch_${key}`),
      ...TRACKED_POST.map((key) => `d_${key}`),
      ...GEOMETRY_GAINS.map((key) => `d_${key}`),
    ];
    const lines = [header.join(",")];
    for (const row of this.trace) {
      lines.push(row.map((value) => format(value)).join(","));
    }
    return lines.join("\n");
  }

  reset(): void {
    for (const track of this.tracks.values()) track.clear();
    this.bucketClock = 0;
    this.frame = null;
    this.trace = [];
    this.traceClock = 0;
    this.tracing = false;
  }

  private rowFor(key: string): Reach {
    return this.byKey.get(key) as Reach;
  }
}

function rowOf(key: TrackedPost): ReachRow {
  if ((FAST_ROW as readonly string[]).includes(key)) return "fast";
  if ((BAR_ROW as readonly string[]).includes(key)) return "bar";
  return "geometry";
}

/** Six significant figures. The smallest thing worth seeing here is the trail
 *  zoom, which deviates by about a thousandth and compounds — rounded to four
 *  it would read as a step function. */
function format(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  const text = value.toPrecision(6);
  // Only ever inside a fraction: stripping trailing zeros off an integer would
  // turn 100000 into 1.
  if (!text.includes(".") || text.includes("e")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}
