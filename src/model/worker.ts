/// <reference lib="webworker" />
import { NextTokenModel, type Device } from "./lm";
import { VARIANTS } from "./config";

export type ToWorker =
  | { type: "load"; device: "webgpu" | "wasm"; dtype?: string }
  | { type: "next"; id: number; prompt: string; pieces: string[] };

export type FromWorker =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "starting"; device: "webgpu" | "wasm" }
  | { type: "fallback"; reason: string }
  | { type: "ready"; device: "webgpu" | "wasm"; dtype: string }
  | { type: "error"; message: string }
  | { type: "next"; id: number; cands: { piece: string; logit: number }[] }
  | { type: "next-error"; id: number; message: string };

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m);
let model: NextTokenModel | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(device: "webgpu" | "wasm", dtype: string): Promise<NextTokenModel> {
  const m = await NextTokenModel.load({
    device: device as Device,
    dtype,
    onProgress: (p) => post({ type: "progress", ...p }),
  });
  post({ type: "starting", device });
  // One real question before saying ready: a model that loads but cannot
  // answer (a GPU driver that lacks an operator, say) should fail here.
  const first = await m.next("Hello", []);
  if (first.length === 0 || first.some((c) => !Number.isFinite(c.logit))) {
    throw new Error("the model returned no usable scores");
  }
  return m;
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === "load") {
    queue = queue.then(async () => {
      let device = msg.device;
      let dtype = msg.dtype ?? VARIANTS[device].dtype;
      try {
        try {
          model = await load(device, dtype);
        } catch (err) {
          if (device !== "webgpu") throw err;
          post({ type: "fallback", reason: String((err as Error)?.message ?? err) });
          device = "wasm";
          dtype = msg.dtype ?? VARIANTS.wasm.dtype;
          model = await load(device, dtype);
        }
        post({ type: "ready", device, dtype });
      } catch (err) {
        post({ type: "error", message: String((err as Error)?.message ?? err) });
      }
    });
  } else if (msg.type === "next") {
    queue = queue.then(async () => {
      try {
        if (!model) throw new Error("the model is not loaded");
        post({ type: "next", id: msg.id, cands: await model.next(msg.prompt, msg.pieces) });
      } catch (err) {
        post({ type: "next-error", id: msg.id, message: String((err as Error)?.message ?? err) });
      }
    });
  }
};
