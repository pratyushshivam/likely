/** One candidate next token: its text and the model's raw score for it. */
export interface Cand {
  piece: string;
  logit: number;
}

/** How many of the top-scoring tokens the sampler is allowed to pick from. */
export const POOL = 40;

/**
 * Turn scores into probabilities at a temperature.
 * p_i = exp(logit_i / T) / sum_j exp(logit_j / T), computed stably.
 */
export function probabilities(logits: readonly number[], temperature: number): number[] {
  if (logits.length === 0) return [];
  const t = Math.max(temperature, 1e-6);
  let max = -Infinity;
  for (const l of logits) if (l > max) max = l;
  const out = new Array<number>(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(((logits[i] as number) - max) / t);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / sum;
  return out;
}

/**
 * Inverse-CDF pick: lay the probabilities end to end on a line from 0 to 1
 * and return the index of the stretch that the roll `u` lands in.
 */
export function pick(probs: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i] as number;
    if (u < acc) return i;
  }
  return Math.max(0, probs.length - 1);
}

/**
 * The roll for a position in the sentence: a number in [0, 1) that depends
 * only on the seed and the position. Holding the rolls fixed means that when
 * the temperature changes, any change in the writing is the temperature's.
 */
export function roll(seed: number, depth: number): number {
  let x = (seed ^ Math.imul(depth + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

interface Entry {
  index: number;
  value: number;
}

/** Indices and values of the k largest entries, largest first. */
export function topK(values: ArrayLike<number>, k: number): Entry[] {
  const best: Entry[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (best.length === k && v <= (best[k - 1] as Entry).value) continue;
    let j = best.length < k ? best.length : k - 1;
    while (j > 0 && (best[j - 1] as Entry).value < v) {
      best[j] = best[j - 1] as Entry;
      j--;
    }
    best[j] = { index: i, value: v };
  }
  return best;
}
