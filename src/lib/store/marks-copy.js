/**
 * The file the highlights travel in and back - `reread-highlights.json`
 * (D168): every document's marks with their notes, and the one thing each
 * document is found by again. Beside it stands the `.md` (`marks-file.js`),
 * the same quotes for reading; the shared stem says the two are one list in
 * two dresses, and the page that writes them says which dress does what.
 *
 * Why a file of its own beside the reading list's `.json`: that file carries
 * no book (D99 - size), so a book's highlights had one way out and none
 * back, and deleting a book - which importing it again asks for, as the
 * footnotes of D159 do - took its highlights with it for good (Michał's
 * report, 2026-09-01). The highlights page is where the quotes stand, and
 * where somebody who reads books alone looks for them.
 *
 * A book has no identity that outlives its own import - its id is minted
 * then (`import-book.js`) - so the file names it the way its package does:
 * title and author, both read from the same `.epub` every time it is
 * imported, so the same file makes the same names. Exact equality, no
 * folding: the same file gives the same strings, and folding would invite
 * another book of the same name. An article is its address, the database's
 * own key.
 *
 * Import adds and never overwrites or removes - the reading list's promise,
 * carried down to the single mark (`marksImportPlan`): a mark already
 * standing stays as it is, a mark meeting one is left out (merging them
 * would need the union's quote read off a document this import never
 * opens), and every other mark is added. Running the same file again adds
 * nothing.
 *
 * A book's marks reach the plan laid against the book's own text (D223,
 * the reader page): the file's anchors count on the cut the book had
 * where the file was written, and a book imported again from its .epub
 * may be cut otherwise - so the page reads the book back from the
 * database, part by part, and sets every mark where its words stand,
 * then addresses the document to that one copy (`docId`). The plan then
 * lays the marks as it always has: what stands here stays, what meets a
 * standing mark is left out.
 *
 * Everything here is a value in and a value out; the database lives in
 * `marks.js`, and the reader page dresses the map it returns in titles.
 */

import { asMark, compareMarks, mergePlan } from "../reader/marks.js";

/** @typedef {import("../reader/marks.js").Mark} Mark */

/**
 * One document as the file carries it: its kind, what it is found by again,
 * and its marks in reading order. A book's `docId` is never in the file:
 * the reader page sets it (D223) once it has laid the document's marks
 * against one copy of the book in the library - the document then names
 * that copy and no other, so two copies cut differently each get the marks
 * laid against their own text.
 *
 * @typedef {{ kind: "article", url: string, title: string, marks: Mark[] }
 *   | { kind: "book", title: string, author: string | null, marks: Mark[], docId?: string }} CopyDoc
 */

/** What the file says it is, and the first thing reading one checks. */
const FORMAT = "reread-highlights";

/**
 * Written for whoever reads this file after the format grows. Reading
 * ignores it today: whether an entry is a document is decided entry by
 * entry, so a newer file yields what this version can read and counts the rest.
 */
const VERSION = 1;

/**
 * The most marks one document brings in - the ceiling the article file and
 * the copy in `storage.local` share: far above any honest reading, low
 * enough that a hand-made file cannot plant a megabyte row behind one name.
 */
const MAX_MARKS_PER_DOC = 1000;

/**
 * What the exported file is called: the `.md`'s own stem, so the two files
 * of one list stand together in a folder. No date, for the reason the other
 * files have none: the highlights are one list, and a browser numbers a
 * second download by itself.
 */
export const MARKS_COPY_FILENAME = "reread-highlights.json";

/**
 * @param {unknown} value
 * @returns {string | null} an author as the file and the library both spell
 *   "none": a name, or null - an empty string is no author either
 */
