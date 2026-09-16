/**
 * The copy of the reading list that outlives the database: every saved
 * article whole, every book with its text, where the reader stopped in
 * each, and the pictures an article was given (D145). The third copy after
 * the vocabulary's (`backup.js`) and the highlights' (`marks-backup.js`),
 * for the reason those two exist: Safari deletes the origin's IndexedDB
 * after thirty days without a touch on the extension's pages, and
 * `storage.local` is where that does not reach.
 *
 * Unlike the first two it can be switched off (`libraryCopy` in the config).
 * The vocabulary and the marks are the reader's own work - small, and
 * impossible to type in again - so they are copied unasked. The reading
 * list is large (the copy doubles the space it takes) and mostly findable
 * again, so the switch exists; it began as off outside iOS and iPadOS and
 * is on everywhere since D146 (`effectiveLibraryCopy` says why), with the
 * copy completed from the library where the default found one already
 * saved (`completeLibraryCopy`).
 *
 * And unlike them it is not one value but one key per document, under one
 * index:
 *
 *   - `libraryCopy:index` - which documents the copy holds, and what each takes
 *   - `libraryCopy:article:<url>` - the article whole, as `getArticle` gives it
 *   - `libraryCopy:book:<id>` - the book's row and every segment of its text
 *   - `libraryCopy:position:<docId>` - where the reader stopped in it
 *   - `libraryCopy:picture:<url>:<index>` - one picture of an article or a book
 *     (under the book's id, D183), as base64
 *
 * because one value would mean rewriting tens of megabytes after every saved
 * reading position, and because a row that will not read should cost only its
 * own document.
 *
 * The index is what makes the rows findable without reading the whole area.
 * `storage.local` can hand out nothing but values, so "every key with the
 * prefix" costs a read of every document - tens of megabytes for one line on
 * the settings page, and every picture on top. The first version of the copy
 * (#245) had no index and read the whole area instead, which held while the
 * copy was text; `migrateIndex` takes over in the one such read this module
 * still makes, and after it the area is never read whole again. The order of
 * writes keeps the index honest: a document is claimed in the index before
 * its row is written, and its row is removed before the claim is. A page
 * that dies between the two leaves at worst a claim without a row - which
 * restores nothing and clears nothing - and never a row the index does not
 * know, which nothing would ever clear. A position carries no claim of its
 * own: a place belongs to the document it is in, and is written only for
 * one the index holds. A picture is claimed by its count: the index says how
 * many a document has, and the keys follow from that.
 *
 * Text comes back whole: the moment the library is found empty, every
 * article and book the index names is read and written back in one
 * transaction. Pictures come back one document at a time, when that
 * article or book is opened (`restorePictures`) - never all at once, since
 * all at once is the whole-area read by another name.
 *
 * The rules: additions only while the copy is on, removals always (switching
 * off clears the copy, and a stale row must never come back with the switch);
 * a document's light row is patched where it stands and written nowhere it
 * does not; restored only into an empty library - no article, no book -
 * asked before the writes that make one and before the list reads, always
 * after the highlights' own restore, whose rule wants no marks either;
 * neither added to nor removed from in a private window, where the area is
 * shared with the normal ones and a session that leaves no trace may only
 * read (D171, `private-copies.js`); and quiet in every failure, because the
 * copy is insurance and a save must not fail for its insurance
 * (`library-copy.js` binds it so).
 *
 * The store and the storage arrive as parameters so the rules can be tested
 * against stand-ins; `library-copy.js` supplies IndexedDB, the config and
 * `storage.local`.
 */

import { fromBase64, toBase64 } from "../base64.js";
import { inPrivateContext, webext } from "../browser.js";
import { asPictureRow, asPicturesSummary } from "../reader/pictures.js";
import { asPosition } from "../reader/position.js";
import { asBookMeta, asSegment } from "./book.js";
import { copiesWritable } from "./private-copies.js";
import { asSavedMeta } from "./saved-article.js";

/**
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {import("../reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("../reader/pictures.js").PicturesSummary} PicturesSummary
 * @typedef {import("./book.js").StoredSegment} Segment
 */

/**
 * A book as the copy carries it and as the library gets it back: the light
 * row and its text, every segment in reading order.
 *
 * @typedef {{ meta: BookMeta, segments: Segment[] }} CopiedBook
 */

