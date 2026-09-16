/**
 * The books in the backup of everything (D218): what a book is in the
 * archive, and the rules that put it back. Three kinds of entry, for the
 * reason the reading list keeps a book's row apart from its text:
 *
 *   - `books.json` - the index: every book's row as the list holds it
 *     (`BookMeta`, its id included), where the reader stopped in it, the
 *     pictures it has as references to their entries, and the name of the
 *     entry its text is in. Light, so the offer can say what the file
 *     holds - and the import which of it is new - without parsing one
 *     book's text.
 *   - `books/<id>.json` - one book's text: its segments exactly as the
 *     database holds them, blocks of our own rebuilt markup with the
 *     weight and the pictures each part shows. Read only when the book is
 *     being written, one at a time.
 *   - `pictures/book/<n>/<index>.<ext>` - the pictures, stored as they are,
 *     under the book's place in the index and the picture's own index -
 *     the index the segments name a picture by, which is why an import
 *     keeps it (an article's pictures are numbered afresh,
 *     `archivePictures`; a book's are not).
 *
 * Identity: a book's id is minted at import (`import-book.js`) and comes
 * back from the file as it is; between the two roads a book can take into
 * the list - its `.epub` and this file - the identity is its title and
 * author, the highlights' rule (D168). The import adds and never
 * overwrites: a book already here, by id or by name, keeps everything it
 * has, its reading position included.
 *
 * The cut: the segments come back as they were, never cut again, so every
 * anchor in the book - the reading position, the highlights - lands where
 * it was made; the row carries the version of the cut it was made with
 * (`BookMeta.cut`, `BOOK_CUT_VERSION`).
 *
 * Everything here is a value in and a value out; the ZIP is the reader
 * page's (`src/reader/zip.js`), the database is `books.js`.
 */

import { MAX_DOWNLOAD_BYTES, isStoredPictureType, sniffPictureType } from "../reader/pictures.js";
import { asPosition } from "../reader/position.js";
import { SNIFF_BYTES, asPictureRef } from "./articles-archive.js";
import { asBookMeta, asSegment } from "./book.js";

/**
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("./book.js").StoredSegment} StoredSegment
 * @typedef {import("../reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {import("./articles-archive.js").PictureRef} PictureRef
 */

/** The index of the books in the archive - what makes a backup carry books at all. */
export const BOOKS_ENTRY = "books.json";

/** What the index says it is, and what a book's text says it is. */
const INDEX_FORMAT = "reread-books";
const TEXT_FORMAT = "reread-book";

/**
 * Written for whoever reads these entries after they grow. Reading ignores
 * it: a book is decided entry by entry.
 */
const VERSION = 1;

/**
 * An id fit for an entry's name: what `crypto.randomUUID()` mints, and
 * nothing that could name a path. A file naming a book otherwise names
 * no book.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The most a book's text entry may be before it is inflated. A novel's
 * segments run to a megabyte or two of markup; a hand-made archive must
 * not plant a text that is inflated whole into a tablet's memory.
 */
export const MAX_BOOK_TEXT_BYTES = 32 * 1024 * 1024;

/** The one shape a text entry's name may have - only what this module writes. */
const TEXT_ENTRY = /^books\/[A-Za-z0-9_-]{1,64}\.json$/;

/**
 * Where a book's text is written: under `books/`, by its id.
 *
 * @param {string} id
 * @returns {string}
 */
export function bookTextEntryName(id) {
  return `books/${id}.json`;
}

/**
 * One book as the index carries it: its row (without its account of the
 * pictures - the import writes that from the rows it wrote), the entry
 * its text is in, where the reader stopped (with the book's own id, as the
 * store keys it) and the references to its pictures - the last two only
 * where there are any.
 *
 * @typedef {{
 *   meta: BookMeta,
 *   text: string,
 *   position?: ReadingPosition,
 *   pictures?: PictureRef[],
 * }} FileBook
 */

/**
 * A position as the index writes it: without the id, which the row beside
 * it carries - the article file's own shape (`articles-file.js`).
 *
 * @param {ReadingPosition} position
 */
