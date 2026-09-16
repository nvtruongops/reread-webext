/**
 * The one place that opens `reread-articles` - the reading list's database.
 *
 * Articles, books, book segments and reading positions live in this single
 * database rather than in one each, because IndexedDB has no transaction
 * across databases and the rows are bound to each other's lifetimes: deleting
 * a document must take its position along, deleting a book must take its
 * segments, and "must" here means one transaction or it is a promise, not an
 * invariant. The database keeps its original name from the days it held only
 * articles - renaming a database is a migration nobody needs.
 *
 * Versions, so far: 1 - `meta` + `content` (M3b); 2 - `positions` (D98);
 * 3 - `books` + `bookSegments` (EPUB import); 4 - `marks` (the highlighter);
 * 5 - `pictures` (an article's pictures, D145).
 * Every store is created behind a `contains()` guard, so the one upgrade
 * path serves a fresh install and every older version alike.
 *
 * Only the reader page opens this. The background never needs any of it, no
 * message carries content, and an extension page writing its own origin's
 * database directly is the same call D14 made for models.
 */

const DB_NAME = "reread-articles";
const DB_VERSION = 5;

/** The list's half of an article: one light row per saved page. */
export const META = "meta";
/** The article's half: the rebuilt markup, read only to render one. */
export const CONTENT = "content";
/** Where each document's reader stopped: one row per `docId`, or none. */
export const POSITIONS = "positions";
/** One light row per imported book: what the list shows, never the text. */
export const BOOKS = "books";
/** The text of the books, one row per segment, keyed `[bookId, index]`. */
export const BOOK_SEGMENTS = "bookSegments";
/** The highlighter's marks: one row per marked document, keyed `docId`. */
export const MARKS = "marks";
/**
 * An article's pictures (D145): one row per picture, keyed `[url, index]`,
 * read only to show that one article - the light row carries their count
 * and size, so the list never touches a byte of them.
 */
export const PICTURES = "pictures";

const ALL_STORES = [META, CONTENT, POSITIONS, BOOKS, BOOK_SEGMENTS, MARKS, PICTURES];

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "url" });
      if (!db.objectStoreNames.contains(CONTENT)) db.createObjectStore(CONTENT, { keyPath: "url" });
      if (!db.objectStoreNames.contains(POSITIONS)) {
        db.createObjectStore(POSITIONS, { keyPath: "docId" });
      }
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BOOK_SEGMENTS)) {
        db.createObjectStore(BOOK_SEGMENTS, { keyPath: ["bookId", "index"] });
      }
      if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: "docId" });
      if (!db.objectStoreNames.contains(PICTURES)) {
        db.createObjectStore(PICTURES, { keyPath: ["url", "index"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the articles database"));
    // A page holding an older version open would block the upgrade forever,
    // and waiting in silence is worse than saying so.
    request.onblocked = () => reject(new Error("The articles database is in use by another page"));
  });
}

/**
 * The seven stores of one open transaction, by name.
 *
 * @typedef {{
 *   meta: IDBObjectStore,
 *   content: IDBObjectStore,
 *   positions: IDBObjectStore,
 *   books: IDBObjectStore,
 *   bookSegments: IDBObjectStore,
 *   marks: IDBObjectStore,
 *   pictures: IDBObjectStore,
 * }} LibraryStores
 */

/**
 * One transaction over the whole database. Always the whole of it, not the
 * stores a caller names: the callers that matter delete across three stores
 * at once, the pages touching this database are this extension's own and
 * never crowd, and a lock wider than needed costs nothing here - while a
 * store forgotten from a list is a transaction that fails at its last step.
 *
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(stores: LibraryStores) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withLibrary(mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction(ALL_STORES, mode);
    /** @type {LibraryStores} */
    const stores = {
      meta: transaction.objectStore(META),
      content: transaction.objectStore(CONTENT),
      positions: transaction.objectStore(POSITIONS),
      books: transaction.objectStore(BOOKS),
      bookSegments: transaction.objectStore(BOOK_SEGMENTS),
      marks: transaction.objectStore(MARKS),
      pictures: transaction.objectStore(PICTURES),
    };
    const result = await work(stores);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Articles transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Articles transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}
