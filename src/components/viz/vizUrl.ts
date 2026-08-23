import { CONFIG_FIELDS, STAGE_MODES, cloneConfig, isStageMode } from "./vizConfig";
import type { ConfigField, VizConfig } from "./vizConfig";

/**
 * The `vizcfg` codec: a whole custom configuration squeezed into one URL-safe
 * token.
 *
 * Two decisions do most of the compressing. The token is a *delta against the
 * named preset* — `vizpreset=zoink` still carries the bulk of the settings, so
 * a link only spells out what the reader actually moved. And every value is
 * quantised to the tuning panel's own step, which is the finest a slider can
 * express anyway, so a field costs one byte instead of a printed float.
 *
 * The consequence of the first decision, stated plainly: a link is read
 * against whatever the preset is on the day it is opened. Retuning a preset
 * moves every shared link that was based on it. That is the price of short
 * links, and it is the right trade here — the deltas are small, the presets
 * are the vocabulary, and a link that drifts with its preset is closer to what
 * "the zoink one, but with more halftone" meant than a frozen snapshot would be.
 */

/** Byte 0, low two bits. Anything else is a token from another format. */
const VERSION = 1;
const VERSION_MASK = 0b11;
/** Byte 0, bit 2: 0 = sparse (code, value) pairs, 1 = presence bitmask. */
const LAYOUT_MASK = 0b100;
/** Byte 0, bits 3-6: 0 = the preset's own stage, else STAGE_MODES index + 1. */
const STAGE_SHIFT = 3;
const STAGE_BITS = 0b1111;

/**
 * Wire order for the tunables: a field's index here *is* its code in an
 * encoded token.
 *
 * So this list is append-only. Reordering it or dropping an entry would not
 * break the build — it would quietly make every link ever shared decode into
 * different values. New tunables go on the end; a retired one keeps its slot
 * (see `retired` below).
 *
 * `speed` is deliberately absent. It rides in `vizspeed`, where it stays
 * legible and hand-editable, and having it in both places would mean two
 * answers to the same question.
 */
const PINNED_PATHS: readonly string[] = [
  "layerCount", "layerLifetime", "layerLifetimeJitter", "crossfade", "layerOpacity", "beat",
  "keyBalance", "zoomAmount", "panAmount", "rotateAmount", "tintAmount",
  "post.feedbackAmount", "post.feedbackScale", "post.feedbackRotate", "post.feedbackDroste",
  // `post.grain` is retired — the film grain is gone from the post chain. Its
  // slot stays so every code after it keeps its number; see `CODEC_FIELDS`.
  "post.halftone", "post.halftoneScale", "post.chroma", "post.posterize", "post.grain",
  "post.vignette", "post.exposure", "post.shoulder", "post.hueShift", "post.solarize",
  "post.kaleido", "post.kaleidoSegments", "post.kaleidoSpin", "post.tile", "post.fold",
  "post.foldScale", "post.foldOffsetX", "post.foldOffsetY", "post.foldSpin", "post.lattice",
  "post.latticeScale", "post.droste", "post.drosteInner", "post.drostePeriod", "post.drosteTwist",
  "post.drosteSpin", "post.tunnel", "post.tunnelDepth", "post.tunnelSpin", "post.warp",
  "post.warpScale", "post.warpSpeed", "post.ripple", "post.rippleFreq", "post.twist",
  "post.bulge", "post.quasi", "post.quasiFreq", "post.turbulence", "post.turbulenceScale",
  "post.turbulenceSpeed",
  "post.flow", "post.flowScale", "post.flowDecay", "post.react", "post.reactFeed",
  "post.reactKill", "post.reactScale", "post.slit", "post.slitAxis", "post.slitLuma",
  "post.slitDepth",
  "post.disperse", "post.blur", "post.blurSpin", "post.bloom", "post.bloomThreshold",
  "post.bloomRadius",
  "post.misreg", "post.misregSpread", "post.moire", "post.moireSpread", "post.benday",
  "post.krackle", "post.krackleScale", "post.krackleThreshold", "post.bleed", "post.bleedRadius",
  "post.paper",
  "psychedelia", "cycleInterval", "wander", "wanderRate",
  "stageDensity", "stageScale", "stageFeather", "stageOpacity", "stageMorph", "stageMorphRate",
  "stageBillboard", "stageBreathe", "stageFov", "stageSpin", "stageFlight", "stageSolids",
  "stageAlign", "stageDisplace", "stageDisplaceRate", "stageSwirl",
  "weights.rhyme", "weights.clash", "weights.color", "weights.random",
  // Appended, not filed with the other geometric maps above, because this list
  // is the wire order and only the end of it is free.
  "post.julia", "post.juliaZoom", "post.juliaShape", "post.juliaSpin", "post.juliaTrap",
  "post.juliaSpread", "post.juliaFlight", "post.juliaAnchor", "post.juliaBind", "post.juliaDepth",
  "post.juliaEdge", "post.juliaFacet", "post.juliaDrift", "post.juliaPlate",
  "post.juliaChunk", "post.juliaChunkGrid", "post.juliaPlateFold",
  // How far a run follows music. The *source* it listens to is deliberately not
  // here and never will be: a link must not be able to ask for a stranger's
  // microphone, so capture is reached only through a gesture on the page.
  "reactivity",
  // How far the music may lift the press artefacts from zero. Safe to share:
  // it decides what a run that is *already* listening does, and grants nothing.
  "audioLift",
  // The other half of the reactivity pair — how sharply a run that is listening
  // follows. Shareable on the same grounds, and capped independently of the link
  // under `prefers-reduced-motion`, so a token asking for the whole of it still
  // arrives calm on a machine that has asked for calm.
  "attack",
  // The capture-delay offset. Pinned so a link round-trips cleanly rather than
  // because it is worth sharing: what it corrects is a property of the machine
  // doing the listening, so a value tuned on one is very likely wrong on
  // another. It grants nothing and cannot make a run louder or faster.
  "audioLatency",
  // The panes, filed here rather than with the other geometric maps for the same
  // reason the Julia block is: this list is the wire order, and only its end is
  // free.
  "post.pane", "post.paneGrid", "post.paneBreathe", "post.paneRate",
  // The five effects that keep the drawing legible while they work — the melt,
  // the colour wake, the caustic net, the lit linework and the slick. Appended
  // whole rather than filed beside their neighbours above, on the rule this list
  // states at the top: only the end of it is free.
  "post.melt", "post.meltLevel", "post.meltAngle",
  "post.wake", "post.wakeSpread", "post.wakeLead",
  "post.caustics", "post.causticsScale", "post.causticsSpeed",
  "post.neon", "post.neonHue", "post.neonSpread", "post.neonWidth",
  "post.sheen", "post.sheenBands", "post.sheenDrift",
];

