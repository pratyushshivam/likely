/** The model this page runs. Change it here and re-run `npm run record`. */
export const MODEL_ID = "onnx-community/SmolLM2-135M-ONNX";
export const MODEL_NAME = "SmolLM2-135M";
export const MODEL_URL = "https://huggingface.co/HuggingFaceTB/SmolLM2-135M";
export const MODEL_PARAMS = "135 million";

/** Weights used on each kind of device, and the size of the download in megabytes. */
export const VARIANTS = {
  webgpu: { dtype: "q4f16", megabytes: 118 },
  wasm: { dtype: "q8", megabytes: 138 },
} as const;

export const DEFAULT_PROMPT = "The best thing about living by the sea is";