function filePosition({ segmentIndex, blockIndex, updatedAt, percent }) {
  return { segmentIndex, blockIndex, updatedAt, ...(percent === undefined ? {} : { percent }) };
}

/**
 * The index, as one string. Indented like every file here, because the
 * point of the files is that somebody can open them and see their
 * reading.
 *
 * @param {{ meta: BookMeta, position?: ReadingPosition, pictures: PictureRef[] }[]} rows
 * @returns {string}
 */
export function toBooksIndex(rows) {
  const books = rows.map(({ meta, position, pictures }) => {
    // The row goes without its account of the pictures: in the file the
    // field names the picture entries, as it does on an article's row, and
    // the import writes the account afresh from the rows it actually
    // wrote - a reference that would not read must not stand in a count.
    const { pictures: summary, ...row } = meta;
    void summary;
    return {
      ...row,
      text: bookTextEntryName(meta.id),
      ...(position === undefined ? {} : { position: filePosition(position) }),
      ...(pictures.length === 0 ? {} : { pictures }),
    };
  });
  return JSON.stringify({ format: INDEX_FORMAT, version: VERSION, books }, null, 2) + "\n";
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
 * One entry of the index as a book, or null: the row narrowed as a row
 * from the database is (`asBookMeta` - the lean is toward keeping it), an
 * id fit for an entry's name, the text entry named the way this module
 * names it, the position narrowed under the book's id, the references
 * one by one - a reference that will not read names no picture, and is
 * left out without costing the book.
 *
 * @param {unknown} value
 * @returns {FileBook | null}
 */
function asFileBook(value) {
  if (typeof value !== "object" || value === null) return null;
  const meta = asBookMeta(value);
  if (meta === null || !ID.test(meta.id)) return null;
  const { text, position, pictures } = /** @type {Record<string, unknown>} */ (value);
  if (typeof text !== "string" || !TEXT_ENTRY.test(text)) return null;
  const where =
    typeof position === "object" && position !== null
      ? asPosition({ .../** @type {Record<string, unknown>} */ (position), docId: meta.id })
      : null;
  const refs = Array.isArray(pictures)
    ? pictures
        .map(asPictureRef)
        .filter((ref) => ref !== null)
        .sort((a, b) => a.index - b.index)
    : [];
  return {
    meta,
    text,
    ...(where === null ? {} : { position: where }),
    ...(refs.length === 0 ? {} : { pictures: refs }),
  };
}

/**
 * Reads what `toBooksIndex` writes. A text that is not the index at all
 * holds zero books rather than throwing; a broken entry between good ones
 * is counted and dropped, the rule of every file here; the same id twice
 * is one book - the first wins, as the first entry under an address wins
 * the article import.
 *
 * @param {string} text
 * @returns {{ books: FileBook[], invalid: number }}
 */
export function fromBooksIndex(text) {
  const file = parsed(text);
  const list = file?.["books"];
  if (file?.["format"] !== INDEX_FORMAT || !Array.isArray(list)) return { books: [], invalid: 0 };
  /** @type {FileBook[]} */
  const books = [];
  const seen = new Set();
  let invalid = 0;
  for (const entry of list) {
    const book = asFileBook(entry);
    if (book === null) {
      invalid += 1;
      continue;
    }
    if (seen.has(book.meta.id)) continue;
    seen.add(book.meta.id);
    books.push(book);
  }
  return { books, invalid };
}

/**
 * One book's text, as one string: its segments as the store holds them,
 * the pictures field only where a part shows any (the row's own shape).
 *
 * @param {string} id
 * @param {StoredSegment[]} segments in index order
 * @returns {string}
 */
export function toBookText(id, segments) {
  const rows = segments.map(({ blocks, charCount, pictures }) => ({
    blocks,
    charCount,
    ...(pictures === undefined || pictures.length === 0 ? {} : { pictures }),
  }));
  return JSON.stringify({ format: TEXT_FORMAT, version: VERSION, id, segments: rows }, null, 2) + "\n";
}

/**
 * Reads what `toBookText` writes - for the book the index named, and no
 * other: an entry that says another id is not this book's text. All or
 * nothing: a segment that will not render (`asSegment`) makes the whole
 * book unreadable, because a book with a hole is not a book anybody could
 * open, and the row would promise parts that are not there.
 *
 * @param {string} text
 * @param {string} id the book the entry was read for
 * @returns {StoredSegment[] | null}
 */
export function fromBookText(text, id) {
  const file = parsed(text);
  const list = file?.["segments"];
  if (file?.["format"] !== TEXT_FORMAT || file["id"] !== id || !Array.isArray(list)) return null;
  /** @type {StoredSegment[]} */
  const segments = [];
  for (const row of list) {
    const segment = asSegment(row);
    if (segment === null) return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments;
}

/**
 * Which of a file's books the import writes: a book already here by its
 * id - the file came from this library, or was restored once already - or
 * by its title and author - the same book, imported from its `.epub`
 * under an id of its own - is left alone with everything it has; the rest
 * are added. Pure, so the offer can say how many are new before the press,
 * and the press writes exactly that.
 *
 * @param {FileBook[]} books the index's books, each id once
 * @param {{ books: { id: string, title: string, author: string | null }[] }} library
 * @returns {{ toAdd: FileBook[], skipped: number }}
 */
export function booksImportPlan(books, library) {
  const ids = new Set(library.books.map((book) => book.id));
  const names = new Set(library.books.map((book) => nameOf(book)));
  /** @type {FileBook[]} */
  const toAdd = [];
  let skipped = 0;
  for (const book of books) {
    if (ids.has(book.meta.id) || names.has(nameOf(book.meta))) {
      skipped += 1;
      continue;
    }
    toAdd.push(book);
  }
  return { toAdd, skipped };
}

/**
 * A book's name for the identity rule (D168): title and author, exact.
 *
 * @param {{ title: string, author: string | null }} book
 * @returns {string}
 */
function nameOf(book) {
  return `${book.title}\n${book.author ?? ""}`;
}

/**
 * What the books going into a backup come to, for the box that offers
 * them: how many, and what they take - the text as characters (about the
 * bytes for a Latin script; the label says "about", as the pictures' box
 * does) and the pictures as the rows account them - read off the light
 * rows alone, without a segment or a picture entering memory.
 *
 * @param {BookMeta[]} books
 * @returns {{ count: number, bytes: number }}
 */
export function booksAccount(books) {
  return books.reduce(
    (sum, book) => ({
      count: sum.count + 1,
      bytes: sum.bytes + book.totalChars + (book.pictures?.bytes ?? 0),
    }),
    { count: 0, bytes: 0 },
  );
}

/**
 * One book's pictures out of the archive, by its references: each entry
 * read by name (nothing for one that is missing or larger than a download
 * may be), typed by its bytes and refused when they are not a stored
 * kind, whatever the reference claimed - and kept under the index the
 * reference names, because the book's segments ask for their pictures by
 * that index (`getBookPictures`). An index named twice is one picture;
 * the first wins.
 *
 * @param {string} id the book's id, the rows' key
 * @param {PictureRef[]} refs
 * @param {(name: string) => Uint8Array | null} read
 * @returns {PictureRow[]} in index order
 */
export function bookPictureRows(id, refs, read) {
  /** @type {Map<number, PictureRow>} */
  const rows = new Map();
  for (const ref of refs) {
    if (rows.has(ref.index)) continue;
    const bytes = read(ref.file);
    if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) continue;
    const type = sniffPictureType(bytes.subarray(0, SNIFF_BYTES));
    if (!isStoredPictureType(type)) continue;
    rows.set(ref.index, {
      url: id,
      index: ref.index,
      src: ref.src,
      mime: type,
      width: ref.width,
      height: ref.height,
      // A copy of its own: the database stores the buffer, and the entry's
      // view may sit inside a wider one.
      data: bytes.slice().buffer,
    });
  }
  return [...rows.values()].sort((a, b) => a.index - b.index);
}
