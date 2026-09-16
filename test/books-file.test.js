import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bookPictureEntryName } from "../src/lib/store/articles-archive.js";
import { bookRecord } from "../src/lib/store/book.js";
import {
  BOOKS_ENTRY,
  bookPictureRows,
  bookTextEntryName,
  booksAccount,
  booksImportPlan,
  fromBookText,
  fromBooksIndex,
  toBookText,
  toBooksIndex,
} from "../src/lib/store/books-file.js";

/**
 * The books in the backup of everything (D218): the index and one book's
 * text as values, the rules that put a book back, and the account the
 * export's box shows. The ZIP is the reader page's.
 */

/**
 * @param {string} id
 * @param {Partial<Parameters<typeof bookRecord>[0]>} [over]
 * @returns {import("../src/lib/store/book.js").BookMeta}
 */
function book(id, over = {}) {
  const row = bookRecord({
    id,
    title: `Book ${id}`,
    author: "Somebody",
    lang: "en",
    segmentCount: 2,
    totalChars: 30000,
    addedAt: 1000,
    cut: 2,
    ...over,
  });
  assert.ok(row !== null);
  return row;
}

/** @type {import("../src/lib/store/book.js").StoredSegment[]} */
const SEGMENTS = [
  { blocks: ["<h1>One</h1>", "<p>First part.</p>"], charCount: 15, pictures: [0, 3] },
  { blocks: ["<p>Second part.</p>"], charCount: 12 },
];

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3]);

/** @type {import("../src/lib/store/articles-archive.js").PictureRef} */
const REF_0 = { index: 0, file: "pictures/book/0/0.jpg", src: "OEBPS/images/a.jpg", mime: "image/jpeg", width: 40, height: 60 };
/** @type {import("../src/lib/store/articles-archive.js").PictureRef} */
const REF_3 = { index: 3, file: "pictures/book/0/3.jpg", src: "OEBPS/images/d.jpg", mime: "image/jpeg", width: 80, height: 60 };

describe("the books' index", () => {
  it("is named for the offer to find, and names a book's text and pictures by its place", () => {
    assert.equal(BOOKS_ENTRY, "books.json");
    assert.equal(bookTextEntryName("b-1"), "books/b-1.json");
    assert.equal(bookPictureEntryName(2, { index: 3, mime: "image/png" }), "pictures/book/2/3.png");
  });

  it("writes every row with its text entry, its position and its pictures, and reads them back", () => {
    const pictured = book("b-1", { pictures: { count: 2, bytes: 2000 } });
    const text = toBooksIndex([
      {
        meta: pictured,
        position: { docId: "b-1", segmentIndex: 1, blockIndex: 4, updatedAt: 99, percent: 50 },
        pictures: [REF_3, REF_0],
      },
      { meta: book("b-2"), pictures: [] },
    ]);
    const { books, invalid } = fromBooksIndex(text);
    assert.equal(invalid, 0);
    // The row comes back without its account of the pictures: the file
    // names the picture entries under that field, and the import writes
    // the account from the rows it actually wrote.
    const { pictures: account, ...bare } = pictured;
    assert.deepEqual(account, { count: 2, bytes: 2000 });
    assert.deepEqual(books.map((one) => one.meta), [bare, book("b-2")]);
    assert.deepEqual(books[0]?.position, { docId: "b-1", segmentIndex: 1, blockIndex: 4, updatedAt: 99, percent: 50 });
    assert.deepEqual(books[0]?.pictures, [REF_0, REF_3]);
    assert.equal(books[0]?.text, "books/b-1.json");
    assert.equal(books[1]?.position, undefined);
    assert.equal(books[1]?.pictures, undefined);
  });

  it("keeps the cut's version with the row", () => {
    const [row] = fromBooksIndex(toBooksIndex([{ meta: book("b-1", { cut: 2 }), pictures: [] }])).books;
    assert.equal(row?.meta.cut, 2);
  });

  it("holds no book for a text that is not the index, counts a broken entry, and takes an id once", () => {
    assert.deepEqual(fromBooksIndex("not json"), { books: [], invalid: 0 });
    assert.deepEqual(fromBooksIndex('{"format":"reread-highlights","books":[]}'), { books: [], invalid: 0 });
    const text = JSON.stringify({
      format: "reread-books",
      version: 1,
      books: [
        { ...book("b-1"), text: "books/b-1.json" },
        { ...book("b-1"), text: "books/b-1.json", title: "Twin" },
        { ...book("b-2"), text: "elsewhere/b-2.json" },
        { ...book("bad/id"), text: "books/bad.json" },
        { title: "no row" },
      ],
    });
    const { books, invalid } = fromBooksIndex(text);
    assert.deepEqual(books.map((one) => one.meta.title), ["Book b-1"]);
    assert.equal(invalid, 3);
  });

  it("leaves a reference that will not read out of the book without costing the book", () => {
    const text = JSON.stringify({
      format: "reread-books",
      version: 1,
      books: [{ ...book("b-1"), text: "books/b-1.json", pictures: [REF_0, { index: 1, file: "pictures/0/1.exe" }] }],
    });
    assert.deepEqual(fromBooksIndex(text).books[0]?.pictures, [REF_0]);
  });
});

