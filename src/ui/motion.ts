/**
 * Everything that moves but is not the model: the opening, smooth scrolling,
 * reveals on scroll, the headline that reacts to the pointer, the field of
 * bars behind the page, the cursor, and the turn from paper to ink.
 *
 * None of it runs under prefers-reduced-motion; the page is then simply still.
 */
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);
gsap.defaults({ ease: "expo.out", duration: 1.1 });

export const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
const root = document.documentElement;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

let lenis: Lenis | null = null;
let openingDone: () => void = () => undefined;
/** Resolves when the opening sequence has lifted and the page is in view. */
export const opened = new Promise<void>((resolve) => (openingDone = resolve));

/* ---------------------------------------------------------------- opening */

function opening(): void {
  const pre = document.getElementById("pre") as HTMLElement;
  const reveal = () => {
    root.classList.remove("is-opening");
    heroIntro();
    openingDone();
  };
  let seen = false;
  try {
    seen = sessionStorage.getItem("likely-seen") === "1";
    sessionStorage.setItem("likely-seen", "1");
  } catch {
    /* private mode */
  }
  if (calm || seen || location.hash.length > 1) {
    pre.remove();
    reveal();
    return;
  }
  root.classList.add("is-locked");
  const count = document.getElementById("pre-count") as HTMLElement;
  const rows = pre.querySelectorAll(".pre__row > span");
  const state = { v: 0 };
  gsap
    .timeline({
      onComplete: () => {
        pre.remove();
        root.classList.remove("is-locked");
      },
    })
    .from(rows, { yPercent: 110, duration: 0.7, stagger: 0.06 })
    .to(
      state,
      {
        v: 100,
        duration: 1.05,
        ease: "power2.inOut",
        onUpdate: () => (count.textContent = String(Math.round(state.v)).padStart(3, "0")),
      },
      0.1,
    )
    .to(pre.querySelector(".pre__bar i"), { scaleX: 1, duration: 1.05, ease: "power2.inOut" }, 0.1)
    .to(rows, { yPercent: -110, duration: 0.6, stagger: 0.05, ease: "expo.in" }, "+=0.1")
    .add(() => {
      // The page underneath is revealed while the sheet lifts.
      pre.style.display = "grid";
      reveal();
    }, "-=0.15")
    .to(pre, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.9, ease: "expo.inOut" }, "-=0.2");
}

/* ------------------------------------------------------------------- hero */

const HERO_WORDS = ["bet.", "draw.", "guess.", "wager."];

function heroIntro(): void {
  const title = document.getElementById("hero-title");
  const word = document.getElementById("hero-word");
  if (!title || !word || calm) return;
  word.classList.add("kch");
  const split = SplitText.create(title.querySelectorAll(".hl"), {
    type: "words,chars",
    charsClass: "kch",
    wordsClass: "kw",
    ignore: "#hero-word",
  });
  const chars = [...(split.chars as HTMLElement[]), word];
  gsap.fromTo(
    chars,
    { yPercent: 118, "--w": 100 },
    {
      yPercent: 0,
      "--w": 560,
      duration: 1.5,
      stagger: 0.016,
      ease: "expo.out",
      onComplete: () => heroPointer(title, chars),
    },
  );
  gsap.from(".hero__foot", { autoAlpha: 0, y: 30, duration: 1.2, delay: 0.55 });

  // The last word keeps being re-drawn, as every word of a model's sentence is.
  let i = 0;
  const cycle = () => {
    i = (i + 1) % HERO_WORDS.length;
    gsap.to(word, {
      duration: 0.9,
      ease: "none",
      scrambleText: { text: HERO_WORDS[i] as string, chars: LETTERS, speed: 0.6 },
      onComplete: () => void gsap.delayedCall(2.6, cycle),
    });
  };
  gsap.delayedCall(3.4, cycle);
}

