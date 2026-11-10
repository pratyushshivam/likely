/**
 * Makes public/recording.json: real output from the model, saved so the page
 * can show a run before (or without) downloading the model.
 *
 * It records every point the page can reach without the model:
 *   - the sentence at every stop of the temperature dial, and
 *   - at the default temperature, the road from each of the top runner-ups.
 *
 *   npm run record -- "Prompt text" [dtype]
 */
import { writeFileSync } from "node:fs";
import { extend, SEED, weigh, isComplete, type Provider } from "../src/core/generate";
import { Recorder } from "../src/core/recording";
import { POOL, type Cand } from "../src/core/sampling";
import { T_DEFAULT, T_MAX, T_MIN, T_STEP } from "../src/core/share";
import { DEFAULT_PROMPT, MODEL_ID, VARIANTS } from "../src/model/config";
import { NextTokenModel } from "../src/model/lm";

const prompt = process.argv[2] ?? DEFAULT_PROMPT;
const dtype = process.argv[3] ?? VARIANTS.wasm.dtype;
const RUNNER_UPS = Number(process.argv[4] ?? 7);
const out = process.argv[5] ?? "public/recording.json";

const model = await NextTokenModel.load({ device: "cpu", dtype });
const recorder = new Recorder();
const memo = new Map<string, Cand[]>();

const provider: Provider = async (p, pieces) => {
  const key = pieces.join("\u0001");
  let cands = memo.get(key);
  if (!cands) {
    cands = await model.next(p, pieces);
    memo.set(key, cands);
  }
  recorder.add(pieces, cands);
  return cands;
};

async function write(start: string[], t: number): Promise<string[]> {
  const pieces = [...start];
  for await (const step of extend(provider, prompt, start, t)) {
    pieces.push((step.cands[step.chosen] as Cand).piece);
  }
  return pieces;
}

const stops: number[] = [];
for (let t = T_MIN; t <= T_MAX + 1e-9; t += T_STEP) stops.push(Math.round(t * 10) / 10);

let trunk: string[] = [];
for (const t of stops) {
  const pieces = await write([], t);
  if (t === T_DEFAULT) trunk = pieces;
  console.log(t.toFixed(1), JSON.stringify(pieces.join("")));
}

console.log("\nrunner-ups at", T_DEFAULT);
for (let d = 0; d < trunk.length; d++) {
  const before = trunk.slice(0, d);
  const cands = (await provider(prompt, before)) as Cand[];
  const step = weigh(cands, d, T_DEFAULT);
  let taken = 0;
  for (let i = 0; i < cands.length && taken < RUNNER_UPS; i++) {
    if (i === step.chosen) continue;
    taken++;
    const start = [...before, (cands[i] as Cand).piece];
    const pieces = isComplete(start) ? start : await write(start, T_DEFAULT);
    if (i < 2) console.log(" ", d, JSON.stringify(pieces.join("")));
  }
}

const recording = recorder.finish({ model: MODEL_ID, dtype, prompt, seed: SEED, pool: POOL });
const json = JSON.stringify(recording);
writeFileSync(out, json);
console.log(`\n${recorder.points} points, ${(json.length / 1024).toFixed(0)} KB -> ${out}`);
