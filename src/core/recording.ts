import type { Cand } from "./sampling";

/**
 * A recording is real model output saved ahead of time: for every point the
 * recorded runs passed through, the top candidates and their scores.
 *
 * node = [cands, children]
 *   cands    flat pairs: token index, then how far its score is below the
 *            best one, in hundredths.
 *   children token index -> node
 */
export type RecNode = [number[], { [token: string]: RecNode }];

export interface Recording {
  model: string;
  dtype: string;
  prompt: string;
  seed: number;
  pool: number;
  tokens: string[];
  root: RecNode;
}

const indexCache = new WeakMap<Recording, Map<string, number>>();
function tokenIndex(rec: Recording): Map<string, number> {
  let m = indexCache.get(rec);
  if (!m) {
    m = new Map(rec.tokens.map((t, i) => [t, i]));
    indexCache.set(rec, m);
  }
  return m;
}

/** The candidates the model gave after `prompt` + `pieces`, if that point was recorded. */
export function lookup(rec: Recording, prompt: string, pieces: readonly string[]): Cand[] | null {
  if (prompt !== rec.prompt) return null;
  const index = tokenIndex(rec);
  let node = rec.root;
  for (const piece of pieces) {
    const i = index.get(piece);
    if (i === undefined) return null;
    const next = node[1][String(i)];
    if (!next) return null;
    node = next;
  }
  const flat = node[0];
  if (flat.length === 0) return null;
  const out: Cand[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ piece: rec.tokens[flat[i] as number] ?? "", logit: -(flat[i + 1] as number) / 100 });
  }
  return out;
}

/** Builds a recording one visited point at a time. */
export class Recorder {
  private tokens: string[] = [];
  private index = new Map<string, number>();
  private root: RecNode = [[], {}];
  points = 0;

  private tok(piece: string): number {
    let i = this.index.get(piece);
    if (i === undefined) {
      i = this.tokens.length;
      this.tokens.push(piece);
      this.index.set(piece, i);
    }
    return i;
  }

  add(pieces: readonly string[], cands: readonly Cand[]): void {
    let node = this.root;
    for (const piece of pieces) {
      const key = String(this.tok(piece));
      node = node[1][key] ??= [[], {}];
    }
    if (node[0].length === 0) this.points++;
    const top = cands[0]?.logit ?? 0;
    node[0] = cands.flatMap((c) => [this.tok(c.piece), Math.round((top - c.logit) * 100)]);
  }

  finish(meta: Omit<Recording, "tokens" | "root">): Recording {
    return { ...meta, tokens: this.tokens, root: this.root };
  }
}
