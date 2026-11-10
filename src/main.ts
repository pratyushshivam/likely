import { endsSentence, extend, weigh, type Provider, type Step } from "./core/generate";
import { lookup, type Recording } from "./core/recording";
import type { Cand } from "./core/sampling";
import { clampTemperature, decodeShared, encodeShared, PROMPT_MAX, T_DEFAULT, T_MAX, T_MIN, T_STEP } from "./core/share";
import {
  addChild,
  anchorOf,
  createRoot,
  depthOf,
  firstLeafUnder,
  forkOf,
  leaves,
  pathTo,
  piecesTo,
  pruneUp,
  type TreeNode,
} from "./core/tree";
import { Live } from "./model/client";
import { DEFAULT_PROMPT, MODEL_NAME, MODEL_URL } from "./model/config";
import { calm, initMotion, opened, refreshSoon, scramble, setBand } from "./ui/motion";
import { byId, el, frame, label, percent, sleep, split } from "./ui/text";

const ROWS = 8;
const CHIPS = 6;
const MAX_ROADS = 12;

/* ------------------------------------------------------------------ state */

const state = {
  prompt: DEFAULT_PROMPT,
  t: T_DEFAULT,
  root: createRoot(),
  /** The end of the sentence on stage: a leaf, or the tip of one being written. */
  active: null as TreeNode | null,
  /** Which word of that sentence the odds are shown for. */
  focus: -1,
  writing: false,
};

let recording: Recording | null = null;
const live = new Live();
const cache = new Map<string, Cand[]>();
const asked = new Set<string>();
let runId = 0;
let dirty = false;
let lastHash = "";

const keyOf = (prompt: string, pieces: readonly string[]) => [prompt, ...pieces].join("\u0001");

/** Candidates we can show right now without waiting. */
function peek(pieces: readonly string[]): Cand[] | null {
  return cache.get(keyOf(state.prompt, pieces)) ?? (recording ? lookup(recording, state.prompt, pieces) : null);
}

const provider: Provider = async (prompt, pieces) => {
  const key = keyOf(prompt, pieces);
  const hit = cache.get(key) ?? (recording ? lookup(recording, prompt, pieces) : null);
  if (hit) return hit;
  if (!live.ready) return null;
  const cands = await live.next(prompt, pieces);
  cache.set(key, cands);
  return cands;
};

/** Fetch candidates for a point we want to show, then draw again. */
function want(pieces: readonly string[]): void {
  const key = keyOf(state.prompt, pieces);
  if (!live.ready || asked.has(key)) return;
  asked.add(key);
  void provider(state.prompt, pieces).then(
    () => renderAll(),
    () => undefined,
  );
}

const activePath = () => (state.active ? pathTo(state.active) : []);

/* --------------------------------------------------------------- sentence */

const seen = new Map<HTMLElement, WeakSet<TreeNode>>();

/**
 * A word of a sentence as a button. The space before it is returned apart, to
 * be placed between the buttons, so that lines wrap as ordinary text does.
 */
function tokenButton(node: TreeNode, depth: number): { lead: string; button: HTMLButtonElement; word: HTMLSpanElement } {
  const { lead, word } = split(node.piece);
  const button = el("button", "tok");
  button.type = "button";
  button.dataset.depth = String(depth);
  if (node.forced) button.classList.add("is-forced");
  const w = el("span", "w", word);
  button.append(w);
  button.setAttribute("aria-label", `Word ${depth + 1}: ${word}`);
  return { lead, button, word: w };
}

/** Lays words out so that a line never breaks inside a word made of several tokens. */
function wordFlow(host: ParentNode): (lead: string, button: HTMLElement) => void {
  let group: HTMLElement | null = null;
  return (lead, button) => {
    if (lead === "" && group) return void group.append(button);
    group = el("span", "word");
    group.append(button);
    host.append(lead, group);
  };
}

/** A sentence that stopped at the length limit, or was left half-written, trails off. */
function trail(path: TreeNode[], writing: boolean): HTMLElement | "" {
  const last = path[path.length - 1];
  if (!last || writing || endsSentence(last.piece, path.length - 1)) return "";
  return el("span", "cut", "…");
}