/**
 * What the copy holds, by the documents' own ids - an article's address, a
 * book's id - each with the bytes its row took when it was written, and by
 * document the account of its pictures: how many rows stand under it and
 * what they take. The settings page's line is a sum over this, never a
 * read of a row.
 *
 * @typedef {{
 *   version: number,
 *   articles: Record<string, number>,
 *   books: Record<string, number>,
 *   pictures: Record<string, PicturesSummary>,
 * }} CopyIndex
 */

/**
 * Everything the copy holds that reads, narrowed from the rows the index
 * names. Positions only of documents that are here: a place in a document
 * the copy does not hold would be a row nothing ever cleans. Pictures as
 * they stand, whoever they belong to - `migrateIndex` is the one reader,
 * and it decides which to claim.
 *
 * @typedef {{
 *   keys: string[],
 *   articles: SavedArticle[],
 *   books: CopiedBook[],
 *   positions: ReadingPosition[],
 *   pictures: PictureRow[],
 * }} CopiedLibrary
 */

/**
 * The library as the copy is built from it, whole - its text. The pictures
 * are asked for one document at a time (`LibraryCopyDeps.pictures`).
 *
 * @typedef {{ articles: SavedArticle[], books: CopiedBook[], positions: ReadingPosition[] }} LibrarySnapshot
 */

/**
 * @typedef {object} LibraryCopyDeps
 * @property {() => Promise<boolean>} enabled whether the copy is on, as the switch and the platform decide
 * @property {() => Promise<boolean>} empty whether the library holds no article and no book
 * @property {() => Promise<{ articles: string[], books: string[] }>} documents the ids of every
 *   article and book the library holds - the two key lists, no content - for a completion
 * @property {(library: CopiedLibrary) => Promise<number>} putRows the documents written back - into an
 *   empty library only, checked again where the write is atomic; answers how many were
 * @property {() => Promise<LibrarySnapshot>} snapshot the whole library, for a build
 * @property {(docId: string) => Promise<PictureRow[]>} pictures one document's pictures - an
 *   article's by its address, a book's by its id - for a build
 * @property {() => Promise<Record<string, unknown>>} readAll everything in the storage area - asked
 *   by `migrateIndex` alone, and by it once
 * @property {(key: string) => Promise<unknown>} read whatever stands under one key
 * @property {(keys: string[]) => Promise<Record<string, unknown>>} readMany whatever stands under each key
 * @property {(items: Record<string, unknown>) => Promise<void>} write
 * @property {(keys: string[]) => Promise<void>} remove
 */

/**
 * The storage half of the dependencies on its own - enough for the index,
 * which asks nothing of the library.
 *
 * @typedef {Pick<LibraryCopyDeps, "readAll" | "read" | "readMany" | "write" | "remove">} StorageDeps
 */

/** What every key of the copy begins with, in `storage.local`. */
export const LIBRARY_COPY_PREFIX = "libraryCopy:";

/** The one key the copy is found by. */
export const INDEX_KEY = `${LIBRARY_COPY_PREFIX}index`;

const VERSION = 1;

/** @param {string} url */
export function articleKey(url) {
  return `${LIBRARY_COPY_PREFIX}article:${url}`;
}

/** @param {string} id */
export function bookKey(id) {
  return `${LIBRARY_COPY_PREFIX}book:${id}`;
}

/** @param {string} docId */
export function positionKey(docId) {
  return `${LIBRARY_COPY_PREFIX}position:${docId}`;
}

/**
 * @param {string} url
 * @param {number} index
 */
export function pictureKey(url, index) {
  return `${LIBRARY_COPY_PREFIX}picture:${url}:${index}`;
}

/**
 * The storage half of the dependencies, the same on every page - except
 * that in a private window the writing half does nothing (D171,
 * `private-copies.js`): the area is shared with the normal windows, and a
 * private session may read the copy but must not leave anything in it, nor
 * take anything out of it.
 *
 * @param {() => boolean} [isPrivate] for tests; the browser's answer by default
 * @returns {StorageDeps}
 */
