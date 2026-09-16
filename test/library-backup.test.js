import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INDEX_KEY,
  LIBRARY_COPY_PREFIX,
  articleKey,
  articleRow,
  asCopiedArticle,
  asCopiedBook,
  asCopiedPicture,
  asCopiedPosition,
  asIndex,
  bookKey,
  bookRow,
  buildLibraryCopy,
  clearLibraryCopy,
  completeLibraryCopy,
  copiedLibrary,
  copyArticle,
  copyBook,
  copyPicture,
  copyPosition,
  copySummary,
  documentKeys,
  dropCopied,
  dropPictures,
  indexOf,
  indexedKeys,
  migrateIndex,
  patchCopiedMeta,
  pictureKey,
  pictureRow,
  positionKey,
  positionRow,
  restoreLibrary,
  restorePictures,
  rowsOf,
  segmentsOf,
  summarizeCopy,
} from "../src/lib/store/library-backup.js";

/** @typedef {import("../src/lib/store/library-backup.js").LibraryCopyDeps} LibraryCopyDeps */
/** @typedef {import("../src/lib/store/library-backup.js").CopiedBook} CopiedBook */
/** @typedef {import("../src/lib/store/library-backup.js").CopiedLibrary} CopiedLibrary */
/** @typedef {import("../src/lib/store/library-backup.js").CopyIndex} CopyIndex */
/** @typedef {import("../src/lib/store/library-backup.js").LibrarySnapshot} LibrarySnapshot */
/** @typedef {import("../src/lib/store/saved-article.js").SavedArticle} SavedArticle */
/** @typedef {import("../src/lib/reader/position.js").ReadingPosition} ReadingPosition */
/** @typedef {import("../src/lib/reader/pictures.js").PictureRow} PictureRow */

/**
 * The copy of the reading list, held to the rules the other two copies keep
 * and to its own: one key per document under one index, additions only
 * while the switch is on, removals always, restored only into a library with
 * nothing in it - and the whole area read once, to put the index over a copy
 * from before it, and never again. No browser runs in CI - the library and
 * the storage area are stand-ins that remember what was asked of them.
 */

/**
 * @param {string} url
 * @param {Partial<SavedArticle>} [over]
 * @returns {SavedArticle}
 */
function article(url, over = {}) {
  return {
    url,
    hostname: "a.example",
    title: `Page at ${url}`,
    savedAt: 1000,
    readAt: null,
    content: "<p>Some text</p>",
    dir: null,
    lang: "en",
    ...over,
  };
}

/**
 * @param {string} id
 * @param {number} segmentCount
 * @returns {CopiedBook}
 */
function book(id, segmentCount) {
  return {
    meta: {
      id,
      title: `Book ${id}`,
      author: null,
      lang: "en",
      segmentCount,
      totalChars: 10 * segmentCount,
      addedAt: 2000,
      readAt: null,
      toc: null,
    },
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      blocks: [`<p>segment ${index}</p>`],
      charCount: 10,
    })),
  };
}

/**
 * @param {string} docId
 * @returns {ReadingPosition}
 */
function position(docId) {
  return { docId, segmentIndex: 0, blockIndex: 3, updatedAt: 3000, percent: 40 };
}

/**
 * @param {string} url
 * @param {number} index
 * @param {number} [size]
 * @returns {PictureRow}
 */
function picture(url, index, size = 16) {
  const data = new Uint8Array(size);
  for (let at = 0; at < size; at += 1) data[at] = (index * 31 + at) % 256;
  return {
    url,
    index,
    src: `https://cdn.example/${index}.jpg`,
    mime: "image/jpeg",
    width: 800,
    height: 600,
    data: data.buffer,
  };
}

/** @param {unknown} row */
const bytes = (row) => new TextEncoder().encode(JSON.stringify(row)).length;

/**
 * The index a library's documents stand under, as a build would write it -
 * before any pictures.
 *
 * @param {LibrarySnapshot} library
 * @returns {CopyIndex}
 */
function indexFor(library) {
  return indexOf(library, rowsOf(library));
}

/**
 * @param {{
 *   enabled?: boolean,
 *   empty?: boolean,
 *   area?: Record<string, unknown>,
 *   snapshot?: LibrarySnapshot,
 *   documents?: { articles: string[], books: string[] },
 *   pictures?: Record<string, PictureRow[]>,
 * }} [script]
 */
function standIn(script = {}) {
  /** @type {string[]} */
  const asked = [];
  /** @type {Record<string, unknown>} */
  const area = { ...(script.area ?? {}) };
  /** @type {CopiedLibrary | null} */
  let put = null;
  /** @type {LibraryCopyDeps} */
  const deps = {
    enabled: async () => {
      asked.push("enabled");
      return script.enabled ?? true;
    },
    empty: async () => {
      asked.push("empty");
      return script.empty ?? false;
    },
    documents: async () => {
      asked.push("documents");
      const snapshot = script.snapshot ?? { articles: [], books: [], positions: [] };
      return (
        script.documents ?? {
          articles: snapshot.articles.map((article) => article.url),
          books: snapshot.books.map((book) => book.meta.id),
        }
      );
    },
    putRows: async (library) => {
      asked.push(`putRows ${library.articles.length + library.books.length}`);
      put = library;
      return library.articles.length + library.books.length;
    },
    snapshot: async () => {
      asked.push("snapshot");
      return script.snapshot ?? { articles: [], books: [], positions: [] };
    },
    pictures: async (url) => {
      asked.push(`pictures ${url}`);
      return script.pictures?.[url] ?? [];
    },
    readAll: async () => {
      asked.push("readAll");
      return { ...area };
    },
    read: async (key) => {
      asked.push(`read ${key}`);
      return area[key];
    },
    readMany: async (keys) => {
      asked.push(`readMany ${keys.join(",")}`);
      return Object.fromEntries(keys.filter((key) => key in area).map((key) => [key, area[key]]));
    },
    write: async (items) => {
      asked.push(`write ${Object.keys(items).join(",")}`);
      Object.assign(area, items);
    },
    remove: async (keys) => {
      asked.push(`remove ${keys.join(",")}`);
      for (const key of keys) delete area[key];
    },
  };
  return { deps, asked, area, put: () => put };
}

