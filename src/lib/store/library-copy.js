/**
 * The reading list's copy bound to this extension: the rules of
 * `library-backup.js` with IndexedDB, the config and `storage.local` behind
 * them, and every entry quiet on failure - the copy is insurance, and a
 * save that succeeded must not turn into an error because its insurance
 * did. `articles.js` and `books.js` call these after their writes and
 * before the writes that could fill an empty library; the reader's list
 * asks the restore before it reads, and the completion after it; the
 * settings page moves the switch and asks the completion before its line.
 */

import { effectiveLibraryCopy, readConfig } from "../config.js";
import { asPosition } from "../reader/position.js";
import { asBookMeta } from "./book.js";
import { asPictureRow } from "../reader/pictures.js";
import {
  buildLibraryCopy as buildWith,
  clearLibraryCopy as clearWith,
  completeLibraryCopy as completeWith,
  copyArticle as copyArticleWith,
  copyBook as copyBookWith,
  copyPicture as copyPictureWith,
  copyPosition as copyPositionWith,
  dropCopied,
  dropPictures as dropPicturesWith,
  migrateIndex,
  patchCopiedMeta,
  restoreLibrary as restoreWith,
  restorePictures as restorePicturesWith,
  segmentsOf,
  storageDeps,
  summarizeCopy,
} from "./library-backup.js";
import { promisify, withLibrary } from "./library-db.js";
import { copiesWritable } from "./private-copies.js";
import { asSavedMeta } from "./saved-article.js";

/**
 * @typedef {import("./library-backup.js").LibraryCopyDeps} LibraryCopyDeps
 * @typedef {import("./library-backup.js").CopiedBook} CopiedBook
 * @typedef {import("./library-backup.js").Segment} Segment
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("../reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {import("./library-db.js").LibraryStores} LibraryStores
 */

/**
 * The index in place before anything on this page touches the copy - once
 * per page, since after it every write goes through the index and there is
 * nothing left to migrate. What it costs is one read of a small key; the
 * one time it finds a copy from before the index (#245), it reads the area
 * whole and never again. A migration that fails is forgotten, so the next
 * call tries again - and the call that needed it goes on regardless, quiet
 * like everything here.
 *
 * @type {Promise<void> | null}
 */
let migrated = null;

/** @returns {Promise<void>} */
function ready() {
  migrated ??= migrateIndex(storageDeps()).then(
    () => undefined,
    () => {
      migrated = null;
    },
  );
  return migrated;
}

/**
 * Every key of one book's segments (`books.js` explains the empty array).
 *
 * @param {string} bookId
 * @returns {IDBKeyRange}
 */
function segmentRange(bookId) {
  return IDBKeyRange.bound([bookId, 0], [bookId, []]);
}

/**
 * One document's pictures as the database holds them, in order - an
 * article's under its address, a book's under its id - read here rather
 * than through `articles.js` or `books.js`, which import this module and
 * must not be needed by it.
 *
 * @param {string} url
 * @returns {Promise<PictureRow[]>}
 */
async function picturesOf(url) {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) =>
      promisify(stores.pictures.getAll(IDBKeyRange.bound([url, 0], [url, []]))),
    )
  );
  return rows
    .map(asPictureRow)
    .filter((row) => row !== null)
    .sort((a, b) => a.index - b.index);
}

/**
 * @param {LibraryStores} stores
 * @returns {Promise<boolean>}
 */
async function isEmpty(stores) {
  const [metas, books] = await Promise.all([
    promisify(stores.meta.count()),
    promisify(stores.books.count()),
  ]);
  return metas === 0 && books === 0;
}

/**
 * Every saved article whole, joined from its two stores the way
 * `allArticles` joins them - repeated here rather than imported, because
 * `articles.js` imports this module and a module must not need its caller.
 *
 * @param {unknown[]} metas
 * @param {unknown[]} stored
 * @returns {SavedArticle[]}
 */
function articlesOf(metas, stored) {
  /** @type {Map<string, { content: string, dir: string | null, lang: string | null }>} */
  const contents = new Map();
  for (const row of stored) {
    if (typeof row !== "object" || row === null) continue;
    const { url, content, dir, lang } = /** @type {Record<string, unknown>} */ (row);
    if (typeof url !== "string" || typeof content !== "string" || content.length === 0) continue;
    contents.set(url, {
      content,
      dir: typeof dir === "string" && dir.length > 0 ? dir : null,
      lang: typeof lang === "string" && lang.length > 0 ? lang : null,
    });
  }
  /** @type {SavedArticle[]} */
  const articles = [];
  for (const row of metas) {
    const meta = asSavedMeta(row);
    if (meta === null) continue;
    const held = contents.get(meta.url);
    if (held !== undefined) articles.push({ ...meta, ...held });
  }
  return articles;
}