/**
 * The codec table, by code. A hole is a pinned path that no longer exists as a
 * tunable: it keeps its slot so the codes after it do not shift, and a token
 * that mentions it is rejected rather than guessed at — its width is unknown,
 * so reading past it would decode every later field into nonsense.
 */
const CODEC_FIELDS: (ConfigField | undefined)[] = (() => {
  const byPath = new Map(CONFIG_FIELDS.map((entry) => [entry.path, entry]));
  const table = PINNED_PATHS.map((path) => byPath.get(path));
  // Anything tunable but unpinned — a field added to CONFIG_FIELDS without a
  // line above — is appended so it is still captured. Its code is only stable
  // as long as it is the sole straggler, hence the warning.
  const pinned = new Set(PINNED_PATHS);
  const strays = CONFIG_FIELDS.filter(
    (entry) => entry.path !== "speed" && !pinned.has(entry.path)
  );
  if (strays.length > 0 && import.meta.env.DEV) {
    console.warn(
      `vizUrl: ${strays.map((entry) => entry.path).join(", ")} missing from PINNED_PATHS — ` +
        "append them there to pin their URL codes."
    );
  }
  return [...table, ...strays];
})();

const MASK_BYTES = Math.ceil(CODEC_FIELDS.length / 8);

/** How many distinct positions a slider has. */
function stepCount(field: ConfigField): number {
  return Math.max(1, Math.round((field.max - field.min) / field.step));
}

/** Two fields (the fold offsets) have more than 256 positions, so they pay a
 *  second byte. Fixed by the field's declared range, so the decoder knows the
 *  width from the code alone. */
function isWide(field: ConfigField): boolean {
  return stepCount(field) > 0xff;
}

function quantize(field: ConfigField, value: number): number {
  const q = Math.round((value - field.min) / field.step);
  return Math.min(stepCount(field), Math.max(0, Number.isFinite(q) ? q : 0));
}

