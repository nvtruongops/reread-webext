import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asBookMeta, asSegment, bookRecord } from "../src/lib/store/book.js";
import { articleEntry, bookEntry } from "../src/reader/list-view.js";

const whole = {
  id: "b-1",
  title: "Dracula",
  author: "Bram Stoker",
  lang: "en",
  segmentCount: 12,
  totalChars: 240000,
  addedAt: 1000,
};

/** @type {import("../src/lib/book/toc.js").TocEntry[]} */
const chapters = [
  { title: "Part One", level: 1, segmentIndex: 0, blockIndex: 0 },
  { title: "Chapter I", level: 2, segmentIndex: 0, blockIndex: 1 },
];

describe("bookRecord", () => {
  it("builds the row an import writes", () => {
    assert.deepEqual(bookRecord(whole), { ...whole, readAt: null, toc: [] });
  });

  it("keeps only words worth carrying as author and language", () => {
    const kept = bookRecord({ ...whole, author: "   ", lang: undefined });
    assert.ok(kept);
    assert.equal(kept.author, null);
    assert.equal(kept.lang, null);
  });

  it("carries the import's table of contents", () => {
    assert.deepEqual(bookRecord({ ...whole, toc: chapters })?.toc, chapters);
  });

  it("writes a torn table of contents as scanned-and-empty, never as owed", () => {
    const torn = /** @type {import("../src/lib/book/toc.js").TocEntry[]} */ (
      /** @type {unknown} */ ([{ title: "", level: 2, segmentIndex: 0, blockIndex: 0 }])
    );
    assert.deepEqual(bookRecord({ ...whole, toc: torn })?.toc, []);
  });

  it("refuses what nobody could open: no id, no title, no text", () => {
    assert.equal(bookRecord({ ...whole, id: "" }), null);
    assert.equal(bookRecord({ ...whole, title: "  " }), null);
    assert.equal(bookRecord({ ...whole, segmentCount: 0 }), null);
    assert.equal(bookRecord({ ...whole, totalChars: 0 }), null);
    assert.equal(bookRecord({ ...whole, segmentCount: 2.5 }), null);
  });

  it("carries the account of the book's pictures only where there are any (D183)", () => {
    const pictured = bookRecord({ ...whole, pictures: { count: 14, bytes: 5_000_000 } });
    assert.deepEqual(pictured?.pictures, { count: 14, bytes: 5_000_000 });
    assert.equal("pictures" in (bookRecord({ ...whole, pictures: null }) ?? {}), false);
    assert.equal("pictures" in (bookRecord({ ...whole, pictures: { count: 0, bytes: 0 } }) ?? {}), false);
  });
});

describe("asBookMeta", () => {
  it("narrows a stored row field by field, healing what it can", () => {
    const healed = asBookMeta({ id: "b-1", segmentCount: 3, addedAt: "when", readAt: 7 });
    assert.deepEqual(healed, {
      id: "b-1",
      title: "b-1",
      author: null,
      lang: null,
      segmentCount: 3,
      totalChars: 0,
      addedAt: 0,
      readAt: 7,
      toc: null,
    });
  });

  it("reads a row without an id or without segments as absent", () => {
    assert.equal(asBookMeta(null), null);
    assert.equal(asBookMeta({ title: "x", segmentCount: 3 }), null);
    assert.equal(asBookMeta({ id: "b-1", segmentCount: 0 }), null);
  });

  it("keeps a stored table of contents, the scanned-and-empty one included", () => {
    assert.deepEqual(asBookMeta({ ...whole, toc: chapters })?.toc, chapters);
    assert.deepEqual(asBookMeta({ ...whole, toc: [] })?.toc, []);
  });

  it("reads a row from before the TOC, or with a torn one, as owed a scan", () => {
    assert.equal(asBookMeta(whole)?.toc, null);
    assert.equal(asBookMeta({ ...whole, toc: "x" })?.toc, null);
    // One torn entry poisons the field - a partial list kept would read as
    // scanned and never heal.
    const torn = [...chapters, { title: "x", level: 7, segmentIndex: 0, blockIndex: 0 }];
    assert.equal(asBookMeta({ ...whole, toc: torn })?.toc, null);
    assert.equal(
      asBookMeta({ ...whole, toc: [{ title: "x", level: 2, segmentIndex: -1, blockIndex: 0 }] })
        ?.toc,
      null,
    );
  });
});

