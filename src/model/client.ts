import type { Cand } from "../core/sampling";
import { MODEL_ID, VARIANTS } from "./config";
import type { FromWorker, ToWorker } from "./worker";

export type Phase = "idle" | "downloading" | "starting" | "ready" | "error";

export interface LiveState {
  phase: Phase;
  device: "webgpu" | "wasm";
  /** Megabytes fetched so far and expected in total. */
  loaded: number;
  total: number;
  /** True when the weights are already in this browser's cache. */
  cached: boolean;
  error: string;
}

/** Whether this browser can run the half-precision WebGPU weights. */
async function detectDevice(): Promise<"webgpu" | "wasm"> {
  const forced = new URLSearchParams(location.search).get("device");
  if (forced === "wasm" || forced === "webgpu") return forced;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (adapter && adapter.features.has("shader-f16")) return "webgpu";
  } catch {
    /* fall through */
  }
  return "wasm";
}

async function isCached(device: "webgpu" | "wasm"): Promise<boolean> {
  try {
    if (!("caches" in self)) return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    const suffix = `model_${device === "webgpu" ? "q4f16" : "quantized"}.onnx_data`;
    return keys.some((k) => k.url.includes(MODEL_ID) && k.url.endsWith(suffix));
  } catch {
    return false;
  }
}

/** The live model: a worker that downloads it once and answers questions. */
export class Live {
  state: LiveState = { phase: "idle", device: "wasm", loaded: 0, total: VARIANTS.wasm.megabytes, cached: false, error: "" };
  private worker: Worker | null = null;
  private files = new Map<string, { loaded: number; total: number }>();
  private waiting = new Map<number, { resolve: (c: Cand[]) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private listeners = new Set<() => void>();
  private whenReady: Promise<boolean> | null = null;

  constructor() {
    void detectDevice().then(async (device) => {
      const cached = await isCached(device);
      if (this.state.phase === "idle") this.set({ device, total: VARIANTS[device].megabytes, cached });
    });
  }

  get ready(): boolean {
    return this.state.phase === "ready";
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  private set(patch: Partial<LiveState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Download (or reopen) the model and start it. Resolves true once it can answer. */
  start(): Promise<boolean> {
    if (this.whenReady && this.state.phase !== "error") return this.whenReady;
    this.files.clear();
    this.worker?.terminate();
    this.whenReady = new Promise<boolean>((resolve) => {
      void detectDevice().then((device) => {
        this.set({ phase: "downloading", device, total: VARIANTS[device].megabytes, loaded: 0, error: "" });
        const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        this.worker = worker;
        worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data, resolve);
        worker.onerror = (e) => {
          this.set({ phase: "error", error: e.message || "the model worker stopped" });
          resolve(false);
        };
        const dtype = new URLSearchParams(location.search).get("dtype") ?? undefined;
        worker.postMessage({ type: "load", device, dtype } satisfies ToWorker);
      });
    });
    return this.whenReady;
  }

  private receive(msg: FromWorker, resolve: (ok: boolean) => void): void {
    switch (msg.type) {
      case "progress": {
        this.files.set(msg.file, { loaded: msg.loaded, total: msg.total });
        let loaded = 0;
        let total = 0;
        for (const f of this.files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        const mb = (n: number) => n / 1e6;
        const expected = VARIANTS[this.state.device].megabytes;
        if (this.state.phase === "downloading") {
          this.set({ loaded: mb(loaded), total: Math.max(mb(total), expected) });
        }
        break;
      }
      case "starting":
        this.set({ phase: "starting", device: msg.device });
        break;
      case "fallback":
        this.files.clear();
        this.set({ phase: "downloading", device: "wasm", loaded: 0, total: VARIANTS.wasm.megabytes });
        break;
      case "ready":
        this.set({ phase: "ready", device: msg.device, cached: true });
        resolve(true);
        break;
      case "error":
        this.set({ phase: "error", error: msg.message });
        resolve(false);
        break;
      case "next":
        this.waiting.get(msg.id)?.resolve(msg.cands);
        this.waiting.delete(msg.id);
        break;
      case "next-error":
        this.waiting.get(msg.id)?.reject(new Error(msg.message));
        this.waiting.delete(msg.id);
        break;
    }
  }

  next(prompt: string, pieces: readonly string[]): Promise<Cand[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) return reject(new Error("the model is not running"));
      const id = this.nextId++;
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ type: "next", id, prompt, pieces: [...pieces] } satisfies ToWorker);
    });
  }
}