export function storageDeps(isPrivate = inPrivateContext) {
  const writable = copiesWritable(isPrivate);
  return {
    readAll: () => webext().storage.local.get(null),
    read: async (key) => (await webext().storage.local.get(key))[key],
    readMany: async (keys) => (keys.length > 0 ? await webext().storage.local.get(keys) : {}),
    write: async (items) => {
      if (writable) await webext().storage.local.set(items);
    },
    remove: async (keys) => {
      if (writable && keys.length > 0) await webext().storage.local.remove(keys);
    },
  };
}

/**
 * The row an article is copied as: its light half apart from its text, the
 * same two halves the database keeps, so a patch of the light half never
 * has to carry the text along.
 *
 * @param {SavedArticle} article
 * @returns {{ version: number, meta: SavedMeta, content: string, dir: string | null, lang: string | null }}
 */
export function articleRow(article) {
  const { content, dir, lang, ...meta } = article;
  return { version: VERSION, meta, content, dir, lang };
}

/**
 * @param {CopiedBook} book
 * @returns {{ version: number, meta: BookMeta, segments: Segment[] }}
 */
export function bookRow(book) {
  return { version: VERSION, meta: book.meta, segments: book.segments };
}

/**
 * @param {ReadingPosition} position
 * @returns {{ version: number, position: ReadingPosition }}
 */
export function positionRow(position) {
  return { version: VERSION, position };
}

/**
 * A picture as the copy carries it: the database's row with its bytes as
 * base64, because the area holds text - `base64.js` says why in chunks.
 *
 * @param {PictureRow} row
 * @returns {{ version: number, url: string, index: number, src: string, mime: string, width: number, height: number, data: string }}
 */
export function pictureRow(row) {
  const { data, ...rest } = row;
  return { version: VERSION, ...rest, data: toBase64(data) };
}

/**
 * A book's text as the database holds it, put in order - or nothing when it
 * is not all there: a copy of half a book is a book that opens on a hole,
 * and the database's own rule (`books.js`) is that the row is written last,
 * after every segment, so a book with a row has every segment or is torn.
 *
 * @param {BookMeta} book
 * @param {unknown[]} rows the segment rows under the book's id, in key order
 * @returns {Segment[] | null}
 */
export function segmentsOf(book, rows) {
  /** @type {Segment[]} */
  const segments = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const { index } = /** @type {Record<string, unknown>} */ (row);
    const segment = asSegment(row);
    if (index !== segments.length || segment === null) return null;
    segments.push(segment);
  }
  return segments.length === book.segmentCount ? segments : null;
}

/**
 * @param {unknown} value
 * @returns {SavedArticle | null}
 */
export function asCopiedArticle(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, meta, content, dir, lang } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION) return null;
  const light = asSavedMeta(meta);
  if (light === null || typeof content !== "string" || content.length === 0) return null;
  return {
    ...light,
    content,
    dir: typeof dir === "string" && dir.length > 0 ? dir : null,
    lang: typeof lang === "string" && lang.length > 0 ? lang : null,
  };
}

/**
 * @param {unknown} value
 * @returns {CopiedBook | null}
 */
export function asCopiedBook(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, meta, segments } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION || !Array.isArray(segments)) return null;
  const book = asBookMeta(meta);
  if (book === null || segments.length !== book.segmentCount) return null;
  /** @type {Segment[]} */
  const kept = [];
  for (const row of segments) {
    const segment = asSegment(row);
    if (segment === null) return null;
    kept.push(segment);
  }
  return { meta: book, segments: kept };
}

/**
 * @param {unknown} value
 * @returns {ReadingPosition | null}
 */
export function asCopiedPosition(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, position } = /** @type {Record<string, unknown>} */ (value);
  return version === VERSION ? asPosition(position) : null;
}

/**
 * A picture back from the copy, its bytes decoded, or nothing: a row that
 * will not read or will not decode is a picture that is not there.
 *
 * @param {unknown} value
 * @returns {PictureRow | null}
 */
export function asCopiedPicture(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, data, ...rest } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION) return null;
  const bytes = fromBase64(data);
  if (bytes === null) return null;
  return asPictureRow({ ...rest, data: bytes.buffer });
}