describe("a book's text in the backup", () => {
  it("writes the segments as the store holds them and reads them back for the book they belong to", () => {
    const text = toBookText("b-1", SEGMENTS);
    assert.deepEqual(fromBookText(text, "b-1"), SEGMENTS);
    assert.equal(fromBookText(text, "b-2"), null, "another book's text was taken");
  });

  it("refuses a text with a hole in it, whole", () => {
    const torn = JSON.stringify({ format: "reread-book", version: 1, id: "b-1", segments: [SEGMENTS[0], { blocks: [] }] });
    assert.equal(fromBookText(torn, "b-1"), null);
    assert.equal(fromBookText('{"format":"reread-book","id":"b-1","segments":[]}', "b-1"), null);
    assert.equal(fromBookText("nope", "b-1"), null);
  });
});

describe("booksImportPlan", () => {
  const filed = fromBooksIndex(
    toBooksIndex([
      { meta: book("b-1"), pictures: [] },
      { meta: book("b-2", { title: "Dracula", author: "Bram Stoker" }), pictures: [] },
      { meta: book("b-3", { title: "Nameless", author: null }), pictures: [] },
    ]),
  ).books;

  it("adds what the library does not hold, by id or by name", () => {
    const plan = booksImportPlan(filed, { books: [] });
    assert.deepEqual(plan.toAdd.map((one) => one.meta.id), ["b-1", "b-2", "b-3"]);
    assert.equal(plan.skipped, 0);
  });

  it("leaves a book already here alone - the same id, or the same title and author under another id", () => {
    const plan = booksImportPlan(filed, {
      books: [
        { id: "b-1", title: "Renamed since", author: "Somebody" },
        { id: "other-id", title: "Dracula", author: "Bram Stoker" },
        { id: "x", title: "Nameless", author: "Somebody" },
      ],
    });
    assert.deepEqual(plan.toAdd.map((one) => one.meta.id), ["b-3"]);
    assert.equal(plan.skipped, 2);
  });
});

describe("booksAccount", () => {
  it("counts the books and what they take - their text and their pictures - off the light rows", () => {
    const account = booksAccount([
      book("b-1", { totalChars: 600000, pictures: { count: 40, bytes: 6000000 } }),
      book("b-2", { totalChars: 250000 }),
    ]);
    assert.deepEqual(account, { count: 2, bytes: 6850000 });
    assert.deepEqual(booksAccount([]), { count: 0, bytes: 0 });
  });
});

describe("bookPictureRows", () => {
  it("keeps the index the reference names, because the segments ask by it", () => {
    const rows = bookPictureRows("b-1", [REF_3, REF_0], (name) => (name.endsWith(".jpg") ? JPEG : null));
    assert.deepEqual(
      rows.map((row) => [row.url, row.index, row.src, row.mime]),
      [
        ["b-1", 0, "OEBPS/images/a.jpg", "image/jpeg"],
        ["b-1", 3, "OEBPS/images/d.jpg", "image/jpeg"],
      ],
    );
    assert.deepEqual(Array.from(new Uint8Array(rows[0]?.data ?? new ArrayBuffer(0))), Array.from(JPEG));
  });

  it("leaves out an entry that is missing, empty, or not a picture by its bytes, and takes an index once", () => {
    const rows = bookPictureRows(
      "b-1",
      [
        REF_0,
        { ...REF_0, src: "twin" },
        { ...REF_3, file: "pictures/book/0/3.png" },
        { ...REF_3, index: 5, file: "pictures/book/0/5.jpg" },
      ],
      (name) => {
        if (name === "pictures/book/0/3.png") return new TextEncoder().encode("<html>not a picture</html>");
        if (name === "pictures/book/0/5.jpg") return null;
        return JPEG;
      },
    );
    assert.deepEqual(rows.map((row) => [row.index, row.src]), [[0, "OEBPS/images/a.jpg"]]);
  });
});
