<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
  <img src="assets/hero-light.svg" width="100%" alt="Likely, an essay you can operate. A language model writes one word at a time. The sentence 'The best thing about living by the sea is' with its next word, as the model weighed it: that 74 percent, the 17 percent, it 1.3 percent, you 1.0 percent, its 1.0 percent.">
</picture>

<p align="center">
  <a href="https://pratyushshivam.github.io/likely/"><b>Open it</b></a> ·
  <a href="#how-a-word-is-chosen">How a word is chosen</a> ·
  <a href="#the-model">The model</a> ·
  <a href="#measured">Measured</a> ·
  <a href="#run-it">Run it</a> ·
  <a href="https://www.pratyushshivam.com/">pratyushshivam.com</a>
</p>

# Likely

**Watch a language model choose its next word.** One page, three things to do, and a real model running in your browser.

A language model writes one word at a time, and every word is a draw from a list of odds. This page shows you the list, lets you bend the odds, and lets you follow the sentences that were never written. Nothing is mocked: the odds on screen are the model's own.

**Open:** [pratyushshivam.github.io/likely](https://pratyushshivam.github.io/likely/)

<a href="https://pratyushshivam.github.io/likely/"><img src="assets/screens/hero.jpg" width="100%" alt="The opening of Likely: the headline 'A language model writes one word at a time. Each one is a bet.' in very large type on paper, with a thin row of bars along the bottom edge"></a>

## Three things to do

### 1. Watch it choose

Type the start of a sentence. Before every word the page shows the front-runners and the odds the model gives them. One is drawn, the row lights up, and the word drops into the line.

<img src="assets/choose.gif" width="100%" alt="Animation: candidate next words appear as ranked bars with percentages, the chosen row is swept with orange, and the word flies up into the sentence, one word after another">

### 2. Turn the dial

One control: temperature. Turn it down and the favourite swells until nothing else can win. Turn it up and the list flattens until long shots get through. The sentence is rewritten as you drag.

<img src="assets/dial.gif" width="100%" alt="Animation: a temperature dial is dragged from 0.8 up to 2.0 and down to 0.1. A strip of the candidates' odds reshapes as it moves and the sentence beneath it is rewritten, from strange at the high end to plain at the low end">

### 3. Take the other road

Click any word, then pick what it could have been instead. The model carries on from there. The branches grow into a small tree, and the whole tree is stored in the link, so whoever opens it sees exactly what you saw.

<img src="assets/roads.gif" width="100%" alt="Animation: a word in the sentence is clicked, a runner-up is chosen, and a new branch draws itself from that word and writes a different ending. It is repeated until four sentences hang from the first">

<table>
<tr>
<td width="50%" valign="top"><img src="assets/screens/choose.jpg" width="100%" alt="The fifth word being chosen: 'have' at 67 percent is swept with orange, ahead of need, know, die and get"><br><sub><b>The pick.</b> The chosen row, a moment before the word lands.</sub></td>
<td width="50%" valign="top"><img src="assets/screens/dial.jpg" width="100%" alt="The dial at 1.5 on an ink background: the strip of odds is nearly flat and the sentence has become 'it reminds us something we have in front and behind us'"><br><sub><b>The dial at 1.5.</b> The odds flatten and the writing wanders.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="assets/screens/roads.jpg" width="100%" alt="A tree of five sentences that share a beginning, with orange lines from each word that was left to the word taken instead"><br><sub><b>The roads.</b> Five sentences from one beginning.</sub></td>
<td width="50%" valign="top"><img src="assets/screens/finale.jpg" width="100%" alt="The closing line in very large type on ink: Likely is not the same as right."><br><sub><b>The point.</b> Each word was likely. That is all it was.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="25%" valign="top"><img src="assets/screens/phone-hero.jpg" width="100%" alt="The opening on a phone"></td>
<td width="25%" valign="top"><img src="assets/screens/phone-choose.jpg" width="100%" alt="A word being chosen, on a phone"></td>
<td width="25%" valign="top"><img src="assets/screens/phone-dial.jpg" width="100%" alt="The temperature dial on a phone"></td>
<td width="25%" valign="top"><img src="assets/screens/phone-roads.jpg" width="100%" alt="The tree of sentences on a phone"></td>
</tr>
</table>

<p align="center"><sub>The same page on a phone. It also works with a keyboard alone, and it holds still if you ask for reduced motion.</sub></p>

| | |
| :-- | :-- |
| **What runs** | SmolLM2-135M, a 135 million parameter language model, in your browser. No server, no API key, no analytics |
| **First visit** | Opens at once on a recording of the model's real output: 0.26 MB |
| **Live** | One press downloads the model (120 MB on WebGPU, 140 MB on WebAssembly). Your browser keeps it; later visits start in about two seconds |
| **Privacy** | Nothing you type leaves your device |
| **Stack** | TypeScript and Vite, no framework. Transformers.js on ONNX Runtime Web in a worker. GSAP and Lenis for motion |

## How a word is chosen

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dial-dark.svg">
  <img src="assets/dial-light.svg" width="100%" alt="Diagram: the same scores at three settings of the dial, with the draw held still. At 0.2 'that' holds more than 99 percent of the strip and the sentence reads 'that it's not always easy to live there.' At 0.8 'that' holds 74 percent and 'the' 17 percent, and the sentence reads 'that you don't have to worry about staying alive while you sleep.' At 1.5 'that' holds 33 percent, 'the' 15 percent, the draw lands on 'it', and the sentence reads 'it reminds us something we have in front and behind us, so we're'.">
</picture>

1. **Score.** The model reads everything written so far and returns one number, a logit, for each of the 49,152 tokens in its vocabulary. A token is usually a word, sometimes a fragment or a full stop.
2. **Shortlist.** The page keeps the 40 highest (top-k sampling).
3. **Weigh.** The scores become probabilities: `p = softmax(score / temperature)`. A low temperature exaggerates the gaps between scores. A high one shrinks them.
4. **Draw.** The probabilities are laid end to end from 0 to 1, and a number between 0 and 1 picks the word whose stretch it lands in.
5. **Repeat** with the longer text, until a full stop, a line break, or 16 tokens.

The draws are fixed by a seed, on purpose. With the draws held still, anything that changes when you move the dial is the dial's doing. The diagram above is drawn from the recording by `npm run readme`; the three sentences in it are what the model wrote.

| Part | What it does | Where |
| :-- | :-- | :-- |
| **Sampling** | Temperature, probabilities, the draw, top-k | [`sampling.ts`](src/core/sampling.ts) |
| **Writing** | Continues a sentence from any source of candidates, live or recorded | [`generate.ts`](src/core/generate.ts) |
| **The tree** | Sentences that share a beginning share nodes. Rewriting one leaves the others alone | [`tree.ts`](src/core/tree.ts) |
| **Links** | The prompt, the dial and the whole tree, in the URL fragment | [`share.ts`](src/core/share.ts) |
| **The recording** | The saved model output and how it is looked up | [`recording.ts`](src/core/recording.ts) |
| **The model** | One question to the model: what could come next, and with what scores? | [`lm.ts`](src/model/lm.ts) |

Everything in [`src/core`](src/core) is plain TypeScript with no DOM, covered by 38 unit tests. The same code makes the recording, runs the page and draws the diagram.

**What is real and what is not.** The scores, the probabilities and the sentences are the model's. The recording is real output, replayed. The only liberties are the ones named above: the shortlist of 40, the fixed draws, and the rule for where a sentence ends. A link is untrusted input: it is validated, size-limited, and only ever written to the page as text.

**What the recording covers.** The sentence at all 20 stops of the dial, and at the default setting the road from each of the top seven runner-ups at every word. Anything else, including your own sentence, needs the live model, and the page says so when you get there.

## The model

| | |
| :-- | :-- |
| **Model** | [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M) by Hugging Face |
| **Licence** | Apache 2.0 |
| **Weights** | [onnx-community/SmolLM2-135M-ONNX](https://huggingface.co/onnx-community/SmolLM2-135M-ONNX), fetched from the Hugging Face hub when you go live |
| **On WebGPU** | 4-bit weights with 16-bit activations (`q4f16`) |
| **On WebAssembly** | 8-bit weights (`q8`). The recording was made with these |
| **Runtime** | [Transformers.js](https://github.com/huggingface/transformers.js) 4.3 on ONNX Runtime Web |

It is the smallest model I tried that writes sensible English about whatever you type. Two smaller ones were tested on the same prompts:

| Model | Download | Given "The capital of France is" |
| :-- | :-- | :-- |
| `Xenova/llama2.c-stories15M` | 15 MB | "very popular. Everyone wants to be around him." Fluent, but it only knows children's stories |
| `Xenova/distilgpt2` | 85 MB | "to be named the "Souvenir" of the French capital of France." |
| **SmolLM2-135M** | 120 to 140 MB | "situated on the left bank of the Seine" |

To try another model, change [`src/model/config.ts`](src/model/config.ts) and run `npm run record`.

## Measured

On the production build, in Chrome, November 2026.

| What | Size |
| :-- | :-- |
| The page without the model: HTML, CSS, script, typeface and recording, compressed | 0.26 MB |
| The same, uncompressed | 0.55 MB |
| The recording alone | 253 KB (103 KB compressed) |
| Live model on WebGPU: weights, graph and tokenizer | 120 MB |
| Live model on WebAssembly | 140 MB |
| ONNX Runtime's WebAssembly binary, fetched once from jsDelivr when you go live | 26.9 MB (about 7 MB compressed) |
| Return visit with the model in the browser's cache | about 2 s to start |

## Run it

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open `http://localhost:5190`.

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Development server |
| `npm run build` | Typecheck, then a static build to `dist/` that works from any folder on any static host |
| `npm test` | Unit tests for the sampling, the tree, the links and the recording |
| `npm run record` | Runs the real model in Node and rewrites `public/recording.json` |
| `npm run readme` | Rebuilds the graphics on this page from the recording |

The screenshots and animations above are the production build, driven in Chrome on the recording.

## How it is put together

```
src/core     the logic: sampling, writing, the tree, links, the recording. Pure, tested.
src/model    the live model: a worker, its client, and the one-line choice of model
src/ui       motion (opening, scroll, cursor, the field of bars) and text helpers
src/main.ts  the page: the odds, the dial, the roads
scripts      makes the recording and the README graphics
```

The row of thin bars behind the page is a probability distribution too. The pointer moves its peak, and acts as its temperature: near the top of the screen the favourite takes everything, near the bottom the odds go flat.

## Licence

[MIT](LICENSE). SmolLM2 is by Hugging Face under Apache 2.0. Transformers.js is Apache 2.0, ONNX Runtime and Lenis are MIT, and GSAP is used under its standard no-charge licence. The Geist typeface is used under the SIL Open Font License.