function authorOf(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The file's order - articles before books, articles by address, books by
 * title and then author - so the same list writes the same file.
 *
 * @param {CopyDoc} a
 * @param {CopyDoc} b
 * @returns {number}
 */
function compareDocs(a, b) {
  if (a.kind === "article" && b.kind === "article") return a.url.localeCompare(b.url);
  if (a.kind === "book" && b.kind === "book") {
    return a.title.localeCompare(b.title) || (a.author ?? "").localeCompare(b.author ?? "");
  }
  return a.kind === "article" ? -1 : 1;
}

/**
 * The whole file, as one string. A document without marks is not written -
 * the file lists highlights, and a title over nothing would be a row about
 * nothing. Indented, because the point of the file is that somebody can open
 * it and see their reading.
 *
 * @param {CopyDoc[]} docs
 * @returns {string}
 */
export function toMarksCopy(docs) {
  const rows = docs
    .filter((doc) => doc.marks.length > 0)
    .sort(compareDocs)
    .map((doc) => {
      const marks = [...doc.marks].sort(compareMarks);
      return doc.kind === "article"
        ? { kind: doc.kind, url: doc.url, title: doc.title, marks }
        : { kind: doc.kind, title: doc.title, author: doc.author, marks };
    });
  return JSON.stringify({ format: FORMAT, version: VERSION, documents: rows }, null, 2) + "\n";
}

/**
 * @param {string} text
 * @returns {Record<string, unknown> | null} the file's object, or nothing for
 *   text that is not JSON or not an object
 */
function parsed(text) {
  try {
    const value = /** @type {unknown} */ (JSON.parse(text));
    return typeof value === "object" && value !== null
      ? /** @type {Record<string, unknown>} */ (value)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a text is this file at all - the reading list's Import asks, so a
 * highlights file handed to it is named for what it is and sent to the page
 * that reads it, rather than reported as a backup with no articles.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isMarksCopy(text) {
  return parsed(text)?.["format"] === FORMAT;
}

/**
 * One entry as a document, or null. The marks narrow one by one through
 * `asMark` - the entry is not refused over a broken mark, the lean every
 * file of this extension reads by - capped and put in reading order however
 * the file held them; an entry left with no mark is no document of this
 * file. What a document is found by must be there: an article's address, a
 * book's title. A title an article lacks reads as its address, the way the
 * copy in `storage.local` names a row it has no title for.
 *
 * @param {unknown} value
 * @returns {CopyDoc | null}
 */
function asCopyDoc(value) {
  if (typeof value !== "object" || value === null) return null;
  const { kind, url, title, author, marks } = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(marks)) return null;
  const kept = marks
    .slice(0, MAX_MARKS_PER_DOC)
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
  if (kept.length === 0) return null;

  if (kind === "article") {
    if (typeof url !== "string" || url.length === 0) return null;
    const named = typeof title === "string" && title.length > 0 ? title : url;
    return { kind, url, title: named, marks: kept };
  }
  if (kind === "book") {
    if (typeof title !== "string" || title.length === 0) return null;
    return { kind, title, author: authorOf(author), marks: kept };
  }
  return null;
}

/**
 * Reads what `toMarksCopy` writes. A file that is not ours at all - not
 * JSON, no marker - holds zero documents rather than throwing: the page
 * turns that into one sentence. A broken entry between good ones is counted
 * and dropped, the rule of every file here: one bad entry must not cost the
 * file, and a count the reader can see beats a silent shrug.
 *
 * @param {string} text
 * @returns {{ documents: CopyDoc[], invalid: number }}
 */
export function fromMarksCopy(text) {
  const file = parsed(text);
  const documents = file?.["documents"];
  if (file?.["format"] !== FORMAT || !Array.isArray(documents)) return { documents: [], invalid: 0 };

  /** @type {CopyDoc[]} */
  const kept = [];
  let invalid = 0;
  for (const entry of documents) {
    const doc = asCopyDoc(entry);
    if (doc === null) invalid += 1;
    else kept.push(doc);
  }
  return { documents: kept, invalid };
}

/**
 * The library as the plan needs to see it: the two lists a document is
 * found in, and every marks row keyed as the rows are (`marks.js`).
 *
 * @typedef {object} MarksLibrary
 * @property {{ url: string, title: string }[]} articles
 * @property {{ id: string, title: string, author: string | null }[]} books
 * @property {Map<string, Mark[]>} marks keyed by `docId`
 */

/**
 * One document of the library that receives marks: the row as it will stand
 * once written - what stood there plus what is added - and how many of them
 * are new.
 *
 * @typedef {{ docId: string, kind: "article" | "book", title: string, marks: Mark[], added: number }} MarksImportTarget
 */

/**
 * @typedef {object} MarksImportPlan
 * @property {MarksImportTarget[]} targets the documents that receive at least one mark
 * @property {number} added marks that will be written, across the targets
 * @property {number} twins marks left out because the same mark already stands
 * @property {number} overlapping marks left out because they meet a standing mark
 * @property {CopyDoc[]} missing the file's documents the library does not hold
 */

/**
 * The same mark twice: the same anchor over the same quote. Colour and note
 * do not enter - the mark standing here is the reader's latest word on both,
 * and an import never overwrites.
 *
 * @param {Mark} a
 * @param {Mark} b
 * @returns {boolean}
 */
function sameMark(a, b) {
  return (
    a.segmentIndex === b.segmentIndex &&
    a.start.block === b.start.block &&
    a.start.offset === b.start.offset &&
    a.end.block === b.end.block &&
    a.end.offset === b.end.offset &&
    a.text === b.text
  );
}

/**
 * The copies of a file's book in the library: by title and author, every
 * one of them - two copies of the same book standing side by side both
 * receive the marks (the one that has them already leaves the twins out),
 * which is what makes "import the book again first, delete the old one
 * later" work in either order - or, for a document the page addressed
 * (D223), the one copy it names. An article has none. The rows come back
 * as they were given, whatever else each carries.
 *
 * @template {{ id: string, title: string, author: string | null }} B
 * @param {CopyDoc} doc
 * @param {B[]} books
 * @returns {B[]}
 */
export function booksOf(doc, books) {
  if (doc.kind !== "book") return [];
  if (doc.docId !== undefined) return books.filter((book) => book.id === doc.docId);
  return books.filter((book) => book.title === doc.title && authorOf(book.author) === doc.author);
}

/**
 * Which documents of the library a file's document is - an article by its
 * address, a book by `booksOf`.
 *
 * @param {CopyDoc} doc
 * @param {MarksLibrary} library
 * @returns {{ docId: string, kind: "article" | "book", title: string }[]}
 */
function targetsOf(doc, library) {
  if (doc.kind === "article") {
    return library.articles
      .filter((article) => article.url === doc.url)
      .map((article) => ({ docId: article.url, kind: "article", title: article.title }));
  }
  return booksOf(doc, library.books).map((book) => ({ docId: book.id, kind: "book", title: book.title }));
}

/**
 * What importing a file would write, decided before anything is - so the
 * offer can say where every mark lands, and the press writes exactly that.
 * Pure so that `node --test` can hold the promise down: nothing standing
 * is changed or removed, a mark already here is left out without a word
 * (the same file twice adds nothing), a mark meeting a standing one is left
 * out and counted, and a document the library does not hold is named so the
 * reader can import it first.
 *
 * @param {CopyDoc[]} documents
 * @param {MarksLibrary} library
 * @returns {MarksImportPlan}
 */
export function marksImportPlan(documents, library) {
  /** @type {Map<string, MarksImportTarget>} */
  const rows = new Map();
  /** @type {CopyDoc[]} */
  const missing = [];
  let added = 0;
  let twins = 0;
  let overlapping = 0;

  for (const doc of documents) {
    const targets = targetsOf(doc, library);
    if (targets.length === 0) {
      missing.push(doc);
      continue;
    }
    for (const target of targets) {
      let row = rows.get(target.docId);
      if (row === undefined) {
        row = { ...target, marks: [...(library.marks.get(target.docId) ?? [])], added: 0 };
        rows.set(target.docId, row);
      }
      for (const mark of doc.marks) {
        if (row.marks.some((standing) => sameMark(standing, mark))) {
          twins += 1;
          continue;
        }
        if (mergePlan(row.marks, mark).absorbed.length > 0) {
          overlapping += 1;
          continue;
        }
        row.marks = [...row.marks, mark].sort(compareMarks);
        row.added += 1;
        added += 1;
      }
    }
  }

  return {
    targets: [...rows.values()].filter((row) => row.added > 0),
    added,
    twins,
    overlapping,
    missing,
  };
}

/**
 * The documents a plan could not place, told apart by what brings each
 * back: a book returns from its .epub file, an article from the reading
 * list's backup - and the report says the two differently, because a
 * book's highlights are kept nowhere until the book is here, so the file
 * has to come round again after it.
 *
 * @param {CopyDoc[]} missing
 * @returns {{ books: CopyDoc[], articles: CopyDoc[] }} each in the file's order
 */
export function missingByKind(missing) {
  return {
    books: missing.filter((doc) => doc.kind === "book"),
    articles: missing.filter((doc) => doc.kind === "article"),
  };
}
