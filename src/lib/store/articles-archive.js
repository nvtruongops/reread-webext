/**
 * The reading list's backup with its pictures (D145): a ZIP archive holding
 * the same `articles.json` the plain backup is - the same rows in the same
 * order, plus a `pictures` field on the articles that have any - and one
 * entry per picture beside it.
 *
 * An archive rather than the pictures as base64 inside the JSON, for the
 * reader whose library is large: a JSON file is read whole and parsed
 * whole, and with pictures in it the parse would hold two or three times
 * the file in memory - a ceiling a phone reaches at a hundred megabytes,
 * and finds out about when the backup will not come back. An archive is
 * read one entry at a time (the book import's own way with an EPUB), and
 * an entry's size is known from the directory before a byte of it is
 * inflated. The plain `.json` stays what it was for a list without
 * pictures, and imports as it always did; the archive is written only
 * when the export is asked to include pictures.
 *
 * Written as a stream since D222: the page asks for one article's
 * pictures at a time (`pictureEntries`) and writes `articles.json` last
 * (`articlesEntry`), once every picture has an entry to be referred to -
 * the way a book's index follows its pictures (D218). Reading looks
 * entries up by name, so the order inside the archive changes nothing
 * for an import, this version's or an older one's.
 *
 * The archive itself is fflate's business on the reader page
 * (`src/reader/zip.js`). Everything here is a value in and a value out -
 * the entries to write, the rows and references read back - so that it
 * runs under `node --test`.
 */

import { MAX_DOWNLOAD_BYTES, sniffPictureType } from "../reader/pictures.js";
import { fileRows, fileText, fromArticlesFile } from "./articles-file.js";

/**
 * @typedef {import("../reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("../reader/marks.js").Mark} Mark
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("./articles-file.js").ArticlesFile} ArticlesFile
 */

/** What the archive is called - the plain file's name, in the other suit. */
export const ARCHIVE_FILENAME = "reread-articles.zip";

/** The entry that makes an archive a backup of the reading list rather than a book. */
export const ARTICLES_ENTRY = "articles.json";

/**
 * What `articles.json` says about one picture: where in the archive its
 * bytes are, and what the database row will say about it - everything but
 * the bytes, which are the entry's.
 *
 * @typedef {{ index: number, file: string, src: string, mime: string, width: number, height: number }} PictureRef
 */

/**
 * One entry to write: its name, its bytes, and whether it is worth
 * deflating - text is, a picture that is already compressed is not.
 *
 * @typedef {{ name: string, data: Uint8Array, deflate: boolean }} ArchiveEntry
 */

/** The kinds a picture entry may be, and the suffix each is written with. */
const EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/**
 * The one shape a picture entry's name may have - only what this module
 * writes, so a hand-made archive cannot point a reference anywhere else:
 * an article's under its place in `articles.json`, a book's (D218) under
 * `book/` and its place in `books.json`.
 */
const ENTRY_NAME = /^pictures\/(?:book\/)?\d{1,7}\/\d{1,7}\.(jpg|png|gif|webp)$/;

/** How much of an entry the type is read from, as on a download. */
export const SNIFF_BYTES = 512;

/**
 * Where an article's picture is written: under the article's place in the
 * file, by the picture's place in the article.
 *
 * @param {number} articleAt the article's position in `articles.json`
 * @param {Pick<PictureRow, "index" | "mime">} picture
 * @returns {string}
 */
export function pictureEntryName(articleAt, picture) {
  return `pictures/${articleAt}/${picture.index}.${EXTENSIONS.get(picture.mime) ?? "bin"}`;
}

/**
 * Where a book's picture is written (D218): under `book/` and the book's
 * place in `books.json`, by the picture's own index - the index the
 * book's segments name it by, which the import keeps.
 *
 * @param {number} bookAt the book's position in `books.json`
 * @param {Pick<PictureRow, "index" | "mime">} picture
 * @returns {string}
 */
export function bookPictureEntryName(bookAt, picture) {
  return `pictures/book/${bookAt}/${picture.index}.${EXTENSIONS.get(picture.mime) ?? "bin"}`;
}

/**
 * A reference as `articles.json` carries it, narrowed field by field, or
 * nothing: a reference that will not read names no picture.
 *
 * @param {unknown} value
 * @returns {PictureRef | null}
 */
