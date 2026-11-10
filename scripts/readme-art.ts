/**
 * Draws the graphics at the top of the README, in a light and a dark variant,
 * from the recorded model output. Every word and number in them is real.
 *
 *   npm run readme
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extend, weigh, type Provider } from "../src/core/generate";
import { lookup, type Recording } from "../src/core/recording";
import type { Cand } from "../src/core/sampling";
import { T_DEFAULT } from "../src/core/share";

const rec = JSON.parse(readFileSync("public/recording.json", "utf8")) as Recording;
const font = readFileSync("public/fonts/Geist-Variable.woff2").toString("base64");
const provider: Provider = async (prompt, pieces) => lookup(rec, prompt, pieces);

interface Theme {
  name: "light" | "dark";
  bg: string;
  fg: string;
  mute: string;
  faint: string;
  rule: string;
  accent: string;
  onAccent: string;
}
const THEMES: Theme[] = [
  { name: "light", bg: "#f2eee5", fg: "#15140f", mute: "#6f6c63", faint: "#b3aea3", rule: "#d5d0c4", accent: "#d4491a", onAccent: "#ffffff" },
  { name: "dark", bg: "#15140f", fg: "#f2eee5", mute: "#a29e94", faint: "#5d5a52", rule: "#34322b", accent: "#ff6b3d", onAccent: "#15140f" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (p: number) => (p >= 0.995 ? ">99%" : p >= 0.0995 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`);
const head = (w: number, h: number, t: Theme) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" fill="${t.fg}">
<style>
@font-face{font-family:G;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
text{font-family:G,"Helvetica Neue",Helvetica,Arial,sans-serif}
.cap{font-size:12px;letter-spacing:2.2px;fill:${t.mute}}
</style>
<rect width="${w}" height="${h}" fill="${t.bg}"/>`;

async function sentenceAt(t: number): Promise<string> {
  const pieces: string[] = [];
  for await (const step of extend(provider, rec.prompt, [], t)) pieces.push((step.cands[step.chosen] as Cand).piece);
  return pieces.join("").trim();
}

/* ------------------------------------------------------------------ hero */

function hero(t: Theme): string {
  const W = 1280;
  const H = 600;
  const first = lookup(rec, rec.prompt, []) as Cand[];
  const step = weigh(first, 0, T_DEFAULT);
  const out: string[] = [head(W, H, t)];

  // The field: a comb of odds along the bottom edge.
  const n = Math.floor(W / 12);
  const logits = Array.from({ length: n }, (_, i) => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    const d = (i - n * 0.455) / 3.2;
    return ((s - Math.floor(s)) * 2 - 1) * 1.5 + Math.sin(i * 0.37) * 0.9 + 5 * Math.exp(-d * d);
  });
  const max = Math.max(...logits);
  const e = logits.map((l) => Math.exp((l - max) / 0.9));
  const sum = e.reduce((a, b) => a + b, 0);
  const peak = e.indexOf(Math.max(...e));
  e.forEach((v, i) => {
    const bar = Math.max(3, Math.min(1, (v / sum) * n * 0.085) * 150);
    out.push(
      i === peak
        ? `<rect x="${i * 12 + 4.5}" y="${H - bar}" width="2.5" height="${bar}" fill="${t.accent}"/>`
        : `<rect x="${i * 12 + 5}" y="${H - bar}" width="1.5" height="${bar}" fill="${t.fg}" opacity="0.16"/>`,
    );
  });

  out.push(
    `<text x="64" y="62" font-size="24" font-weight="650" letter-spacing="-0.9">Likely</text>`,
    `<circle cx="134.5" cy="58.5" r="3.6" fill="${t.accent}"/>`,
    `<text x="1216" y="60" text-anchor="end" class="cap">AN ESSAY YOU CAN OPERATE</text>`,
    `<text font-size="106" font-weight="560" letter-spacing="-5.8"><tspan x="60" y="196">A language model writes</tspan><tspan x="60" y="296">one word at a time.</tspan></text>`,
    `<rect x="64" y="344" width="1152" height="1" fill="${t.fg}"/>`,
  );

  // Left: the sentence being written. Right: the odds for its next word.
  out.push(
    `<text x="64" y="386" class="cap">THE SENTENCE</text>`,
    `<text font-size="34" font-weight="540" letter-spacing="-1.3"><tspan x="64" y="436" fill="${t.faint}">The best thing about</tspan><tspan x="64" y="478" fill="${t.faint}">living by the sea is </tspan><tspan fill="${t.accent}">${esc((first[step.chosen] as Cand).piece.trim())}</tspan></text>`,
    `<text x="640" y="386" class="cap">ITS NEXT WORD, AS THE MODEL WEIGHED IT</text>`,
  );
  for (let i = 0; i < 5; i++) {
    const y = 410 + i * 34;
    const p = step.probs[i] as number;
    const chosen = i === step.chosen;
    const colour = chosen ? t.accent : t.fg;
    const width = Math.max(2, p * 330);
    out.push(
      `<text x="640" y="${y + 20}" font-size="11" fill="${t.faint}">${i + 1}</text>`,
      `<text x="668" y="${y + 22}" font-size="24" font-weight="540" letter-spacing="-0.9" fill="${colour}">${esc((first[i] as Cand).piece.trim())}</text>`,
      `<rect x="800" y="${y + 6}" width="${width.toFixed(1)}" height="18" fill="${colour}"/>`,
      `<text x="${(812 + width).toFixed(1)}" y="${y + 21}" font-size="15" fill="${chosen ? t.accent : t.mute}">${pct(p)}</text>`,
      `<rect x="640" y="${y + 32}" width="576" height="1" fill="${t.rule}"/>`,
    );
  }
  out.push("</svg>");
  return out.join("\n");
}

