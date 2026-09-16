import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SEGMENT_CHAR_BUDGET, isHeadingTag, segmenter } from "../src/lib/book/segment.js";

/**
 * @param {number} chars
 * @param {string} name a payload that names the block in assertions
 */
const p = (chars, name) => ({ chars, heading: false, payload: name });

/**
 * @param {number} chars
 * @param {string} name
 */
const h = (chars, name) => ({ chars, heading: true, payload: name });

/**
 * Runs a whole spine through a packer and returns every segment, in order.
 *
 * @param {Array<{ chars: number, heading: boolean, payload: string }>} blocks
 * @param {number} budget
 */
function packed(blocks, budget) {
  const packer = /** @type {ReturnType<typeof segmenter<string>>} */ (segmenter(budget));
  const segments = blocks.flatMap((block) => packer.push(block));
  return [...segments, ...packer.finish()];
}

describe("segmenter", () => {
  it("packs greedily up to the budget and cuts only between blocks", () => {
    const segments = packed([p(40, "a"), p(40, "b"), p(40, "c"), p(40, "d"), p(40, "e")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a", "b"], ["c", "d"], ["e"]],
    );
    assert.deepEqual(
      segments.map((segment) => segment.charCount),
      [80, 80, 40],
    );
  });

  it("one small file is one segment", () => {
    assert.deepEqual(packed([p(10, "a"), p(10, "b")], 100), [
      { blocks: ["a", "b"], charCount: 20 },
    ]);
  });

  it("prefers to cut before a heading arriving late in the budget", () => {
    // 80 of 100 spent: the heading starts the next segment even though it
    // would still have fit.
    const segments = packed([p(80, "a"), h(5, "H"), p(50, "b"), p(60, "tail")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a"], ["H", "b"], ["tail"]],
    );
  });

  it("lets an early heading join the flow", () => {
    // 40 of 100 spent - below the cut line, so the heading is just a block.
    const segments = packed([p(40, "a"), h(5, "H"), p(40, "b")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a", "H", "b"]],
    );
  });

  it("never ends a segment on a heading - the title travels with its text", () => {
    // The heading would overflow the budget; instead of closing after it,
    // it opens the next segment.
    const segments = packed([p(90, "a"), h(20, "H"), p(90, "b"), p(90, "tail")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a"], ["H", "b"], ["tail"]],
    );
  });

  it("gives an oversized block its own segment, whole", () => {
    const segments = packed([p(40, "a"), p(250, "whale"), p(40, "b"), p(50, "tail")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a"], ["whale"], ["b", "tail"]],
    );
  });

  it("keeps a heading in front of the oversized block it announces", () => {
    const segments = packed([p(90, "a"), h(5, "H"), p(250, "whale"), p(50, "b")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a"], ["H", "whale"], ["b"]],
    );
  });

  it("does not strand a barely-started segment before an oversized block", () => {
    // 10 of 100 open when a chapter-sized block arrives - a part-divider
    // page, in practice. Closing would hand the reader a segment of almost
    // nothing, so the stub rides along with the whale instead.
    const segments = packed([p(10, "titles"), p(250, "whale"), p(40, "b")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["titles", "whale"], ["b"]],
    );
  });

  it("lets a segment past the stub line stand before an oversized block", () => {
    // 30 of 100 is a real beginning, not a stub - it closes as usual and the
    // whale gets its own segment.
    const segments = packed([p(30, "a"), p(250, "whale")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a"], ["whale"]],
    );
  });

  it("folds a short tail into its neighbour", () => {
    // The last segment would hold 10 of 100 - under the quarter, so it joins
    // the previous one even though that pushes it over budget.
    const segments = packed([p(60, "a"), p(35, "b"), p(10, "tail")], 100);
    assert.deepEqual(segments, [{ blocks: ["a", "b", "tail"], charCount: 105 }]);
  });

  it("lets a tail of real length stand", () => {
    const segments = packed([p(60, "a"), p(35, "b"), p(30, "tail")], 100);
    assert.deepEqual(
      segments.map((segment) => segment.blocks),
      [["a", "b"], ["tail"]],
    );
  });

  it("a spine with no headings still packs by size alone", () => {
    const segments = packed(
      Array.from({ length: 7 }, (_, at) => p(30, `p${at}`)),
      100,
    );
    assert.deepEqual(
      segments.map((segment) => segment.blocks.length),
      [3, 3, 1],
    );
  });

  it("answers nothing for an empty spine", () => {
    assert.deepEqual(packed([], 100), []);
  });

  it("ships with the budget the brief set", () => {
    assert.equal(SEGMENT_CHAR_BUDGET, 20000);
  });
});

describe("isHeadingTag", () => {
  it("is h1 to h3 and nothing else", () => {
    assert.equal(isHeadingTag("h1"), true);
    assert.equal(isHeadingTag("h3"), true);
    assert.equal(isHeadingTag("h4"), false);
    assert.equal(isHeadingTag("p"), false);
  });
});

describe("BOOK_CUT_VERSION", () => {
  it("pins the cut of one fixture - a boundary that moves is a new version of the cut, bumped by hand", async () => {
    const { BOOK_CUT_VERSION } = await import("../src/lib/book/segment.js");
    const { packedChars } = await import("../src/lib/book/pictures.js");
    assert.equal(BOOK_CUT_VERSION, 2);
    // A heading, six paragraphs, a figure (one picture's weight), five
    // paragraphs, a heading close to the budget's three quarters, three
    // paragraphs, one block over the whole budget, and a short tail.
    const blocks = [
      h(packedChars(40, 0), "h1"),
      ...Array.from({ length: 6 }, (_, i) => p(packedChars(2900, 0), `p${i}`)),
      p(packedChars(120, 1), "fig"),
      ...Array.from({ length: 5 }, (_, i) => p(packedChars(3100, 0), `q${i}`)),
      h(packedChars(30, 0), "h2"),
      ...Array.from({ length: 3 }, (_, i) => p(packedChars(4000, 0), `r${i}`)),
      p(packedChars(25000, 0), "long"),
      p(packedChars(800, 0), "tail"),
    ];
    const segments = packed(blocks, SEGMENT_CHAR_BUDGET);
    // The cut of version 2. Changing the budget, a threshold, a picture's
    // weight or the packer's rules moves these - then BOOK_CUT_VERSION
    // moves too, and this expectation with it.
    assert.deepEqual(
      segments.map((segment) => [segment.blocks.join(","), segment.charCount]),
      [
        ["h1,p0,p1,p2,p3,p4,p5,fig", 19560],
        ["q0,q1,q2,q3,q4", 15500],
        ["h2,r0,r1,r2", 12030],
        ["long,tail", 25800],
      ],
    );
  });
});
