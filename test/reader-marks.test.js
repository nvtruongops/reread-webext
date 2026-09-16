import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MARK_COLOR,
  MAX_MARK_TEXT_LENGTH,
  MAX_NOTE_LENGTH,
  asMark,
  compareMarks,
  comparePoints,
  findQuote,
  fitsProse,
  handleAt,
  headRect,
  isMarkColor,
  locateQuote,
  markRecord,
  marksInSegment,
  mergePlan,
  mergedNote,
  placeMark,
  quoteOf,
  reanchorMarks,
  reshapePlan,
  tailRect,
  withoutMark,
} from "../src/lib/reader/marks.js";

/**
 * A whole mark with sensible defaults, so a test names only what it is about.
 *
 * @param {Partial<import("../src/lib/reader/marks.js").Mark>} [over]
 * @returns {import("../src/lib/reader/marks.js").Mark}
 */
function mark(over = {}) {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: 5 },
    color: "yellow",
    createdAt: 1000,
    text: "quote",
    ...over,
  });
  assert.notEqual(built, null);
  return /** @type {import("../src/lib/reader/marks.js").Mark} */ (built);
}

describe("markRecord", () => {
  it("builds the record a finished stroke writes", () => {
    assert.deepEqual(
      markRecord({
        segmentIndex: 2,
        start: { block: 3, offset: 14 },
        end: { block: 5, offset: 9 },
        color: "yellow",
        createdAt: 1234,
        text: "across three blocks",
      }),
      {
        segmentIndex: 2,
        start: { block: 3, offset: 14 },
        end: { block: 5, offset: 9 },
        color: "yellow",
        createdAt: 1234,
        text: "across three blocks",
      },
    );
  });

  it("refuses a span that does not run forward", () => {
    // Backwards, empty, and the end standing at the very start of a block -
    // a mark "ending" there really ends in the block before.
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 1, offset: 5 },
        end: { block: 1, offset: 5 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 2, offset: 0 },
        end: { block: 1, offset: 4 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 0, offset: 3 },
        end: { block: 1, offset: 0 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
  });

  it("refuses what it cannot paint or guard with", () => {
    assert.equal(markRecord({ ...mark(), color: "chartreuse" }), null);
    assert.equal(markRecord({ ...mark(), text: "" }), null);
    assert.equal(markRecord({ ...mark(), createdAt: Infinity }), null);
    assert.equal(markRecord({ ...mark(), segmentIndex: -1 }), null);
    assert.equal(
      markRecord({ ...mark(), start: { block: 0, offset: 1.5 } }),
      null,
    );
  });
});

describe("the note on a mark (D118)", () => {
  it("keeps a note through the record and through the healer alike", () => {
    const noted = mark({ note: "worth keeping" });
    assert.equal(noted.note, "worth keeping");
    assert.deepEqual(asMark(JSON.parse(JSON.stringify(noted))), noted);
  });

  it("narrows emptiness into absence - no note is no field", () => {
    assert.equal("note" in mark(), false);
    assert.equal("note" in mark({ note: "" }), false);
    assert.equal("note" in mark({ note: "   \n  " }), false);
    // A non-string from a hand-made file is not somebody's words either.
    assert.equal("note" in /** @type {object} */ (asMark({ ...mark(), note: 7 })), false);
    // And absence and emptiness must read back the same.
    assert.equal("note" in /** @type {object} */ (asMark({ ...mark() })), false);
  });

  it("trims and cuts to the cap, and healing twice reads as healing once", () => {
    assert.equal(mark({ note: "  spaced  " }).note, "spaced");
    const flood = "x".repeat(MAX_NOTE_LENGTH + 500);
    const healed = mark({ note: flood }).note;
    assert.equal(healed?.length, MAX_NOTE_LENGTH);
    // A cut landing on a space must not read differently on the next pass.
    const cutOnSpace = "y".repeat(MAX_NOTE_LENGTH - 1) + " z";
    const once = mark({ note: cutOnSpace }).note ?? "";
    assert.deepEqual(mark({ note: once }).note, once);
  });

  it("rides a record rebuilt in place, the colour change's road", () => {
    const noted = mark({ note: "stays" });
    assert.equal(markRecord({ ...noted, color: "blue" })?.note, "stays");
  });
});

