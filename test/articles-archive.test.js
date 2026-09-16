import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_DOWNLOAD_BYTES } from "../src/lib/reader/pictures.js";
import {
  ARCHIVE_FILENAME,
  ARTICLES_ENTRY,
  archiveAccount,
  archivePictures,
  articlesEntry,
  asPictureRef,
  bookPictureEntryName,
  fromArchiveText,
  pictureEntries,
  pictureEntryName,
} from "../src/lib/store/articles-archive.js";
import { fileOrder, toArticlesFile } from "../src/lib/store/articles-file.js";
import { savedArticle } from "../src/lib/store/saved-article.js";

/**
 * The backup with pictures: the plain file's rows under `articles.json`,
 * a reference per picture, and the pictures as entries of their own -
 * written as the page streams them (D222): each article's pictures in
 * file order, the file last. The ZIP container is the reader page's
 * (fflate); here the entries are values.
 */

/**
 * @param {string} path
 * @param {Partial<Parameters<typeof savedArticle>[0]>} [over]
 * @returns {import("../src/lib/store/saved-article.js").SavedArticle}
 */
function article(path, over = {}) {
  const built = savedArticle({
    url: `https://example.com/${path}`,
    title: `Title of ${path}`,
    content: `<p>Body of ${path}</p><img data-src="https://cdn.example/${path}.jpg">`,
    savedAt: 1000,
    ...over,
  });
  assert.ok(built !== null);
  return built;
}

/** JPEG magic, then whatever - what the sniffer opens. */
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
/** PNG magic. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * @param {string} url
 * @param {number} index
 * @param {number[]} head
 * @param {number} [size]
 * @returns {import("../src/lib/reader/pictures.js").PictureRow}
 */
function picture(url, index, head, size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return {
    url,
    index,
    src: `https://cdn.example/${index}.jpg`,
    mime: head === PNG ? "image/png" : "image/jpeg",
    width: 800,
    height: 600,
    data: bytes.buffer,
  };
}

/** @param {{ name: string, data: Uint8Array }[]} entries */
const readerOf = (entries) => {
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  return (/** @type {string} */ name) => byName.get(name) ?? null;
};

const decode = (/** @type {Uint8Array} */ bytes) => new TextDecoder().decode(bytes);

/**
 * The entries as the reader page's stream writes them (D222): each
 * article's pictures under its place in the file's order, then the file
 * carrying their names.
 *
 * @param {import("../src/lib/store/saved-article.js").SavedArticle[]} articles
 * @param {Map<string, import("../src/lib/reader/pictures.js").PictureRow[]>} pictures
 * @param {Map<string, import("../src/lib/reader/position.js").ReadingPosition>} [positions]
 * @returns {import("../src/lib/store/articles-archive.js").ArchiveEntry[]}
 */
function streamed(articles, pictures, positions = new Map()) {
  /** @type {import("../src/lib/store/articles-archive.js").ArchiveEntry[]} */
  const entries = [];
  /** @type {Map<string, import("../src/lib/store/articles-archive.js").PictureRef[]>} */
  const refs = new Map();
  for (const [at, article] of fileOrder(articles).entries()) {
    const kept = pictureEntries(at, pictures.get(article.url) ?? []);
    if (kept.refs.length === 0) continue;
    entries.push(...kept.entries);
    refs.set(article.url, kept.refs);
  }
  entries.push(articlesEntry(articles, new Map(), positions, refs));
  return entries;
}

