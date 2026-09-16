/**
 * Where highlighter marks live: one row per document in the reading list's
 * database, holding every mark the document has. One row rather than one per
 * mark for the reason the position is one row: the marks of a document are
 * read together, written together, and leave together with it - and a list
 * of a few dozen small records rewritten whole costs nothing next to the
 * article standing beside it.
 *
 * Keyed by `docId` exactly as positions are - an article's `url`, a book's
 * own id - so the rows of one document can be deleted by one name in one
 * transaction (`articles.js`, `books.js` do that; this module never has to).
 *
 * Only the reader page opens this, like everything else in the database.
 */

import { asMark, compareMarks } from "../reader/marks.js";
import { asBookMeta } from "./book.js";
import { promisify, withLibrary } from "./library-db.js";
import {
  rebuildMarksBackup as rebuildWith,
  restoreMarks as restoreWith,
  storageDeps,
} from "./marks-backup.js";
import { asSavedMeta } from "./saved-article.js";

/** @typedef {import("../reader/marks.js").Mark} Mark */
/** @typedef {import("./marks-backup.js").DocTitle} DocTitle */

/**
 * Every mark of one document, in reading order, however the row was written
 * or hand-edited. A mark that does not narrow drops alone - the lean of
 * `asMark` - and no row at all is simply a document nobody marked.
 *
 * @param {string} docId
 * @returns {Promise<Mark[]>}
 */
export async function getMarks(docId) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.marks.get(docId)));
  if (typeof row !== "object" || row === null) return [];
  const { marks } = /** @type {Record<string, unknown>} */ (row);
  if (!Array.isArray(marks)) return [];
  return marks
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
}

/**
 * The document's marks, replaced whole - the latest word, like a position. An
 * empty list deletes the row rather than storing it: a row saying "no marks"
 * and no row must mean the same thing, and only one of them costs nothing.
 *
 * @param {string} docId
 * @param {Mark[]} marks
 * @returns {Promise<void>}
 */
export async function putMarks(docId, marks) {
  // Settled first, the copy's rule: a library the browser emptied gets its
  // marks back before this write, so the copy rebuilt below is never built
  // from this one row alone.
  await restoreMarks();
  await withLibrary("readwrite", async (stores) => {
    if (marks.length === 0) await promisify(stores.marks.delete(docId));
    else await promisify(stores.marks.put({ docId, marks }));
  });
  await rebuildMarksBackup();
}

/**
 * Several documents' marks replaced whole in one transaction - `putMarks`
 * for a list, the highlights import's write (D168): the copy's rule settled
 * once before, the copy rebuilt once after, and no document written while
 * another is not.
 *
 * @param {{ docId: string, marks: Mark[] }[]} rows
 * @returns {Promise<void>}
 */
export async function putMarksRows(rows) {
  await restoreMarks();
  await withLibrary("readwrite", async (stores) => {
    for (const { docId, marks } of rows) {
      if (marks.length === 0) await promisify(stores.marks.delete(docId));
      else await promisify(stores.marks.put({ docId, marks }));
    }
  });
  await rebuildMarksBackup();
}

/**
 * Every document's marks at once, for the exports: the article file carries
 * each article's marks beside it, and the highlights file is nothing but
 * this map dressed in titles. One `getAll` for the same reason the list
 * reads positions in bulk. Rows narrow like `getMarks` narrows, and a row
 * left with nothing readable simply is not in the map.
 *
 * @returns {Promise<Map<string, Mark[]>>} keyed by `docId`
 */
export async function allMarks() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.marks.getAll()))
  );
  return narrowRows(rows);
}

/**
 * @param {unknown[]} rows
 * @returns {Map<string, Mark[]>} keyed by `docId`
 */
function narrowRows(rows) {
  /** @type {Map<string, Mark[]>} */
  const map = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { docId, marks } = /** @type {Record<string, unknown>} */ (row);
    if (typeof docId !== "string" || docId.length === 0 || !Array.isArray(marks)) continue;
    const kept = marks
      .map(asMark)
      .filter((mark) => mark !== null)
      .sort(compareMarks);
    if (kept.length > 0) map.set(docId, kept);
  }
  return map;
}

/**
 * The titles the library can still put to a marks row - every article's and
 * every book's - as the copy remembers them beside the row.
 *
 * @param {unknown[]} metas
 * @param {unknown[]} books
 * @returns {Map<string, DocTitle>}
 */
function titlesOf(metas, books) {
  /** @type {Map<string, DocTitle>} */
  const titles = new Map();
  for (const row of metas) {
    const meta = asSavedMeta(row);
    if (meta !== null) titles.set(meta.url, { kind: "article", title: meta.title });
  }
  for (const row of books) {
    const book = asBookMeta(row);
    if (book !== null) titles.set(book.id, { kind: "book", title: book.title });
  }
  return titles;
}

/**
 * The copy's view of this database (`marks-backup.js` holds the rules; this
 * is the IndexedDB half of them): the snapshot the copy is rebuilt from, the
 * emptiness the restore asks about, and the rows written back - into an
 * empty library only, checked again inside the transaction that writes them,
 * because the count outside it is a gate, not a lock.
 *
 * @returns {import("./marks-backup.js").MarksBackupDeps}
 */
function backupDeps() {
  /** @param {import("./library-db.js").LibraryStores} stores */
  const isEmpty = async (stores) => {
    const [metas, books, marks] = await Promise.all([
      promisify(stores.meta.count()),
      promisify(stores.books.count()),
      promisify(stores.marks.count()),
    ]);
    return metas === 0 && books === 0 && marks === 0;
  };
  return {
    ...storageDeps(),
    snapshot: async () => {
      const { rows, metas, books } = await withLibrary("readonly", async (stores) => ({
        rows: /** @type {unknown[]} */ (await promisify(stores.marks.getAll())),
        metas: /** @type {unknown[]} */ (await promisify(stores.meta.getAll())),
        books: /** @type {unknown[]} */ (await promisify(stores.books.getAll())),
      }));
      return { marks: narrowRows(rows), titles: titlesOf(metas, books) };
    },
    empty: () => withLibrary("readonly", isEmpty),
    putRows: async (docs) => {
      await withLibrary("readwrite", async (stores) => {
        if (!(await isEmpty(stores))) return;
        for (const doc of docs) await promisify(stores.marks.put({ docId: doc.docId, marks: doc.marks }));
      });
    },
  };
}

/**
 * Whatever the browser deleted, back from the copy - the library empty and
 * the copy not being the one shape that means. Asked by every write to the
 * marks and by the pages before they read, and quiet on every failure: the
 * copy is insurance, and a write must not fail because its insurance did.
 *
 * @returns {Promise<number>} how many documents' marks came back
 */
export async function restoreMarks() {
  try {
    return await restoreWith(backupDeps());
  } catch {
    return 0;
  }
}

/**
 * The copy rebuilt from the whole store, after every write that touched a
 * marks row - here, in `articles.js` and in `books.js`. Quiet on failure
 * for the same reason `restoreMarks` is; the next write rebuilds it again.
 *
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function rebuildMarksBackup() {
  try {
    await rebuildWith(backupDeps());
    return true;
  } catch {
    return false;
  }
}