describe("mergedNote", () => {
  /**
   * @param {number} block
   * @param {string} [note]
   */
  const at = (block, note) =>
    mark({
      start: { block, offset: 0 },
      end: { block, offset: 3 },
      ...(note === undefined ? {} : { note }),
    });

  it("inherits every absorbed note, reading order kept, a blank line between", () => {
    // Handed out of order on purpose: the growth gesture absorbs by overlap,
    // not by age, and the notes must still read the way the page does.
    assert.equal(mergedNote([at(4, "later"), at(1, "sooner")]), "sooner\n\nlater");
  });

  it("collapses exact twins and passes over marks without words", () => {
    assert.equal(mergedNote([at(0, "same"), at(2), at(5, "same")]), "same");
  });

  it("stands aside when nobody wrote - the fresh record gets no field", () => {
    assert.equal(mergedNote([at(0), at(1)]), undefined);
    assert.equal(mergedNote([]), undefined);
  });
});

describe("asMark", () => {
  it("narrows a stored mark field by field", () => {
    const stored = mark({ segmentIndex: 1, createdAt: 77 });
    assert.deepEqual(asMark(JSON.parse(JSON.stringify(stored))), stored);
  });

  it("heals what can heal and drops what cannot", () => {
    // An unknown colour is still somebody's mark: it comes back in the
    // default rather than not at all. Half an anchor or no quote is not.
    assert.equal(asMark({ ...mark(), color: "ultraviolet" })?.color, DEFAULT_MARK_COLOR);
    assert.equal(asMark({ ...mark(), createdAt: "yesterday" })?.createdAt, 0);
    assert.equal(asMark(null), null);
    assert.equal(asMark({ ...mark(), start: undefined }), null);
    assert.equal(asMark({ ...mark(), end: { block: 0 } }), null);
    assert.equal(asMark({ ...mark(), text: 7 }), null);
  });

  it("refuses a quote past the cap whole rather than cutting it (D171)", () => {
    // A cut quote would anchor nowhere; a quote this long is not a mark but
    // a file planting a document behind one row.
    assert.equal(asMark({ ...mark(), text: "x".repeat(MAX_MARK_TEXT_LENGTH) })?.text.length, MAX_MARK_TEXT_LENGTH);
    assert.equal(asMark({ ...mark(), text: "x".repeat(MAX_MARK_TEXT_LENGTH + 1) }), null);
  });
});

describe("the order of marks", () => {
  it("compares points block-major", () => {
    assert.ok(comparePoints({ block: 1, offset: 90 }, { block: 2, offset: 0 }) < 0);
    assert.ok(comparePoints({ block: 2, offset: 5 }, { block: 2, offset: 4 }) > 0);
    assert.equal(comparePoints({ block: 3, offset: 3 }, { block: 3, offset: 3 }), 0);
  });

  it("orders marks segment first, then by where they begin", () => {
    const early = mark({ start: { block: 0, offset: 2 }, end: { block: 0, offset: 4 } });
    const late = mark({ start: { block: 4, offset: 0 }, end: { block: 4, offset: 2 } });
    const nextPart = mark({ segmentIndex: 1, start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } });
    assert.ok(compareMarks(early, late) < 0);
    assert.ok(compareMarks(late, nextPart) < 0);
  });
});

