import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARKS_PAGE_SIZE,
  markRows,
  marksListView,
  searchableMark,
} from "../src/reader/marks-list.js";

/** @typedef {import("../src/lib/reader/marks.js").Mark} Mark */

/**
 * @param {string} text
 * @param {Partial<Mark>} [rest]
 * @returns {Mark}
 */
function mark(text, rest = {}) {
  return {
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: text.length },
    color: "yellow",
    createdAt: 10,
    text,
    ...rest,
  };
}

/**
 * @param {number} at
 * @param {Partial<import("../src/lib/store/saved-article.js").SavedMeta>} [rest]
 */
function meta(at, rest = {}) {
  return {
    url: `https://example.org/article/${at}`,
    hostname: "example.org",
    title: `Article ${at}`,
    savedAt: at,
    readAt: null,
    ...rest,
  };
}

/**
 * @param {string} id
 * @param {Partial<import("../src/lib/store/book.js").BookMeta>} [rest]
 * @returns {import("../src/lib/store/book.js").BookMeta}
 */
function book(id, rest = {}) {
  return {
    id,
    title: `Book ${id}`,
    author: null,
    lang: null,
    segmentCount: 12,
    totalChars: 1000,
    addedAt: 5,
    readAt: null,
    toc: null,
    ...rest,
  };
}

describe("markRows", () => {
  it("orders documents by their newest mark and keeps each document's reading order", () => {
    const metas = [meta(1), meta(2)];
    const marks = new Map([
      // Document 1 was marked long ago and once more just now; its quotes
      // still read top to bottom, never newest-first.
      [
        meta(1).url,
        [mark("first passage", { createdAt: 100 }), mark("second passage", { createdAt: 20 })],
      ],
      [meta(2).url, [mark("elsewhere", { createdAt: 50 })]],
    ]);

    const rows = markRows(metas, [], marks);
    assert.deepEqual(
      rows.map((row) => row.mark.text),
      ["first passage", "second passage", "elsewhere"],
    );
  });

  it("names a quote whose document is gone after the copy, and drops one nobody remembers", () => {
    const marks = new Map([
      [meta(1).url, [mark("still here")]],
      ["https://example.org/gone", [mark("from the copy", { note: "mine" })]],
      ["book-gone", [mark("a book's")]],
      ["https://example.org/forgotten", [mark("mid-delete")]],
    ]);
    /** @type {Map<string, import("../src/lib/store/marks-backup.js").DocTitle>} */
    const kept = new Map([
      ["https://example.org/gone", { kind: "article", title: "Gone article" }],
      ["book-gone", { kind: "book", title: "Gone book" }],
    ]);

    const rows = markRows([meta(1)], [], marks, kept);
    assert.deepEqual(
      rows.map((row) => [row.mark.text, row.title, row.kind, row.missing, row.part]),
      [
        ["still here", "Article 1", "article", false, null],
        ["from the copy", "Gone article", "article", true, null],
        ["a book's", "Gone book", "book", true, null],
      ],
      "the remembered ones stand under their copied titles, the unremembered one is left out",
    );
    assert.equal(markRows([meta(1)], [], marks).length, 1, "without the copy, only the living document's quote shows");
  });

  it("sinks documents whose clocks were healed to zero, held steady by title", () => {
    const metas = [meta(1, { title: "B" }), meta(2, { title: "A" }), meta(3, { title: "C" })];
    const marks = new Map([
      [meta(1).url, [mark("b", { createdAt: 0 })]],
      [meta(2).url, [mark("a", { createdAt: 0 })]],
      [meta(3).url, [mark("c", { createdAt: 7 })]],
    ]);

    const rows = markRows(metas, [], marks);
    assert.deepEqual(
      rows.map((row) => row.title),
      ["C", "A", "B"],
    );
  });

  it("dresses a book's quote in its part, and only when the book has parts", () => {
    const many = book("book:many", { segmentCount: 12, lang: "de" });
    const single = book("book:one", { segmentCount: 1 });
    const marks = new Map([
      [many.id, [mark("deep in", { segmentIndex: 2, createdAt: 30 })]],
      [single.id, [mark("alone", { createdAt: 20 })]],
    ]);

    const rows = markRows([], [many, single], marks);
    assert.deepEqual(rows[0]?.part, { at: 3, of: 12 });
    assert.equal(rows[0]?.kind, "book");
    // The language rides along for the row's speaker - a book declares one,
    // an article's meta does not (see the null in the orphan test's rows).
    assert.equal(rows[0]?.lang, "de");
    assert.equal(rows[1]?.part, null);
  });

  it("counts a document's quotes on every one of its rows (D150)", () => {
    // The number a document-wide deletion names: every quote of the
    // document, whichever page or filter the row is seen through.
    const marks = new Map([
      [meta(1).url, [mark("one of two", { createdAt: 3 }), mark("two of two", { createdAt: 4 })]],
      ["https://example.org/gone", [mark("alone", { createdAt: 1 })]],
    ]);
    /** @type {Map<string, import("../src/lib/store/marks-backup.js").DocTitle>} */
    const kept = new Map([["https://example.org/gone", { kind: "article", title: "Gone" }]]);

    const rows = markRows([meta(1)], [], marks, kept);
    assert.deepEqual(
      rows.map((row) => [row.mark.text, row.count]),
      [
        ["one of two", 2],
        ["two of two", 2],
        ["alone", 1],
      ],
    );
  });

  it("leaves out marks whose document neither list answers for", () => {
    // Marks live and die with their document; a row without one is two
    // reads catching the database mid-delete, not a quote anybody can open.
    const marks = new Map([
      [meta(1).url, [mark("kept")]],
      ["https://example.org/gone", [mark("orphan")]],
    ]);

    const rows = markRows([meta(1)], [], marks);
    assert.deepEqual(
      rows.map((row) => row.mark.text),
      ["kept"],
    );
  });
});