describe("the backup with pictures", () => {
  const plain = article("plain");
  const shot = article("shot", { savedAt: 2000 });
  const pictured = article("pictured", { savedAt: 3000 });
  const pictures = new Map([
    [pictured.url, [picture(pictured.url, 0, JPEG), picture(pictured.url, 1, PNG, 100)]],
    [shot.url, [picture(shot.url, 0, JPEG, 32)]],
  ]);

  it("names a picture's entry by the article's place in the file and the picture's in the article", () => {
    assert.equal(pictureEntryName(2, { index: 1, mime: "image/png" }), "pictures/2/1.png");
    assert.equal(pictureEntryName(0, { index: 7, mime: "image/webp" }), "pictures/0/7.webp");
    assert.equal(ARCHIVE_FILENAME, "reread-articles.zip");
  });

  it("writes each article's pictures stored as they are under its place in the file, then articles.json with a reference per picture", () => {
    // The file's order is the plain file's - oldest saved first - known
    // before the file is written, so the pictures can go first.
    assert.deepEqual(
      fileOrder([pictured, plain, shot]).map((article) => article.url),
      [plain.url, shot.url, pictured.url],
    );
    const entries = streamed([pictured, plain, shot], pictures);
    assert.deepEqual(
      entries.map(({ name, deflate }) => ({ name, deflate })),
      [
        { name: "pictures/1/0.jpg", deflate: false },
        { name: "pictures/2/0.jpg", deflate: false },
        { name: "pictures/2/1.png", deflate: false },
        { name: ARTICLES_ENTRY, deflate: true },
      ],
    );
    const stored = entries[2];
    const second = pictures.get(pictured.url)?.[1];
    assert.ok(stored !== undefined && second !== undefined);
    assert.deepEqual(stored.data, new Uint8Array(second.data));

    const text = decode(entries[3]?.data ?? new Uint8Array());
    const parsed = JSON.parse(text);
    assert.equal(parsed.format, "reread-articles");
    assert.equal(parsed.version, 1);
    assert.deepEqual(
      parsed.articles.map((/** @type {{ url: string }} */ row) => row.url),
      [plain.url, shot.url, pictured.url],
    );
    assert.equal("pictures" in parsed.articles[0], false);
    assert.deepEqual(parsed.articles[2].pictures, [
      { index: 0, file: "pictures/2/0.jpg", src: "https://cdn.example/0.jpg", mime: "image/jpeg", width: 800, height: 600 },
      { index: 1, file: "pictures/2/1.png", src: "https://cdn.example/1.jpg", mime: "image/png", width: 800, height: 600 },
    ]);
    // An article with no rows to write gets no entry and no field.
    assert.deepEqual(pictureEntries(4, []), { entries: [], refs: [] });
    // An archive of a list without pictures holds the plain file, byte for byte.
    const bare = streamed([pictured, plain, shot], new Map());
    assert.equal(bare.length, 1);
    assert.equal(decode(bare[0]?.data ?? new Uint8Array()), toArticlesFile([pictured, plain, shot]));
    // The reading list's positions travel with the articles (D213).
    const position = { docId: plain.url, segmentIndex: 0, blockIndex: 3, updatedAt: 7 };
    const placed = streamed([plain], new Map(), new Map([[plain.url, position]]));
    assert.deepEqual(fromArchiveText(decode(placed[0]?.data ?? new Uint8Array())).articles[0]?.position, position);
  });

  it("reads the articles as the plain file does, with the pictures each names beside them", () => {
    const entries = streamed([pictured, plain, shot], pictures);
    const read = fromArchiveText(decode(entries[3]?.data ?? new Uint8Array()));
    assert.equal(read.invalid, 0);
    assert.deepEqual(
      read.articles.map((row) => row.url),
      [plain.url, shot.url, pictured.url],
    );
    // No reference rides inside an article: the rows go to the database as
    // a plain file's do.
    assert.ok(read.articles.every((row) => !("pictures" in row)));
    assert.deepEqual([...read.refs.keys()], [shot.url, pictured.url]);
    assert.equal(read.refs.get(pictured.url)?.length, 2);

    const rows = archivePictures(pictured.url, read.refs.get(pictured.url) ?? [], readerOf(entries));
    assert.deepEqual(
      rows.map(({ data, ...rest }) => ({ ...rest, size: data.byteLength })),
      [
        { url: pictured.url, index: 0, src: "https://cdn.example/0.jpg", mime: "image/jpeg", width: 800, height: 600, size: 64 },
        { url: pictured.url, index: 1, src: "https://cdn.example/1.jpg", mime: "image/png", width: 800, height: 600, size: 100 },
      ],
    );
    assert.deepEqual(archiveAccount(read.refs, entries.map((entry) => ({ name: entry.name, originalSize: entry.data.byteLength }))), {
      count: 3,
      bytes: 64 + 100 + 32,
    });
  });

  it("refuses a reference that will not read, and a picture that is not one", () => {
    const ref = { index: 0, file: "pictures/0/0.jpg", src: "https://cdn.example/a.jpg", mime: "image/jpeg", width: 10, height: 10 };
    assert.deepEqual(asPictureRef(ref), ref);
    assert.equal(asPictureRef({ ...ref, file: "../../etc/passwd" }), null);
    assert.equal(asPictureRef({ ...ref, file: "pictures/0/0.svg" }), null);
    assert.equal(asPictureRef({ ...ref, mime: "image/svg+xml" }), null);
    assert.equal(asPictureRef({ ...ref, index: -1 }), null);
    assert.equal(asPictureRef({ ...ref, width: 0 }), null);
    assert.equal(asPictureRef({ ...ref, src: "" }), null);
    assert.equal(asPictureRef("ref"), null);

    // A reference to an entry that is missing, empty, too large, or not a
    // picture by its bytes - whatever it claims - yields no row; the rest
    // are numbered afresh, without a hole.
    const url = "https://example.com/x";
    const refs = [
      { ...ref, index: 0, file: "pictures/0/0.jpg" },
      { ...ref, index: 1, file: "pictures/0/1.jpg" },
      { ...ref, index: 2, file: "pictures/0/2.png" },
      { ...ref, index: 3, file: "pictures/0/3.jpg" },
      { ...ref, index: 4, file: "pictures/0/4.gif" },
    ];
    const html = new TextEncoder().encode("<html>not a picture</html>");
    const read = readerOf([
      { name: "pictures/0/1.jpg", data: new Uint8Array(0) },
      { name: "pictures/0/2.png", data: html },
      { name: "pictures/0/3.jpg", data: new Uint8Array(picture(url, 3, JPEG).data) },
      { name: "pictures/0/4.gif", data: new Uint8Array(MAX_DOWNLOAD_BYTES + 1) },
    ]);
    const rows = archivePictures(url, refs, read);
    assert.equal(rows.length, 1);
    const kept = rows[0];
    assert.ok(kept !== undefined);
    assert.equal(kept.index, 0);
    assert.equal(kept.mime, "image/jpeg");
    assert.equal(kept.src, refs[3]?.src);
  });

  it("reads references only for articles the file holds, the first entry under an address winning", () => {
    const text = JSON.stringify({
      format: "reread-articles",
      version: 1,
      articles: [
        { url: "https://example.com/a", title: "A", savedAt: 1, readAt: null, content: "<p>a</p>", pictures: [
          { index: 0, file: "pictures/0/0.jpg", src: "https://cdn.example/a.jpg", mime: "image/jpeg", width: 1, height: 1 },
          { index: 1, file: "not/a/picture", src: "https://cdn.example/b.jpg", mime: "image/jpeg", width: 1, height: 1 },
        ] },
        { url: "https://example.com/a", title: "A again", savedAt: 2, readAt: null, content: "<p>a</p>", pictures: [
          { index: 0, file: "pictures/1/0.jpg", src: "https://cdn.example/c.jpg", mime: "image/jpeg", width: 1, height: 1 },
        ] },
        { url: "not a url", title: "broken", savedAt: 3, readAt: null, content: "<p>x</p>", pictures: [
          { index: 0, file: "pictures/2/0.jpg", src: "https://cdn.example/d.jpg", mime: "image/jpeg", width: 1, height: 1 },
        ] },
        { url: "https://example.com/b", title: "B", savedAt: 4, readAt: null, content: "<p>b</p>", pictures: "none" },
      ],
    });
    const read = fromArchiveText(text);
    assert.equal(read.articles.length, 3);
    assert.equal(read.invalid, 1);
    assert.deepEqual([...read.refs.keys()], ["https://example.com/a"]);
    assert.deepEqual(
      read.refs.get("https://example.com/a")?.map((ref) => ref.file),
      ["pictures/0/0.jpg"],
    );
    // Not JSON, not ours: no articles, no references, no throw.
    assert.deepEqual(fromArchiveText("{").refs.size, 0);
    assert.deepEqual(fromArchiveText("{}").articles, []);
  });
});

describe("a book's picture entries (D218)", () => {
  it("are named under book/ and read as references like an article's", () => {
    assert.equal(bookPictureEntryName(0, { index: 3, mime: "image/jpeg" }), "pictures/book/0/3.jpg");
    const ref = asPictureRef({ index: 3, file: "pictures/book/0/3.jpg", src: "OEBPS/a.jpg", mime: "image/jpeg", width: 10, height: 10 });
    assert.equal(ref?.file, "pictures/book/0/3.jpg");
    assert.equal(asPictureRef({ index: 3, file: "pictures/books/0/3.jpg", src: "x", mime: "image/jpeg", width: 10, height: 10 }), null);
  });
});
