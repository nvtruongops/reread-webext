import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markRecord } from "../src/lib/reader/marks.js";
import {
  MARKS_COPY_FILENAME,
  booksOf,
  fromMarksCopy,
  isMarksCopy,
  marksImportPlan,
  missingByKind,
  toMarksCopy,
} from "../src/lib/store/marks-copy.js";

/** @typedef {import("../src/lib/reader/marks.js").Mark} Mark */
/** @typedef {import("../src/lib/store/marks-copy.js").CopyDoc} CopyDoc */

/**
 * A mark over `text` in block `block` of segment `segment`, starting at
 * `offset` - the quote's length places the end.
 *
 * @param {string} text
 * @param {{ block?: number, offset?: number, segment?: number, note?: string, color?: string }} [where]
 * @returns {Mark}
 */
function mark(text, { block = 0, offset = 0, segment = 0, note, color = "yellow" } = {}) {
  const built = markRecord({
    segmentIndex: segment,
    start: { block, offset },
    end: { block, offset: offset + text.length },
    color,
    createdAt: 500,
    text,
    ...(note === undefined ? {} : { note }),
  });
  assert.ok(built !== null);
  return built;
}

/** @type {CopyDoc} */
const ARTICLE = {
  kind: "article",
  url: "https://example.com/long",
  title: "A long article",
  marks: [mark("first passage"), mark("second passage", { block: 2 })],
};

/** @type {CopyDoc} */
const BOOK = {
  kind: "book",
  title: "A Novel",
  author: "Somebody",
  marks: [mark("a line of the book", { segment: 3, block: 7, offset: 12, note: "why" })],
};

/**
 * @param {Partial<import("../src/lib/store/marks-copy.js").MarksLibrary>} [over]
 * @returns {import("../src/lib/store/marks-copy.js").MarksLibrary}
 */
function library(over = {}) {
  return { articles: [], books: [], marks: new Map(), ...over };
}

