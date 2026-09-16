import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markRecord } from "../src/lib/reader/marks.js";
import { MARKS_FILENAME, toMarksFile } from "../src/lib/store/marks-file.js";

/**
 * @param {string} text
 * @param {Partial<import("../src/lib/reader/marks.js").Mark>} [over]
 * @returns {import("../src/lib/reader/marks.js").Mark}
 */
function mark(text, over = {}) {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: text.length },
    color: "yellow",
    createdAt: 500,
    text,
    ...over,
  });
  assert.ok(built !== null);
  return built;
}

describe("toMarksFile", () => {
  it("writes a document's quotes under its title, source and day", () => {
    const file = toMarksFile([
      {
        title: "A long article",
        source: "https://example.com/long",
        // 2026-08-17 UTC, whatever timezone writes the file.
        at: Date.UTC(2026, 7, 17, 13, 30),
        marks: [mark("first passage"), mark("second passage")],
      },
    ]);
    assert.equal(
      file,
      [
        "# re/read highlights",
        "",
        "## A long article",
        "",
        "https://example.com/long - 2026-08-17",
        "",
        "> first passage",
        "",
        "> second passage",
        "",
      ].join("\n"),
    );
  });

  it("keeps a quote spanning blocks one blockquote, line by line", () => {
    const file = toMarksFile([
      {
        title: "t",
        source: null,
        at: 0,
        marks: [mark("end of one\nstart of the next")],
      },
    ]);
    assert.ok(file.includes("> end of one\n> start of the next"));
  });

  it("stands a note under its quote as the reader's own paragraph (D118)", () => {
    const file = toMarksFile([
      {
        title: "Annotated",
        source: null,
        at: 0,
        marks: [
          mark("quoted words", { note: "my thought\non two lines" }),
          mark("unannotated"),
        ],
      },
    ]);
    // The blank line closes the blockquote: the note is plain text, not more
    // of the quote - and the next quote starts clean after it.
    assert.ok(file.includes("> quoted words\n\nmy thought\non two lines\n\n> unannotated"));
  });

  it("says nothing about a source or a day it does not have", () => {
    // A book without an author, a document with no clock: the heading stands
    // alone rather than over an empty line of dashes.
    const file = toMarksFile([{ title: "Bare", source: null, at: 0, marks: [mark("q")] }]);
    assert.ok(file.includes("## Bare\n\n> q"));
  });

  it("writes the same list as the same file, oldest first, title as the tie", () => {
    const docs = [
      { title: "B", source: null, at: 2000, marks: [mark("b")] },
      { title: "A", source: null, at: 2000, marks: [mark("a")] },
      { title: "Later", source: null, at: 3000, marks: [mark("l")] },
    ];
    const one = toMarksFile(docs);
    assert.equal(one, toMarksFile([...docs].reverse()));
    assert.ok(one.indexOf("## A") < one.indexOf("## B"));
    assert.ok(one.indexOf("## B") < one.indexOf("## Later"));
  });

  it("is one name, and a Markdown one", () => {
    assert.equal(MARKS_FILENAME, "reread-highlights.md");
  });
});
