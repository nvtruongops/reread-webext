import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asPosition,
  blockAtLine,
  fineScrollTop,
  measuredPercent,
  overallPercent,
  positionRecord,
  restoredIndex,
} from "../src/lib/reader/position.js";

describe("positionRecord", () => {
  it("builds the row a save writes", () => {
    assert.deepEqual(positionRecord("https://example.com/a", 0, 12, 1000), {
      docId: "https://example.com/a",
      segmentIndex: 0,
      blockIndex: 12,
      updatedAt: 1000,
    });
  });

  it("refuses a place that belongs to nothing or points nowhere", () => {
    assert.equal(positionRecord("", 0, 1, 1000), null);
    assert.equal(positionRecord("doc", -1, 1, 1000), null);
    assert.equal(positionRecord("doc", 0, -1, 1000), null);
    assert.equal(positionRecord("doc", 0, 1.5, 1000), null);
    assert.equal(positionRecord("doc", 0, NaN, 1000), null);
    assert.equal(positionRecord("doc", 0, 1, Infinity), null);
  });

  it("carries a whole percent and leaves off anything less", () => {
    assert.equal(positionRecord("doc", 0, 1, 1000, 42)?.percent, 42);
    assert.equal(positionRecord("doc", 0, 1, 1000, 0)?.percent, 0);
    // The anchor is the record's reason to exist; a broken percent must not
    // cost it.
    for (const broken of [null, undefined, -1, 101, 4.5, NaN]) {
      const record = positionRecord("doc", 0, 1, 1000, broken);
      assert.notEqual(record, null);
      assert.ok(record !== null && !("percent" in record));
    }
  });
});

describe("asPosition", () => {
  it("narrows a stored row field by field", () => {
    assert.deepEqual(asPosition({ docId: "doc", segmentIndex: 2, blockIndex: 7, updatedAt: 5 }), {
      docId: "doc",
      segmentIndex: 2,
      blockIndex: 7,
      updatedAt: 5,
    });
  });

  it("reads half an anchor as no anchor at all", () => {
    assert.equal(asPosition(null), null);
    assert.equal(asPosition(undefined), null);
    assert.equal(asPosition("doc"), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: 0 }), null);
    assert.equal(asPosition({ docId: "", segmentIndex: 0, blockIndex: 0 }), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: 0, blockIndex: 0.5 }), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: -1, blockIndex: 0 }), null);
  });

  it("keeps the place even when the timestamp is broken", () => {
    const kept = asPosition({ docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: "when" });
    assert.deepEqual(kept, { docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: 0 });
  });

  it("keeps the anchor when only the percent is broken, and the percent when whole", () => {
    const row = { docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: 5 };
    assert.equal(asPosition({ ...row, percent: 42 })?.percent, 42);
    for (const broken of [-1, 101, 4.5, "42", NaN]) {
      const read = asPosition({ ...row, percent: broken });
      assert.notEqual(read, null);
      assert.ok(read !== null && !("percent" in read));
    }
  });
});

describe("restoredIndex", () => {
  const position = { docId: "doc", segmentIndex: 0, blockIndex: 4, updatedAt: 1 };

  it("answers the stored block while it is still a place in the document", () => {
    assert.equal(restoredIndex(position, 0, 10), 4);
    assert.equal(restoredIndex(position, 0, 5), 4);
  });

  it("answers the top for no record at all", () => {
    assert.equal(restoredIndex(null, 0, 10), null);
  });

  it("answers the top for a record about another segment", () => {
    assert.equal(restoredIndex(position, 1, 10), null);
  });

  it("answers the top once the document has fewer blocks than the anchor", () => {
    assert.equal(restoredIndex(position, 0, 4), null);
    assert.equal(restoredIndex(position, 0, 0), null);
  });
});

describe("measuredPercent", () => {
  it("measures the window's bottom edge over the whole height", () => {
    // A 900px window over a 3000px document: never scrolled, 30% has still
    // passed before the eyes; standing at the end, all of it has.
    assert.equal(measuredPercent(0, 900, 3000), 30);
    assert.equal(measuredPercent(2100, 900, 3000), 100);
    assert.equal(measuredPercent(600, 900, 3000), 50);
  });

  it("never leaves 0-100, whatever the geometry says", () => {
    // Overscroll bounce and rounding must not mint an impossible number.
    assert.equal(measuredPercent(5000, 900, 3000), 100);
    assert.equal(measuredPercent(-50, 900, 3000), 28);
  });

  it("has no answer for a document with no height", () => {
    assert.equal(measuredPercent(0, 900, 0), null);
    assert.equal(measuredPercent(0, 0, 3000), null);
    assert.equal(measuredPercent(NaN, 900, 3000), null);
  });
});

describe("overallPercent", () => {
  it("passes an article's percent through and answers null for none", () => {
    const row = { docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: 1, percent: 42 };
    assert.equal(overallPercent(row, 1), 42);
    assert.equal(overallPercent(null, 1), null);
    assert.equal(
      overallPercent({ docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: 1 }, 1),
      null,
    );
  });

  it("counts a book's earlier parts as read through", () => {
    const row = { docId: "b", segmentIndex: 4, blockIndex: 0, updatedAt: 1, percent: 50 };
    assert.equal(overallPercent(row, 12), Math.round((4.5 / 12) * 100));
    // The last part read to its end is the whole book.
    assert.equal(
      overallPercent({ docId: "b", segmentIndex: 11, blockIndex: 0, updatedAt: 1, percent: 100 }, 12),
      100,
    );
  });

  it("places a book by its part alone when the row predates the percent", () => {
    const bare = { docId: "b", segmentIndex: 6, blockIndex: 0, updatedAt: 1 };
    assert.equal(overallPercent(bare, 12), 50);
  });
});

describe("fineScrollTop", () => {
  // A 500px window; the block spans 1000..9000 of a 10000px document.
  /** @param {number | undefined} percent */
  const inside = (percent) => fineScrollTop(1000, 8000, 500, percent, 10000);

  it("stays quiet while the anchor is answer enough", () => {
    assert.equal(fineScrollTop(1000, 400, 500, 60, 10000), null);
    assert.equal(fineScrollTop(1000, 500, 500, 60, 10000), null);
    assert.equal(inside(undefined), null);
  });

  it("turns the stored percent back into the offset it was measured from", () => {
    // 60% of 10000 is the bottom edge at 6000: the window stood at 5500.
    assert.equal(inside(60), 5500);
  });

  it("holds the answer inside the block's own span", () => {
    // A stale percent from another shape of the text must not carry the view
    // out of the block the anchor named.
    assert.equal(inside(0), 1000);
    assert.equal(inside(100), 8500);
  });

  it("has no answer without solid geometry", () => {
    assert.equal(fineScrollTop(NaN, 8000, 500, 60, 10000), null);
    assert.equal(fineScrollTop(1000, 8000, 0, 60, 10000), null);
    assert.equal(fineScrollTop(1000, 8000, 500, 60, 0), null);
  });
});

describe("blockAtLine", () => {
  /** @param {number[]} bottoms */
  const rects = (...bottoms) => bottoms.map((bottom) => ({ bottom }));

  it("names the first block whose bottom is still below the line", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 60), 1);
    assert.equal(blockAtLine(rects(40, 90, 200), 0), 0);
  });

  it("a block ending exactly on the line is above it, not under it", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 90), 2);
  });

  it("scrolled past everything means the last block", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 500), 2);
  });

  it("an empty document has no place at all", () => {
    assert.equal(blockAtLine([], 60), null);
  });
});