export function asPictureRef(value) {
  if (typeof value !== "object" || value === null) return null;
  const { index, file, src, mime, width, height } = /** @type {Record<string, unknown>} */ (value);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  if (typeof file !== "string" || !ENTRY_NAME.test(file)) return null;
  if (typeof src !== "string" || src.length === 0) return null;
  if (typeof mime !== "string" || !EXTENSIONS.has(mime)) return null;
  if (!isSide(width) || !isSide(height)) return null;
  return { index, file, src, mime, width, height };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isSide(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * One article's pictures as the entries an export writes - each stored
 * as it is - and the references `articles.json` will carry for them. The
 * export takes the articles in file order and asks for each one's rows
 * only when its turn comes (D222), so a library of pictures never stands
 * in memory whole beside its own archive; the references are all it
 * keeps until the file is written, last.
 *
 * @param {number} articleAt the article's position in `articles.json` (`fileOrder`)
 * @param {PictureRow[]} rows the article's pictures, in their order
 * @returns {{ entries: ArchiveEntry[], refs: PictureRef[] }}
 */
export function pictureEntries(articleAt, rows) {
  /** @type {ArchiveEntry[]} */
  const entries = [];
  /** @type {PictureRef[]} */
  const refs = [];
  for (const picture of rows) {
    const file = pictureEntryName(articleAt, picture);
    entries.push({ name: file, data: new Uint8Array(picture.data), deflate: false });
    refs.push({
      index: picture.index,
      file,
      src: picture.src,
      mime: picture.mime,
      width: picture.width,
      height: picture.height,
    });
  }
  return { entries, refs };
}

/**
 * The `articles.json` entry: the plain file's rows, with a `pictures`
 * field on every article whose references are here. An article without
 * any is written exactly as the plain file writes it, and a list with
 * none is the plain file, byte for byte. Written after the pictures'
 * entries, whose names it carries; where it stands in the archive is
 * nobody's concern, an import reads entries by name.
 *
 * @param {SavedArticle[]} articles
 * @param {Map<string, Mark[]>} marks each article's marks, keyed by `url`
 * @param {Map<string, import("../reader/position.js").ReadingPosition>} positions each document's position, keyed by `docId` (D213)
 * @param {Map<string, PictureRef[]>} refs each article's references, keyed by `url` - from `pictureEntries`
 * @returns {ArchiveEntry}
 */
export function articlesEntry(articles, marks, positions, refs) {
  const rows = fileRows(articles, marks, positions).map((row) => {
    const kept = refs.get(row.url) ?? [];
    return kept.length === 0 ? row : { ...row, pictures: kept };
  });
  return { name: ARTICLES_ENTRY, data: new TextEncoder().encode(fileText(rows)), deflate: true };
}

/**
 * The archive's `articles.json` read the way the plain file is - the same
 * articles, the same count of what would not read - with the pictures each
 * article names read off the same text by address. References ride beside
 * the articles rather than inside them, so the articles go to the database
 * exactly as a plain file's do, and only the ones actually added are asked
 * for their pictures. The first entry under an address wins, as it wins
 * the import.
 *
 * @param {string} text
 * @returns {ArticlesFile & { refs: Map<string, PictureRef[]> }}
 */
export function fromArchiveText(text) {
  const parsed = fromArticlesFile(text);
  /** @type {Map<string, PictureRef[]>} */
  const refs = new Map();
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...parsed, refs };
  }
  const list = typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw)["articles"] : null;
  if (!Array.isArray(list)) return { ...parsed, refs };
  const kept = new Set(parsed.articles.map((article) => article.url));
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { url, pictures } = /** @type {Record<string, unknown>} */ (entry);
    if (typeof url !== "string" || !kept.has(url) || refs.has(url) || !Array.isArray(pictures)) continue;
    const valid = pictures
      .map(asPictureRef)
      .filter((ref) => ref !== null)
      .sort((a, b) => a.index - b.index);
    if (valid.length > 0) refs.set(url, valid);
  }
  return { ...parsed, refs };
}

/**
 * What the pictures an archive names come to, for the sentence that asks
 * consent: how many, and the bytes their entries take as the directory
 * states them - known before any entry is opened.
 *
 * @param {Map<string, PictureRef[]>} refs
 * @param {{ name: string, originalSize: number }[]} entries the archive's directory
 * @returns {{ count: number, bytes: number }}
 */
export function archiveAccount(refs, entries) {
  const sizes = new Map(entries.map((entry) => [entry.name, entry.originalSize]));
  let count = 0;
  let bytes = 0;
  for (const list of refs.values()) {
    for (const ref of list) {
      const size = sizes.get(ref.file);
      if (size === undefined) continue;
      count += 1;
      bytes += size;
    }
  }
  return { count, bytes };
}

/**
 * One article's pictures out of the archive, by its references: each
 * entry read by name (nothing for one that is missing or larger than a
 * download may be - decided by the caller from the directory), typed by
 * its bytes and refused when they are not a stored kind, whatever the
 * reference claimed. The rows come out numbered afresh and without a
 * hole, which is what the copy's claim by count needs.
 *
 * @param {string} url
 * @param {PictureRef[]} refs
 * @param {(name: string) => Uint8Array | null} read
 * @returns {PictureRow[]}
 */
export function archivePictures(url, refs, read) {
  /** @type {PictureRow[]} */
  const rows = [];
  for (const ref of refs) {
    const bytes = read(ref.file);
    if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) continue;
    const type = sniffPictureType(bytes.subarray(0, SNIFF_BYTES));
    if (type === null || !EXTENSIONS.has(type)) continue;
    rows.push({
      url,
      index: rows.length,
      src: ref.src,
      mime: type,
      width: ref.width,
      height: ref.height,
      // A copy of its own: the database stores the buffer, and the entry's
      // view may sit inside a wider one.
      data: bytes.slice().buffer,
    });
  }
  return rows;
}
