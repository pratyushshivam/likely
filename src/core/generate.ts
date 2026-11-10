import { pick, probabilities, roll, type Cand } from "./sampling";

/** Anything that can say what might come next: the live model or a recording. */
export type Provider = (prompt: string, pieces: readonly string[]) => Promise<Cand[] | null>;

export const MAX_TOKENS = 16;
export const SEED = 20261111;
export const END_OF_TEXT = "<|endoftext|>";

export interface Step {
  /** Position of the chosen token, counting from 0 after the prompt. */
  depth: number;
  cands: Cand[];
  probs: number[];
  /** Where the roll for this position landed, 0 to 1. */
  u: number;
  /** Index into `cands` of the token the roll chose. */
  chosen: number;
}

/** A sentence is finished at a full stop, a line break, or the end-of-text token. */
export function endsSentence(piece: string, depth: number): boolean {
  if (piece === END_OF_TEXT || piece.includes("\n")) return true;
  return depth >= 3 && /[.!?]["')”]?$/.test(piece.trimEnd());
}

export function isComplete(pieces: readonly string[]): boolean {
  const n = pieces.length;
  if (n === 0) return false;
  return n >= MAX_TOKENS || endsSentence(pieces[n - 1] as string, n - 1);
}

/** Weigh a set of candidates at a temperature and let the roll choose. */
export function weigh(cands: Cand[], depth: number, temperature: number, seed = SEED): Step {
  const probs = probabilities(
    cands.map((c) => c.logit),
    temperature,
  );
  const u = roll(seed, depth);
  return { depth, cands, probs, u, chosen: pick(probs, u) };
}

/**
 * Continue a sentence until it is complete. Yields every step as it is
 * decided; returns false if the provider could not answer part-way.
 */
export async function* extend(
  provider: Provider,
  prompt: string,
  start: readonly string[],
  temperature: number,
  seed = SEED,
): AsyncGenerator<Step, boolean> {
  const pieces = [...start];
  while (!isComplete(pieces)) {
    const cands = await provider(prompt, pieces);
    if (!cands || cands.length === 0) return false;
    const step = weigh(cands, pieces.length, temperature, seed);
    yield step;
    pieces.push((step.cands[step.chosen] as Cand).piece);
  }
  return true;
}