/**
 * Every book with all of its text, from one read of the segments store - a
 * book whose text is not all there is left out, as `segmentsOf` rules.
 *
 * @param {unknown[]} rows book rows
 * @param {unknown[]} segmentRows every segment row, in key order
 * @returns {CopiedBook[]}
 */
function booksOf(rows, segmentRows) {
  /** @type {Map<string, unknown[]>} */
  const byBook = new Map();
  for (const row of segmentRows) {
    if (typeof row !== "object" || row === null) continue;
    const { bookId } = /** @type {Record<string, unknown>} */ (row);
    if (typeof bookId !== "string") continue;
    const list = byBook.get(bookId) ?? [];
    list.push(row);
    byBook.set(bookId, list);
  }
  /** @type {CopiedBook[]} */
  const books = [];
  for (const row of rows) {
    const meta = asBookMeta(row);
    if (meta === null) continue;
    const segments = segmentsOf(meta, byBook.get(meta.id) ?? []);
    if (segments !== null) books.push({ meta, segments });
  }
  return books;
}

/**
 * The copy's view of this extension: the switch as the config and the
 * platform decide it, and the library's three answers - its emptiness, its
 * whole, and the rows written back into an empty one (checked again inside
 * the transaction that writes them, because the count outside it is a gate,
 * not a lock).
 *
 * @returns {LibraryCopyDeps}
 */
function copyDeps() {
  return {
    ...storageDeps(),
    // Off in a private window as well as by the switch (D171): the copy's
    // writers are no-ops there anyway, and saying so here spares a
    // completion the read of the whole library it would then throw away.
    enabled: async () => copiesWritable() && effectiveLibraryCopy(await readConfig()),
    empty: () => withLibrary("readonly", isEmpty),
    // The ids alone, from the two key lists: what the completion compares
    // against the index on every list, without a byte of content read.
    documents: async () => {
      const { articles, books } = await withLibrary("readonly", async (stores) => ({
        articles: /** @type {IDBValidKey[]} */ (await promisify(stores.meta.getAllKeys())),
        books: /** @type {IDBValidKey[]} */ (await promisify(stores.books.getAllKeys())),
      }));
      return { articles: articles.map(String), books: books.map(String) };
    },
    pictures: picturesOf,
    snapshot: async () => {
      const { metas, stored, books, segments, positions } = await withLibrary("readonly", async (stores) => ({
        metas: /** @type {unknown[]} */ (await promisify(stores.meta.getAll())),
        stored: /** @type {unknown[]} */ (await promisify(stores.content.getAll())),
        books: /** @type {unknown[]} */ (await promisify(stores.books.getAll())),
        segments: /** @type {unknown[]} */ (await promisify(stores.bookSegments.getAll())),
        positions: /** @type {unknown[]} */ (await promisify(stores.positions.getAll())),
      }));
      return {
        articles: articlesOf(metas, stored),
        books: booksOf(books, segments),
        positions: positions.map(asPosition).filter((position) => position !== null),
      };
    },
    putRows: async (library) => {
      return await withLibrary("readwrite", async (stores) => {
        if (!(await isEmpty(stores))) return 0;
        for (const article of library.articles) {
          const { content, dir, lang, ...meta } = article;
          await promisify(stores.meta.put(meta));
          await promisify(stores.content.put({ url: article.url, content, dir, lang }));
        }
        for (const { meta, segments } of library.books) {
          for (const [index, segment] of segments.entries()) {
            await promisify(stores.bookSegments.put({ bookId: meta.id, index, ...segment }));
          }
          await promisify(stores.books.put(meta));
        }
        for (const position of library.positions) await promisify(stores.positions.put(position));
        return library.articles.length + library.books.length;
      });
    },
  };
}

/**
 * Whatever the browser deleted, back from the copy - the library empty and
 * the copy holding a document being the one shape that means. Asked by the
 * writes that could fill an empty library and by the list before it reads,
 * after `restoreMarks` in every case (its rule wants no marks either, and a
 * library restored first would refuse the marks their way back).
 *
 * @returns {Promise<number>} how many documents came back
 */
export async function restoreLibrary() {
  try {
    await ready();
    return await restoreWith(copyDeps());
  } catch {
    return 0;
  }
}

/**
 * Whatever the library holds and the copy does not, copied - once per page,
 * because after it every document is claimed and every later one is
 * claimed as it is written. What it costs on every other page is the two
 * key lists and one small key; what it costs once is the documents that
 * were saved while the copy was off or before it was on by default (D146).
 * Asked by the reader's list after the restore and by the settings page
 * before its line. A completion that fails is forgotten, so the next page
 * tries again - and the caller goes on regardless.
 *
 * @type {Promise<number> | null}
 */
let completed = null;

/** @returns {Promise<number>} how many documents the copy gained */
export function completeLibraryCopy() {
  completed ??= ready()
    .then(() => completeWith(copyDeps()))
    .catch(() => {
      completed = null;
      return 0;
    });
  return completed;
}