function renderSentence(host: HTMLElement, hidden: TreeNode | null = null): HTMLElement | null {
  const known = seen.get(host) ?? new WeakSet<TreeNode>();
  seen.set(host, known);
  const path = activePath();
  const frag = document.createDocumentFragment();
  frag.append(el("span", "given", state.prompt));
  const place = wordFlow(frag);
  let fresh = 0;
  let hiddenWord: HTMLElement | null = null;
  path.forEach((node, depth) => {
    const { lead, button, word } = tokenButton(node, depth);
    if (depth === state.focus) button.classList.add("is-focus");
    if (node === hidden) {
      button.classList.add("is-hidden");
      hiddenWord = word;
    } else if (!known.has(node)) {
      button.classList.add("is-fresh");
      button.style.setProperty("--i", String(fresh++));
    }
    known.add(node);
    button.addEventListener("click", () => select(state.active as TreeNode, depth));
    place(lead, button);
  });
  frag.append(state.writing ? el("span", "caret") : trail(path, false));
  host.replaceChildren(frag);
  return hiddenWord;
}

/* ------------------------------------------------------------------- odds */

const odds = byId("odds");
const oddsRows = byId("odds-rows");
const oddsTitle = byId("odds-title");
const oddsNote = byId("odds-note");
const oddsTail = byId("odds-tail");

interface Row {
  li: HTMLLIElement;
  button: HTMLButtonElement;
  rank: HTMLElement;
  word: HTMLElement;
  bar: HTMLElement;
  pct: HTMLElement;
  piece: string;
}
const rows: Row[] = [];

function makeRow(i: number): Row {
  const li = el("li");
  const button = el("button", "cand");
  button.type = "button";
  const rank = el("span", "cand__rank");
  const word = el("span", "cand__word");
  const meter = el("span", "cand__meter");
  const bar = el("span", "cand__bar");
  const pct = el("span", "cand__pct");
  const go = el("span", "cand__go", "Take this road");
  button.dataset.cursor = "Branch";
  button.style.setProperty("--i", String(i));
  meter.append(bar, pct);
  button.append(rank, word, meter, go);
  li.append(button);
  const row: Row = { li, button, rank, word, bar, pct, piece: "" };
  button.addEventListener("click", () => {
    if (button.classList.contains("is-chosen") || state.focus < 0) return;
    const path = activePath();
    const parent = state.focus === 0 ? state.root : path[state.focus - 1];
    if (parent) branch(parent, row.piece);
  });
  return row;
}

/**
 * Show the odds for one position. `actual` is the token that was written
 * there, or null while the choice has not been made yet.
 */
function setOdds(step: Step, actual: string | null, total: number, justPicked = false, shuffle = false): void {
  odds.classList.remove("is-empty");
  const show: number[] = [];
  for (let i = 0; i < Math.min(ROWS, step.cands.length); i++) show.push(i);
  const actualIndex = actual === null ? -1 : step.cands.findIndex((c) => c.piece === actual);
  if (actualIndex >= ROWS) show.push(actualIndex);

  while (rows.length < show.length) {
    const row = makeRow(rows.length);
    rows.push(row);
    oddsRows.append(row.li);
  }
  rows.forEach((row, r) => {
    const i = show[r];
    row.li.hidden = i === undefined;
    if (i === undefined) return;
    const cand = step.cands[i] as Cand;
    const p = step.probs[i] as number;
    const { join, word } = label(cand.piece);
    row.piece = cand.piece;
    row.rank.textContent = String(i + 1);
    if (shuffle && !join && row.word.childElementCount === 0) scramble(row.word, word, 0.34 + r * 0.03);
    else row.word.replaceChildren(...(join ? [el("span", "join", "+")] : []), word);
    row.pct.textContent = percent(p);
    row.bar.style.setProperty("--p", p.toFixed(5));
    const chosen = i === actualIndex;
    row.button.classList.toggle("is-chosen", chosen);
    if (chosen) delete row.button.dataset.cursor;
    else row.button.dataset.cursor = "Branch";
    row.button.setAttribute("aria-disabled", String(chosen));
    row.button.setAttribute(
      "aria-label",
      chosen
        ? `${word}, ${percent(p)}, the word that was written`
        : `${word}, ${percent(p)}. Take this road instead`,
    );
  });
  odds.classList.toggle("is-picked", justPicked);

  oddsTitle.textContent = actual === null ? `Choosing word ${step.depth + 1}` : `Word ${step.depth + 1} of ${total}`;
  oddsNote.textContent = `Temperature ${state.t.toFixed(1)}`;
  let shownMass = 0;
  for (const i of show) shownMass += step.probs[i] as number;
  const rest = step.cands.length - show.length;
  const forcedHere = actual !== null && actualIndex !== step.chosen;
  oddsTail.textContent =
    (rest > 0 ? `The other ${rest} on the shortlist share ${percent(Math.max(0, 1 - shownMass))}. ` : "") +
    (actual === null
      ? ""
      : forcedHere
        ? "This word was chosen by hand. Pick another to branch again."
        : "Pick a runner-up to take that road instead.");
}

