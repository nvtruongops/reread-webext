import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIndex, findMatches } from "../src/lib/matcher/index.js";
import { joinPieces, locate, unwrapLines } from "../src/lib/matcher/spans.js";
import { sentenceAround } from "../src/lib/sentence.js";

describe("unwrapLines", () => {
  it("reads the line breaks a file was wrapped with as the spaces the reader sees", () => {
    assert.equal(unwrapLines("told by our forefathers and\nmothers"), "told by our forefathers and mothers");
  });

  it("changes nothing else, and never the length", () => {
    const data = "one\ttwo  three\n";
    assert.equal(unwrapLines(data), "one\ttwo  three ");
    assert.equal(unwrapLines(data).length, data.length);
    assert.equal(unwrapLines("no breaks"), "no breaks");
    assert.deepEqual(joinPieces([unwrapLines("a\nb"), "c"]).spans, joinPieces(["a\nb", "c"]).spans);
  });

  it("keeps a sentence whole across a wrapped line", () => {
    // What a Project Gutenberg paragraph is in the DOM: one text node, wrapped
    // at seventy columns. Read as stored, the sentence ended at "and".
    const stored = "those that came before. All the way back to the myths and legends told by our forefathers and\nmothers around the cave fire.";
    const text = unwrapLines(stored);
    const at = text.indexOf("forefathers");
    assert.equal(
      sentenceAround(text, at, at + "forefathers".length),
      "All the way back to the myths and legends told by our forefathers and mothers around the cave fire.",
    );
  });
});

describe("joinPieces", () => {
  it("puts nothing between the pieces, because the page does not either", () => {
    assert.deepEqual(joinPieces(["hot", "test"]), {
      text: "hottest",
      spans: [
        { start: 0, end: 3 },
        { start: 3, end: 7 },
      ],
    });
  });

  it("has an answer for no pieces at all", () => {
    assert.deepEqual(joinPieces([]), { text: "", spans: [] });
  });
});

describe("locate", () => {
  const { spans } = joinPieces(["The ", "world's oceans", " hit"]);

  it("finds the piece a character came from, and how far into it", () => {
    assert.deepEqual(locate(spans, 0), { piece: 0, offset: 0 });
    assert.deepEqual(locate(spans, 4), { piece: 1, offset: 0 });
    assert.deepEqual(locate(spans, 17), { piece: 1, offset: 13 });
    assert.deepEqual(locate(spans, 18), { piece: 2, offset: 0 });
  });

  it("answers nothing outside the text", () => {
    assert.equal(locate(spans, -1), null);
    assert.equal(locate(spans, 22), null);
  });

  it("walks past pieces that hold nothing", () => {
    const empty = joinPieces(["", "a", "", "b"]).spans;
    assert.deepEqual(locate(empty, 0), { piece: 1, offset: 0 });
    assert.deepEqual(locate(empty, 1), { piece: 3, offset: 0 });
  });
});

describe("a phrase cut in half by markup", () => {
  it("is found, and points back at the right pieces", () => {
    // What `The <em>hottest</em> ever recorded` is in the DOM.
    const pieces = ["The ", "hottest", " ever recorded"];
    const { text, spans } = joinPieces(pieces);

    const [match] = findMatches(text, buildIndex(["hottest ever"]));
    assert.ok(match !== undefined);

    const from = locate(spans, match.start);
    const to = locate(spans, match.end - 1);
    assert.deepEqual(from, { piece: 1, offset: 0 });
    assert.deepEqual(to, { piece: 2, offset: 4 });
    assert.ok(from !== null && to !== null);

    // Which is what a range from (piece 1, 0) to (piece 2, 5) selects - the
    // same two ends the highlighter gives to `setStart` and `setEnd`.
    const [, second, third] = pieces;
    assert.ok(second !== undefined && third !== undefined);
    assert.equal(second.slice(from.offset) + third.slice(0, to.offset + 1), "hottest ever");
  });
});