describe("mergePlan", () => {
  const standing = () => [
    mark({ start: { block: 1, offset: 10 }, end: { block: 1, offset: 20 }, text: "one" }),
    mark({ start: { block: 3, offset: 0 }, end: { block: 4, offset: 8 }, text: "two" }),
    mark({ segmentIndex: 1, start: { block: 1, offset: 12 }, end: { block: 1, offset: 18 }, text: "other part" }),
  ];

  it("absorbs nothing when the stroke stands alone", () => {
    const plan = mergePlan(standing(), {
      segmentIndex: 0,
      start: { block: 6, offset: 0 },
      end: { block: 6, offset: 4 },
    });
    assert.equal(plan.absorbed.length, 0);
    assert.deepEqual(plan.span.start, { block: 6, offset: 0 });
  });

  it("grows the stroke to cover every mark it overlaps or touches", () => {
    // Overlapping the first, touching the second end to start, crossing a
    // block boundary on the way: one stroke, one union.
    const marks = standing();
    const plan = mergePlan(marks, {
      segmentIndex: 0,
      start: { block: 1, offset: 15 },
      end: { block: 3, offset: 0 },
    });
    assert.deepEqual(plan.absorbed, [marks[0], marks[1]]);
    assert.deepEqual(plan.span, {
      segmentIndex: 0,
      start: { block: 1, offset: 10 },
      end: { block: 4, offset: 8 },
    });
  });

  it("never reaches into another segment", () => {
    // The same block numbers exist in every part of a book; only the same
    // part's marks are this stroke's to absorb.
    const plan = mergePlan(standing(), {
      segmentIndex: 1,
      start: { block: 1, offset: 0 },
      end: { block: 1, offset: 30 },
    });
    assert.equal(plan.absorbed.length, 1);
    assert.equal(plan.absorbed[0]?.text, "other part");
  });

  it("leaves marks that merely stand near", () => {
    const plan = mergePlan(standing(), {
      segmentIndex: 0,
      start: { block: 1, offset: 21 },
      end: { block: 1, offset: 30 },
    });
    // One offset short of touching: still two marks, and the seam is real.
    assert.equal(plan.absorbed.length, 0);
  });
});

describe("reshapePlan (D181)", () => {
  const standing = () => [
    mark({ start: { block: 1, offset: 10 }, end: { block: 1, offset: 20 }, text: "one" }),
    mark({ start: { block: 1, offset: 24 }, end: { block: 1, offset: 30 }, text: "two" }),
  ];

  it("keeps a trim as drawn - the old outline is never unioned back in", () => {
    // The end pin dragged inward: a stroke over the same words would merge
    // into the standing mark and change nothing, which was the bug.
    const marks = standing();
    const trimmed = { segmentIndex: 0, start: { block: 1, offset: 10 }, end: { block: 1, offset: 15 } };
    const plan = reshapePlan(marks, /** @type {import("../src/lib/reader/marks.js").Mark} */ (marks[0]), trimmed);
    assert.deepEqual(plan.span, trimmed);
    // Absorbed by construction: the record is replaced whatever the span.
    assert.deepEqual(plan.absorbed, [marks[0]]);
  });

  it("absorbs the other marks the new outline reaches, and only those", () => {
    // The end pin dragged past the neighbour: one mark, the way a stroke
    // over both would leave one.
    const marks = standing();
    const plan = reshapePlan(marks, /** @type {import("../src/lib/reader/marks.js").Mark} */ (marks[0]), {
      segmentIndex: 0,
      start: { block: 1, offset: 10 },
      end: { block: 1, offset: 26 },
    });
    assert.deepEqual(plan.absorbed, [marks[0], marks[1]]);
    assert.deepEqual(plan.span.end, { block: 1, offset: 30 });
  });
});

describe("handleAt (D181)", () => {
  // Two pins as the page draws them: a two-pixel stem the line's height,
  // the start's dot above it, the end's below.
  const start = { top: 100, bottom: 130, left: 40, right: 42, width: 2, height: 30 };
  const end = { top: 250, bottom: 280, left: 300, right: 302, width: 2, height: 30 };

  it("takes a press on a pin from a thumb's reach around it", () => {
    assert.equal(handleAt(41, 96, start, end, 20), "start");
    assert.equal(handleAt(58, 148, start, end, 20), "start");
    assert.equal(handleAt(301, 285, start, end, 20), "end");
    assert.equal(handleAt(284, 232, start, end, 20), "end");
  });

  it("answers nobody off both pins - the text between them is the text's", () => {
    assert.equal(handleAt(150, 115, start, end, 20), null);
    assert.equal(handleAt(41, 160, start, end, 20), null);
    assert.equal(handleAt(64, 115, start, end, 20), null);
  });

  it("tells the pins of a one-word mark apart by their dots", () => {
    // Both stems a few pixels apart on one line: a press above the line's
    // middle is nearer the start's dot, one below nearer the end's.
    const near = { top: 100, bottom: 130, left: 70, right: 72, width: 2, height: 30 };
    assert.equal(handleAt(55, 105, start, near, 20), "start");
    assert.equal(handleAt(55, 126, start, near, 20), "end");
  });
});