/** Letters grow heavier as the pointer comes near them. */
function heroPointer(title: HTMLElement, chars: HTMLElement[]): void {
  if (!fine) return;
  const base = 560;
  const weight = chars.map(() => base);
  let centres: { x: number; y: number }[] = [];
  let pointer: { x: number; y: number } | null = null;
  let visible = true;
  const measure = () => {
    centres = chars.map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY };
    });
  };
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("pointermove", (e) => (pointer = { x: e.pageX, y: e.pageY }), { passive: true });
  root.addEventListener("pointerleave", () => (pointer = null));
  new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting))).observe(title);
  const reach = Math.max(180, innerWidth * 0.17);
  gsap.ticker.add(() => {
    if (!visible) return;
    for (let i = 0; i < chars.length; i++) {
      const c = centres[i] as { x: number; y: number };
      let target = base;
      if (pointer) {
        const d = Math.hypot(pointer.x - c.x, pointer.y - c.y);
        const near = Math.max(0, 1 - d / reach);
        target = base + 340 * near * near - 150 * Math.max(0, 1 - Math.abs(d - reach * 1.5) / reach);
      }
      const w = (weight[i] as number) + (target - (weight[i] as number)) * 0.12;
      if (Math.abs(w - (weight[i] as number)) > 0.4) {
        weight[i] = w;
        (chars[i] as HTMLElement).style.setProperty("--w", w.toFixed(0));
      }
    }
  });
}

/* ---------------------------------------------------------------- reveals */

function reveals(): void {
  document.querySelectorAll<HTMLElement>("[data-lines]").forEach((el) => {
    const delay = parseFloat(el.dataset.delay || "0");
    SplitText.create(el, {
      type: "lines",
      mask: "lines",
      autoSplit: true,
      linesClass: "line",
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 115,
          duration: 1.2,
          stagger: 0.085,
          delay,
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
        });
      },
    });
  });

  document.querySelectorAll<HTMLElement>("[data-rise]").forEach((el) => {
    gsap.from(el, {
      y: 36,
      opacity: 0,
      delay: parseFloat(el.dataset.delay || "0"),
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
  });

  document.querySelectorAll<HTMLElement>("[data-rule]").forEach((el) => {
    gsap.from(el, {
      scaleX: 0,
      transformOrigin: "left center",
      duration: 1.6,
      ease: "expo.inOut",
      scrollTrigger: { trigger: el, start: "top 94%", once: true },
    });
  });

  document.querySelectorAll<HTMLElement>("[data-drift]").forEach((el) => {
    const amount = parseFloat(el.dataset.drift || "10");
    gsap.fromTo(
      el,
      { yPercent: amount },
      { yPercent: -amount, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } },
    );
  });

  document.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el) => {
    const text = el.textContent || "";
    gsap.to(el, {
      duration: 1.1,
      ease: "none",
      scrambleText: { text, chars: "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/", speed: 0.7, revealDelay: 0.15 },
      scrollTrigger: { trigger: el, start: "top 94%", once: true },
    });
  });

  // The closing line gains its weight as it is scrolled into place.
  document.querySelectorAll<HTMLElement>("[data-kinetic]").forEach((el) => {
    SplitText.create(el, {
      type: "words,chars",
      charsClass: "kch",
      onSplit(self) {
        const chars = self.chars as HTMLElement[];
        gsap.set(chars, { "--w": 100, opacity: 0.1, yPercent: 24 });
        return gsap.to(chars, {
          "--w": 560,
          opacity: 1,
          yPercent: 0,
          ease: "power2.out",
          stagger: { each: 0.035, from: "start" },
          scrollTrigger: { trigger: el, start: "top 88%", end: "top 30%", scrub: 0.9 },
        });
      },
    });
  });

  // Blocks that hold the instruments rise as one.
  document.querySelectorAll<HTMLElement>(".ask, .odds, .dial, .strip, .roads, .share").forEach((el) => {
    gsap.from(el, { y: 44, opacity: 0, duration: 1.2, scrollTrigger: { trigger: el, start: "top 92%", once: true } });
  });
}

/* ------------------------------------------------------- scroll and theme */

function scrolling(): void {
  lenis = new Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 0.95 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    const id = link?.getAttribute("href");
    if (!id || id.length < 2) return;
    const target = document.querySelector<HTMLElement>(id);
    if (!target) return;
    e.preventDefault();
    lenis?.scrollTo(id === "#top" ? 0 : target, { duration: 1.6 });
  });
}