function dequantize(field: ConfigField, q: number): number {
  const value = field.min + q * field.step;
  // The steps are as fine as 0.0005, so six places is past every one of them —
  // this only sheds the binary-float dust the multiply leaves behind.
  return Number(Math.min(field.max, Math.max(field.min, value)).toFixed(6));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(token)) return null;
  const padded = token.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(token.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The token describing `config` as a departure from `base`, or null when it is
 * not one — a run of the plain preset leaves the URL exactly as short as it was
 * before this codec existed.
 */
export function encodeVizConfig(config: VizConfig, base: VizConfig): string | null {
  const changed: { code: number; field: ConfigField; q: number }[] = [];
  for (let code = 0; code < CODEC_FIELDS.length; code++) {
    const field = CODEC_FIELDS[code];
    if (!field) continue;
    const q = quantize(field, field.get(config));
    if (q !== quantize(field, field.get(base))) changed.push({ code, field, q });
  }

  // Bits 3-6, so the mode list cannot outgrow fifteen entries without a format
  // bump: one that did would be dropped here rather than folded into the flag
  // beside it.
  const stageIndex = STAGE_MODES.indexOf(config.stageKind) + 1;
  const stage =
    config.stageKind === base.stageKind || stageIndex < 1 || stageIndex > STAGE_BITS
      ? 0
      : stageIndex;

  if (changed.length === 0 && stage === 0) return null;

  // The values cost the same either way, so the layout is chosen on the cost of
  // *naming* the fields: a code byte each, against one fixed presence bitmask.
  // The crossover is fourteen fields, so a light tweak stays tiny and a
  // wholesale retune stops paying a byte per field to say which ones moved.
  const useMask = MASK_BYTES < changed.length;

  const bytes: number[] = [VERSION | (useMask ? LAYOUT_MASK : 0) | (stage << STAGE_SHIFT)];

  const pushValue = (entry: { field: ConfigField; q: number }) => {
    if (isWide(entry.field)) bytes.push(entry.q & 0xff, (entry.q >> 8) & 0xff);
    else bytes.push(entry.q);
  };

  if (useMask) {
    const mask = new Uint8Array(MASK_BYTES);
    for (const entry of changed) mask[entry.code >> 3] |= 1 << (entry.code & 7);
    bytes.push(...mask);
    for (const entry of changed) pushValue(entry);
  } else {
    for (const entry of changed) {
      bytes.push(entry.code);
      pushValue(entry);
    }
  }

  return toBase64Url(Uint8Array.from(bytes));
}

/**
 * `base` with the token's departures applied, or null if the token is not one
 * this build can read — a truncated paste, a format from a later version, a
 * field since retired. Null rather than a partial config on purpose: half a
 * custom look is not what the link said, and the caller falls back to the plain
 * preset, which is.
 */
export function decodeVizConfig(token: string, base: VizConfig): VizConfig | null {
  const bytes = fromBase64Url(token);
  if (!bytes || bytes.length < 1) return null;

  const header = bytes[0];
  if ((header & VERSION_MASK) !== VERSION) return null;

  const config = cloneConfig(base);

  const stage = (header >> STAGE_SHIFT) & STAGE_BITS;
  if (stage > 0) {
    const kind = STAGE_MODES[stage - 1];
    if (!isStageMode(kind)) return null;
    config.stageKind = kind;
  }

  let cursor = 1;
  const readValue = (field: ConfigField): boolean => {
    const width = isWide(field) ? 2 : 1;
    if (cursor + width > bytes.length) return false;
    const q = width === 2 ? bytes[cursor] | (bytes[cursor + 1] << 8) : bytes[cursor];
    cursor += width;
    field.set(config, dequantize(field, q));
    return true;
  };

  if (header & LAYOUT_MASK) {
    if (bytes.length < 1 + MASK_BYTES) return null;
    const mask = bytes.subarray(1, 1 + MASK_BYTES);
    cursor = 1 + MASK_BYTES;
    for (let code = 0; code < CODEC_FIELDS.length; code++) {
      if ((mask[code >> 3] & (1 << (code & 7))) === 0) continue;
      const field = CODEC_FIELDS[code];
      if (!field || !readValue(field)) return null;
    }
  } else {
    while (cursor < bytes.length) {
      const field = CODEC_FIELDS[bytes[cursor++]];
      if (!field || !readValue(field)) return null;
    }
  }

  return config;
}

/**
 * The same delta as JSON, in the shape the tuning panel emits — what the launch
 * modal shows in its custom-config box when a run arrives from a link, so the
 * departures are readable and editable rather than only encoded.
 */
export function diffConfigJson(config: VizConfig, base: VizConfig): string | null {
  const top: Record<string, unknown> = {};
  const post: Record<string, number> = {};
  const weights: Record<string, number> = {};

  if (config.stageKind !== base.stageKind) top.stageKind = config.stageKind;

  for (const field of CONFIG_FIELDS) {
    if (field.path === "speed") continue;
    const q = quantize(field, field.get(config));
    if (q === quantize(field, field.get(base))) continue;
    const value = dequantize(field, q);
    const [head, tail] = field.path.split(".");
    if (tail === undefined) top[head] = value;
    else if (head === "post") post[tail] = value;
    else if (head === "weights") weights[tail] = value;
  }

  if (Object.keys(post).length > 0) top.post = post;
  if (Object.keys(weights).length > 0) top.weights = weights;
  if (Object.keys(top).length === 0) return null;

  return JSON.stringify(top, null, 2);
}
