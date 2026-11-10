import { AutoModelForCausalLM, AutoTokenizer, Tensor } from "@huggingface/transformers";
import { POOL, topK, type Cand } from "../core/sampling";
import { MODEL_ID } from "./config";

export type Device = "webgpu" | "wasm" | "cpu";

export interface LoadOptions {
  device: Device;
  dtype: string;
  onProgress?: (p: { file: string; loaded: number; total: number }) => void;
}

/**
 * The language model, reduced to the one question this page asks of it:
 * given this text, how does it score every token it could write next?
 * Used unchanged by the browser worker and by the script that makes the recording.
 */
export class NextTokenModel {
  private pieceIds = new Map<string, number>();
  private promptIds = new Map<string, number[]>();

  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private tokenizer: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private model: any,
  ) {}

  static async load(opts: LoadOptions): Promise<NextTokenModel> {
    const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status === "progress" && e.file && e.total) {
        opts.onProgress?.({ file: e.file, loaded: e.loaded ?? 0, total: e.total });
      }
    };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
    const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dtype: opts.dtype as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      device: opts.device as any,
      progress_callback,
    });
    return new NextTokenModel(tokenizer, model);
  }

  private encode(text: string): number[] {
    const ids = this.tokenizer.encode(text, { add_special_tokens: false }) as number[];
    return Array.from(ids);
  }

  private idsFor(prompt: string, pieces: readonly string[]): number[] {
    let ids = this.promptIds.get(prompt);
    if (!ids) {
      ids = this.encode(prompt);
      this.promptIds.set(prompt, ids);
    }
    const out = [...ids];
    for (const piece of pieces) {
      const id = this.pieceIds.get(piece);
      if (id !== undefined) out.push(id);
      else out.push(...this.encode(piece));
    }
    return out;
  }

  /** The POOL highest-scoring next tokens after `prompt` + `pieces`, best first. */
  async next(prompt: string, pieces: readonly string[]): Promise<Cand[]> {
    const ids = this.idsFor(prompt, pieces);
    if (ids.length === 0) return [];
    const n = ids.length;
    const input_ids = new Tensor("int64", BigInt64Array.from(ids.map((i) => BigInt(i))), [1, n]);
    const attention_mask = new Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]);
    const output = await this.model({ input_ids, attention_mask });
    const logits = output.logits as Tensor;
    const vocab = logits.dims[2] as number;
    const all = (logits.type === "float32" ? logits : logits.to("float32")).data as Float32Array;
    const last = all.subarray((n - 1) * vocab, n * vocab);
    const best = topK(last, POOL);
    for (const value of Object.values(output)) {
      if (value instanceof Tensor && value.location !== "cpu") value.dispose();
    }
    return best.map(({ index, value }) => {
      const piece = this.tokenizer.decode([index], { skip_special_tokens: false }) as string;
      if (!this.pieceIds.has(piece)) this.pieceIds.set(piece, index);
      return { piece, logit: value };
    });
  }
}