function chrome(): void {
  const mast = document.getElementById("mast") as HTMLElement;
  gsap.to("#mast-progress", {
    scaleX: 1,
    ease: "none",
    scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.3 },
  });
  ScrollTrigger.create({
    start: 200,
    end: "max",
    onUpdate: (self) => mast.classList.toggle("is-hidden", self.direction === 1 && self.scroll() > 400),
  });
  const atTop = () => mast.classList.toggle("is-top", scrollY < 60);
  window.addEventListener("scroll", atTop, { passive: true });
  atTop();
  document.querySelectorAll<HTMLAnchorElement>(".mast__nav a").forEach((link) => {
    const part = document.querySelector<HTMLElement>(link.getAttribute("href") as string);
    if (!part) return;
    ScrollTrigger.create({
      trigger: part,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => link.classList.toggle("is-here", self.isActive),
    });
  });

  // Sections marked as ink turn the whole page while they hold the middle of the screen.
  let inked = 0;
  document.querySelectorAll<HTMLElement>('[data-theme="ink"]').forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: "top 58%",
      end: "bottom 42%",
      onToggle: (self) => {
        inked += self.isActive ? 1 : -1;
        root.classList.toggle("theme-ink", inked > 0);
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", inked > 0 ? "#15140f" : "#f2eee5");
      },
    });
  });

  let timer = 0;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => ScrollTrigger.refresh(), 250);
  }).observe(document.body);
}

/* ----------------------------------------------------- cursor and magnets */

function cursor(): void {
  const dot = document.getElementById("cursor") as HTMLElement;
  if (!fine) return;
  const label = dot.querySelector("span") as HTMLElement;
  const xTo = gsap.quickTo(dot, "x", { duration: 0.45, ease: "power3.out" });
  const yTo = gsap.quickTo(dot, "y", { duration: 0.45, ease: "power3.out" });
  let shown = false;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!shown) {
        shown = true;
        gsap.set(dot, { x: e.clientX, y: e.clientY });
        gsap.to(dot, { autoAlpha: 1, duration: 0.3 });
      }
      xTo(e.clientX);
      yTo(e.clientY);
    },
    { passive: true },
  );
  window.addEventListener(
    "pointerover",
    (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cursor], a, button, input");
      const text = t?.dataset.cursor;
      dot.classList.toggle("is-label", !!text);
      dot.classList.toggle("is-link", !!t && !text);
      if (text) label.textContent = text;
    },
    { passive: true },
  );
  root.addEventListener("pointerleave", () => {
    shown = false;
    gsap.to(dot, { autoAlpha: 0, duration: 0.2 });
  });

  document.querySelectorAll<HTMLElement>(".magnetic").forEach((el) => {
    const mx = gsap.quickTo(el, "x", { duration: 0.9, ease: "elastic.out(1, 0.4)" });
    const my = gsap.quickTo(el, "y", { duration: 0.9, ease: "elastic.out(1, 0.4)" });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - (r.left + r.width / 2)) * 0.35);
      my((e.clientY - (r.top + r.height / 2)) * 0.35);
    });
    el.addEventListener("pointerleave", () => {
      mx(0);
      my(0);
    });
  });
}

/* ------------------------------------------------------------------- band */

export interface BandItem {
  word: string;
  share: string;
}

/** The passing line of candidates under the headline. Faster when the page is scrolled. */
export function setBand(items: BandItem[]): void {
  const track = document.getElementById("band-track");
  if (!track || items.length === 0) return;
  const build = () =>
    items.map((item, i) => {
      const el = document.createElement("span");
      el.className = `band__item${i === 0 ? " is-top" : ""}`;
      const sup = document.createElement("sup");
      sup.textContent = item.share;
      el.append(item.word, sup);
      return el;
    });
  track.replaceChildren(...build(), ...build(), ...build());
  if (calm) return;
  let x = 0;
  let dir = -1;
  gsap.ticker.add((_t, dt) => {
    const width = track.scrollWidth / 3;
    if (!width) return;
    const v = lenis?.velocity ?? 0;
    if (Math.abs(v) > 0.5) dir = v > 0 ? -1 : 1;
    x += dir * (0.045 + Math.min(1.6, Math.abs(v) * 0.03)) * dt;
    if (x <= -width) x += width;
    if (x > 0) x -= width;
    track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
  });
}

/* ------------------------------------------------------------------ field */