describe("searchableMark", () => {
  it("finds a quote by its own words and by its document's title", () => {
    const [row] = markRows(
      [meta(1, { title: "Old Chinese" })],
      [],
      new Map([[meta(1).url, [mark("a Tocharian loanword")]]]),
    );
    assert.ok(row !== undefined);
    const searchable = searchableMark(row);
    for (const word of ["tocharian", "loanword", "chinese"]) {
      assert.ok(searchable.includes(word), `misses ${word}`);
    }
  });

  it("finds a quote by the reader's own note (D118)", () => {
    // Half of why the note exists: the comment is often the memorable part.
    const [row] = markRows(
      [meta(1)],
      [],
      new Map([[meta(1).url, [mark("plain quote", { note: "compare with Baxter" })]]]),
    );
    assert.ok(row !== undefined);
    assert.ok(searchableMark(row).includes("baxter"));
  });
});

describe("marksListView", () => {
  const rows = markRows(
    [meta(1, { title: "Old Chinese" }), meta(2, { title: "Weather" })],
    [],
    new Map([
      [
        meta(1).url,
        [mark("rime tables", { createdAt: 90 }), mark("oracle bones", { createdAt: 80 })],
      ],
      [meta(2).url, [mark("cold rain", { createdAt: 50 })]],
    ]),
  );

  it("cuts to one document when a scope is asked for, counting the scope as the whole", () => {
    const view = marksListView(rows, { scope: meta(2).url, query: "", page: 1 });
    assert.deepEqual(
      view.rows.map((row) => row.mark.text),
      ["cold rain"],
    );
    assert.deepEqual([view.matching, view.total], [1, 1]);
  });

  it("filters by quote and title, and tells matching from total", () => {
    const view = marksListView(rows, { scope: null, query: "oracle", page: 1 });
    assert.deepEqual(
      view.rows.map((row) => row.mark.text),
      ["oracle bones"],
    );
    assert.deepEqual([view.matching, view.total], [1, 3]);

    const byTitle = marksListView(rows, { scope: null, query: "chinese", page: 1 });
    assert.equal(byTitle.matching, 2);
  });

  it("cuts a long list into pages and clamps a page the list moved from under", () => {
    const many = markRows(
      [meta(1)],
      [],
      new Map([
        [
          meta(1).url,
          Array.from({ length: 60 }, (_, at) =>
            mark(`quote ${at}`, { start: { block: at, offset: 0 }, end: { block: at, offset: 5 } }),
          ),
        ],
      ]),
    );

    const first = marksListView(many, { scope: null, query: "", page: 1 });
    assert.equal(first.rows.length, MARKS_PAGE_SIZE);
    assert.deepEqual([first.page, first.pages], [1, 3]);

    const past = marksListView(many, { scope: null, query: "", page: 9 });
    assert.equal(past.page, 3);
    assert.equal(past.rows.length, 60 - 2 * MARKS_PAGE_SIZE);

    const under = marksListView(many, { scope: null, query: "", page: 0 });
    assert.equal(under.page, 1);
  });
});
