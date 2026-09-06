import { describe, expect, it, vi } from "vitest";
import { Rng, formatSeed, parseSeed, randomSeed } from "./rng";

describe("Rng", () => {
  it("replays identically from the same seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const runA = Array.from({ length: 20 }, () => a.next());
    const runB = Array.from({ length: 20 }, () => b.next());
    expect(runA).toEqual(runB);
  });

  it("diverges between seeds", () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it("stays in [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("coerces the seed to an unsigned 32-bit value", () => {
    // A negative seed must still produce a usable, repeatable stream.
    expect(new Rng(-1).next()).toBe(new Rng(0xffffffff).next());
  });

  describe("range", () => {
    it("stays within the bounds", () => {
      const rng = new Rng(3);
      for (let i = 0; i < 200; i++) {
        const v = rng.range(-5, 5);
        expect(v).toBeGreaterThanOrEqual(-5);
        expect(v).toBeLessThan(5);
      }
    });

    it("collapses to the value when the bounds are equal", () => {
      expect(new Rng(1).range(2, 2)).toBe(2);
    });
  });

  describe("int", () => {
    it("stays in [0, n)", () => {
      const rng = new Rng(9);
      for (let i = 0; i < 300; i++) {
        const v = rng.int(5);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(5);
      }
    });

    it("always returns 0 for n = 1", () => {
      const rng = new Rng(4);
      for (let i = 0; i < 20; i++) expect(rng.int(1)).toBe(0);
    });

    it("does not divide by zero for n = 0", () => {
      expect(new Rng(4).int(0)).toBe(0);
    });
  });

  describe("bool", () => {
    it("is always false at probability 0 and always true at 1", () => {
      const rng = new Rng(11);
      for (let i = 0; i < 50; i++) {
        expect(rng.bool(0)).toBe(false);
        expect(rng.bool(1)).toBe(true);
      }
    });

    it("lands on both sides at the default probability", () => {
      const rng = new Rng(13);
      const draws = Array.from({ length: 200 }, () => rng.bool());
      expect(draws).toContain(true);
      expect(draws).toContain(false);
    });
  });

  describe("pick", () => {
    it("returns a member of the list", () => {
      const items = ["a", "b", "c"] as const;
      const rng = new Rng(17);
      for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    });

    it("returns the only item from a one-item list", () => {
      expect(new Rng(2).pick(["only"])).toBe("only");
    });
  });

  describe("weightedIndex", () => {
    it("always picks the only non-zero weight", () => {
      const rng = new Rng(5);
      for (let i = 0; i < 100; i++) expect(rng.weightedIndex([0, 1, 0])).toBe(1);
    });

    it("returns 0 when every weight is zero", () => {
      expect(new Rng(5).weightedIndex([0, 0, 0])).toBe(0);
    });

    it("returns 0 for an empty weight list", () => {
      expect(new Rng(5).weightedIndex([])).toBe(0);
    });

    it("does not need the weights to sum to 1", () => {
      const rng = new Rng(21);
      const hits = new Set<number>();
      for (let i = 0; i < 400; i++) hits.add(rng.weightedIndex([70, 30]));
      expect([...hits].sort()).toEqual([0, 1]);
    });

    it("favours the heavier weight", () => {
      const rng = new Rng(23);
      let zeros = 0;
      for (let i = 0; i < 1000; i++) if (rng.weightedIndex([9, 1]) === 0) zeros++;
      expect(zeros).toBeGreaterThan(800);
    });
  });

  describe("fork", () => {
    it("is deterministic given the parent's position", () => {
      const a = new Rng(31).fork();
      const b = new Rng(31).fork();
      expect(a.next()).toBe(b.next());
    });

    it("advances the parent, so two forks differ", () => {
      const parent = new Rng(31);
      expect(parent.fork().next()).not.toBe(parent.fork().next());
    });
  });
});

describe("seed encoding", () => {
  it("round-trips through base 36", () => {
    for (const seed of [0, 1, 12345, 0xffffffff]) {
      expect(parseSeed(formatSeed(seed))).toBe(seed >>> 0);
    }
  });

  it("formats compactly enough for a URL", () => {
    expect(formatSeed(0xffffffff)).toMatch(/^[0-9a-z]+$/);
    expect(formatSeed(0xffffffff).length).toBeLessThanOrEqual(7);
  });

  it("is null for an absent or unparseable seed", () => {
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed("")).toBeNull();
    expect(parseSeed("!!!")).toBeNull();
  });

  it("produces a seed the codec can carry", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const seed = randomSeed();
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
    expect(parseSeed(formatSeed(seed))).toBe(seed);
    vi.restoreAllMocks();
  });
});