/**
 * A row of thin bars along the bottom of the screen: a probability
 * distribution that is always being reshaped. The pointer moves its peak
 * left and right, and acts as the temperature: near the top of the screen
 * the favourite takes everything, near the bottom the odds go flat.
 */
function field(): void {
  const canvas = document.getElementById("field") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const GAP = 12;
  let w = 0;
  let h = 0;
  let n = 0;
  let heights = new Float32Array(0);
  let hash = new Float32Array(0);
  let px = 0.62;
  let py = 0.4;
  let hasPointer = false;
  let strength = 1;
  let wanted = 1;

  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    n = Math.ceil(w / GAP);
    heights = new Float32Array(n);
    hash = Float32Array.from({ length: n }, (_, i) => {
      const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return (s - Math.floor(s)) * 2 - 1;
    });
  };
  size();
  window.addEventListener("resize", size);
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      hasPointer = true;
      px = e.clientX / w;
      py = e.clientY / h;
    },
    { passive: true },
  );

  // Full strength over the opening and the close, a murmur behind the instruments.
  let lit = 0;
  document.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: "top 80%",
      end: "bottom 30%",
      onToggle: (self) => {
        lit += self.isActive ? 1 : -1;
        wanted = lit > 0 ? 1 : 0.14;
      },
    });
  });
  wanted = 1;

  const logits = new Float32Array(2048);
  const draw = (time: number) => {
    const t = time;
    const cx = hasPointer ? px : 0.6 + 0.22 * Math.sin(t * 0.13);
    const cy = hasPointer ? py : 0.42 + 0.3 * Math.sin(t * 0.21);
    const temperature = 0.28 + 2.1 * Math.min(1, Math.max(0, cy));
    const spread = Math.max(3, n * 0.03);
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = (i - cx * n) / spread;
      const l =
        (hash[i] as number) * 1.5 + Math.sin(i * 0.37 - t * 0.31) * 0.9 + Math.sin(i * 1.7 + t * 0.47) * 0.6 + 5 * Math.exp(-d * d);
      logits[i] = l / temperature;
      if ((logits[i] as number) > max) max = logits[i] as number;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      logits[i] = Math.exp((logits[i] as number) - max);
      sum += logits[i] as number;
    }
    strength += (wanted - strength) * 0.05;
    const ink = root.classList.contains("theme-ink");
    const rgb = ink ? "242,238,229" : "21,20,15";
    const accent = ink ? "#ff6b3d" : "#d4491a";
    const top = h * 0.24;
    ctx.clearRect(0, 0, w, h);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const target = Math.min(1, ((logits[i] as number) / sum) * n * 0.085);
      heights[i] = (heights[i] as number) + (target - (heights[i] as number)) * (calm ? 1 : 0.09);
      if ((heights[i] as number) > (heights[peak] as number)) peak = i;
    }
    ctx.fillStyle = `rgba(${rgb},${((ink ? 0.2 : 0.15) * strength).toFixed(3)})`;
    for (let i = 0; i < n; i++) {
      if (i === peak) continue;
      const bar = Math.max(3, (heights[i] as number) * top);
      ctx.fillRect(i * GAP + 5, h - bar, 1.5, bar);
    }
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = accent;
    const bar = Math.max(3, (heights[peak] as number) * top);
    ctx.fillRect(peak * GAP + 4.5, h - bar, 2.5, bar);
    ctx.globalAlpha = 1;
  };

  if (calm) {
    draw(0);
    return;
  }
  gsap.ticker.add((time) => {
    if (!document.hidden) draw(time);
  });
}

/* ---------------------------------------------------------------- helpers */

/** Replace an element's text by shuffling letters into place. */
export function scramble(el: HTMLElement, text: string, seconds = 0.4): void {
  if (calm || el.textContent === text) {
    el.textContent = text;
    return;
  }
  gsap.killTweensOf(el);
  gsap.to(el, { duration: seconds, ease: "none", scrambleText: { text, chars: LETTERS, speed: 1 } });
}

/** Tell the scroll-driven effects that the page has changed height. */
export function refreshSoon(): void {
  if (!calm) ScrollTrigger.refresh();
}

export function initMotion(): void {
  field();
  if (calm) {
    root.classList.remove("is-opening");
    document.getElementById("pre")?.remove();
    openingDone();
    return;
  }
  scrolling();
  reveals();
  chrome();
  cursor();
  opening();
}
