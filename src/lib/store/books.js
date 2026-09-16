/**
 * Where imported books live: the books' half of the reading list's database
 * (`library-db.js` opens it and says why everything shares it).
 *
 * Metadata and text are separate stores for the reason articles split theirs:
 * the list must render without a single segment entering memory. Segments are
 * keyed `[bookId, index]`, so one book's text is one contiguous key range -
 * which is what lets a delete take all of it in one pass, and the orphan
 * sweep find strays without reading their content.
 *
 * The order of an import's writes is part of the contract here: segments
 * first, the book row **last**. An import interrupted by a closed tab then
 * leaves segments without a book - invisible to every reader of this module -
 * and `sweepOrphanSegments` removes them the next time the list opens. At no
 * point does a half-imported book exist as a row anybody can open.
 *
 * A book's pictures (D183) live where an article's do - the `pictures`
 * store, keyed `[id, index]`, the book's id standing where an article's
 * address stands - and are written under the same contract: before the
 * row, one by one as the import meets them, swept with the segments if the
 * row never comes. A segment names the rows its blocks show (`pictures`
 * on the segment row), so opening one part reads that part's pictures and
 * not the book's.
 */

import { asPictureRow } from "../reader/pictures.js";
import { asBookMeta, asSegment } from "./book.js";
import { segmentsOf } from "./library-backup.js";
import {
  copyBook,
  dropBookCopy,
  dropPictureCopies,
  patchBookCopy,
  restoreLibrary,
  restorePictures,
} from "./library-copy.js";
import { promisify, withLibrary } from "./library-db.js";
import { rebuildMarksBackup, restoreMarks } from "./marks.js";

/**
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("./book.js").StoredSegment} StoredSegment
 * @typedef {import("../reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("../reader/pictures.js").PicturesSummary} PicturesSummary
 */

/**
 * Every key of one book's segments: from `[id, 0]` up to `[id, anything]` -
 * an empty array sorts above every number in IndexedDB's key order, which is
 * the standard way to say "all indexes of this id".
 *
 * @param {string} bookId
 * @returns {IDBKeyRange}
 */
function segmentRange(bookId) {
  return IDBKeyRange.bound([bookId, 0], [bookId, []]);
}

/**
 * Every key of one document's pictures, the same way (`articles.js` keeps
 * its own copy of this line, for its own rows).
 *
 * @param {string} docId
 * @returns {IDBKeyRange}
 */
function pictureRange(docId) {
  return IDBKeyRange.bound([docId, 0], [docId, []]);
}

/**
 * Writes one segment as the import produces it. Plain `put` - an import
 * writes each key once, and a re-import is a new book under a new id. The
 * pictures field is written only where the segment shows any, so a segment
 * without them is one shape with every segment from before pictures.
 *
 * @param {{ bookId: string, index: number } & StoredSegment} segment
 * @returns {Promise<void>}
 */
export async function putBookSegment(segment) {
  const { pictures, ...rest } = segment;
  const row = pictures === undefined || pictures.length === 0 ? rest : { ...rest, pictures };
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.bookSegments.put(row));
  });
}

/**
 * One picture of a book being imported, written as the import meets it
 * (D183) - into the database alone: the copy takes a picture only beside a
 * document it holds, and the book's row, which claims it there, is the
 * import's last write. `copyBook` sends the pictures after it.
 *
 * @param {PictureRow} row keyed by the book's id
 * @returns {Promise<void>}
 */
export async function putBookPicture(row) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.pictures.put(row));
  });
}

/**
 * The pictures one part of a book shows, by the indexes its segment names -
 * or, when the database holds none of them and the book's row says there
 * are some, back from the copy first, the whole book's at once and once:
 * the text of a reading list comes back the moment the library is found
 * empty (`restoreLibrary`), its pictures one document at a time, the first
 * time each is opened - the same road an article's take (`getPictures`).
 *
 * @param {string} id
 * @param {number[]} indexes the segment's `pictures`
 * @param {PicturesSummary | null} promised the book row's account, or null for none
 * @returns {Promise<PictureRow[]>}
 */
export async function getBookPictures(id, indexes, promised) {
  if (indexes.length === 0) return [];
  const rows = await readBookPictures(id, indexes);
  if (rows.length > 0 || promised === null) return rows;
  const restored = await restorePictures(id, promised.count);
  if (restored.length === 0) return [];
  await withLibrary("readwrite", async (stores) => {
    for (const row of restored) await promisify(stores.pictures.put(row));
  });
  return readBookPictures(id, indexes);
}