function renderOdds(): void {
  const path = activePath();
  const d = state.focus;
  if (d < 0 || d >= path.length) {
    odds.classList.add("is-empty");
    oddsTitle.textContent = "Next word";
    oddsNote.textContent = "";
    oddsTail.textContent = path.length ? "Pick a word in the sentence to see its moment." : "";
    return;
  }
  const before = path.slice(0, d).map((n) => n.piece);
  const cands = peek(before);
  if (!cands) {
    want(before);
    odds.classList.add("is-empty");
    oddsTitle.textContent = `Word ${d + 1} of ${path.length}`;
    oddsNote.textContent = "";
    oddsTail.textContent = live.ready
      ? "Asking the model what it weighed here."
      : "The recording does not cover this sentence. Run it live to see what the model weighed here.";
    return;
  }
  setOdds(weigh(cands, d, state.t), (path[d] as TreeNode).piece, path.length);
}

/** The chosen word leaves its row and drops into the sentence. */
async function fly(from: HTMLElement, to: HTMLElement, text: string, ms: number): Promise<void> {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (calm || a.width === 0 || b.width === 0) return;
  const fromSize = parseFloat(getComputedStyle(from).fontSize);
  const toSize = parseFloat(getComputedStyle(to).fontSize);
  const flyer = el("div", "flyer", text);
  flyer.style.fontSize = `${fromSize}px`;
  document.body.append(flyer);
  const fh = flyer.getBoundingClientRect().height;
  const scale = toSize / fromSize;
  const x0 = a.left;
  const y0 = a.top + (a.height - fh) / 2;
  const x1 = b.left;
  const y1 = b.top + (b.height - fh * scale) / 2;
  const lift = Math.min(60, Math.abs(y1 - y0) * 0.18);
  const flight = flyer.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1)`, easing: "cubic-bezier(0.5, 0, 0.75, 0.4)" },
      {
        transform: `translate(${x0 + (x1 - x0) * 0.35}px, ${y0 - lift}px) scale(${1 + (scale - 1) * 0.35})`,
        easing: "cubic-bezier(0.2, 0.6, 0.2, 1)",
        offset: 0.3,
      },
      { transform: `translate(${x1}px, ${y1}px) scale(${scale})` },
    ],
    { duration: ms, fill: "forwards" },
  );
  // A background tab pauses animations; never let the writing wait on one.
  await Promise.race([flight.finished.catch(() => undefined), sleep(ms + 120)]);
  flyer.remove();
}

/* ------------------------------------------------------------------- dial */

const dial = byId<HTMLInputElement>("dial");
const dialValue = byId("dial-value");
const dialTicks = byId("dial-ticks");
const stripBar = byId("strip-bar");
const stripNeedle = byId("strip-needle");
const stripNote = byId("strip-note");
const segs: { box: HTMLElement; text: HTMLElement }[] = [];

function buildDial(): void {
  const stops = Math.round((T_MAX - T_MIN) / T_STEP) + 1;
  for (let i = 0; i < stops; i++) dialTicks.append(el("i"));
  dial.min = String(T_MIN);
  dial.max = String(T_MAX);
  dial.step = String(T_STEP);
}

function renderDial(): void {
  dial.value = String(state.t);
  dialValue.textContent = state.t.toFixed(1);
  dialValue.style.setProperty("--heat", String(Math.round(280 + ((state.t - T_MIN) / (T_MAX - T_MIN)) * 520)));
  dial.setAttribute("aria-valuetext", `${state.t.toFixed(1)}, between dull and unhinged`);
  const on = Math.round((state.t - T_MIN) / T_STEP);
  Array.from(dialTicks.children).forEach((tick, i) => {
    tick.classList.toggle("is-on", i === on);
    tick.classList.toggle("is-near", Math.abs(i - on) === 1);
  });

  // The strip shows the first word the draw decided: straight after the
  // prompt, or straight after the last word chosen by hand.
  const anchor = state.active ? anchorOf(state.active) : state.root;
  const before = piecesTo(anchor);
  const cands = peek(before);
  const strip = byId("strip");
  if (!cands) {
    want(before);
    strip.style.visibility = "hidden";
    return;
  }
  strip.style.visibility = "";
  const step = weigh(cands, before.length, state.t);
  while (segs.length < step.cands.length) {
    const box = el("div", "seg");
    const text = el("span");
    box.append(text);
    stripBar.append(box);
    segs.push({ box, text });
  }
  segs.forEach((seg, i) => {
    const cand = step.cands[i];
    const p = step.probs[i] ?? 0;
    seg.box.style.setProperty("--p", p.toFixed(5));
    seg.box.classList.toggle("is-chosen", i === step.chosen);
    seg.box.classList.toggle("is-wide", p > 0.085);
    seg.text.textContent = cand ? label(cand.piece).word : "";
  });
  stripNeedle.style.left = `${(step.u * 100).toFixed(3)}%`;
  const chosen = step.cands[step.chosen] as Cand;
  const where = anchor === state.root ? "The first word after the prompt" : "The first word after the one chosen by hand";
  stripNote.replaceChildren(
    `${where}: `,
    el("b", "", `“${label(chosen.piece).word}”`),
    `, which holds ${percent(step.probs[step.chosen] as number)} of the strip at this setting.`,
  );
}

/* ------------------------------------------------------------------ roads */

const roadsPrompt = byId("roads-prompt");
const roadsList = byId("roads-list");
const roadsBody = byId("roads-body");
const roadsLines = byId("roads-lines") as unknown as SVGSVGElement;
const alts = byId("alts");
const roadSeen = new WeakSet<TreeNode>();
const lineBorn = new WeakMap<TreeNode, number>();
let wordEls = new Map<TreeNode, Map<TreeNode, HTMLElement>>();
let roadLeaves: TreeNode[] = [];

function renderRoads(): void {
  roadsPrompt.textContent = `${state.prompt}…`;
  roadLeaves = leaves(state.root);
  wordEls = new Map();
  const frag = document.createDocumentFragment();
  const activeLeaf = state.active;
  for (const leaf of roadLeaves) {
    const li = el("li", "road");
    const path = pathTo(leaf);
    const fork = forkOf(leaf);
    const ghosts = fork ? depthOf(fork) - 1 : 0;
    const isActive = leaf === activeLeaf;
    if (isActive) li.classList.add("is-active");
    const map = new Map<TreeNode, HTMLElement>();
    const place = wordFlow(li);
    let fresh = 0;
    path.forEach((node, depth) => {
      const { lead, button, word } = tokenButton(node, depth);
      if (node === fork) button.classList.add("is-fork");
      if (depth < ghosts) button.classList.add("is-ghost");
      else if (!roadSeen.has(node)) {
        button.classList.add("is-fresh");
        button.style.setProperty("--i", String(fresh++));
        roadSeen.add(node);
      }
      if (isActive && depth === state.focus) button.classList.add("is-focus");
      button.addEventListener("click", () => select(leaf, depth));
      map.set(node, word);
      place(depth === 0 ? "" : lead, button);
    });
    li.append(trail(path, state.writing && isActive));
    wordEls.set(leaf, map);
    frag.append(li);
  }
  roadsList.replaceChildren(frag);
  drawLines();
}

const SVG = "http://www.w3.org/2000/svg";

/** One line per branch, from under the word it left to the word it took instead. */
function drawLines(): void {
  const box = roadsBody.getBoundingClientRect();
  roadsLines.replaceChildren();
  for (const leaf of roadLeaves) {
    const fork = forkOf(leaf);
    if (!fork || !fork.parent) continue;
    const sibling = fork.parent.children[0] as TreeNode;
    const from = wordEls.get(firstLeafUnder(sibling))?.get(sibling);
    const to = wordEls.get(leaf)?.get(fork);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    // Down through the gap before the word that was left, then across to the word taken instead.
    const sx = a.left - box.left - a.height * 0.12;
    const sy = a.bottom - box.top - a.height * 0.1;
    const ex = b.left - box.left - a.height * 0.3;
    const ey = b.top - box.top + b.height * 0.52;
    const turn = Math.min(9, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2);
    const dir = ex >= sx ? 1 : -1;
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", `M ${sx} ${sy} V ${ey - turn} Q ${sx} ${ey} ${sx + dir * turn} ${ey} H ${ex}`);
    path.setAttribute("pathLength", "1");
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", String(ex));
    dot.setAttribute("cy", String(ey));
    dot.setAttribute("r", "3.5");
    // A line draws itself once. The tree is redrawn as each word arrives, so a
    // young line picks its animation up from where it had got to.
    const now = performance.now();
    const born = lineBorn.get(fork) ?? now;
    lineBorn.set(fork, born);
    const age = now - born;
    if (age < 1300) {
      path.classList.add("is-fresh");
      dot.classList.add("is-fresh");
      path.style.animationDelay = `${-age}ms`;
      dot.style.animationDelay = `${700 - age}ms`;
    }
    roadsLines.append(path, dot);
  }
}

function renderAlts(): void {
  const path = activePath();
  const d = state.focus;
  alts.replaceChildren();
  if (d < 0 || d >= path.length) {
    alts.append(el("p", "alts__lead", "Pick any word above to see what it could have been."));
    return;
  }
  const node = path[d] as TreeNode;
  const before = path.slice(0, d).map((n) => n.piece);
  const cands = peek(before);
  const lead = el("p", "alts__lead");
  if (!cands) {
    want(before);
    lead.textContent = live.ready
      ? "Asking the model what else it weighed here."
      : "The recording does not cover this sentence. Run it live to see what else could have been written here.";
    alts.append(lead);
    return;
  }
  const step = weigh(cands, d, state.t);
  const at = step.cands.findIndex((c) => c.piece === node.piece);
  lead.append(
    "Instead of ",
    el("b", "", `“${label(node.piece).word}”`),
    at >= 0 ? ` (${percent(step.probs[at] as number)})` : "",
    `, word ${d + 1} could have been:`,
  );
  const chips = el("div", "alts__chips");
  let shown = 0;
  step.cands.forEach((cand, i) => {
    if (i === at || shown >= CHIPS) return;
    const chip = el("button", "chip");
    chip.type = "button";
    chip.style.setProperty("--i", String(shown++));
    const { join, word } = label(cand.piece);
    chip.append((join ? "+" : "") + word, el("small", "", percent(step.probs[i] as number)));
    chip.addEventListener("click", () => branch(node.parent as TreeNode, cand.piece));
    chips.append(chip);
  });
  alts.append(lead, chips);
}

/* ------------------------------------------------------------- live model */

const liveBox = byId("live");
const toast = byId("toast");
let pending: { message: string; resume: () => void; undo?: () => void } | null = null;

function liveButton(): HTMLButtonElement {
  const s = live.state;
  const button = el("button", "btn btn--accent");
  button.type = "button";
  button.append(
    s.phase === "error" ? "Try again" : "Run it live",
    el("small", "", s.cached ? "already on this device" : `${s.total} MB download`),
  );
  button.addEventListener("click", () => void goLive());
  return button;
}

function meter(): HTMLElement {
  const s = live.state;
  const starting = s.phase === "starting";
  const box = el("div", `meter${starting ? " meter--starting" : ""}`);
  const bar = el("div", "meter__bar");
  const fill = el("i");
  const share = starting ? 1 : Math.min(1, s.loaded / s.total);
  fill.style.transform = `scaleX(${share.toFixed(4)})`;
  bar.append(fill);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  bar.setAttribute("aria-label", "Model download");
  const text = el("div", "meter__text");
  const how = s.device === "webgpu" ? "on your graphics chip" : "on your processor";
  text.append(
    el("span", "", starting ? `Starting the model ${how}` : `Downloading ${MODEL_NAME}`),
    el("span", "", starting ? "a few seconds" : `${Math.round(s.loaded)} of ${Math.round(s.total)} MB`),
  );
  box.append(bar, text);
  return box;
}

function stateLine(strong: string, rest: string): HTMLElement {
  const line = el("div", "live__state");
  const words = el("span");
  words.append(el("b", "", strong), ` ${rest}`);
  line.append(el("span", "live__dot"), words);
  return line;
}

let liveKey = "";
function renderLive(): void {
  const s = live.state;
  const busy = s.phase === "downloading" || s.phase === "starting";
  // While busy only the meter moves; do not rebuild it, so the bar can glide.
  const key = `${s.phase}|${s.device}|${s.cached}|${s.total}|${pending?.message ?? ""}`;
  if (busy && key === liveKey) {
    for (const host of [liveBox, toast]) {
      const fill = host.querySelector<HTMLElement>(".meter__bar i");
      const text = host.querySelector<HTMLElement>(".meter__text span:last-child");
      const share = s.phase === "starting" ? 1 : Math.min(1, s.loaded / s.total);
      if (fill) fill.style.transform = `scaleX(${share.toFixed(4)})`;
      if (text && s.phase === "downloading") text.textContent = `${Math.round(s.loaded)} of ${Math.round(s.total)} MB`;
      host.querySelector(".meter__bar")?.setAttribute("aria-valuenow", String(Math.round(share * 100)));
    }
    return;
  }
  liveKey = key;
  liveBox.className = `live live--${s.phase}`;
  if (busy) liveBox.replaceChildren(meter());
  else if (s.phase === "ready") {
    liveBox.replaceChildren(
      stateLine("Live.", `${MODEL_NAME} is running on this device, ${s.device === "webgpu" ? "on its graphics chip (WebGPU)" : "on its processor (WebAssembly)"}. Type anything.`),
    );
  } else if (s.phase === "error") {
    liveBox.replaceChildren(stateLine("It would not start here.", `${s.error}. The recording still works.`), liveButton());
  } else {
    liveBox.replaceChildren(stateLine("Recording.", `Real output from ${MODEL_NAME}, saved earlier.`), liveButton());
  }

  if (!pending) {
    toast.hidden = true;
    return;
  }
  toast.hidden = false;
  const row = el("div", "toast__row");
  if (busy) row.append(meter());
  else {
    const actions = el("div", "toast__actions");
    const close = el("button", "toast__close", "Not now");
    close.type = "button";
    close.addEventListener("click", dismiss);
    actions.append(liveButton(), close);
    row.append(el("p", "", s.phase === "error" ? `It would not start here: ${s.error}.` : pending.message), actions);
  }
  toast.replaceChildren(row);
}

function dismiss(): void {
  pending?.undo?.();
  pending = null;
  liveKey = "";
  renderAll();
}

async function goLive(): Promise<void> {
  const ok = await live.start();
  if (!ok) return;
  const job = pending;
  pending = null;
  liveKey = "";
  renderAll();
  job?.resume();
}

function needLive(message: string, resume: () => void, undo?: () => void): void {
  if (live.ready) return;
  pending = { message, resume, undo };
  liveKey = "";
  renderLive();
}

/* ---------------------------------------------------------------- writing */

type Mode = "show" | "flow" | "quick";

function renderAll(): void {
  renderSentence(byId("stage-sentence"));
  renderSentence(byId("dial-sentence"));
  renderOdds();
  renderDial();
  renderRoads();
  renderAlts();
  renderLive();
  syncUrl();
}

/** The word whose odds were the most evenly split: the closest call. */
function closestCall(): number {
  const path = activePath();
  let best = path.length ? 0 : -1;
  let bestEntropy = -1;
  path.forEach((_, d) => {
    const cands = peek(path.slice(0, d).map((n) => n.piece));
    if (!cands) return;
    let h = 0;
    for (const p of weigh(cands, d, state.t).probs) if (p > 0) h -= p * Math.log(p);
    if (h > bestEntropy) {
      bestEntropy = h;
      best = d;
    }
  });
  return best;
}

/**
 * Write on from `from` until the sentence is complete. With `old` given, this
 * is a rewrite: the old sentence stays until the new one first differs from it.
 */
async function run(from: TreeNode, mode: Mode, old: TreeNode | null, onStuck: (tip: TreeNode) => void): Promise<void> {
  const id = ++runId;
  const oldPath = old ? pathTo(old) : [];
  let tip = from;
  let same = old !== null;
  let shown = 0;
  state.writing = true;
  if (!old) {
    state.active = from;
    state.focus = Math.min(state.focus, depthOf(from) - 1);
  }
  renderAll();

  const gen = extend(provider, state.prompt, piecesTo(from), state.t);
  let finished = false;
  try {
    for (;;) {
      const r = await gen.next();
      if (id !== runId) return;
      if (r.done) {
        finished = r.value;
        break;
      }
      const step = r.value;
      const piece = (step.cands[step.chosen] as Cand).piece;
      if (same) {
        const next = oldPath[step.depth];
        if (next && next.piece === piece && next.parent === tip) {
          tip = next;
          continue;
        }
        pruneUp(old as TreeNode, tip);
        same = false;
        state.active = tip;
      }

      if (mode === "show" && !calm) {
        const pace = shown++ < 3 ? 1 : 0.5;
        state.focus = -1;
        renderSentence(byId("stage-sentence"));
        setOdds(step, null, 0, false, true);
        await sleep(640 * pace);
        if (id !== runId) return;
        setOdds(step, piece, step.depth + 1, true);
        await sleep(300 * pace);
        if (id !== runId) return;
        tip = addChild(tip, piece);
        state.active = tip;
        state.focus = step.depth;
        const target = renderSentence(byId("stage-sentence"), tip);
        const source = rows.find((row) => !row.li.hidden && row.piece === piece)?.word;
        if (target && source) await fly(source, target, split(piece).word, 460 * pace);
        if (id !== runId) return;
        const landed = renderSentence(byId("stage-sentence"), tip);
        landed?.parentElement?.classList.replace("is-hidden", "is-landed");
        renderSentence(byId("dial-sentence"));
        renderRoads();
        renderAlts();
        await sleep(220 * pace);
        if (id !== runId) return;
      } else {
        tip = addChild(tip, piece);
        state.active = tip;
        state.focus = Math.min(state.focus, step.depth);
        if (mode !== "quick" || live.ready) {
          renderAll();
          if (mode === "flow" && !calm) await sleep(70);
          else await frame();
          if (id !== runId) return;
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
  if (id !== runId) return;
  state.writing = false;
  if (same && old) state.active = old;
  const length = activePath().length;
  if (mode === "show") state.focus = closestCall();
  else if (state.focus < 0 || state.focus >= length) state.focus = Math.min(Math.max(0, depthOf(from)), length - 1);
  renderAll();
  refreshSoon();
  if (!finished) onStuck(tip);
}

function start(prompt: string, mode: Mode): void {
  state.prompt = prompt;
  state.root = createRoot();
  state.active = null;
  state.focus = -1;
  byId<HTMLInputElement>("prompt").value = prompt;
  void run(state.root, mode, null, () =>
    needLive("The recording only knows one opening. To continue yours, the model has to run on this device.", () =>
      start(prompt, "show"),
    ),
  );
}

/** Write the active sentence again at the current dial setting. */
function rewrite(): void {
  const old = state.active;
  if (!old) return;
  const anchor = anchorOf(old);
  void run(anchor, "quick", old, () =>
    needLive("The recording does not cover this road at this setting. To follow it, the model has to run on this device.", rewrite),
  );
}

function branch(parent: TreeNode, piece: string): void {
  const existing = parent.children.find((c) => c.piece === piece);
  if (!existing && leaves(state.root).length >= MAX_ROADS) {
    byId("copy-note").textContent = `${MAX_ROADS} roads is a full page. Start a new sentence to clear it.`;
    return;
  }
  dirty = true;
  runId++;
  state.writing = false;
  const before = state.active;
  const beforeFocus = state.focus;
  const node = addChild(parent, piece, true);
  state.focus = depthOf(node) - 1;
  if (node.children.length > 0) {
    state.active = firstLeafUnder(node);
    renderAll();
    return;
  }
  const go = () =>
    void run(node, "flow", null, (tip) => {
      if (tip !== node) return needLive(stuckMessage, go);
      needLive(stuckMessage, go, () => {
        // Nothing could be written after it: take the stub back out.
        pruneUp(node, parent);
        if (existing) return;
        state.active = before && before.parent ? before : firstLeafUnder(state.root);
        state.focus = beforeFocus;
      });
    });
  go();
}
const stuckMessage =
  "The recording does not go down that road. To follow it, the model has to run on this device.";

function select(leaf: TreeNode, depth: number): void {
  if (state.writing && leaf !== state.active) {
    runId++;
    state.writing = false;
  }
  state.active = leaf;
  state.focus = depth;
  renderAll();
}

/* -------------------------------------------------------------------- URL */

function syncUrl(): void {
  if (!dirty || state.writing || !state.active || state.root.children.length === 0) return;
  const all = leaves(state.root);
  const hash = encodeShared({
    prompt: state.prompt,
    temperature: state.t,
    root: state.root,
    active: Math.max(0, all.indexOf(state.active)),
  });
  if (hash === lastHash) return;
  lastHash = hash;
  history.replaceState(null, "", `#${hash}`);
}

