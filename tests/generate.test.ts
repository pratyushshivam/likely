import { describe, expect, it } from "vitest";
import { endsSentence, extend, isComplete, MAX_TOKENS, weigh, type Provider } from "../src/core/generate";
import { lookup, Recorder } from "../src/core/recording";
import type { Cand } from "../src/core/sampling";

/** A stand-in model: always offers the same three words, then a full stop late on. */
const fake: Provider = async (_prompt, pieces) => {
  const cands: Cand[] = [
    { piece: " alpha", logit: 3 },
    { piece: " beta", logit: 2 },
    { piece: " gamma", logit: 1 },
  ];
  if (pieces.length >= 5) cands.unshift({ piece: ".", logit: 9 });
  return cands;
};

async function run(provider: Provider, start: string[], t: number) {
  const pieces = [...start];
  const gen = extend(provider, "p", start, t);
  let r = await gen.next();
  while (!r.done) {
    pieces.push((r.value.cands[r.value.chosen] as Cand).piece);
    r = await gen.next();
  }
  return { pieces, finished: r.value };
}

describe("ending a sentence", () => {
  it("stops at a full stop, but not in the first three tokens", () => {
    expect(endsSentence(".", 5)).toBe(true);
    expect(endsSentence(' it."', 5)).toBe(true);
    expect(endsSentence(".", 1)).toBe(false);
    expect(endsSentence(" sea", 9)).toBe(false);
  });
  it("stops at a line break or end of text anywhere", () => {
    expect(endsSentence("\n\n", 0)).toBe(true);
    expect(endsSentence("<|endoftext|>", 0)).toBe(true);
  });
  it("stops at the length limit", () => {
    expect(isComplete(Array(MAX_TOKENS).fill(" a"))).toBe(true);
    expect(isComplete(Array(MAX_TOKENS - 1).fill(" a"))).toBe(false);
    expect(isComplete([])).toBe(false);
  });
});

describe("extend", () => {
  it("writes the favourite every time when cold, and stops at the full stop", async () => {
    const { pieces, finished } = await run(fake, [], 0.05);
    expect(pieces).toEqual([" alpha", " alpha", " alpha", " alpha", " alpha", "."]);
    expect(finished).toBe(true);
  });

  it("writes the same thing twice for the same dial setting", async () => {
    const a = await run(fake, [], 1.5);
    const b = await run(fake, [], 1.5);
    expect(a.pieces).toEqual(b.pieces);
  });

  it("continues from a hand-chosen start", async () => {
    const { pieces } = await run(fake, [" alpha", " gamma"], 0.05);
    expect(pieces.slice(0, 2)).toEqual([" alpha", " gamma"]);
    expect(pieces.at(-1)).toBe(".");
  });

  it("reports when the provider runs out", async () => {
    const short: Provider = async (_p, pieces) => (pieces.length < 2 ? fake("p", pieces) : null);
    const { pieces, finished } = await run(short, [], 0.05);
    expect(pieces).toHaveLength(2);
    expect(finished).toBe(false);
  });
});

describe("weigh", () => {
  it("keeps the roll fixed while the dial moves the odds", () => {
    const cands = [
      { piece: "a", logit: 2 },
      { piece: "b", logit: 1 },
      { piece: "c", logit: 0 },
    ];
    const cold = weigh(cands, 4, 0.1);
    const hot = weigh(cands, 4, 2);
    expect(cold.u).toBe(hot.u);
    expect(cold.probs[0]).toBeGreaterThan(hot.probs[0] as number);
    expect(cold.chosen).toBe(0);
  });
});

describe("recording", () => {
  it("gives back what was recorded, to a hundredth", async () => {
    const rec = new Recorder();
    const recordingProvider: Provider = async (p, pieces) => {
      const cands = (await fake(p, pieces)) as Cand[];
      rec.add(pieces, cands);
      return cands;
    };
    const live = await run(recordingProvider, [], 0.9);
    const saved = JSON.parse(JSON.stringify(rec.finish({ model: "m", dtype: "q", prompt: "p", seed: 1, pool: 3 })));
    const replay = await run(async (p, pieces) => lookup(saved, p, pieces), [], 0.9);
    expect(replay.pieces).toEqual(live.pieces);
    expect(replay.finished).toBe(true);

    const first = lookup(saved, "p", []) as Cand[];
    expect(first.map((c) => c.piece)).toEqual([" alpha", " beta", " gamma"]);
    expect(first.map((c) => c.logit)).toEqual([-0, -1, -2]);
  });

  it("has nothing for another prompt or an unrecorded road", () => {
    const rec = new Recorder();
    rec.add([], [{ piece: "a", logit: 1 }]);
    const saved = rec.finish({ model: "m", dtype: "q", prompt: "p", seed: 1, pool: 1 });
    expect(lookup(saved, "other", [])).toBeNull();
    expect(lookup(saved, "p", ["a"])).toBeNull();
    expect(lookup(saved, "p", ["never seen"])).toBeNull();
  });
});