/**
 * The index as stored, narrowed field by field, or nothing: an index that
 * will not read is no index, and `migrateIndex` builds one again from the
 * rows - the rows are the copy, the index only says where they are. An
 * index from before pictures (#249) has no account of them, and reads as
 * one with none.
 *
 * @param {unknown} value
 * @returns {CopyIndex | null}
 */
export function asIndex(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, articles, books, pictures } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION) return null;
  const articleSizes = sizesOf(articles);
  const bookSizes = sizesOf(books);
  const pictureSizes = pictures === undefined ? {} : summariesOf(pictures);
  if (articleSizes === null || bookSizes === null || pictureSizes === null) return null;
  return { version: VERSION, articles: articleSizes, books: bookSizes, pictures: pictureSizes };
}

/**
 * @param {unknown} value
 * @returns {Record<string, number> | null}
 */
function sizesOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const [id, bytes] of Object.entries(value)) {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
    sizes[id] = bytes;
  }
  return sizes;
}

/**
 * @param {unknown} value
 * @returns {Record<string, PicturesSummary> | null}
 */
function summariesOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  /** @type {Record<string, PicturesSummary>} */
  const summaries = {};
  for (const [url, summary] of Object.entries(value)) {
    const kept = asPicturesSummary(summary);
    if (kept === null) return null;
    summaries[url] = kept;
  }
  return summaries;
}

/** @returns {CopyIndex} */
function emptyIndex() {
  return { version: VERSION, articles: {}, books: {}, pictures: {} };
}

/**
 * @param {Pick<LibraryCopyDeps, "read">} deps
 * @returns {Promise<CopyIndex | null>}
 */
async function readIndex(deps) {
  return asIndex(await deps.read(INDEX_KEY));
}

/**
 * @param {CopyIndex} index
 * @param {string} docId an article's url or a book's id
 * @returns {boolean}
 */
export function indexHolds(index, docId) {
  return Object.hasOwn(index.articles, docId) || Object.hasOwn(index.books, docId);
}

/**
 * The keys of every document the index accounts for: each one's row and
 * the place in it - the place's key derived, whether or not a row stands
 * under it, because a position is written only for a document the index
 * holds. What a restore reads: the text, never the pictures.
 *
 * @param {CopyIndex} index
 * @returns {string[]}
 */
export function documentKeys(index) {
  /** @type {string[]} */
  const keys = [];
  for (const url of Object.keys(index.articles)) keys.push(articleKey(url), positionKey(url));
  for (const id of Object.keys(index.books)) keys.push(bookKey(id), positionKey(id));
  return keys;
}

/**
 * The keys of one document's pictures, from the count the index claims.
 *
 * @param {CopyIndex} index
 * @param {string} url an article's address or a book's id
 * @returns {string[]}
 */
export function pictureKeys(index, url) {
  const count = index.pictures[url]?.count ?? 0;
  return Array.from({ length: count }, (_, at) => pictureKey(url, at));
}

/**
 * Every key the index accounts for - documents, places and pictures. What
 * a clear removes and a build sweeps.
 *
 * @param {CopyIndex} index
 * @returns {string[]}
 */
export function indexedKeys(index) {
  return [...documentKeys(index), ...Object.keys(index.pictures).flatMap((url) => pictureKeys(index, url))];
}

/**
 * The copy picked out of a set of rows by its keys and narrowed row by row.
 * A row that will not read is still one of the copy's keys - a clear takes
 * it - but no document: the library gets back only what opens. Handed the
 * rows the index names on a restore, and the whole area exactly once, by
 * `migrateIndex`.
 *
 * @param {Record<string, unknown>} rows keyed as the area keys them
 * @returns {CopiedLibrary}
 */