describe("placeMark and withoutMark", () => {
  it("replaces the absorbed and keeps the reading order", () => {
    const a = mark({ start: { block: 0, offset: 0 }, end: { block: 0, offset: 3 }, text: "a" });
    const b = mark({ start: { block: 2, offset: 0 }, end: { block: 2, offset: 3 }, text: "b" });
    const c = mark({ start: { block: 5, offset: 0 }, end: { block: 5, offset: 3 }, text: "c" });
    const grown = mark({ start: { block: 1, offset: 0 }, end: { block: 2, offset: 9 }, text: "bc" });

    const placed = placeMark([a, b, c], [b], grown);
    assert.deepEqual(placed.map((one) => one.text), ["a", "bc", "c"]);
  });

  it("takes one mark and only that mark", () => {
    const a = mark({ text: "a" });
    const twin = mark({ text: "a" });
    const left = withoutMark([a, twin], twin);
    // Identity, not likeness: two marks can quote the same words, and the
    // delete bubble means the one that was tapped.
    assert.deepEqual(left, [a]);
  });
});

describe("headRect and tailRect", () => {
  /**
   * @param {number} top
   * @param {number} left
   * @param {number} [width]
   * @param {number} [height]
   */
  const box = (top, left, width = 100, height = 20) => ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  it("picks the topmost and the bottommost box, wherever the list put them", () => {
    // Blink hands a range's rects grouped by node, not in document order -
    // the exact shape that stood the note badge mid-mark (Brave report).
    const lines = [box(40, 0), box(60, 0, 40), box(0, 0), box(20, 0)];
    assert.equal(headRect(lines)?.top, 0);
    assert.equal(tailRect(lines)?.top, 60);
  });

  it("breaks a shared line toward the reading edge", () => {
    // Two boxes on one line - split by an inline element - and the tail is
    // the one the reading ends in: the rightmost.
    const split = [box(0, 300, 50), box(0, 0, 280)];
    assert.equal(tailRect(split)?.right, 350);
    assert.equal(headRect(split)?.left, 0);
  });

  it("counts no empty box as a line", () => {
    // Collapsed whitespace rides along as zero-size rects; a badge on one
    // would stand on nothing.
    const rects = [box(0, 0), box(50, 200, 0, 20), box(50, 200, 20, 0)];
    assert.equal(tailRect(rects)?.top, 0);
    assert.equal(headRect([box(10, 10, 0, 0)]), null);
    assert.equal(tailRect([]), null);
  });
});

describe("marksInSegment", () => {
  it("answers one part of a book", () => {
    const here = mark({ segmentIndex: 2 });
    const elsewhere = mark({ segmentIndex: 3 });
    assert.deepEqual(marksInSegment([here, elsewhere], 2), [here]);
  });
});

