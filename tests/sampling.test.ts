import { describe, expect, it } from "vitest";
import { pick, probabilities, roll, topK } from "../src/core/sampling";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("probabilities", () => {
  it("sums to one and keeps the order of the scores", () => {
    const p = probabilities([3, 1, 2], 1);
    expect(sum(p)).toBeCloseTo(1, 12);
    expect(p[0]).toBeGreaterThan(p[2] as number);
    expect(p[2]).toBeGreaterThan(p[1] as number);
  });

  it("is the plain softmax at temperature 1", () => {
    const p = probabilities([0, Math.log(3)], 1);
    expect(p[0]).toBeCloseTo(0.25, 12);
    expect(p[1]).toBeCloseTo(0.75, 12);
  });

  it("sharpens towards the favourite as temperature falls", () => {
    const cold = probabilities([2, 1, 0], 0.1);
    const warm = probabilities([2, 1, 0], 1);
    expect(cold[0]).toBeGreaterThan(0.999);
    expect(cold[0]).toBeGreaterThan(warm[0] as number);
  });

  it("flattens towards even odds as temperature rises", () => {
    const hot = probabilities([2, 1, 0], 100);
    for (const x of hot) expect(x).toBeCloseTo(1 / 3, 2);
  });

  it("does not care about a constant added to every score", () => {
    const a = probabilities([5, 3, 1], 0.7);
    const b = probabilities([105, 103, 101], 0.7);
    a.forEach((x, i) => expect(x).toBeCloseTo(b[i] as number, 12));
  });

  it("survives huge scores and an empty list", () => {
    const p = probabilities([1e6, 0], 0.1);
    expect(p[0]).toBe(1);
    expect(Number.isNaN(p[1])).toBe(false);
    expect(probabilities([], 1)).toEqual([]);
  });
});

describe("pick", () => {
  const p = [0.5, 0.3, 0.2];
  it("returns the stretch the roll lands in", () => {
    expect(pick(p, 0)).toBe(0);
    expect(pick(p, 0.49)).toBe(0);
    expect(pick(p, 0.5)).toBe(1);
    expect(pick(p, 0.79)).toBe(1);
    expect(pick(p, 0.81)).toBe(2);
  });
  it("never runs off the end through rounding", () => {
    expect(pick([0.3, 0.3, 0.3], 0.9999)).toBe(2);
  });
  it("matches the odds over many rolls", () => {
    const counts = [0, 0, 0];
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pick(p, roll(1, i))]!++;
    counts.forEach((c, i) => expect(c / n).toBeCloseTo(p[i] as number, 1));
  });
});

describe("roll", () => {
  it("is repeatable and stays in [0, 1)", () => {
    for (let d = 0; d < 200; d++) {
      const u = roll(42, d);
      expect(u).toBe(roll(42, d));
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
  it("differs by position and by seed", () => {
    expect(roll(42, 0)).not.toBe(roll(42, 1));
    expect(roll(42, 0)).not.toBe(roll(43, 0));
  });
});

describe("topK", () => {
  it("finds the largest values, largest first", () => {
    const got = topK(Float32Array.from([1, 9, 3, 7, 5]), 3);
    expect(got.map((g) => g.index)).toEqual([1, 3, 4]);
    expect(got.map((g) => g.value)).toEqual([9, 7, 5]);
  });
  it("copes with fewer values than asked for", () => {
    expect(topK([2, 5], 4).map((g) => g.index)).toEqual([1, 0]);
  });
  it("agrees with a full sort on random data", () => {
    const xs = Array.from({ length: 500 }, (_, i) => roll(7, i));
    const want = xs
      .map((value, index) => ({ index, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 40);
    expect(topK(xs, 40)).toEqual(want);
  });
});
