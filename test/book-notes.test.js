import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTE_TEXT_LIMIT, cleanNoteText, internalTarget, isNoteref } from "../src/lib/book/notes.js";

describe("isNoteref", () => {
  it("believes EPUB 3 when it says noteref out loud", () => {
    assert.ok(isNoteref("noteref", "see the appendix"));
    assert.ok(isNoteref("noteref backlink", "1"));
  });

  it("does not read noteref out of a longer word", () => {
    assert.ok(!isNoteref("notereference", "see the appendix"));
  });

  it("recognizes the marks older books use", () => {
    for (const mark of ["1", "42", "[3]", "(7)", "*", "†", "‡", "§", "¶", "1234"]) {
      assert.ok(isNoteref(null, mark), `"${mark}" should read as a footnote mark`);
    }
  });

  it("leaves the table of contents and cross-references alone", () => {
    // The book's own TOC page and "see chapter 5" links target fragments too;
    // what tells them apart is that their text is words, not a mark.
    for (const text of ["Chapter One", "see chapter 5", "12345", "IV", "a", ""]) {
      assert.ok(!isNoteref(null, text), `"${text}" must not read as a footnote mark`);
    }
  });
});

describe("internalTarget", () => {
  it("takes a same-file fragment apart", () => {
    assert.deepEqual(internalTarget("#fn2"), { path: null, id: "fn2" });
  });

  it("takes a sibling file's fragment apart", () => {
    assert.deepEqual(internalTarget("notes.xhtml#fn2"), { path: "notes.xhtml", id: "fn2" });
    assert.deepEqual(internalTarget("../back/notes.xhtml#a"), { path: "../back/notes.xhtml", id: "a" });
  });

  it("refuses jumps, the outside world and empty fragments", () => {
    assert.equal(internalTarget("chapter2.xhtml"), null);
    assert.equal(internalTarget("https://example.test/page#x"), null);
    assert.equal(internalTarget("//example.test/page#x"), null);
    assert.equal(internalTarget("mailto:someone@example.test#x"), null);
    assert.equal(internalTarget("notes.xhtml#"), null);
    assert.equal(internalTarget(null), null);
  });
});

describe("cleanNoteText", () => {
  it("collapses whitespace the way the store does", () => {
    assert.equal(cleanNoteText("  1. A note,\n   wrapped twice.  "), "1. A note, wrapped twice.");
  });

  it("takes the backlink arrow off the end", () => {
    // Most books close a note with an arrow back to the text; the popover
    // stands IN the text, so the arrow points nowhere it can go.
    assert.equal(cleanNoteText("A note. ↩"), "A note.");
    assert.equal(cleanNoteText("A note. ↩︎"), "A note.");
    assert.equal(cleanNoteText("A note ←"), "A note");
  });

  it("keeps an arrow that is part of the sentence", () => {
    assert.equal(cleanNoteText("press ↩ to continue"), "press ↩ to continue");
  });

  it("caps a runaway note with an honest ellipsis", () => {
    const capped = cleanNoteText("x".repeat(NOTE_TEXT_LIMIT * 2));
    assert.equal(capped.length, NOTE_TEXT_LIMIT);
    assert.ok(capped.endsWith("…"));
  });

  it("has nothing to say about an empty block", () => {
    assert.equal(cleanNoteText("   \n  "), "");
  });
});