export function copiedLibrary(rows) {
  /** @type {string[]} */
  const keys = [];
  /** @type {SavedArticle[]} */
  const articles = [];
  /** @type {CopiedBook[]} */
  const books = [];
  /** @type {ReadingPosition[]} */
  const positions = [];
  /** @type {PictureRow[]} */
  const pictures = [];
  for (const [key, value] of Object.entries(rows)) {
    if (!key.startsWith(LIBRARY_COPY_PREFIX)) continue;
    keys.push(key);
    const kind = key.slice(LIBRARY_COPY_PREFIX.length).split(":", 1)[0];
    if (kind === "article") {
      const article = asCopiedArticle(value);
      if (article !== null && key === articleKey(article.url)) articles.push(article);
    } else if (kind === "book") {
      const book = asCopiedBook(value);
      if (book !== null && key === bookKey(book.meta.id)) books.push(book);
    } else if (kind === "position") {
      const position = asCopiedPosition(value);
      if (position !== null && key === positionKey(position.docId)) positions.push(position);
    } else if (kind === "picture") {
      const picture = asCopiedPicture(value);
      if (picture !== null && key === pictureKey(picture.url, picture.index)) pictures.push(picture);
    }
  }
  const docIds = new Set([...articles.map((article) => article.url), ...books.map((book) => book.meta.id)]);
  return {
    keys: keys.sort(),
    articles: articles.sort((a, b) => a.url.localeCompare(b.url)),
    books: books.sort((a, b) => a.meta.id.localeCompare(b.meta.id)),
    positions: positions.filter((position) => docIds.has(position.docId)),
    pictures: pictures.sort((a, b) => a.url.localeCompare(b.url) || a.index - b.index),
  };
}

/**
 * What a row takes, as the index records it: the size of the row as it
 * would be written, near enough - the area's own accounting is not readable
 * in every browser.
 *
 * @param {unknown} value
 * @returns {number} bytes
 */
