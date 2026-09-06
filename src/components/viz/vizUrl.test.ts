import { describe, expect, it } from "vitest";
import { CONFIG_FIELDS, DEFAULT_CONFIG, STAGE_MODES, cloneConfig } from "./vizConfig";
import type { ConfigField, VizConfig } from "./vizConfig";
import { decodeVizConfig, diffConfigJson, encodeVizConfig } from "./vizUrl";

const base = DEFAULT_CONFIG;
const byPath = new Map(CONFIG_FIELDS.map((f) => [f.path, f]));

function field(path: string): ConfigField {
  const f = byPath.get(path);
  if (!f) throw new Error(`no such tunable: ${path}`);
  return f;
}

/** `base` with one tunable moved off its current value. */
function moved(path: string, value?: number): VizConfig {
  const f = field(path);
  const config = cloneConfig(base);
  const next = value ?? (f.get(base) + f.step * 4 <= f.max ? f.get(base) + f.step * 4 : f.min);
  f.set(config, next);
  return config;
}

function bytesOf(token: string): number[] {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(token.length / 4) * 4, "=");
  return [...Buffer.from(padded, "base64")];
}

describe("encodeVizConfig", () => {
  it("is null for a run of the plain preset", () => {
    // A link to an untouched preset stays exactly as short as it was before
    // this codec existed.
    expect(encodeVizConfig(cloneConfig(base), base)).toBeNull();
  });

  it("emits a URL-safe token", () => {
    const token = encodeVizConfig(moved("layerCount"), base)!;
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("spends one code byte and one value byte on a single tweak", () => {
    const token = encodeVizConfig(moved("layerCount", 8), base)!;
    // header, code 0 (layerCount is first in the wire order), quantised value.
    expect(bytesOf(token)).toEqual([1, 0, 7]);
  });

  it("stamps version 1 in the low two bits", () => {
    expect(bytesOf(encodeVizConfig(moved("layerCount"), base)!)[0] & 0b11).toBe(1);
  });

  it("carries the stage in bits 3-6 with no field bytes at all", () => {
    const config = cloneConfig(base);
    config.stageKind = "vault";
    // STAGE_MODES index 2, stored as 3 so zero can mean "the preset's own".
    expect(bytesOf(encodeVizConfig(config, base)!)).toEqual([1 | (3 << 3)]);
  });

  it("leaves the stage bits clear when the stage is the preset's own", () => {
    const config = moved("layerCount");
    config.stageKind = base.stageKind;
    expect((bytesOf(encodeVizConfig(config, base)!)[0] >> 3) & 0b1111).toBe(0);
  });

  it("switches to the presence bitmask once naming the fields costs more", () => {
    const config = cloneConfig(base);
    let moves = 0;
    for (const f of CONFIG_FIELDS) {
      if (f.path === "speed") continue;
      f.set(config, Math.min(f.max, f.get(config) + f.step * 3));
      if (++moves >= 40) break;
    }
    const header = bytesOf(encodeVizConfig(config, base)!)[0];
    expect(header & 0b100).toBe(0b100);
  });

  it("stays on the sparse layout for a light tweak", () => {
    const header = bytesOf(encodeVizConfig(moved("layerCount"), base)!)[0];
    expect(header & 0b100).toBe(0);
  });

  it("ignores a change too small for the slider's own step", () => {
    // Values are quantised to the finest position a slider can express, so a
    // sub-step nudge is not a departure.
    const f = field("crossfade");
    const config = cloneConfig(base);
    f.set(config, f.get(base) + f.step / 10);
    expect(encodeVizConfig(config, base)).toBeNull();
  });

  it("never encodes speed — it rides in vizspeed instead", () => {
    const config = cloneConfig(base);
    config.speed = base.speed === 2 ? 0.5 : 2;
    expect(encodeVizConfig(config, base)).toBeNull();
  });
});

describe("decodeVizConfig", () => {
  it("round-trips a single tweak", () => {
    const config = moved("layerCount", 8);
    const out = decodeVizConfig(encodeVizConfig(config, base)!, base)!;
    expect(out.layerCount).toBe(8);
  });

  it("leaves everything the token did not mention on the base", () => {
    const out = decodeVizConfig(encodeVizConfig(moved("layerCount", 8), base)!, base)!;
    expect(out.crossfade).toBe(base.crossfade);
    expect(out.post.halftone).toBe(base.post.halftone);
  });

  it("does not mutate the base config", () => {
    const before = JSON.stringify(base);
    decodeVizConfig(encodeVizConfig(moved("layerCount", 8), base)!, base);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("round-trips a stage change", () => {
    for (const kind of STAGE_MODES) {
      const config = cloneConfig(base);
      config.stageKind = kind;
      const token = encodeVizConfig(config, base);
      const out = token === null ? cloneConfig(base) : decodeVizConfig(token, base)!;
      expect(out.stageKind).toBe(kind);
    }
  });

  it("round-trips a wide field through its two bytes", () => {
    // `post.foldOffsetX` has 300 slider positions, so it pays a second byte
    // and the decoder must know that from the code alone.
    const f = field("post.foldOffsetX");
    expect(Math.round((f.max - f.min) / f.step)).toBeGreaterThan(0xff);
    const config = cloneConfig(base);
    f.set(config, 1.42);
    const out = decodeVizConfig(encodeVizConfig(config, base)!, base)!;
    expect(f.get(out)).toBeCloseTo(1.42, 6);
  });

  it("round-trips a wholesale retune through the bitmask layout", () => {
    const config = cloneConfig(base);
    const touched: ConfigField[] = [];
    let moves = 0;
    for (const f of CONFIG_FIELDS) {
      if (f.path === "speed") continue;
      f.set(config, Math.min(f.max, f.get(config) + f.step * 3));
      touched.push(f);
      if (++moves >= 40) break;
    }
    const token = encodeVizConfig(config, base)!;
    const out = decodeVizConfig(token, base)!;
    // Values are quantised to the slider's own step, so a value that started
    // off-grid comes back snapped to the nearest position — within one step,
    // which is the finest the panel could have expressed it anyway.
    for (const f of touched) {
      expect(Math.abs(f.get(out) - f.get(config))).toBeLessThanOrEqual(f.step);
    }
    // Re-encoding what came back is the invariant that actually matters: the
    // codec is idempotent, so a link survives being opened and re-shared.
    expect(encodeVizConfig(out, base)).toBe(token);
  });

  it("round-trips a stage change alongside field changes", () => {
    const config = moved("layerCount", 8);
    config.stageKind = "shatter";
    const out = decodeVizConfig(encodeVizConfig(config, base)!, base)!;
    expect(out.stageKind).toBe("shatter");
    expect(out.layerCount).toBe(8);
  });

  it("clamps a decoded value into the field's declared range", () => {
    // A hand-edited token can name a quantised step past the slider's end.
    const token = Buffer.from([1, 0, 0xff]).toString("base64url");
    const out = decodeVizConfig(token, base)!;
    expect(out.layerCount).toBeLessThanOrEqual(field("layerCount").max);
  });

  describe("rejection", () => {
    it("rejects a token with characters outside the alphabet", () => {
      expect(decodeVizConfig("not a token!", base)).toBeNull();
    });

    it("rejects an empty token", () => {
      expect(decodeVizConfig("", base)).toBeNull();
    });

    it("rejects a format from another version", () => {
      const token = Buffer.from([0b10, 0, 7]).toString("base64url");
      expect(decodeVizConfig(token, base)).toBeNull();
    });

    it("rejects a sparse token truncated mid-value", () => {
      // A code byte with no value after it: half a custom look is not what
      // the link said.
      expect(decodeVizConfig(Buffer.from([1, 0]).toString("base64url"), base)).toBeNull();
    });

    it("rejects a wide field truncated to one byte", () => {
      const code = bytesOf(
        encodeVizConfig(
          (() => {
            const c = cloneConfig(base);
            field("post.foldOffsetX").set(c, 1.42);
            return c;
          })(),
          base,
        )!,
      )[1];
      expect(decodeVizConfig(Buffer.from([1, code, 0]).toString("base64url"), base)).toBeNull();
    });

    it("rejects a token naming a retired field", () => {
      // `post.grain` keeps its slot so later codes do not shift, but its
      // width is unknown — reading past it would decode everything after it
      // into nonsense.
      const codes = CONFIG_FIELDS.map((f) => f.path);
      expect(codes).not.toContain("post.grain");
      const hole = 255; // past the end of the table — the same undefined branch
      expect(decodeVizConfig(Buffer.from([1, hole, 0]).toString("base64url"), base)).toBeNull();
    });

    it("rejects a bitmask token that is shorter than the mask itself", () => {
      expect(decodeVizConfig(Buffer.from([1 | 0b100, 0xff]).toString("base64url"), base)).toBeNull();
    });

    it("rejects a stage index past the mode list", () => {
      const token = Buffer.from([1 | (15 << 3)]).toString("base64url");
      expect(decodeVizConfig(token, base)).toBeNull();
    });
  });
});

describe("wire order", () => {
  it("is append-only — reordering it would silently redirect every shared link", () => {
    // The first few codes, pinned. A change here is not a build failure, it
    // is a change of meaning for links already in the wild.
    const expected = [
      "layerCount",
      "layerLifetime",
      "layerLifetimeJitter",
      "crossfade",
      "layerOpacity",
      "beat",
      "keyBalance",
    ];
    expected.forEach((path, code) => {
      const f = field(path);
      const config = cloneConfig(base);
      f.set(config, Math.min(f.max, f.get(base) + f.step));
      expect(bytesOf(encodeVizConfig(config, base)!)[1]).toBe(code);
    });
  });
});

describe("diffConfigJson", () => {
  it("is null when nothing departs from the preset", () => {
    expect(diffConfigJson(cloneConfig(base), base)).toBeNull();
  });

  it("names a top-level tunable", () => {
    expect(JSON.parse(diffConfigJson(moved("layerCount", 8), base)!)).toEqual({ layerCount: 8 });
  });

  it("nests a post field under post", () => {
    const config = cloneConfig(base);
    field("post.halftone").set(config, field("post.halftone").max);
    const out = JSON.parse(diffConfigJson(config, base)!);
    expect(out.post.halftone).toBe(field("post.halftone").max);
  });

  it("nests a weight under weights", () => {
    const config = cloneConfig(base);
    field("weights.rhyme").set(config, field("weights.rhyme").max);
    const out = JSON.parse(diffConfigJson(config, base)!);
    expect(out.weights.rhyme).toBe(field("weights.rhyme").max);
  });

  it("names the stage when it differs", () => {
    const config = cloneConfig(base);
    config.stageKind = "prism";
    expect(JSON.parse(diffConfigJson(config, base)!).stageKind).toBe("prism");
  });

  it("omits speed, matching the token", () => {
    const config = cloneConfig(base);
    config.speed = base.speed === 2 ? 0.5 : 2;
    expect(diffConfigJson(config, base)).toBeNull();
  });

  it("emits readable, re-editable JSON", () => {
    const json = diffConfigJson(moved("layerCount", 8), base)!;
    expect(json).toContain("\n");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("agrees with the token about which fields moved", () => {
    const config = moved("layerCount", 8);
    field("post.halftone").set(config, field("post.halftone").max);
    const json = JSON.parse(diffConfigJson(config, base)!);
    const decoded = decodeVizConfig(encodeVizConfig(config, base)!, base)!;
    expect(decoded.layerCount).toBe(json.layerCount);
    expect(decoded.post.halftone).toBe(json.post.halftone);
  });
});
