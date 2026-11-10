import { fromPlain, leaves, toPlain, type TreeNode } from "./tree";

/** Everything a shared link carries. */
export interface Shared {
  prompt: string;
  temperature: number;
  root: TreeNode;
  /** Which sentence (in reading order) is the one on stage. */
  active: number;
}

export const T_MIN = 0.1;
export const T_MAX = 2;
export const T_STEP = 0.1;
export const T_DEFAULT = 0.8;
export const PROMPT_MAX = 160;

export function clampTemperature(t: number): number {
  if (!Number.isFinite(t)) return T_DEFAULT;
  const snapped = Math.round(t / T_STEP) * T_STEP;
  return Math.min(T_MAX, Math.max(T_MIN, Math.round(snapped * 10) / 10));
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The part of the URL after `#`. */
export function encodeShared(s: Shared): string {
  const params = new URLSearchParams();
  params.set("p", s.prompt);
  params.set("t", s.temperature.toFixed(1));
  if (s.active > 0) params.set("a", String(s.active));
  params.set("r", toBase64Url(JSON.stringify(toPlain(s.root))));
  return params.toString();
}

/** Read a link. Anything malformed gives null; nothing in it is trusted. */
export function decodeShared(hash: string): Shared | null {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const prompt = params.get("p");
    const r = params.get("r");
    if (!prompt || !r || prompt.length > PROMPT_MAX || r.length > 40000) return null;
    const root = fromPlain(JSON.parse(fromBase64Url(r)));
    if (!root) return null;
    const count = leaves(root).length;
    const a = Number.parseInt(params.get("a") ?? "0", 10);
    const active = Number.isInteger(a) && a >= 0 && a < count ? a : 0;
    return { prompt, temperature: clampTemperature(Number(params.get("t"))), root, active };
  } catch {
    return null;
  }
}