describe("quoteOf", () => {
  it("reads a span inside one block", () => {
    assert.equal(
      quoteOf(["the quick brown fox"], { block: 4, offset: 4 }, { block: 4, offset: 9 }),
      "quick",
    );
  });

  it("reads across blocks with a line break at every boundary", () => {
    assert.equal(
      quoteOf(
        ["first paragraph", "the middle one", "and the last"],
        { block: 1, offset: 6 },
        { block: 3, offset: 3 },
      ),
      "paragraph\nthe middle one\nand",
    );
  });

  it("refuses offsets the prose cannot hold - the quote guard's teeth", () => {
    assert.equal(quoteOf(["short"], { block: 0, offset: 5 }, { block: 0, offset: 6 }), null);
    assert.equal(quoteOf(["short"], { block: 0, offset: 0 }, { block: 0, offset: 9 }), null);
    assert.equal(quoteOf(["a", "b"], { block: 0, offset: 0 }, { block: 0, offset: 1 }), null);
    assert.equal(quoteOf([], { block: 0, offset: 0 }, { block: 0, offset: 1 }), null);
    assert.equal(quoteOf(["ab"], { block: 0, offset: 0 }, { block: 0, offset: 0 }), null);
  });

  it("reads the page as it stands, so a page corrected under a mark no longer reads its quote", () => {
    // Michał's T625: the quote was written when the page said $899; the page
    // saved again says $1100 in the same place. The guard compares what the
    // anchor reads today with the quote it was written with, exactly - one
    // changed figure is a different quote, and the mark stays unpainted
    // rather than washing words that were never highlighted.
    const written = "costs substantially more at $899 and offers";
    const before = ["That's the MovinkPad Pro 14, which costs substantially more at $899 and offers a number of upgrades."];
    const after = ["That's the MovinkPad Pro 14, which costs substantially more at $1100 and offers a number of upgrades."];
    const start = { block: 0, offset: 35 };
    const end = { block: 0, offset: 35 + written.length };
    assert.equal(quoteOf(before, start, end), written);
    assert.notEqual(quoteOf(after, start, end), written);
  });
});

describe("findQuote (D169)", () => {
  it("finds a quote standing once in one block, as the anchor quoteOf reads back", () => {
    const prose = ["The quick brown fox", "jumps over the lazy dog"];
    const span = findQuote(prose, "quick brown");
    assert.deepEqual(span, { start: { block: 0, offset: 4 }, end: { block: 0, offset: 15 } });
    assert.ok(span !== null);
    assert.equal(quoteOf(prose.slice(0, 1), span.start, span.end), "quick brown");
  });

  it("finds a quote across blocks - the line break is the boundary, as quoteOf writes it", () => {
    const prose = ["end of one", "the middle", "start of the next"];
    const span = findQuote(prose, "of one\nthe middle\nstart");
    assert.deepEqual(span, { start: { block: 0, offset: 4 }, end: { block: 2, offset: 5 } });
    assert.ok(span !== null);
    assert.equal(quoteOf(prose, span.start, span.end), "of one\nthe middle\nstart");
  });

  it("heals the backlog's own case: a paragraph added above moves every block by one", () => {
    // The mark was written at block 1; a paragraph inserted before it puts
    // the quote in block 2, where the guard refuses the old anchor.
    const written = mark({ start: { block: 1, offset: 0 }, end: { block: 1, offset: 5 }, text: "quote" });
    const after = ["A new paragraph.", "First paragraph.", "quote, and the rest."];
    assert.equal(quoteOf([after[1] ?? ""], written.start, written.end), "First");
    assert.deepEqual(findQuote(after, written.text), {
      start: { block: 2, offset: 0 },
      end: { block: 2, offset: 5 },
    });
  });

  it("refuses a quote it cannot find, and one it finds twice", () => {
    const prose = ["the fox and the fox", "another fox"];
    assert.equal(findQuote(prose, "the dog"), null);
    assert.equal(findQuote(prose, "fox"), null);
    // Once is once, however the twice-standing word around it reads.
    assert.deepEqual(findQuote(prose, "another"), {
      start: { block: 1, offset: 0 },
      end: { block: 1, offset: 7 },
    });
  });

  it("refuses a quote ending on a block boundary, and nothing at all", () => {
    const prose = ["one", "two"];
    assert.equal(findQuote(prose, "one\n"), null);
    assert.equal(findQuote(prose, "\ntwo"), null);
    assert.equal(findQuote(prose, ""), null);
    assert.equal(findQuote([], "one"), null);
    // The text changed under the quote (T625, D151): still refused - a
    // heal finds words, never guesses at them.
    assert.equal(findQuote(["costs $1100 and offers"], "costs $899 and offers"), null);
  });
});