/* ------------------------------------------------------------------ dial */

async function dial(t: Theme): Promise<string> {
  const W = 1280;
  const H = 610;
  const first = lookup(rec, rec.prompt, []) as Cand[];
  const settings = [0.2, 0.8, 1.5];
  const X = 300;
  const WIDTH = 916;
  const out: string[] = [head(W, H, t)];
  const u = weigh(first, 0, 1).u;
  const needle = X + u * WIDTH;

  out.push(
    `<text x="64" y="56" class="cap">THE SAME SCORES AT THREE SETTINGS OF THE DIAL</text>`,
    `<text x="${needle}" y="56" text-anchor="middle" class="cap" fill="${t.accent}" style="fill:${t.accent}">THE DRAW, HELD STILL</text>`,
  );
  for (let r = 0; r < settings.length; r++) {
    const temp = settings[r] as number;
    const step = weigh(first, 0, temp);
    const y = 86 + r * 172;
    out.push(
      `<text x="60" y="${y + 80}" font-size="96" font-weight="${[300, 520, 760][r]}" letter-spacing="-6">${temp.toFixed(1)}</text>`,
      `<text x="64" y="${y + 108}" class="cap">${["DULL", "THE DEFAULT", "UNHINGED"][r]}</text>`,
    );
    let x = X;
    step.probs.forEach((p, i) => {
      const w = p * WIDTH;
      const chosen = i === step.chosen;
      if (w > 0.15) {
        out.push(`<rect x="${x.toFixed(2)}" y="${y}" width="${Math.max(0.2, w - 1).toFixed(2)}" height="84" fill="${chosen ? t.accent : t.fg}"/>`);
        if (w > 70) {
          out.push(
            `<text x="${(x + 12).toFixed(1)}" y="${y + 70}" font-size="22" font-weight="540" letter-spacing="-0.7" fill="${chosen ? t.onAccent : t.bg}">${esc((first[i] as Cand).piece.trim())}</text>`,
            `<text x="${(x + 12).toFixed(1)}" y="${y + 24}" font-size="13" fill="${chosen ? t.onAccent : t.bg}" opacity="0.8">${pct(p)}</text>`,
          );
        }
      }
      x += w;
    });
    const sentence = await sentenceAt(temp);
    out.push(
      `<text x="${X}" y="${y + 116}" font-size="19" font-weight="500" letter-spacing="-0.4"><tspan fill="${t.faint}">${esc(rec.prompt)} </tspan><tspan>${esc(sentence)}</tspan></text>`,
    );
  }
  for (let r = 0; r < settings.length; r++) {
    const y = 86 + r * 172;
    out.push(
      `<rect x="${needle - 3}" y="${y - 12}" width="6" height="108" fill="${t.bg}"/>`,
      `<rect x="${needle - 1}" y="${y - 14}" width="2" height="112" fill="${t.accent}"/>`,
    );
  }
  out.push("</svg>");
  return out.join("\n");
}

mkdirSync("assets", { recursive: true });
for (const t of THEMES) {
  writeFileSync(`assets/hero-${t.name}.svg`, hero(t));
  writeFileSync(`assets/dial-${t.name}.svg`, await dial(t));
}
for (const temp of [0.2, 0.8, 1.5]) console.log(temp.toFixed(1), JSON.stringify(await sentenceAt(temp)));
console.log("wrote assets/hero-*.svg and assets/dial-*.svg");