/**
 * @param {string} id
 * @param {number[]} indexes
 * @returns {Promise<PictureRow[]>}
 */
async function readBookPictures(id, indexes) {
  const rows = await withLibrary("readonly", async (stores) => {
    /** @type {unknown[]} */
    const found = [];
    for (const index of indexes) found.push(await promisify(stores.pictures.get([id, index])));
    return found;
  });
  return rows.map(asPictureRow).filter((row) => row !== null);
}

/**
 * Every picture of a book out - the press of "Remove pictures" over one:
 * the rows, the copy's, and the account on the book's row. The segments
 * keep naming the rows that are gone; a name nothing answers is a picture
 * hidden, which is what the text looks like before any picture is shown.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBookPictures(id) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.pictures.delete(pictureRange(id)));
  });
  await dropPictureCopies(id);
  await setBookPictures(id, null);
}

/**
 * The book row's account of its pictures, settled after they are all out.
 * A no-op when the book is gone, like every patch of a light row: an
 * account is never a way to resurrect a row.
 *
 * @param {string} id
 * @param {PicturesSummary | null} pictures
 * @returns {Promise<BookMeta | null>} the row as it stands now
 */
export async function setBookPictures(id, pictures) {
  const updated = await withLibrary("readwrite", async (stores) => {
    const row = asBookMeta(await promisify(stores.books.get(id)));
    if (row === null) return null;
    /** @type {BookMeta} */
    const updated = { ...row };
    if (pictures === null || pictures.count === 0) delete updated.pictures;
    else updated.pictures = pictures;
    await promisify(stores.books.put(updated));
    return updated;
  });
  if (updated !== null) await patchBookCopy(updated);
  return updated;
}

/**
 * The last write of an import - the row that makes the book exist. Whatever
 * the browser deleted is asked back first (the highlights' copy, then the
 * reading list's - `library-copy.js` says why in that order), because this
 * write is one that fills an empty library and would shut the door on a
 * restore; and the book goes into the reading list's copy after, whole,
 * read back from the segments the import wrote before this row.
 *
 * @param {BookMeta} book
 * @returns {Promise<void>}
 */
export async function putBook(book) {
  await restoreMarks();
  await restoreLibrary();
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.books.put(book));
  });
  await copyBook(book.id);
}

/**
 * @param {string} id
 * @returns {Promise<BookMeta | null>}
 */
export async function getBook(id) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.books.get(id)));
  return asBookMeta(row);
}

/**
 * Every book's light row, unordered - the list merges, orders and filters
 * these together with the articles, where the rule is testable.
 *
 * @returns {Promise<BookMeta[]>}
 */
export async function listBooks() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.books.getAll()))
  );
  return rows.map(asBookMeta).filter((book) => book !== null);
}

/**
 * One segment's text, or null when it is not there to render - an index past
 * the end and a torn row read the same.
 *
 * @param {string} bookId
 * @param {number} index
 * @returns {Promise<StoredSegment | null>}
 */
export async function getBookSegment(bookId, index) {
  const row = await withLibrary("readonly", (stores) =>
    promisify(stores.bookSegments.get([bookId, index])),
  );
  return asSegment(row);
}

/**
 * Every segment of one book in index order, for the backup (D218) - or
 * null when the text is not all there, the copy's own rule (`segmentsOf`):
 * a book with a torn segment is left out of the file rather than written
 * as a book nobody could open.
 *
 * @param {BookMeta} book
 * @returns {Promise<StoredSegment[] | null>}
 */
export async function allBookSegments(book) {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.bookSegments.getAll(segmentRange(book.id))))
  );
  return segmentsOf(book, rows);
}

/**
 * Every picture of one book by its index, for the backup (D218) - from the
 * database, or back from the copy when the database has lost them and the
 * row still promises some: the road `getBookPictures` takes for one part,
 * taken here for the whole book.
 *
 * @param {BookMeta} book
 * @returns {Promise<PictureRow[]>}
 */
export async function allBookPictures(book) {
  if (book.pictures === undefined) return [];
  const rows = await readPictureRange(book.id);
  if (rows.length > 0) return rows;
  const restored = await restorePictures(book.id, book.pictures.count);
  if (restored.length === 0) return [];
  await withLibrary("readwrite", async (stores) => {
    for (const row of restored) await promisify(stores.pictures.put(row));
  });
  return readPictureRange(book.id);
}

/**
 * @param {string} id
 * @returns {Promise<PictureRow[]>} in index order - the store's key order
 */
