/**
 * The tree of sentences. Every node is one token; every leaf is one sentence
 * (the tokens on the way from the root to that leaf). Sentences that start
 * the same way share nodes, so the tree is a trie.
 */
export interface TreeNode {
  piece: string;
  /** True when a person chose this token by hand rather than the sampler. */
  forced: boolean;
  parent: TreeNode | null;
  children: TreeNode[];
}

export function createRoot(): TreeNode {
  return { piece: "", forced: false, parent: null, children: [] };
}

/** Add a token under `parent`, or return the child that already says it. */
export function addChild(parent: TreeNode, piece: string, forced = false): TreeNode {
  const existing = parent.children.find((c) => c.piece === piece);
  if (existing) {
    if (forced) existing.forced = true;
    return existing;
  }
  const node: TreeNode = { piece, forced, parent, children: [] };
  parent.children.push(node);
  return node;
}

/** Nodes from the first token to `node`, root excluded. */
export function pathTo(node: TreeNode): TreeNode[] {
  const path: TreeNode[] = [];
  for (let n: TreeNode | null = node; n && n.parent; n = n.parent) path.push(n);
  return path.reverse();
}

export function piecesTo(node: TreeNode): string[] {
  return pathTo(node).map((n) => n.piece);
}

export function depthOf(node: TreeNode): number {
  let d = 0;
  for (let n = node; n.parent; n = n.parent) d++;
  return d;
}

/** All sentences, in the order a reader would meet them top to bottom. */
export function leaves(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.children.length === 0) {
      if (n.parent) out.push(n);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

export function countNodes(root: TreeNode): number {
  let n = 0;
  const walk = (x: TreeNode) => {
    for (const c of x.children) {
      n++;
      walk(c);
    }
  };
  walk(root);
  return n;
}

/**
 * Where a sentence may be rewritten from: the last token on its path that a
 * person chose by hand, or the root if the sampler chose all of it.
 */
export function anchorOf(leaf: TreeNode): TreeNode {
  let n: TreeNode = leaf;
  while (n.parent) {
    if (n.forced) return n;
    n = n.parent;
  }
  return n;
}

/**
 * Remove the part of a sentence that no other sentence shares, walking up
 * from its leaf and stopping at `stopAt`. Returns the node left standing.
 */
export function pruneUp(leaf: TreeNode, stopAt: TreeNode): TreeNode {
  let n = leaf;
  while (n !== stopAt && n.parent && n.children.length === 0) {
    const p: TreeNode = n.parent;
    p.children = p.children.filter((c) => c !== n);
    n.parent = null;
    n = p;
  }
  return n;
}

/** The leaf reached by always taking the first child. */
export function firstLeafUnder(node: TreeNode): TreeNode {
  let n = node;
  while (n.children.length > 0) n = n.children[0] as TreeNode;
  return n;
}

/**
 * The token where the sentence ending at `leaf` leaves the sentence printed
 * above it, or null for the first sentence.
 */
export function forkOf(leaf: TreeNode): TreeNode | null {
  let n = leaf;
  while (n.parent) {
    const p = n.parent;
    if (p.children[0] !== n) return n;
    n = p;
  }
  return null;
}

/* ---------- plain-data form, for the URL ---------- */

/** [piece, children] or [piece, children, 1] when forced. */
export type PlainNode = [string, PlainNode[]] | [string, PlainNode[], 1];

export function toPlain(root: TreeNode): PlainNode[] {
  const conv = (n: TreeNode): PlainNode =>
    n.forced ? [n.piece, n.children.map(conv), 1] : [n.piece, n.children.map(conv)];
  return root.children.map(conv);
}

export const LIMITS = { nodes: 600, pieceLength: 48, depth: 40 };

/** Rebuild a tree from untrusted plain data. Returns null if it is not a sane tree. */
export function fromPlain(plain: unknown): TreeNode | null {
  const root = createRoot();
  let count = 0;
  const build = (data: unknown, parent: TreeNode, depth: number): boolean => {
    if (!Array.isArray(data) || data.length < 2 || data.length > 3) return false;
    const [piece, kids, forced] = data as unknown[];
    if (typeof piece !== "string" || piece.length === 0 || piece.length > LIMITS.pieceLength) return false;
    if (!Array.isArray(kids)) return false;
    if (++count > LIMITS.nodes || depth > LIMITS.depth) return false;
    if (parent.children.some((c) => c.piece === piece)) return false;
    const node: TreeNode = { piece, forced: forced === 1, parent, children: [] };
    parent.children.push(node);
    for (const k of kids) if (!build(k, node, depth + 1)) return false;
    return true;
  };
  if (!Array.isArray(plain) || plain.length === 0) return null;
  for (const p of plain) if (!build(p, root, 1)) return null;
  return root;
}