/** @param {unknown} value */
const throughJson = (value) => JSON.parse(JSON.stringify(value));

describe("the copy of the reading list", () => {
  it("copies an article as its two halves and reads it back whole", () => {
    const saved = article("https://a.example/p", { readAt: 5000, dir: "rtl" });
    const row = articleRow(saved);
    assert.deepEqual(row.meta, {
      url: saved.url,
      hostname: "a.example",
      title: saved.title,
      savedAt: 1000,
      readAt: 5000,
    });
    assert.deepEqual(asCopiedArticle(throughJson(row)), saved);

    // Torn rows read as no article: the library gets back only what opens.
    assert.equal(asCopiedArticle({ ...row, content: "" }), null);
    assert.equal(asCopiedArticle({ ...row, meta: { title: "no address" } }), null);
    assert.equal(asCopiedArticle({ ...row, version: 2 }), null);
    assert.equal(asCopiedArticle("not a row"), null);

    // The light row's account of its pictures rides in the meta.
    const pictured = article("https://a.example/p", { pictures: { count: 2, bytes: 32 } });
    assert.deepEqual(asCopiedArticle(throughJson(articleRow(pictured))), pictured);
  });

  it("copies a book only with all of its text, in order", () => {
    const whole = book("b1", 3);
    const rows = whole.segments.map((segment, index) => ({ bookId: "b1", index, ...segment }));
    assert.deepEqual(segmentsOf(whole.meta, rows), whole.segments);
    // A missing segment, one out of order, or a count the row does not
    // promise: not a book anybody could open on every page.
    assert.equal(segmentsOf(whole.meta, rows.slice(0, 2)), null);
    assert.equal(segmentsOf(whole.meta, [rows[0], rows[2], rows[1]]), null);
    assert.equal(segmentsOf({ ...whole.meta, segmentCount: 2 }, rows), null);

    const row = bookRow(whole);
    assert.deepEqual(asCopiedBook(throughJson(row)), whole);
    assert.equal(asCopiedBook({ ...row, segments: row.segments.slice(1) }), null);
    assert.equal(asCopiedBook({ ...row, segments: [...row.segments.slice(0, 2), { blocks: [] }] }), null);
    assert.equal(asCopiedBook({ ...row, version: 0 }), null);

    // A segment's pictures (D183) ride the copy with the segment: the part
    // that comes back names the rows it shows, or the restored pictures
    // would stand under a text that asks for none of them.
    const pictured = book("b2", 1);
    const shown = pictured.segments[0];
    assert.ok(shown);
    pictured.segments[0] = { ...shown, pictures: [0, 2] };
    pictured.meta.pictures = { count: 3, bytes: 48 };
    assert.deepEqual(asCopiedBook(throughJson(bookRow(pictured))), pictured);
  });

  it("copies where the reader stopped, and refuses half a place", () => {
    const place = position("https://a.example/p");
    assert.deepEqual(asCopiedPosition(throughJson(positionRow(place))), place);
    assert.equal(asCopiedPosition({ version: 1, position: { docId: "x" } }), null);
    assert.equal(asCopiedPosition({ version: 3, position: place }), null);
  });

  it("copies a picture as text and reads its bytes back, or nothing", () => {
    const shot = picture("https://a.example/p", 3, 1000);
    const row = pictureRow(shot);
    assert.equal(typeof row.data, "string");
    assert.deepEqual(asCopiedPicture(throughJson(row)), shot);
    assert.equal(asCopiedPicture({ ...row, data: "not base64!" }), null);
    assert.equal(asCopiedPicture({ ...row, data: "" }), null);
    assert.equal(asCopiedPicture({ ...row, version: 2 }), null);
    assert.equal(asCopiedPicture({ ...row, mime: "image/svg+xml" }), null);
    assert.equal(asCopiedPicture(null), null);
  });

  it("finds the copy among rows by its prefix, and keeps only what opens", () => {
    const kept = article("https://a.example/kept");
    const shelf = book("b1", 1);
    const area = {
      vocabBackup: { version: 1, phrases: [] },
      config: { keepArticles: true },
      [articleKey(kept.url)]: articleRow(kept),
      [bookKey("b1")]: bookRow(shelf),
      [positionKey(kept.url)]: positionRow(position(kept.url)),
      [pictureKey(kept.url, 0)]: pictureRow(picture(kept.url, 0)),
      // A place in a document the copy does not hold: an orphan nothing
      // would ever clean, so it stays out.
      [positionKey("https://a.example/gone")]: positionRow(position("https://a.example/gone")),
      // A row under the wrong key names no document the key does.
      [articleKey("https://a.example/other")]: articleRow(article("https://a.example/elsewhere")),
      [pictureKey(kept.url, 5)]: pictureRow(picture(kept.url, 4)),
      // Unreadable, but the copy's: a clear has to take it.
      [`${LIBRARY_COPY_PREFIX}article:https://a.example/torn`]: { version: 1 },
    };
    const library = copiedLibrary(area);
    assert.deepEqual(library.articles, [kept]);
    assert.deepEqual(library.books, [shelf]);
    assert.deepEqual(library.positions, [position(kept.url)]);
    assert.deepEqual(library.pictures, [picture(kept.url, 0)]);
    assert.deepEqual(library.keys, [
      articleKey(kept.url),
      articleKey("https://a.example/other"),
      `${LIBRARY_COPY_PREFIX}article:https://a.example/torn`,
      bookKey("b1"),
      pictureKey(kept.url, 0),
      pictureKey(kept.url, 5),
      positionKey("https://a.example/gone"),
      positionKey(kept.url),
    ]);
  });

  it("reads the index as stored, and refuses one that will not read", () => {
    const index = {
      version: 1,
      articles: { "https://a.example/p": 120 },
      books: { b1: 3000 },
      pictures: { "https://a.example/p": { count: 2, bytes: 4096 } },
    };
    assert.deepEqual(asIndex(throughJson(index)), index);
    // An index from before pictures (#249) reads as one with none.
    assert.deepEqual(asIndex({ version: 1, articles: {}, books: {} }), {
      version: 1,
      articles: {},
      books: {},
      pictures: {},
    });
    assert.equal(asIndex(undefined), null);
    assert.equal(asIndex({ version: 2, articles: {}, books: {} }), null);
    assert.equal(asIndex({ version: 1, articles: [], books: {} }), null);
    assert.equal(asIndex({ version: 1, articles: { u: "big" }, books: {} }), null);
    assert.equal(asIndex({ version: 1, articles: { u: -1 }, books: {} }), null);
    assert.equal(asIndex({ version: 1, articles: {} }), null);
    assert.equal(asIndex({ version: 1, articles: {}, books: {}, pictures: { u: { count: 0, bytes: 0 } } }), null);
    assert.equal(asIndex({ version: 1, articles: {}, books: {}, pictures: [] }), null);

    // Every document's row and the place in it - the place's key derived,
    // row or no row under it - and the pictures by the count claimed.
    assert.deepEqual(documentKeys(index), [
      articleKey("https://a.example/p"),
      positionKey("https://a.example/p"),
      bookKey("b1"),
      positionKey("b1"),
    ]);
    assert.deepEqual(indexedKeys(index), [
      ...documentKeys(index),
      pictureKey("https://a.example/p", 0),
      pictureKey("https://a.example/p", 1),
    ]);
  });

  it("puts the index over a copy from before it in one read of the whole area, and sweeps what it cannot claim", async () => {
    const kept = article("https://a.example/kept");
    const shelf = book("b1", 2);
    const legacy = standIn({
      area: {
        vocabBackup: { version: 1, phrases: [] },
        [articleKey(kept.url)]: articleRow(kept),
        [bookKey("b1")]: bookRow(shelf),
        [positionKey(kept.url)]: positionRow(position(kept.url)),
        [positionKey("https://a.example/gone")]: positionRow(position("https://a.example/gone")),
        [articleKey("https://a.example/other")]: articleRow(article("https://a.example/elsewhere")),
        [`${LIBRARY_COPY_PREFIX}article:https://a.example/torn`]: { version: 1 },
      },
    });
    const index = await migrateIndex(legacy.deps);
    assert.deepEqual(index, {
      version: 1,
      articles: { [kept.url]: bytes(articleRow(kept)) },
      books: { b1: bytes(bookRow(shelf)) },
      pictures: {},
    });
    assert.deepEqual(legacy.area[INDEX_KEY], index);
    // The documents that read stay, with their places; the orphan place,
    // the row under the wrong key and the torn row go - unclaimed, nothing
    // would ever clear them.
    assert.deepEqual(Object.keys(legacy.area).sort(), [
      articleKey(kept.url),
      bookKey("b1"),
      INDEX_KEY,
      positionKey(kept.url),
      "vocabBackup",
    ]);
    assert.deepEqual(legacy.asked, [
      `read ${INDEX_KEY}`,
      "readAll",
      `remove ${articleKey("https://a.example/other")},${LIBRARY_COPY_PREFIX}article:https://a.example/torn,${positionKey("https://a.example/gone")}`,
      `write ${INDEX_KEY}`,
    ]);

    // An index in place is the end of it: one read of a small key.
    assert.deepEqual(await migrateIndex(legacy.deps), index);
    assert.deepEqual(legacy.asked.slice(4), [`read ${INDEX_KEY}`]);

    // No row of the copy at all: no index either, and nothing written.
    const none = standIn({ area: { vocabBackup: { version: 1 } } });
    assert.equal(await migrateIndex(none.deps), null);
    assert.deepEqual(Object.keys(none.area), ["vocabBackup"]);

    // Only rows that will not read: swept, and still no index.
    const torn = standIn({ area: { [`${LIBRARY_COPY_PREFIX}book:torn`]: "not a row" } });
    assert.equal(await migrateIndex(torn.deps), null);
    assert.deepEqual(Object.keys(torn.area), []);

    // An index that will not read is no index: built again from the rows,
    // pictures claimed where their run is whole - a book's as an article's
    // (D183) - swept where it has a hole or belongs to nobody here.
    const broken = standIn({
      area: {
        [INDEX_KEY]: { version: 9 },
        [articleKey(kept.url)]: articleRow(kept),
        [pictureKey(kept.url, 0)]: pictureRow(picture(kept.url, 0, 10)),
        [pictureKey(kept.url, 1)]: pictureRow(picture(kept.url, 1, 20)),
        [bookKey("b1")]: bookRow(shelf),
        [pictureKey("b1", 0)]: pictureRow(picture("b1", 0, 5)),
        [articleKey("https://a.example/holed")]: articleRow(article("https://a.example/holed")),
        [pictureKey("https://a.example/holed", 1)]: pictureRow(picture("https://a.example/holed", 1)),
        [pictureKey("https://a.example/nobody", 0)]: pictureRow(picture("https://a.example/nobody", 0)),
      },
    });
    assert.deepEqual(await migrateIndex(broken.deps), {
      version: 1,
      articles: {
        "https://a.example/holed": bytes(articleRow(article("https://a.example/holed"))),
        [kept.url]: bytes(articleRow(kept)),
      },
      books: { b1: bytes(bookRow(shelf)) },
      pictures: { [kept.url]: { count: 2, bytes: 30 }, b1: { count: 1, bytes: 5 } },
    });
    assert.deepEqual(Object.keys(broken.area).sort(), [
      articleKey("https://a.example/holed"),
      articleKey(kept.url),
      bookKey("b1"),
      INDEX_KEY,
      pictureKey("b1", 0),
      pictureKey(kept.url, 0),
      pictureKey(kept.url, 1),
    ]);
  });

  it("restores only into an empty library, and reads the rows the index names only then", async () => {
    const full = standIn({ empty: false, area: { [articleKey("u")]: articleRow(article("u")) } });
    assert.equal(await restoreLibrary(full.deps), 0);
    assert.deepEqual(full.asked, ["empty"]);

    const nothingToRestore = standIn({ empty: true, area: { vocabBackup: {} } });
    assert.equal(await restoreLibrary(nothingToRestore.deps), 0);
    assert.deepEqual(nothingToRestore.asked, ["empty", `read ${INDEX_KEY}`]);

    const kept = article("https://a.example/p", { pictures: { count: 1, bytes: 16 } });
    const library = { articles: [kept], books: [book("b1", 2)], positions: [position("b1")] };
    const index = { ...indexFor(library), pictures: { [kept.url]: { count: 1, bytes: 16 } } };
    const emptied = standIn({
      empty: true,
      area: {
        [INDEX_KEY]: index,
        [articleKey(kept.url)]: articleRow(kept),
        [bookKey("b1")]: bookRow(book("b1", 2)),
        [positionKey("b1")]: positionRow(position("b1")),
        [pictureKey(kept.url, 0)]: pictureRow(picture(kept.url, 0)),
      },
    });
    assert.equal(await restoreLibrary(emptied.deps), 2);
    // The text alone: the pictures wait for their article to be opened.
    assert.deepEqual(emptied.asked, [
      "empty",
      `read ${INDEX_KEY}`,
      `readMany ${documentKeys(index).join(",")}`,
      "putRows 2",
    ]);
    const put = emptied.put();
    assert.ok(put !== null);
    assert.deepEqual(put.articles, [kept]);
    assert.deepEqual(put.books, [book("b1", 2)]);
    assert.deepEqual(put.positions, [position("b1")]);

    // A claim without a row - a page that died between the two writes -
    // restores nothing for that document, and the rest comes back.
    const ghost = standIn({
      empty: true,
      area: {
        [INDEX_KEY]: { ...index, articles: { ...index.articles, "https://a.example/ghost": 50 } },
        [articleKey(kept.url)]: articleRow(kept),
        [bookKey("b1")]: bookRow(book("b1", 2)),
      },
    });
    assert.equal(await restoreLibrary(ghost.deps), 2);
    assert.deepEqual(ghost.put()?.articles, [kept]);
  });

  it("brings an article's pictures back one key at a time, torn ones left out", async () => {
    const url = "https://a.example/p";
    const stand = standIn({
      area: {
        [INDEX_KEY]: {
          version: 1,
          articles: { [url]: 100 },
          books: {},
          pictures: { [url]: { count: 3, bytes: 48 } },
        },
        [pictureKey(url, 0)]: pictureRow(picture(url, 0)),
        // Claimed and never written: a save that died between the writes.
        [pictureKey(url, 2)]: { version: 1, url, index: 2, data: "not base64!" },
      },
    });
    assert.deepEqual(await restorePictures(url, stand.deps), [picture(url, 0)]);
    assert.deepEqual(stand.asked, [
      `read ${INDEX_KEY}`,
      `read ${pictureKey(url, 0)}`,
      `read ${pictureKey(url, 1)}`,
      `read ${pictureKey(url, 2)}`,
    ]);
    // No index, no pictures - and an article the index holds none of.
    assert.deepEqual(await restorePictures(url, standIn().deps), []);
    assert.deepEqual(await restorePictures("https://a.example/other", stand.deps), []);
  });

  it("builds the copy from the whole library, claims before it writes, and sweeps the rows it no longer names", async () => {
    const kept = article("https://a.example/kept");
    const shelf = book("b1", 2);
    const deleted = article("https://a.example/deleted");
    const library = {
      articles: [kept],
      books: [shelf],
      positions: [position(kept.url), position("https://a.example/orphan")],
    };
    const stand = standIn({
      snapshot: library,
      // The article's two pictures, and the book's one (D183).
      pictures: {
        [kept.url]: [picture(kept.url, 0, 10), picture(kept.url, 1, 20)],
        b1: [picture("b1", 0, 5)],
      },
      area: {
        vocabBackup: { version: 1 },
        // What a copy switched off and on again might have kept: a document
        // the library no longer has, claimed by the index that stood, with
        // a picture of its own.
        [INDEX_KEY]: {
          ...indexFor({ articles: [deleted], books: [], positions: [] }),
          pictures: { [deleted.url]: { count: 1, bytes: 16 } },
        },
        [articleKey(deleted.url)]: articleRow(deleted),
        [positionKey(deleted.url)]: positionRow(position(deleted.url)),
        [pictureKey(deleted.url, 0)]: pictureRow(picture(deleted.url, 0)),
      },
    });
    assert.equal(await buildLibraryCopy(stand.deps), 2);
    assert.deepEqual(Object.keys(stand.area).sort(), [
      articleKey(kept.url),
      bookKey("b1"),
      INDEX_KEY,
      pictureKey("b1", 0),
      pictureKey(kept.url, 0),
      pictureKey(kept.url, 1),
      positionKey(kept.url),
      "vocabBackup",
    ]);
    assert.deepEqual(stand.area[INDEX_KEY], {
      ...indexFor(library),
      pictures: { [kept.url]: { count: 2, bytes: 30 }, b1: { count: 1, bytes: 5 } },
    });
    assert.deepEqual(stand.area[bookKey("b1")], bookRow(shelf));
    assert.deepEqual(stand.area[pictureKey(kept.url, 1)], pictureRow(picture(kept.url, 1, 20)));
    assert.deepEqual(stand.area[pictureKey("b1", 0)], pictureRow(picture("b1", 0, 5)));
    // The stale rows go first, the index claims every document next, then
    // one document per write - never the whole reading list in one - and
    // each document's pictures after the text, claimed before written.
    assert.deepEqual(stand.asked.slice(2), [
      `remove ${articleKey(deleted.url)},${positionKey(deleted.url)},${pictureKey(deleted.url, 0)}`,
      `write ${INDEX_KEY}`,
      `write ${articleKey(kept.url)}`,
      `write ${bookKey("b1")}`,
      `write ${positionKey(kept.url)}`,
      `pictures ${kept.url}`,
      `write ${INDEX_KEY}`,
      `write ${pictureKey(kept.url, 0)}`,
      `write ${pictureKey(kept.url, 1)}`,
      "pictures b1",
      `write ${INDEX_KEY}`,
      `write ${pictureKey("b1", 0)}`,
    ]);
  });

  it("keys every document of a library, and a position only beside its document", () => {
    const rows = rowsOf({
      articles: [article("u")],
      books: [book("b", 1)],
      positions: [position("u"), position("b"), position("nobody")],
    });
    assert.deepEqual([...rows.keys()], [articleKey("u"), bookKey("b"), positionKey("u"), positionKey("b")]);
  });

  it("clears every key the index accounts for, and nothing else", async () => {
    const library = { articles: [article("u")], books: [book("b", 1)], positions: [position("u")] };
    const stand = standIn({
      area: {
        vocabBackup: { version: 1 },
        marksBackup: { version: 1 },
        [INDEX_KEY]: { ...indexFor(library), pictures: { u: { count: 1, bytes: 16 } } },
        [articleKey("u")]: articleRow(article("u")),
        [bookKey("b")]: bookRow(book("b", 1)),
        [positionKey("u")]: positionRow(position("u")),
        [pictureKey("u", 0)]: pictureRow(picture("u", 0)),
      },
    });
    assert.equal(await clearLibraryCopy(stand.deps), 2);
    assert.deepEqual(Object.keys(stand.area).sort(), ["marksBackup", "vocabBackup"]);
    // No index, no copy: nothing to clear and nothing read for it.
    const none = standIn({ area: { vocabBackup: { version: 1 } } });
    assert.equal(await clearLibraryCopy(none.deps), 0);
    assert.deepEqual(none.asked, [`read ${INDEX_KEY}`]);
  });

  it("writes a document only while the switch is on, and claims it before its row", async () => {
    const off = standIn({ enabled: false });
    assert.equal(await copyArticle(article("u"), false, off.deps), false);
    assert.equal(await copyBook(book("b", 1), off.deps), false);
    assert.equal(await copyPosition(position("u"), off.deps), false);
    assert.equal(await copyPicture(picture("u", 0), off.deps), false);
    assert.deepEqual(Object.keys(off.area), []);

    const on = standIn({ enabled: true });
    assert.equal(await copyArticle(article("u"), false, on.deps), true);
    assert.equal(await copyBook(book("b", 1), on.deps), true);
    assert.equal(await copyPosition(position("u"), on.deps), true);
    assert.deepEqual(Object.keys(on.area).sort(), [articleKey("u"), bookKey("b"), INDEX_KEY, positionKey("u")]);
    assert.deepEqual(on.area[articleKey("u")], articleRow(article("u")));
    assert.deepEqual(on.area[INDEX_KEY], {
      version: 1,
      articles: { u: bytes(articleRow(article("u"))) },
      books: { b: bytes(bookRow(book("b", 1))) },
      pictures: {},
    });
    // The claim is written before the row it claims, every time; a place
    // needs no claim of its own, only a document to belong to.
    assert.deepEqual(
      on.asked.filter((step) => step.startsWith("write")),
      [
        `write ${INDEX_KEY}`,
        `write ${articleKey("u")}`,
        `write ${INDEX_KEY}`,
        `write ${bookKey("b")}`,
        `write ${positionKey("u")}`,
      ],
    );
  });

  it("writes a place only beside a document the copy holds", async () => {
    const nothing = standIn({ enabled: true });
    assert.equal(await copyPosition(position("u"), nothing.deps), false);
    assert.deepEqual(Object.keys(nothing.area), []);

    const holding = standIn({
      enabled: true,
      area: { [INDEX_KEY]: indexFor({ articles: [], books: [book("b", 1)], positions: [] }) },
    });
    assert.equal(await copyPosition(position("u"), holding.deps), false);
    assert.equal(await copyPosition(position("b"), holding.deps), true);
    assert.deepEqual(Object.keys(holding.area).sort(), [INDEX_KEY, positionKey("b")]);
  });

  it("copies a picture beside its document, claimed by count first, and only beside a document the copy holds", async () => {
    const stranger = standIn({ enabled: true, area: { [INDEX_KEY]: indexFor({ articles: [], books: [], positions: [] }) } });
    assert.equal(await copyPicture(picture("u", 0), stranger.deps), false);
    assert.deepEqual(Object.keys(stranger.area), [INDEX_KEY]);

    const library = { articles: [article("u")], books: [], positions: [] };
    const stand = standIn({ enabled: true, area: { [INDEX_KEY]: indexFor(library), [articleKey("u")]: articleRow(article("u")) } });
    assert.equal(await copyPicture(picture("u", 0, 10), stand.deps), true);
    assert.equal(await copyPicture(picture("u", 1, 20), stand.deps), true);
    assert.deepEqual(stand.area[INDEX_KEY], { ...indexFor(library), pictures: { u: { count: 2, bytes: 30 } } });
    assert.deepEqual(stand.area[pictureKey("u", 1)], pictureRow(picture("u", 1, 20)));
    assert.deepEqual(
      stand.asked.filter((step) => step.startsWith("write")),
      [`write ${INDEX_KEY}`, `write ${pictureKey("u", 0)}`, `write ${INDEX_KEY}`, `write ${pictureKey("u", 1)}`],
    );
    // The account rides the settings line as space, not as documents.
    assert.deepEqual(copySummary(/** @type {CopyIndex} */ (stand.area[INDEX_KEY])), {
      docs: 1,
      bytes: bytes(articleRow(article("u"))) + 30,
    });

    // A book's pictures (D183) stand under its id the way an article's
    // stand under its address - and only once the book's row is claimed,
    // which is why the import sends them after the row.
    const shelf = book("b1", 1);
    const shelved = { articles: [], books: [shelf], positions: [] };
    const late = standIn({ enabled: true, area: { [INDEX_KEY]: indexFor({ articles: [], books: [], positions: [] }) } });
    assert.equal(await copyPicture(picture("b1", 0, 10), late.deps), false);
    const claimed = standIn({ enabled: true, area: { [INDEX_KEY]: indexFor(shelved), [bookKey("b1")]: bookRow(shelf) } });
    assert.equal(await copyPicture(picture("b1", 0, 10), claimed.deps), true);
    assert.deepEqual(claimed.area[INDEX_KEY], { ...indexFor(shelved), pictures: { b1: { count: 1, bytes: 10 } } });
    assert.deepEqual(claimed.area[pictureKey("b1", 0)], pictureRow(picture("b1", 0, 10)));
  });

  it("drops an article's pictures on request and on a save that writes over it - rows first, claim after", async () => {
    const library = { articles: [article("u")], books: [], positions: [] };
    const pictured = { ...indexFor(library), pictures: { u: { count: 2, bytes: 30 } } };
    const stand = standIn({
      enabled: false,
      area: {
        [INDEX_KEY]: pictured,
        [articleKey("u")]: articleRow(article("u")),
        [pictureKey("u", 0)]: pictureRow(picture("u", 0, 10)),
        [pictureKey("u", 1)]: pictureRow(picture("u", 1, 20)),
      },
    });
    await dropPictures("u", stand.deps);
    assert.deepEqual(Object.keys(stand.area).sort(), [articleKey("u"), INDEX_KEY]);
    assert.deepEqual(stand.area[INDEX_KEY], indexFor(library));
    assert.deepEqual(stand.asked, [
      `read ${INDEX_KEY}`,
      `remove ${pictureKey("u", 0)},${pictureKey("u", 1)}`,
      `write ${INDEX_KEY}`,
    ]);
    // An article the index holds no pictures of costs one read.
    await dropPictures("u", stand.deps);
    assert.deepEqual(stand.asked.slice(3), [`read ${INDEX_KEY}`]);

    // A save over the article takes the old pictures with the old place,
    // switch or no switch - the new text has none yet.
    const written = standIn({
      enabled: false,
      area: {
        [INDEX_KEY]: pictured,
        [positionKey("u")]: positionRow(position("u")),
        [pictureKey("u", 0)]: pictureRow(picture("u", 0, 10)),
        [pictureKey("u", 1)]: pictureRow(picture("u", 1, 20)),
      },
    });
    assert.equal(await copyArticle(article("u"), true, written.deps), false);
    assert.deepEqual(Object.keys(written.area), [INDEX_KEY]);
    assert.deepEqual(written.area[INDEX_KEY], indexFor(library));
  });

  it("drops the old place when a save writes over an article, switch or no switch", async () => {
    const off = standIn({ enabled: false, area: { [positionKey("u")]: positionRow(position("u")) } });
    assert.equal(await copyArticle(article("u"), true, off.deps), false);
    assert.deepEqual(Object.keys(off.area), []);
    // A first save of an address drops nothing: there is nothing under it,
    // and the remove would be a write for no reason.
    const first = standIn({ enabled: false });
    await copyArticle(article("u"), false, first.deps);
    assert.deepEqual(first.asked, ["enabled"]);
  });

  it("patches a light row where one stands, and nowhere else", async () => {
    const saved = article("u");
    const index = indexFor({ articles: [saved], books: [], positions: [] });
    const stand = standIn({ area: { [INDEX_KEY]: index, [articleKey("u")]: articleRow(saved) } });
    const read = { ...articleRow(saved).meta, readAt: 9000 };
    assert.equal(await patchCopiedMeta("article", "u", read, stand.deps), true);
    assert.deepEqual(stand.area[articleKey("u")], { ...articleRow(saved), meta: read });
    // The index keeps the size it recorded - a patch is a handful of bytes
    // under a line written in megabytes.
    assert.deepEqual(stand.area[INDEX_KEY], index);
    // No row, no write - which is also what makes the switch unasked here.
    assert.equal(await patchCopiedMeta("article", "elsewhere", read, stand.deps), false);
    assert.deepEqual(Object.keys(stand.area).sort(), [articleKey("u"), INDEX_KEY]);
    assert.ok(!stand.asked.includes("enabled"));
  });

  it("drops a document with its place and its pictures, and lets the claim go last", async () => {
    const library = { articles: [article("u")], books: [book("b", 1)], positions: [position("u"), position("b")] };
    const stand = standIn({
      area: {
        [INDEX_KEY]: { ...indexFor(library), pictures: { u: { count: 1, bytes: 16 } } },
        [articleKey("u")]: articleRow(article("u")),
        [positionKey("u")]: positionRow(position("u")),
        [pictureKey("u", 0)]: pictureRow(picture("u", 0)),
        [bookKey("b")]: bookRow(book("b", 1)),
        [positionKey("b")]: positionRow(position("b")),
      },
    });
    await dropCopied("u", "article", stand.deps);
    assert.deepEqual(Object.keys(stand.area).sort(), [bookKey("b"), INDEX_KEY, positionKey("b")]);
    assert.deepEqual(stand.area[INDEX_KEY], indexFor({ articles: [], books: [book("b", 1)], positions: [] }));
    assert.deepEqual(stand.asked, [
      `read ${INDEX_KEY}`,
      `remove ${articleKey("u")},${positionKey("u")},${pictureKey("u", 0)}`,
      `read ${INDEX_KEY}`,
      `write ${INDEX_KEY}`,
    ]);
    await dropCopied("b", "book", stand.deps);
    assert.deepEqual(Object.keys(stand.area), [INDEX_KEY]);
    assert.deepEqual(stand.area[INDEX_KEY], { version: 1, articles: {}, books: {}, pictures: {} });

    // A document the index never held costs the removes and no write.
    const stranger = standIn({ area: { [INDEX_KEY]: indexFor(library) } });
    await dropCopied("nobody", "article", stranger.deps);
    assert.deepEqual(stranger.asked, [
      `read ${INDEX_KEY}`,
      `remove ${articleKey("nobody")},${positionKey("nobody")}`,
      `read ${INDEX_KEY}`,
    ]);
  });

  it("sums the copy from the index for the settings page", async () => {
    assert.equal(copySummary(null), null);
    assert.equal(copySummary({ version: 1, articles: {}, books: {}, pictures: {} }), null);
    const library = { articles: [article("u")], books: [book("b", 2)], positions: [position("u")] };
    const index = indexFor(library);
    const summary = copySummary(index);
    assert.ok(summary !== null);
    assert.equal(summary.docs, 2);
    assert.equal(summary.bytes, bytes(articleRow(article("u"))) + bytes(bookRow(book("b", 2))));

    // The line reads one key, never a row.
    const stand = standIn({ area: { [INDEX_KEY]: index, [articleKey("u")]: articleRow(article("u")) } });
    assert.deepEqual(await summarizeCopy(stand.deps), summary);
    assert.deepEqual(stand.asked, [`read ${INDEX_KEY}`]);
  });

  it("completes the copy with what the library holds and the index does not, and touches nothing else", async () => {
    // The shape D146 leaves behind: a reading list saved while the copy was
    // off - one article the copy already holds, one it does not, a book -
    // and then the copy on by default, with no press to build it.
    const held = article("https://a.example/held");
    const missing = article("https://a.example/missing", { pictures: { count: 1, bytes: 16 } });
    const shelf = book("b1", 2);
    const library = {
      articles: [held, missing],
      books: [shelf],
      positions: [position(held.url), position(missing.url), position("b1")],
    };
    const heldRow = articleRow(held);
    const stand = standIn({
      snapshot: library,
      pictures: { [held.url]: [picture(held.url, 0)], [missing.url]: [picture(missing.url, 0)] },
      area: { [INDEX_KEY]: indexFor({ articles: [held], books: [], positions: [] }), [articleKey(held.url)]: heldRow },
    });
    assert.equal(await completeLibraryCopy(stand.deps), 2);
    // The index claims the newcomers beside what it held, with their
    // pictures; the row it held is the very object it was, unrewritten.
    assert.deepEqual(stand.area[INDEX_KEY], {
      ...indexFor(library),
      pictures: { [missing.url]: { count: 1, bytes: 16 } },
    });
    assert.equal(stand.area[articleKey(held.url)], heldRow);
    assert.deepEqual(Object.keys(stand.area).sort(), [
      articleKey(held.url),
      articleKey(missing.url),
      bookKey("b1"),
      INDEX_KEY,
      pictureKey(missing.url, 0),
      positionKey("b1"),
      positionKey(missing.url),
    ]);
    // The question costs the two key lists and the index; the library is
    // read whole only because there was something to copy, and the held
    // article's pictures are never asked for. The book's are (D183), and
    // it has none to write.
    assert.deepEqual(stand.asked, [
      "enabled",
      `read ${INDEX_KEY}`,
      "documents",
      "snapshot",
      `write ${INDEX_KEY}`,
      `write ${articleKey(missing.url)}`,
      `write ${bookKey("b1")}`,
      `write ${positionKey(missing.url)}`,
      `write ${positionKey("b1")}`,
      `pictures ${missing.url}`,
      `write ${INDEX_KEY}`,
      `write ${pictureKey(missing.url, 0)}`,
      "pictures b1",
    ]);
  });

  it("completes nothing where the switch is off, the index holds everything, or the library is empty", async () => {
    const off = standIn({ enabled: false, snapshot: { articles: [article("u")], books: [], positions: [] } });
    assert.equal(await completeLibraryCopy(off.deps), 0);
    assert.deepEqual(off.asked, ["enabled"]);

    const library = { articles: [article("u")], books: [book("b1", 1)], positions: [] };
    const whole = standIn({ snapshot: library, area: { [INDEX_KEY]: indexFor(library) } });
    assert.equal(await completeLibraryCopy(whole.deps), 0);
    // The ordinary cost, on every list: never the library whole.
    assert.deepEqual(whole.asked, ["enabled", `read ${INDEX_KEY}`, "documents"]);

    // A fresh install: nothing to copy and no index written for it - the
    // first document claimed writes one.
    const bare = standIn();
    assert.equal(await completeLibraryCopy(bare.deps), 0);
    assert.deepEqual(Object.keys(bare.area), []);
  });

  it("builds the copy whole where the default found a reading list and no copy at all", async () => {
    const kept = article("https://a.example/kept");
    const library = { articles: [kept], books: [book("b1", 2)], positions: [position(kept.url)] };
    const stand = standIn({ snapshot: library, pictures: { [kept.url]: [picture(kept.url, 0, 10)] } });
    assert.equal(await completeLibraryCopy(stand.deps), 2);
    assert.deepEqual(stand.area[INDEX_KEY], {
      ...indexFor(library),
      pictures: { [kept.url]: { count: 1, bytes: 10 } },
    });
    assert.deepEqual(Object.keys(stand.area).sort(), [
      articleKey(kept.url),
      bookKey("b1"),
      INDEX_KEY,
      pictureKey(kept.url, 0),
      positionKey(kept.url),
    ]);
  });

  it("never reads the whole area once the index stands", async () => {
    const kept = article("https://a.example/kept");
    const stand = standIn({
      enabled: true,
      empty: true,
      snapshot: { articles: [kept, article("u")], books: [], positions: [] },
      pictures: { u: [picture("u", 0)] },
      area: { [articleKey(kept.url)]: articleRow(kept) },
    });
    await migrateIndex(stand.deps);
    await restoreLibrary(stand.deps);
    await copyArticle(article("u"), false, stand.deps);
    await copyPosition(position("u"), stand.deps);
    await copyPicture(picture("u", 0), stand.deps);
    await restorePictures("u", stand.deps);
    await patchCopiedMeta("article", "u", { ...articleRow(article("u")).meta, readAt: 1 }, stand.deps);
    await dropPictures("u", stand.deps);
    await dropCopied(kept.url, "article", stand.deps);
    await buildLibraryCopy(stand.deps);
    await completeLibraryCopy(stand.deps);
    await summarizeCopy(stand.deps);
    await clearLibraryCopy(stand.deps);
    assert.equal(stand.asked.filter((step) => step === "readAll").length, 1);
    assert.deepEqual(Object.keys(stand.area), []);
  });
});
