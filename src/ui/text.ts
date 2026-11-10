import { END_OF_TEXT } from "../core/generate";

/** A token split into the space before it and the part you can see. */
export function split(piece: string): { lead: string; word: string } {
  if (piece === END_OF_TEXT) return { lead: " ", word: "■" };
  const shown = piece.replace(/\n+/g, "↵");
  const m = /^(\s*)([\s\S]*)$/.exec(shown) as RegExpExecArray;
  return { lead: m[1] ?? "", word: m[2] || "␣" };
}

/** How a token is named in a list: no leading space, and a mark if it joins the word before. */
export function label(piece: string): { join: boolean; word: string } {
  if (piece === END_OF_TEXT) return { join: false, word: "end of text" };
  const { lead, word } = split(piece);
  if (word === "↵") return { join: false, word: "new line" };
  return { join: lead === "" && /^[\p{L}\p{N}]/u.test(word), word };
}

export function percent(p: number): string {
  if (p >= 0.0995) return `${Math.round(p * 100)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(1)}%`;
  return "<0.1%";
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The next frame, or 50 ms if the tab is in the background and frames are not coming. */
export const frame = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 50);
  });