/**
 * The copy made whole from the library - the switch turned on.
 *
 * @returns {Promise<boolean>} whether the copy was built
 */
export async function buildLibraryCopy() {
  // Not from a private window (D171): the switch there moves the setting,
  // and the build follows on the first normal page (`completeLibraryCopy`).
  if (!copiesWritable()) return false;
  try {
    await ready();
    await buildWith(copyDeps());
    return true;
  } catch {
    return false;
  }
}

/**
 * The copy removed - the switch turned off.
 *
 * @returns {Promise<boolean>} whether the copy was cleared
 */
export async function clearLibraryCopy() {
  // As above: a private window may not take the copy away from the normal
  // ones. The setting is off, so nothing is added until it is on again.
  if (!copiesWritable()) return false;
  try {
    await ready();
    await clearWith(copyDeps());
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {SavedArticle} article
 * @param {boolean} replaced whether the save wrote over an older article
 * @returns {Promise<void>}
 */
export async function copyArticle(article, replaced) {
  try {
    await ready();
    await copyArticleWith(article, replaced, copyDeps());
  } catch {
    // Insurance, not a transaction: the article is saved either way.
  }
}

/**
 * The book just written, read back whole for the copy: the row and every
 * segment, which the import wrote before the row - so a book with a row has
 * all of its text, or `segmentsOf` refuses it. Its pictures right behind
 * (D183): the import wrote them before the row too, and the copy takes a
 * picture only beside a document it holds, so they go one by one, after.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function copyBook(id) {
  try {
    await ready();
    const deps = copyDeps();
    if (!(await deps.enabled())) return;
    const { row, rows } = await withLibrary("readonly", async (stores) => ({
      row: /** @type {unknown} */ (await promisify(stores.books.get(id))),
      rows: /** @type {unknown[]} */ (await promisify(stores.bookSegments.getAll(segmentRange(id)))),
    }));
    const meta = asBookMeta(row);
    if (meta === null) return;
    const segments = segmentsOf(meta, rows);
    if (segments === null) return;
    await copyBookWith({ meta, segments }, deps);
    if (meta.pictures === undefined) return;
    for (const picture of await picturesOf(id)) await copyPictureWith(picture, deps);
  } catch {
    // As above.
  }
}

/**
 * @param {ReadingPosition} position
 * @returns {Promise<void>}
 */
export async function copyPosition(position) {
  try {
    await ready();
    await copyPositionWith(position, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * One picture into the copy, as it arrives (D145) - an article's; a book's
 * go through `copyBook`, behind the row that claims them.
 *
 * @param {PictureRow} picture
 * @returns {Promise<void>}
 */
export async function copyPicture(picture) {
  try {
    await ready();
    await copyPictureWith(picture, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * A document's pictures out of the copy - removed, or their save cut short.
 *
 * @param {string} url an article's address or a book's id
 * @returns {Promise<void>}
 */
export async function dropPictureCopies(url) {
  try {
    await ready();
    await dropPicturesWith(url, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * One document's pictures back from the copy, for the database to take when
 * it has none and the light row says there were some (`getPictures`,
 * `getBookPictures`). Nothing on failure: the document opens without them,
 * as it would have.
 *
 * @param {string} url an article's address or a book's id
 * @param {number} count how many the light row promises - a ceiling for the reads
 * @returns {Promise<PictureRow[]>}
 */
export async function restorePictures(url, count) {
  try {
    await ready();
    const rows = await restorePicturesWith(url, copyDeps());
    return rows.slice(0, count);
  } catch {
    return [];
  }
}

/**
 * @param {SavedMeta} meta the article's light row as it stands now
 * @returns {Promise<void>}
 */
export async function patchArticleCopy(meta) {
  try {
    await ready();
    await patchCopiedMeta("article", meta.url, meta, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {BookMeta} meta the book's row as it stands now
 * @returns {Promise<void>}
 */
export async function patchBookCopy(meta) {
  try {
    await ready();
    await patchCopiedMeta("book", meta.id, meta, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function dropArticleCopy(url) {
  try {
    await ready();
    await dropCopied(url, "article", copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function dropBookCopy(id) {
  try {
    await ready();
    await dropCopied(id, "book", copyDeps());
  } catch {
    // As above.
  }
}

/**
 * The copy in two numbers for the settings page: how many documents, how
 * much space - or null for no copy at all, and null when the area will not
 * answer, which the line reads the same way. From the index alone: the line
 * costs one small key, not a read of every document.
 *
 * @returns {Promise<{ docs: number, bytes: number } | null>}
 */
export async function readLibraryCopy() {
  try {
    await ready();
    return await summarizeCopy(storageDeps());
  } catch {
    return null;
  }
}