function bytesOf(value) {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

/**
 * The copy in two numbers for the settings page, or null when there is no
 * copy at all - the line then says so, or says the switch is off. A sum
 * over the index: the light row a document was patched with since may be
 * a few bytes off its record, which a line in megabytes never shows. The
 * pictures count into the space, not into the documents - they are part
 * of theirs.
 *
 * @param {CopyIndex | null} index
 * @returns {{ docs: number, bytes: number } | null}
 */
export function copySummary(index) {
  if (index === null) return null;
  const sizes = [...Object.values(index.articles), ...Object.values(index.books)];
  if (sizes.length === 0) return null;
  const pictures = Object.values(index.pictures).reduce((sum, summary) => sum + summary.bytes, 0);
  return { docs: sizes.length, bytes: sizes.reduce((sum, bytes) => sum + bytes, 0) + pictures };
}

/**
 * @param {Pick<LibraryCopyDeps, "read">} deps
 * @returns {Promise<{ docs: number, bytes: number } | null>}
 */
export async function summarizeCopy(deps) {
  return copySummary(await readIndex(deps));
}

/**
 * The rows every document of a library is copied as, keyed - the shape one
 * build writes and one restore reads.
 *
 * @param {LibrarySnapshot} library
 * @returns {Map<string, unknown>}
 */
export function rowsOf(library) {
  /** @type {Map<string, unknown>} */
  const rows = new Map();
  for (const article of library.articles) rows.set(articleKey(article.url), articleRow(article));
  for (const book of library.books) rows.set(bookKey(book.meta.id), bookRow(book));
  const docIds = new Set([
    ...library.articles.map((article) => article.url),
    ...library.books.map((book) => book.meta.id),
  ]);
  for (const position of library.positions) {
    if (docIds.has(position.docId)) rows.set(positionKey(position.docId), positionRow(position));
  }
  return rows;
}

/**
 * The index a library's rows are claimed under, sizes and all - the text's;
 * the pictures are claimed as a build reaches them.
 *
 * @param {LibrarySnapshot} library
 * @param {Map<string, unknown>} rows as `rowsOf` keyed them
 * @returns {CopyIndex}
 */
export function indexOf(library, rows) {
  const index = emptyIndex();
  for (const article of library.articles) {
    index.articles[article.url] = bytesOf(rows.get(articleKey(article.url)));
  }
  for (const book of library.books) index.books[book.meta.id] = bytesOf(rows.get(bookKey(book.meta.id)));
  return index;
}

/**
 * The account a document's picture rows add up to, as the index claims it -
 * only when they are all there, first to last: a run with a hole is not
 * what the count says it is, and is swept rather than claimed.
 *
 * @param {PictureRow[]} rows one document's, in index order
 * @returns {PicturesSummary | null}
 */
function claimedPictures(rows) {
  if (rows.length === 0 || rows.some((row, at) => row.index !== at)) return null;
  return { count: rows.length, bytes: rows.reduce((sum, row) => sum + row.data.byteLength, 0) };
}

/**
 * The index where the copy has none - the one read of the whole area this
 * module makes, and the one time it is made. Built from the rows the first
 * version of the copy (#245) left behind, or from whatever an index that
 * will not read was standing over. Rows the index cannot account for - torn,
 * under a key that names another document, a place in a document that is
 * not here, a picture of one, or a run of pictures with a hole - are
 * removed: unclaimed, nothing would ever clear them. An area holding no
 * row of the copy gets no index either; the copy is then simply absent, and
 * the first document claimed will write one.
 *
 * @param {StorageDeps} deps
 * @returns {Promise<CopyIndex | null>} the index in place, or null for no copy
 */
export async function migrateIndex(deps) {
  const standing = await readIndex(deps);
  if (standing !== null) return standing;
  const all = await deps.readAll();
  const library = copiedLibrary(all);
  if (library.keys.length === 0) return null;
  const index = emptyIndex();
  for (const article of library.articles) index.articles[article.url] = bytesOf(all[articleKey(article.url)]);
  for (const book of library.books) index.books[book.meta.id] = bytesOf(all[bookKey(book.meta.id)]);
  for (const docId of [...Object.keys(index.articles), ...Object.keys(index.books)]) {
    const summary = claimedPictures(library.pictures.filter((picture) => picture.url === docId));
    if (summary !== null) index.pictures[docId] = summary;
  }
  const claimed = new Set(indexedKeys(index));
  await deps.remove(library.keys.filter((key) => !claimed.has(key)));
  if (copySummary(index) === null) return null;
  await deps.write({ [INDEX_KEY]: index });
  return index;
}

/**
 * A document claimed in the index - before its row is written, so that the
 * row can never be the one the index does not know.
 *
 * @param {"article" | "book"} kind
 * @param {string} docId
 * @param {number} bytes what the row about to be written takes
 * @param {StorageDeps} deps
 * @returns {Promise<void>}
 */
async function claim(kind, docId, bytes, deps) {
  const index = (await readIndex(deps)) ?? emptyIndex();
  (kind === "article" ? index.articles : index.books)[docId] = bytes;
  await deps.write({ [INDEX_KEY]: index });
}

/**
 * A document's claim released, with its pictures' - after their rows are
 * gone, for the same reason `claim` comes first. A document the index never
 * held costs no write.
 *
 * @param {"article" | "book"} kind
 * @param {string} docId
 * @param {StorageDeps} deps
 * @returns {Promise<void>}
 */
async function release(kind, docId, deps) {
  const index = await readIndex(deps);
  if (index === null) return;
  const sizes = kind === "article" ? index.articles : index.books;
  const held = Object.hasOwn(sizes, docId) || Object.hasOwn(index.pictures, docId);
  if (!held) return;
  delete sizes[docId];
  delete index.pictures[docId];
  await deps.write({ [INDEX_KEY]: index });
}

/**
 * The library written back from the copy, when - and only when - the
 * library is empty and the copy holds a document. The emptiness is asked
 * first, the index only then, and the rows only when the index names one,
 * so on every ordinary call this costs two counts and nothing else. The
 * text alone: the pictures wait for their article to be opened.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents came back
 */
export async function restoreLibrary(deps) {
  if (!(await deps.empty())) return 0;
  const index = await readIndex(deps);
  if (index === null || copySummary(index) === null) return 0;
  const library = copiedLibrary(await deps.readMany(documentKeys(index)));
  if (library.articles.length === 0 && library.books.length === 0) return 0;
  return await deps.putRows(library);
}

/**
 * One document's pictures back from the copy, one key at a time - never all
 * of a document's in one read, since one read of seventy pictures is the
 * message the index exists to avoid. A key the index claims and no row
 * answers (a save that died between the two writes) is simply not among
 * them, and so is a row that will not decode.
 *
 * @param {string} url an article's address or a book's id
 * @param {StorageDeps} deps
 * @returns {Promise<PictureRow[]>}
 */
export async function restorePictures(url, deps) {
  const index = await readIndex(deps);
  if (index === null) return [];
  /** @type {PictureRow[]} */
  const rows = [];
  for (const key of pictureKeys(index, url)) {
    const row = asCopiedPicture(await deps.read(key));
    if (row !== null && row.url === url) rows.push(row);
  }
  return rows;
}

/**
 * A set of documents into the copy under an index that claims them: the
 * index first, with every one of them, then every document written, one
 * row at a time so no single write carries the whole reading list, and
 * each document's pictures after its text, claimed by the document before
 * they are written. The whole library on a build, the missing part on a
 * completion.
 *
 * @param {LibrarySnapshot} library the documents to write, with their positions
 * @param {CopyIndex} index the index as it will stand, the documents claimed in it already
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<void>}
 */
async function writeDocuments(library, index, deps) {
  const rows = rowsOf(library);
  await deps.write({ [INDEX_KEY]: index });
  for (const [key, row] of rows) await deps.write({ [key]: row });
  const docIds = [...library.articles.map((article) => article.url), ...library.books.map((book) => book.meta.id)];
  for (const docId of docIds) {
    const pictures = await deps.pictures(docId);
    const summary = claimedPictures(pictures);
    if (summary === null) continue;
    index.pictures[docId] = summary;
    await deps.write({ [INDEX_KEY]: index });
    for (const picture of pictures) await deps.write({ [pictureKey(docId, picture.index)]: pictureRow(picture) });
  }
}

/**
 * The copy made whole from the library, when the switch is turned on: the
 * rows the standing index names and the library no longer does removed -
 * whatever a copy switched off and on again might have kept - then every
 * document claimed and written (`writeDocuments`).
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents the copy now holds
 */
export async function buildLibraryCopy(deps) {
  const library = await deps.snapshot();
  const rows = rowsOf(library);
  const index = indexOf(library, rows);
  const standing = await readIndex(deps);
  if (standing !== null) await deps.remove(indexedKeys(standing).filter((key) => !rows.has(key)));
  await writeDocuments(library, index, deps);
  return library.articles.length + library.books.length;
}

/**
 * The copy completed: every document the library holds and the index does
 * not, copied - with its position and its pictures - and nothing else
 * touched. Where the documents come from: a reading list saved while the
 * copy was off, and then the copy switched on by a default rather than by
 * the press that builds it (D146: on everywhere, for an install that never
 * chose); a claim that failed quietly, once. Asked on every list, so the
 * question is asked of the two key lists and the index alone, and the
 * library is read whole only when there is something to copy - which, for
 * one install, is once.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents the copy gained
 */
export async function completeLibraryCopy(deps) {
  if (!(await deps.enabled())) return 0;
  const index = (await readIndex(deps)) ?? emptyIndex();
  const held = await deps.documents();
  const wantedArticles = new Set(held.articles.filter((url) => !Object.hasOwn(index.articles, url)));
  const wantedBooks = new Set(held.books.filter((id) => !Object.hasOwn(index.books, id)));
  if (wantedArticles.size === 0 && wantedBooks.size === 0) return 0;
  const whole = await deps.snapshot();
  /** @type {LibrarySnapshot} */
  const missing = {
    articles: whole.articles.filter((article) => wantedArticles.has(article.url)),
    books: whole.books.filter((book) => wantedBooks.has(book.meta.id)),
    positions: whole.positions.filter(
      (position) => wantedArticles.has(position.docId) || wantedBooks.has(position.docId),
    ),
  };
  if (missing.articles.length === 0 && missing.books.length === 0) return 0;
  const rows = rowsOf(missing);
  const claimed = indexOf(missing, rows);
  index.articles = { ...index.articles, ...claimed.articles };
  index.books = { ...index.books, ...claimed.books };
  await writeDocuments(missing, index, deps);
  return missing.articles.length + missing.books.length;
}

/**
 * The copy removed whole, when the switch is turned off - every key the
 * index accounts for, and the index last.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents went
 */
export async function clearLibraryCopy(deps) {
  const index = await readIndex(deps);
  if (index === null) return 0;
  await deps.remove([...indexedKeys(index), INDEX_KEY]);
  return copySummary(index)?.docs ?? 0;
}

/**
 * One article into the copy, after its save - and, when the save wrote over
 * an older article, its reading position and its pictures out of it, the
 * way the database drops what was anchored into text that is gone.
 *
 * @param {SavedArticle} article
 * @param {boolean} replaced whether the save wrote over an older article
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyArticle(article, replaced, deps) {
  if (replaced) {
    await deps.remove([positionKey(article.url)]);
    await dropPictures(article.url, deps);
  }
  if (!(await deps.enabled())) return false;
  const row = articleRow(article);
  await claim("article", article.url, bytesOf(row), deps);
  await deps.write({ [articleKey(article.url)]: row });
  return true;
}

/**
 * One book into the copy, after the row that made it exist.
 *
 * @param {CopiedBook} book
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyBook(book, deps) {
  if (!(await deps.enabled())) return false;
  const row = bookRow(book);
  await claim("book", book.meta.id, bytesOf(row), deps);
  await deps.write({ [bookKey(book.meta.id)]: row });
  return true;
}

/**
 * Where the reader stopped, beside its document - and only beside one the
 * copy holds: a place in a document that is not here would be the row the
 * index does not know.
 *
 * @param {ReadingPosition} position
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyPosition(position, deps) {
  if (!(await deps.enabled())) return false;
  const index = await readIndex(deps);
  if (index === null || !indexHolds(index, position.docId)) return false;
  await deps.write({ [positionKey(position.docId)]: positionRow(position) });
  return true;
}

/**
 * One picture into the copy, beside its document and only beside one the
 * copy holds - claimed by count first, written second, like a document.
 * The pictures of a document arrive in order, so the count claimed is the
 * one past this picture's place. An article's as they are downloaded; a
 * book's after its row, which is written last of the import and claimed
 * only then (D183) - so they wait, and `library-copy.js` sends them right
 * behind it.
 *
 * @param {PictureRow} picture
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyPicture(picture, deps) {
  if (!(await deps.enabled())) return false;
  const index = await readIndex(deps);
  if (index === null || !indexHolds(index, picture.url)) return false;
  const before = index.pictures[picture.url] ?? { count: 0, bytes: 0 };
  index.pictures[picture.url] = {
    count: Math.max(before.count, picture.index + 1),
    bytes: before.bytes + picture.data.byteLength,
  };
  await deps.write({ [INDEX_KEY]: index });
  await deps.write({ [pictureKey(picture.url, picture.index)]: pictureRow(picture) });
  return true;
}

/**
 * A document's pictures out of the copy - always, switch or no switch: the
 * rows first, the claim after. A document the index holds no pictures of
 * costs one read.
 *
 * @param {string} url an article's address or a book's id
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<void>}
 */
export async function dropPictures(url, deps) {
  const index = await readIndex(deps);
  if (index === null || !Object.hasOwn(index.pictures, url)) return;
  await deps.remove(pictureKeys(index, url));
  delete index.pictures[url];
  await deps.write({ [INDEX_KEY]: index });
}

/**
 * A document's light row changed where it stands - read or unread again, a
 * table of contents found, pictures saved or removed - and nowhere else:
 * without a row under the key there is nothing to patch, which is also what
 * makes the switch unasked here (a copy switched off has no rows). The
 * index keeps the size it recorded: a patch moves a row by a handful of
 * bytes, and the line that sums them is in megabytes.
 *
 * @param {"article" | "book"} kind
 * @param {string} docId
 * @param {SavedMeta | BookMeta} meta
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether a row was patched
 */
export async function patchCopiedMeta(kind, docId, meta, deps) {
  const key = kind === "article" ? articleKey(docId) : bookKey(docId);
  const row = await deps.read(key);
  if (typeof row !== "object" || row === null) return false;
  await deps.write({ [key]: { ...row, meta } });
  return true;
}

/**
 * A document out of the copy, with its position and its pictures - always,
 * switch or no switch: a row about a document that is gone must not outlive
 * it. The rows go first, the claim after.
 *
 * @param {string} docId an article's url or a book's id
 * @param {"article" | "book"} kind
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<void>}
 */
export async function dropCopied(docId, kind, deps) {
  const index = await readIndex(deps);
  await deps.remove([
    kind === "article" ? articleKey(docId) : bookKey(docId),
    positionKey(docId),
    ...(index === null ? [] : pictureKeys(index, docId)),
  ]);
  await release(kind, docId, deps);
}