async function readPictureRange(id) {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.pictures.getAll(pictureRange(id))))
  );
  return rows.map(asPictureRow).filter((row) => row !== null);
}

/**
 * Deletes the book whole: its row, every segment, its pictures, its reading
 * position and its highlighter marks, in one transaction - the copy is the
 * only copy, and nothing of it may survive as an orphan. Quiet when the
 * book is already gone.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.books.delete(id));
    await promisify(stores.bookSegments.delete(segmentRange(id)));
    await promisify(stores.pictures.delete(pictureRange(id)));
    await promisify(stores.positions.delete(id));
    await promisify(stores.marks.delete(id));
  });
  // The marks left with the book, and the copy that outlives the database
  // follows every write that touches a marks row (`marks-backup.js`); the
  // reading list's own copy lets the book go the same way, pictures and all.
  await rebuildMarksBackup();
  await dropBookCopy(id);
}

/**
 * Marks one book read, or unread again - by hand, from the book's view, the
 * same meaning the articles' toggle has. A no-op when the book is gone.
 *
 * @param {string} id
 * @param {number | null} readAt
 * @returns {Promise<BookMeta | null>} the row as it stands now
 */
export async function setBookReadAt(id, readAt) {
  const updated = await withLibrary("readwrite", async (stores) => {
    const row = asBookMeta(await promisify(stores.books.get(id)));
    if (row === null) return null;
    const updated = { ...row, readAt };
    await promisify(stores.books.put(updated));
    return updated;
  });
  if (updated !== null) await patchBookCopy(updated);
  return updated;
}

/**
 * Writes the table of contents a backfill scan produced (D116) - for books
 * imported before the TOC existed, whose rows carry `toc: null`. One
 * readwrite transaction around a fresh read of the row, because the scan
 * took time and the world may have moved: a book deleted meanwhile must not
 * be resurrected by this put, and a scan another tab already landed is the
 * same list - first writer wins, quietly.
 *
 * @param {string} id
 * @param {import("../book/toc.js").TocEntry[]} toc
 * @returns {Promise<boolean>} whether this call's list is the one stored
 */
export async function setBookToc(id, toc) {
  const written = await withLibrary("readwrite", async (stores) => {
    const row = asBookMeta(await promisify(stores.books.get(id)));
    if (row === null || row.toc !== null) return null;
    const updated = { ...row, toc };
    await promisify(stores.books.put(updated));
    return updated;
  });
  if (written !== null) await patchBookCopy(written);
  return written !== null;
}

/**
 * Removes segments and pictures whose book never came to exist - the
 * leavings of an import that a closed tab cut short (the book row is
 * written last). Run when the list opens, because this page is the only
 * one holding a key to the database; the keys are read, never the text.
 *
 * A picture is an orphan when no document stands under its key - no book
 * and no article, since the store holds both kinds' (D183). Only its own
 * rows go for it: a marks row under an address nobody saved can be the
 * copy's, put back for a page to return to (`marks-backup.js`), and no
 * picture is a reason to take it.
 *
 * @returns {Promise<void>}
 */
export async function sweepOrphanSegments() {
  await withLibrary("readwrite", async (stores) => {
    const bookIds = new Set(
      /** @type {IDBValidKey[]} */ (await promisify(stores.books.getAllKeys())).map(String),
    );
    const segmentKeys = /** @type {Array<[string, number]>} */ (
      await promisify(stores.bookSegments.getAllKeys())
    );
    /** @type {Set<string>} */
    const strays = new Set();
    for (const [bookId] of segmentKeys) {
      if (!bookIds.has(bookId)) strays.add(bookId);
    }
    for (const bookId of strays) {
      await promisify(stores.bookSegments.delete(segmentRange(bookId)));
      await promisify(stores.pictures.delete(pictureRange(bookId)));
      await promisify(stores.positions.delete(bookId));
      await promisify(stores.marks.delete(bookId));
    }

    const articleUrls = new Set(
      /** @type {IDBValidKey[]} */ (await promisify(stores.meta.getAllKeys())).map(String),
    );
    const pictureKeys = /** @type {Array<[string, number]>} */ (
      await promisify(stores.pictures.getAllKeys())
    );
    /** @type {Set<string>} */
    const unowned = new Set();
    for (const [docId] of pictureKeys) {
      if (!bookIds.has(docId) && !articleUrls.has(docId)) unowned.add(docId);
    }
    for (const docId of unowned) await promisify(stores.pictures.delete(pictureRange(docId)));
  });
}
