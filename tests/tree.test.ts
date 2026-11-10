import { describe, expect, it } from "vitest";
import { decodeShared, encodeShared, clampTemperature } from "../src/core/share";
import {
  addChild,
  anchorOf,
  countNodes,
  createRoot,
  depthOf,
  firstLeafUnder,
  forkOf,
  fromPlain,
  leaves,
  piecesTo,
  pruneUp,
  toPlain,
  type TreeNode,
} from "../src/core/tree";

function write(root: TreeNode, pieces: string[], forcedAt = -1): TreeNode {
  let n = root;
  pieces.forEach((p, i) => (n = addChild(n, p, i === forcedAt)));
  return n;
}

const sentences = (root: TreeNode) => leaves(root).map((l) => piecesTo(l).join(""));

describe("tree", () => {
  it("shares the start of sentences that begin alike", () => {
    const root = createRoot();
    write(root, [" the", " sea", "."]);
    write(root, [" the", " sky", "."], 1);
    expect(countNodes(root)).toBe(5);
    expect(sentences(root)).toEqual([" the sea.", " the sky."]);
  });

  it("returns the same node when a token is added twice", () => {
    const root = createRoot();
    const a = addChild(root, " a");
    expect(addChild(root, " a")).toBe(a);
    expect(a.forced).toBe(false);
    addChild(root, " a", true);
    expect(a.forced).toBe(true);
  });

  it("knows depth and the path back", () => {
    const root = createRoot();
    const leaf = write(root, ["a", "b", "c"]);
    expect(depthOf(leaf)).toBe(3);
    expect(piecesTo(leaf)).toEqual(["a", "b", "c"]);
    expect(depthOf(root)).toBe(0);
  });

  it("anchors a sentence at its last hand-chosen token, else the root", () => {
    const root = createRoot();
    const trunk = write(root, ["a", "b", "c"]);
    expect(anchorOf(trunk)).toBe(root);
    const branch = write(root, ["a", "x", "y", "z"], 1);
    expect(anchorOf(branch).piece).toBe("x");
    const deeper = write(root, ["a", "x", "y", "q"], 3);
    expect(anchorOf(deeper).piece).toBe("q");
  });

  it("prunes only what no other sentence shares", () => {
    const root = createRoot();
    const trunk = write(root, ["a", "b", "c", "d"]);
    write(root, ["a", "b", "x"], 2);
    const stood = pruneUp(trunk, root);
    expect(stood.piece).toBe("b");
    expect(sentences(root)).toEqual(["abx"]);
  });

  it("stops pruning at the anchor", () => {
    const root = createRoot();
    const branch = write(root, ["a", "x", "y"], 1);
    const anchor = anchorOf(branch);
    expect(pruneUp(branch, anchor)).toBe(anchor);
    expect(sentences(root)).toEqual(["ax"]);
  });

  it("finds where a sentence leaves the one above it", () => {
    const root = createRoot();
    const trunk = write(root, ["a", "b", "c"]);
    const branch = write(root, ["a", "x", "y"], 1);
    expect(forkOf(trunk)).toBeNull();
    expect(forkOf(branch)?.piece).toBe("x");
    expect(firstLeafUnder(root)).toBe(trunk);
  });
});

describe("plain form", () => {
  it("round-trips a tree, forced marks included", () => {
    const root = createRoot();
    write(root, [" one", " two", "."]);
    write(root, [" one", " deux", "!"], 1);
    const back = fromPlain(JSON.parse(JSON.stringify(toPlain(root))));
    expect(back).not.toBeNull();
    expect(toPlain(back as TreeNode)).toEqual(toPlain(root));
    expect(anchorOf(leaves(back as TreeNode)[1] as TreeNode).piece).toBe(" deux");
  });

  it("rejects anything that is not a sane tree", () => {
    expect(fromPlain(null)).toBeNull();
    expect(fromPlain([])).toBeNull();
    expect(fromPlain([["a"]])).toBeNull();
    expect(fromPlain([[1, []]])).toBeNull();
    expect(fromPlain([["", []]])).toBeNull();
    expect(fromPlain([["a", "b"]])).toBeNull();
    expect(fromPlain([["x".repeat(49), []]])).toBeNull();
    expect(fromPlain([["a", []], ["a", []]])).toBeNull();
    const wide = Array.from({ length: 601 }, (_, i) => [`t${i}`, []]);
    expect(fromPlain(wide)).toBeNull();
    let deep: unknown = ["z", []];
    for (let i = 0; i < 41; i++) deep = ["z", [deep]];
    expect(fromPlain([deep])).toBeNull();
  });
});

describe("shared links", () => {
  const root = createRoot();
  write(root, [" that", " you", " don't", " “worry”", "."]);
  write(root, [" that", " it", " is", " free", " \u{1F30A}"], 1);

  it("restores the same prompt, dial, tree and active sentence", () => {
    const hash = encodeShared({ prompt: "By the sea & beyond = ?", temperature: 1.3, root, active: 1 });
    const got = decodeShared("#" + hash);
    expect(got).not.toBeNull();
    expect(got?.prompt).toBe("By the sea & beyond = ?");
    expect(got?.temperature).toBe(1.3);
    expect(got?.active).toBe(1);
    expect(toPlain(got?.root as TreeNode)).toEqual(toPlain(root));
  });

  it("uses only URL-safe characters", () => {
    const hash = encodeShared({ prompt: "a b", temperature: 0.8, root, active: 0 });
    expect(hash).toMatch(/^[A-Za-z0-9\-_.~%+&=]+$/);
  });

  it("returns null for broken or hostile links", () => {
    expect(decodeShared("")).toBeNull();
    expect(decodeShared("#p=hi")).toBeNull();
    expect(decodeShared("#p=hi&r=%%%")).toBeNull();
    expect(decodeShared("#p=hi&r=bm90IGpzb24")).toBeNull();
    expect(decodeShared(`#p=${"x".repeat(161)}&r=W10`)).toBeNull();
  });

  it("repairs an out-of-range dial or sentence number", () => {
    const hash = encodeShared({ prompt: "p", temperature: 0.8, root, active: 0 });
    const got = decodeShared(hash.replace("t=0.8", "t=99") + "&a=57");
    expect(got?.temperature).toBe(2);
    expect(got?.active).toBe(0);
  });

  it("snaps the dial to its stops", () => {
    expect(clampTemperature(0.84)).toBe(0.8);
    expect(clampTemperature(-3)).toBe(0.1);
    expect(clampTemperature(Number.NaN)).toBe(0.8);
  });
});