describe("asSegment", () => {
  it("keeps a row of markup blocks", () => {
    assert.deepEqual(asSegment({ blocks: ["<p>a</p>"], charCount: 1 }), {
      blocks: ["<p>a</p>"],
      charCount: 1,
    });
  });

  it("reads a torn row as absent", () => {
    assert.equal(asSegment(null), null);
    assert.equal(asSegment({ blocks: [] }), null);
    assert.equal(asSegment({ blocks: ["<p>a</p>", 5] }), null);
  });

  it("names the pictures its blocks show, each once and in order, or none (D183)", () => {
    const row = { blocks: ['<img data-src="OEBPS/a.jpg">'], charCount: 2000 };
    assert.deepEqual(asSegment({ ...row, pictures: [3, 0, 3] }), { ...row, pictures: [0, 3] });
    // A list that will not read, or an empty one, is one shape with absent:
    // the part opens with its pictures hidden, never torn.
    assert.deepEqual(asSegment({ ...row, pictures: [] }), row);
    assert.deepEqual(asSegment({ ...row, pictures: [0, -1] }), row);
    assert.deepEqual(asSegment({ ...row, pictures: [0, "1"] }), row);
    assert.deepEqual(asSegment({ ...row, pictures: "0" }), row);
  });
});

describe("library entries", () => {
  const meta = {
    url: "https://example.com/a",
    hostname: "example.com",
    title: "An article",
    savedAt: 500,
    readAt: null,
  };

  it("an article enters as itself", () => {
    assert.deepEqual(articleEntry(meta, null), {
      ...meta,
      kind: "article",
      progress: null,
      percentRead: null,
      lastReadAt: null,
    });
  });

  it("the entry carries its position's clock, and a torn clock reads as never", () => {
    const position = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 777 };
    assert.equal(articleEntry(meta, position).lastReadAt, 777);
    // `asPosition` marks a row whose clock is broken with zero; the list must
    // not mistake that for a reading older than every honest date.
    assert.equal(articleEntry(meta, { ...position, updatedAt: 0 }).lastReadAt, null);
    const book = { ...whole, readAt: null, toc: null };
    assert.equal(bookEntry(book, { ...position, docId: "b-1" }).lastReadAt, 777);
  });

  it("an article's percent read is its position's, as stored", () => {
    const position = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 1, percent: 42 };
    assert.equal(articleEntry(meta, position).percentRead, 42);
    // A row from before the percent existed places the article, but has no
    // number to say - not a zero, which would read as "barely started".
    const bare = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 1 };
    assert.equal(articleEntry(meta, bare).percentRead, null);
  });

  it("a book wears the list's fields: author for site, added for saved", () => {
    const book = { ...whole, readAt: 9, toc: null };
    assert.deepEqual(bookEntry(book, null), {
      url: "b-1",
      hostname: "Bram Stoker",
      title: "Dracula",
      savedAt: 1000,
      readAt: 9,
      kind: "book",
      progress: { at: 1, of: 12 },
      percentRead: null,
      lastReadAt: null,
    });
  });

  it("a book's row says what its pictures take, as an article's does (D183)", () => {
    const pictures = { count: 3, bytes: 900_000 };
    const book = { ...whole, readAt: null, toc: [], pictures };
    assert.deepEqual(bookEntry(book, null).pictures, pictures);
    assert.equal("pictures" in bookEntry({ ...whole, readAt: null, toc: [] }, null), false);
  });

  it("a book's percent read counts the parts before the remembered one", () => {
    const book = { ...whole, readAt: null, toc: null };
    // Halfway through part 5 of 12: four whole parts and half of the fifth.
    const position = { docId: "b-1", segmentIndex: 4, blockIndex: 3, updatedAt: 1, percent: 50 };
    assert.equal(bookEntry(book, position).percentRead, Math.round((4.5 / 12) * 100));
  });

  it("progress reads the stored position, clamped to the book it has", () => {
    const book = { ...whole, readAt: null, toc: null };
    /** @param {import("../src/lib/reader/position.js").ReadingPosition} position */
    const at = (position) => bookEntry(book, position).progress;
    assert.deepEqual(at({ docId: "b-1", segmentIndex: 4, blockIndex: 0, updatedAt: 1 }), {
      at: 5,
      of: 12,
    });
    // A position past the end - the book was re-imported shorter - shows as
    // the last part rather than an impossible one.
    assert.deepEqual(at({ docId: "b-1", segmentIndex: 40, blockIndex: 0, updatedAt: 1 }), {
      at: 12,
      of: 12,
    });
  });

  it("a book without an author leads with nothing, not with a blank", () => {
    const entry = bookEntry({ ...whole, author: null, readAt: null, toc: null }, null);
    assert.equal(entry.hostname, "");
  });
});

describe("the cut's version on a book's row", () => {
  it("is written by bookRecord and read back by asBookMeta, only as a count", () => {
    assert.equal(bookRecord({ ...whole, cut: 2 })?.cut, 2);
    assert.equal(bookRecord(whole)?.cut, undefined);
    assert.equal(bookRecord({ ...whole, cut: 0 })?.cut, undefined);
    assert.equal(asBookMeta({ ...whole, cut: 2 })?.cut, 2);
    assert.equal(asBookMeta({ ...whole, cut: "2" })?.cut, undefined);
    assert.equal(asBookMeta(whole)?.cut, undefined);
  });
});