describe("fitsProse, locateQuote and reanchorMarks (D223)", () => {
  // A book of three parts as its prose reads after a cut; the marks below
  // were written against another cut of the same text.
  const book = [
    ["Chapter one.", "The fox ran across the field.", "A picture."],
    ["Chapter two.", "The dog slept.", "The fox came back at night."],
    ["Chapter three.", "Nobody saw the fox again."],
  ];

  it("fitsProse is the quote guard on the prose alone", () => {
    const fits = mark({ segmentIndex: 0, start: { block: 1, offset: 4 }, end: { block: 1, offset: 7 }, text: "fox" });
    assert.equal(fitsProse(book[0] ?? [], fits), true);
    assert.equal(fitsProse(book[0] ?? [], { ...fits, text: "dog" }), false);
    assert.equal(fitsProse(book[0] ?? [], { ...fits, start: { block: 5, offset: 0 }, end: { block: 5, offset: 3 } }), false);
    assert.equal(fitsProse([], fits), false);
  });

  it("locateQuote finds a quote standing once in the whole book, in whichever part", () => {
    assert.deepEqual(locateQuote(book, "came back"), {
      segmentIndex: 1,
      start: { block: 2, offset: 8 },
      end: { block: 2, offset: 17 },
    });
    assert.deepEqual(locateQuote(book, "Chapter three."), {
      segmentIndex: 2,
      start: { block: 0, offset: 0 },
      end: { block: 0, offset: 14 },
    });
    // Across blocks inside one part, as quoteOf joins them.
    assert.deepEqual(locateQuote(book, "slept.\nThe fox came"), {
      segmentIndex: 1,
      start: { block: 1, offset: 8 },
      end: { block: 2, offset: 12 },
    });
  });

  it("locateQuote refuses a quote standing twice - in one part or in two - and one standing nowhere", () => {
    assert.equal(locateQuote(book, "fox"), null);
    assert.equal(locateQuote(book, "The fox"), null);
    assert.equal(locateQuote(book, "Chapter"), null);
    assert.equal(locateQuote(book, "the cat"), null);
    assert.equal(locateQuote(book, ""), null);
    assert.equal(locateQuote([], "fox"), null);
  });

  it("reanchorMarks keeps a mark that fits, moves one whose words moved to another part, and keeps one it cannot place - counting both", () => {
    const fits = mark({ segmentIndex: 0, start: { block: 1, offset: 4 }, end: { block: 1, offset: 7 }, text: "fox", note: "kept" });
    // Written when "came back at night" stood in part 0, block 3.
    const moved = mark({
      segmentIndex: 0,
      start: { block: 3, offset: 8 },
      end: { block: 3, offset: 26 },
      text: "came back at night",
      note: "moved",
      color: "green",
      createdAt: 7,
    });
    // Its part is past the end of this cut altogether.
    const far = mark({ segmentIndex: 9, start: { block: 0, offset: 0 }, end: { block: 0, offset: 18 }, text: "saw the fox again." });
    const gone = mark({ segmentIndex: 1, start: { block: 1, offset: 0 }, end: { block: 1, offset: 7 }, text: "The cat" });
    // Anchored where "A picture." stands now; "Chapter" opens every part.
    const twice = mark({ segmentIndex: 0, start: { block: 2, offset: 0 }, end: { block: 2, offset: 7 }, text: "Chapter" });
    const laid = reanchorMarks(book, [fits, moved, far, gone, twice]);
    assert.equal(laid.healed, 2);
    assert.equal(laid.lost, 2);
    assert.equal(laid.marks.length, 5);
    assert.equal(laid.marks[0], fits);
    assert.deepEqual(laid.marks[1], { ...moved, segmentIndex: 1, start: { block: 2, offset: 8 }, end: { block: 2, offset: 26 } });
    assert.deepEqual(laid.marks[2], { ...far, segmentIndex: 2, start: { block: 1, offset: 7 }, end: { block: 1, offset: 25 } });
    // Nowhere and twice: as they were, in the list all the same.
    assert.equal(laid.marks[3], gone);
    assert.equal(laid.marks[4], twice);
    // Every placed record reads its quote back through the guard.
    for (const placed of laid.marks.slice(0, 3)) {
      assert.equal(fitsProse(book[placed.segmentIndex] ?? [], placed), true);
    }
    // A file written against this very cut: nothing moves, nothing is counted.
    assert.deepEqual(reanchorMarks(book, [fits]), { marks: [fits], healed: 0, lost: 0 });
  });
});