function restore(): boolean {
  const shared = decodeShared(location.hash);
  if (!shared) return false;
  runId++;
  dirty = true;
  lastHash = location.hash.slice(1);
  state.prompt = shared.prompt;
  state.t = shared.temperature;
  state.root = shared.root;
  state.active = leaves(shared.root)[shared.active] ?? firstLeafUnder(shared.root);
  state.writing = false;
  byId<HTMLInputElement>("prompt").value = shared.prompt;
  state.focus = closestCall();
  renderAll();
  return true;
}

/* ------------------------------------------------------------------- boot */

function boot(): void {
  initMotion();
  buildDial();
  const link = byId<HTMLAnchorElement>("model-link");
  link.href = MODEL_URL;
  const input = byId<HTMLInputElement>("prompt");
  input.maxLength = PROMPT_MAX;
  input.value = state.prompt;

  byId<HTMLFormElement>("ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const prompt = input.value.replace(/\s+/g, " ").trim();
    if (!prompt) return input.focus();
    dirty = prompt !== DEFAULT_PROMPT || state.t !== T_DEFAULT;
    if (!dirty) history.replaceState(null, "", location.pathname + location.search);
    lastHash = "";
    start(prompt, "show");
  });

  let timer = 0;
  dial.addEventListener("input", () => {
    state.t = clampTemperature(Number(dial.value));
    dirty = true;
    renderDial();
    if (!state.writing) renderOdds();
    clearTimeout(timer);
    timer = window.setTimeout(rewrite, live.ready ? 180 : 0);
  });

  byId("copy").addEventListener("click", async () => {
    dirty = true;
    syncUrl();
    const note = byId("copy-note");
    try {
      await navigator.clipboard.writeText(location.href);
      note.textContent = "Copied. Whoever opens it sees this same tree.";
    } catch {
      note.textContent = "The link is in the address bar now. Copy it from there.";
    }
  });

  live.subscribe(renderLive);
  new ResizeObserver(() => drawLines()).observe(roadsBody);
  addEventListener("hashchange", () => {
    if (location.hash.slice(1) !== lastHash) restore();
  });
  renderAll();

  void fetch(`${import.meta.env.BASE_URL}recording.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Recording>) : null))
    .catch(() => null)
    .then(async (rec) => {
      recording = rec;
      const first = rec ? lookup(rec, rec.prompt, []) : null;
      if (first) {
        const step = weigh(first, 0, T_DEFAULT);
        setBand(first.slice(0, 14).map((c, i) => ({ word: label(c.piece).word, share: percent(step.probs[i] as number) })));
      }
      if (restore()) return;
      await opened;
      await Promise.race([document.fonts.ready, sleep(1200)]);
      // Begin the first run when the stage scrolls into view, so nobody misses it.
      const begin = () => {
        if (state.root.children.length === 0 && !state.writing) start(rec?.prompt ?? DEFAULT_PROMPT, "show");
      };
      if (calm || !("IntersectionObserver" in window)) return begin();
      const watcher = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          watcher.disconnect();
          setTimeout(begin, 350);
        },
        { threshold: 0.6 },
      );
      watcher.observe(byId("stage-sentence"));
    });
}

boot();