describe("the highlights backup file", () => {
  it("reads back what it wrote, marks and all", () => {
    const { documents, invalid } = fromMarksCopy(toMarksCopy([BOOK, ARTICLE]));
    assert.equal(invalid, 0);
    assert.deepEqual(documents, [ARTICLE, BOOK]);
  });

  it("writes the same list as the same file: articles first, then books, by name", () => {
    const other = { ...ARTICLE, url: "https://example.com/another", title: "Another" };
    const later = { ...BOOK, title: "Zebras", author: null };
    const docs = [later, BOOK, ARTICLE, other];
    const one = toMarksCopy(docs);
    assert.equal(one, toMarksCopy([...docs].reverse()));
    const order = [other.url, ARTICLE.url, BOOK.title, later.title].map((name) => one.indexOf(name));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it("says what it is, on the first line anybody reads", () => {
    const text = toMarksCopy([ARTICLE]);
    assert.ok(text.startsWith('{\n  "format": "reread-highlights",\n  "version": 1,'));
    assert.ok(isMarksCopy(text));
    assert.equal(MARKS_COPY_FILENAME, "reread-highlights.json");
  });

  it("leaves out a document that has no marks", () => {
    const text = toMarksCopy([{ ...ARTICLE, marks: [] }, BOOK]);
    assert.deepEqual(fromMarksCopy(text).documents, [BOOK]);
  });

  it("reads nothing from a file that is not ours", () => {
    for (const text of ["", "not json", "{}", '{"format":"reread-articles","articles":[]}', "[]"]) {
      assert.deepEqual(fromMarksCopy(text), { documents: [], invalid: 0 });
      assert.equal(isMarksCopy(text), false);
    }
  });

  it("counts an entry that is not a document, and drops a broken mark alone", () => {
    const text = JSON.stringify({
      format: "reread-highlights",
      version: 1,
      documents: [
        { kind: "article", url: "https://example.com/x", marks: [mark("kept"), { text: "no anchor" }] },
        { kind: "article", url: "", marks: [mark("nowhere")] },
        { kind: "book", author: "Nameless", marks: [mark("untitled")] },
        { kind: "book", title: "Empty", marks: [] },
        { kind: "poem", title: "Odd", marks: [mark("odd")] },
        "not an object",
      ],
    });
    const { documents, invalid } = fromMarksCopy(text);
    assert.equal(invalid, 5);
    assert.deepEqual(documents, [
      // An article without a title is named by its address, the copy's way.
      { kind: "article", url: "https://example.com/x", title: "https://example.com/x", marks: [mark("kept")] },
    ]);
  });

  it("reads an empty author as none, and caps a document's marks", () => {
    const many = Array.from({ length: 1001 }, (_, index) => mark("m", { block: index }));
    const text = JSON.stringify({
      format: "reread-highlights",
      version: 1,
      documents: [{ kind: "book", title: "Crowded", author: "", marks: many }],
    });
    const [doc] = fromMarksCopy(text).documents;
    assert.ok(doc !== undefined && doc.kind === "book");
    assert.equal(doc.author, null);
    assert.equal(doc.marks.length, 1000);
  });
});

describe("marksImportPlan", () => {
  it("adds a file's marks to the article at that address", () => {
    const plan = marksImportPlan(
      [ARTICLE],
      library({ articles: [{ url: ARTICLE.url, title: "Saved under another title" }] }),
    );
    assert.equal(plan.added, 2);
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(plan.targets, [
      { docId: ARTICLE.url, kind: "article", title: "Saved under another title", marks: ARTICLE.marks, added: 2 },
    ]);
  });

  it("finds a book by its title and author - every copy of it", () => {
    // The old book still standing beside the one imported again: both
    // receive the marks, so the order of "import again" and "delete the old
    // one" does not matter.
    const plan = marksImportPlan(
      [BOOK],
      library({
        books: [
          { id: "old", title: "A Novel", author: "Somebody" },
          { id: "new", title: "A Novel", author: "Somebody" },
          { id: "other", title: "A Novel", author: "Somebody Else" },
        ],
      }),
    );
    assert.deepEqual(
      plan.targets.map((target) => target.docId),
      ["old", "new"],
    );
    assert.equal(plan.added, 2);
  });

  it("matches an author exactly, and none against none", () => {
    const anonymous = { ...BOOK, author: null };
    const shelf = library({
      books: [
        { id: "signed", title: "A Novel", author: "Somebody" },
        { id: "unsigned", title: "A Novel", author: null },
        { id: "blank", title: "A Novel", author: "" },
      ],
    });
    assert.deepEqual(
      marksImportPlan([anonymous], shelf).targets.map((target) => target.docId),
      ["unsigned", "blank"],
    );
    assert.deepEqual(
      marksImportPlan([BOOK], shelf).targets.map((target) => target.docId),
      ["signed"],
    );
  });

  it("leaves a mark already standing out without a word - the same file twice adds nothing", () => {
    const shelf = library({
      books: [{ id: "b", title: BOOK.title, author: BOOK.author }],
      marks: new Map([["b", BOOK.marks]]),
    });
    const plan = marksImportPlan([BOOK], shelf);
    assert.deepEqual(plan.targets, []);
    assert.equal(plan.added, 0);
    assert.equal(plan.twins, 1);
    assert.equal(plan.overlapping, 0);
  });

  it("treats the same anchor over the same quote as the same mark, whatever its colour or note", () => {
    const recoloured = mark("a line of the book", { segment: 3, block: 7, offset: 12, color: "pink" });
    const shelf = library({
      books: [{ id: "b", title: BOOK.title, author: BOOK.author }],
      marks: new Map([["b", [recoloured]]]),
    });
    const plan = marksImportPlan([BOOK], shelf);
    assert.equal(plan.twins, 1);
    assert.deepEqual(plan.targets, []);
  });

  it("leaves a mark meeting a standing one out, and counts it", () => {
    // Merging would need the union's quote, read off a document the import
    // never opens; the pen merges them later in one stroke.
    const standing = mark("passage", { block: 0, offset: 6 });
    const shelf = library({
      articles: [{ url: ARTICLE.url, title: ARTICLE.title }],
      marks: new Map([[ARTICLE.url, [standing]]]),
    });
    const plan = marksImportPlan([ARTICLE], shelf);
    assert.equal(plan.overlapping, 1);
    assert.equal(plan.added, 1);
    assert.deepEqual(plan.targets[0]?.marks, [standing, mark("second passage", { block: 2 })]);
  });

  it("never changes or removes what stands: the row is what stood plus what is added, in reading order", () => {
    const own = mark("their own", { block: 5, note: "mine" });
    const shelf = library({
      articles: [{ url: ARTICLE.url, title: ARTICLE.title }],
      marks: new Map([[ARTICLE.url, [own]]]),
    });
    const [target] = marksImportPlan([ARTICLE], shelf).targets;
    assert.ok(target !== undefined);
    assert.deepEqual(target.marks, [mark("first passage"), mark("second passage", { block: 2 }), own]);
    assert.equal(target.added, 2);
  });

  it("names the documents the library does not hold", () => {
    const plan = marksImportPlan([ARTICLE, BOOK], library({ books: [{ id: "b", title: "Some Other Book", author: null }] }));
    assert.deepEqual(plan.targets, []);
    assert.deepEqual(plan.missing, [ARTICLE, BOOK]);
    assert.equal(plan.added, 0);
  });
});

describe("missingByKind", () => {
  it("tells the books the plan could not place apart from the articles, each in the file's order", () => {
    const second = { ...BOOK, title: "Another Novel" };
    const plan = marksImportPlan([BOOK, ARTICLE, second], library());
    const { books, articles } = missingByKind(plan.missing);
    assert.deepEqual(books.map((doc) => doc.title), ["A Novel", "Another Novel"]);
    assert.deepEqual(articles, [ARTICLE]);
  });

  it("answers two empty lists for a plan that placed everything", () => {
    const shelf = library({ books: [{ id: "b", title: BOOK.title, author: BOOK.author }] });
    assert.deepEqual(missingByKind(marksImportPlan([BOOK], shelf).missing), { books: [], articles: [] });
  });
});

describe("a book document addressed to one copy (D223)", () => {
  const shelf = [
    { id: "old", title: "A Novel", author: "Somebody" },
    { id: "new", title: "A Novel", author: "Somebody" },
    { id: "other", title: "A Novel", author: "Somebody Else" },
  ];

  it("booksOf names every copy by title and author, or the one copy the page addressed, and none for an article", () => {
    assert.deepEqual(booksOf(BOOK, shelf).map((book) => book.id), ["old", "new"]);
    assert.deepEqual(booksOf({ ...BOOK, docId: "new" }, shelf).map((book) => book.id), ["new"]);
    // An address the library does not hold names nothing: the plan then
    // counts the document as missing, as for a book that is not here.
    assert.deepEqual(booksOf({ ...BOOK, docId: "gone" }, shelf), []);
    assert.deepEqual(booksOf(ARTICLE, shelf), []);
    // The rows come back as they were given, whatever else each carries.
    const rows = [{ id: "old", title: "A Novel", author: "Somebody", segmentCount: 12 }];
    assert.equal(booksOf(BOOK, rows)[0]?.segmentCount, 12);
  });

  it("the plan lays an addressed document on that copy alone, and its twin on the other", () => {
    const moved = mark("a line of the book", { segment: 5, block: 1, offset: 0, note: "why" });
    const plan = marksImportPlan([{ ...BOOK, docId: "old" }, { ...BOOK, docId: "new", marks: [moved] }], library({ books: shelf }));
    assert.deepEqual(
      plan.targets.map((target) => target.docId),
      ["old", "new"],
    );
    assert.deepEqual(plan.targets[0]?.marks, BOOK.marks);
    assert.deepEqual(plan.targets[1]?.marks, [moved]);
    assert.equal(plan.added, 2);
  });

  it("the file never carries the address: a document written and read back has none", () => {
    const text = toMarksCopy([{ ...BOOK, docId: "old" }]);
    assert.equal(text.includes("docId"), false);
    const read = fromMarksCopy(text);
    assert.equal(read.documents.length, 1);
    assert.equal("docId" in (read.documents[0] ?? {}), false);
  });
});
