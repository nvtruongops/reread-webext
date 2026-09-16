/**
 * The backup of everything (D213): one `reread-backup.zip` holding what the
 * separate files held before it and what none of them could - the
 * vocabulary with its sentences and counts (`vocabulary-file.js`), every
 * document's highlights (`marks-copy.js`, the highlights page's own file),
 * the reading list with its pictures when asked and its reading positions
 * (`articles-archive.js`), and the settings (`settings-file.js`) - behind a
 * manifest that says what the file is, when and by which version it was
 * written, and what it holds.
 *
 * An archive because the reading list's backup with pictures already is
 * one, read one entry at a time (`src/reader/zip.js`); the plain
 * `reread-articles.json` and the old `reread-highlights.json` stay
 * readable by the same Import, as parts of this format that happen to
 * stand alone. Each entry is exactly the file its own module writes, so a
 * reader who opens the archive finds the same JSON the pages used to
 * download - and each part is restored by the importer it always had,
 * every one of them adding and never overwriting.
 *
 * Everything here is a value in and a value out - the entries to write,
 * the manifest read back; the ZIP itself is the reader page's business,
 * and so are the heavy parts: the reading list's pictures and the books
 * are read from the store one document at a time and written as a
 * stream after the entries here (D218, D222), with `articles.json` and
 * `books.json` following the pictures they refer to.
 */

import { ARTICLES_ENTRY } from "./articles-archive.js";
import { BOOKS_ENTRY } from "./books-file.js";
import { toMarksCopy } from "./marks-copy.js";
import { SETTINGS_ENTRY, toSettingsFile } from "./settings-file.js";
import { VOCABULARY_ENTRY, toVocabularyFile } from "./vocabulary-file.js";

/**
 * @typedef {import("./articles-archive.js").ArchiveEntry} ArchiveEntry
 * @typedef {import("./marks-copy.js").CopyDoc} CopyDoc
 * @typedef {import("./phrase.js").Phrase} Phrase
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("../reader/marks.js").Mark} Mark
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {import("../config.js").Config} Config
 * @typedef {import("./book.js").BookMeta} BookMeta
 */

/** What the export is called. No date: a browser numbers a second download by itself. */
export const BACKUP_FILENAME = "reread-backup.zip";

/**
 * What the selection's export is called (D218): the same format cut to
 * the ticked documents, under a name that says so - a file to hand
 * somebody, not the backup of everything.
 */
export const SELECTION_FILENAME = "reread-selection.zip";

/** The entry that makes an archive the backup of everything. */
export const MANIFEST_ENTRY = "manifest.json";

/** The highlights, in the highlights page's own file format. */
export const HIGHLIGHTS_ENTRY = "highlights.json";

/** What the manifest says the archive is, and the first thing reading one checks. */
const FORMAT = "reread-backup";

/**
 * The format this version writes and reads. A file with a higher number
 * was written by a newer re/read, and the page says so instead of
 * restoring half of it: the parts this version knows might depend on ones
 * it does not.
 */
export const BACKUP_VERSION = 1;

/**
 * What the manifest says the archive holds - the sentence the import offer
 * opens with, before any part is parsed.
 *
 * @typedef {{
 *   phrases: number,
 *   pairs: number,
 *   highlights: number,
 *   articles: number,
 *   pictures: boolean,
 *   settings: boolean,
 *   books: number,
 *   bookPictures: boolean,
 * }} BackupHolds
 * @typedef {{
 *   format: string,
 *   version: number,
 *   createdAt: number,
 *   app: string,
 *   scope: "everything" | "selection",
 *   holds: BackupHolds,
 * }} BackupManifest
 */

/**
 * What one export puts into the archive.
 *
 * @typedef {object} BackupInput
 * @property {string} app the extension's version, from the manifest
 * @property {number} now epoch milliseconds
 * @property {SavedArticle[]} articles
 * @property {Map<string, Mark[]>} marks each article's marks, keyed by `url`
 * @property {boolean} pictures whether the articles' pictures go in (D222) - read by the page
 *   one article at a time after these entries, never held here
 * @property {Map<string, ReadingPosition>} positions each document's position, keyed by `docId`
 * @property {Phrase[]} phrases every pair
 * @property {CopyDoc[]} highlights every document with marks, articles and books alike
 * @property {Config | null} settings the config, or null to leave it out
 * @property {BookMeta[]} [books] the books going into the archive (D218) - written by the
 *   page after these entries, one at a time; none by default
 * @property {boolean} [selection] whether the archive is a selection of documents to hand on
 *   (D218) rather than the backup of everything: the manifest says so, and the vocabulary's
 *   entry is left out rather than written empty
 */

/**
 * @param {BackupInput} input
 * @returns {BackupManifest}
 */
export function manifestOf({ app, now, articles, pictures, phrases, highlights, settings, books = [], selection = false }) {
  const pairs = new Set(phrases.map((phrase) => `${phrase.langFrom}\t${phrase.langTo}`));
  return {
    format: FORMAT,
    version: BACKUP_VERSION,
    createdAt: now,
    app,
    scope: selection ? "selection" : "everything",
    holds: {
      phrases: phrases.length,
      pairs: pairs.size,
      highlights: highlights.reduce((sum, doc) => sum + doc.marks.length, 0),
      articles: articles.length,
      // By the light rows' account, as the books' claim is: the manifest
      // is written before any picture is read (D222).
      pictures: pictures && articles.some((article) => article.pictures !== undefined),
      settings: settings !== null,
      books: books.length,
      bookPictures: books.some((book) => book.pictures !== undefined),
    },
  };
}

/**
 * @param {string} name
 * @param {string} text
 * @returns {ArchiveEntry}
 */
function textEntry(name, text) {
  return { name, data: new TextEncoder().encode(text), deflate: true };
}

/**
 * The light entries an export writes, first: the manifest, then the
 * vocabulary, the highlights, and the settings when asked for - each
 * exactly as its own module writes it. The reading list follows on the
 * page's stream (D222): each article's pictures as its rows are read,
 * then `articles.json` with the references (`articles-archive.js`) - and
 * the books after it (D218). Every part here is written even when empty,
 * so a reader opening the archive sees what the file is made of - except
 * the vocabulary of a selection (D218), which hands on documents and
 * never held phrases: written empty it would read as phrases lost.
 *
 * @param {BackupInput} input
 * @returns {ArchiveEntry[]}
 */
export function backupEntries(input) {
  const manifest = JSON.stringify(manifestOf(input), null, 2) + "\n";
  /** @type {ArchiveEntry[]} */
  const entries = [textEntry(MANIFEST_ENTRY, manifest)];
  if (input.selection !== true) entries.push(textEntry(VOCABULARY_ENTRY, toVocabularyFile(input.phrases)));
  entries.push(textEntry(HIGHLIGHTS_ENTRY, toMarksCopy(input.highlights)));
  if (input.settings !== null) entries.push(textEntry(SETTINGS_ENTRY, toSettingsFile(input.settings)));
  return entries;
}

/**
 * @param {unknown} value
 * @returns {number} a count, or zero for anything that is not one
 */
function countOf(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Reads the manifest, or nothing for a text that is not one: the archive
 * is then the reading list's old backup, or a book, and the importer looks
 * for `articles.json` as it always has. The counts are what the file
 * claims; the offer says what it parsed.
 *
 * @param {string} text
 * @returns {BackupManifest | null}
 */
export function fromManifest(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { format, version, createdAt, app, scope, holds } = /** @type {Record<string, unknown>} */ (parsed);
  if (format !== FORMAT) return null;
  const claims = typeof holds === "object" && holds !== null ? /** @type {Record<string, unknown>} */ (holds) : {};
  return {
    format,
    version: typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : BACKUP_VERSION,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    app: typeof app === "string" ? app : "",
    scope: scope === "selection" ? "selection" : "everything",
    holds: {
      phrases: countOf(claims["phrases"]),
      pairs: countOf(claims["pairs"]),
      highlights: countOf(claims["highlights"]),
      articles: countOf(claims["articles"]),
      pictures: claims["pictures"] === true,
      settings: claims["settings"] === true,
      books: countOf(claims["books"]),
      bookPictures: claims["bookPictures"] === true,
    },
  };
}

/**
 * Whether the file was written by a newer re/read than this one - the one
 * thing the version is a gate for.
 *
 * @param {BackupManifest} manifest
 * @returns {boolean}
 */
export function isNewerBackup(manifest) {
  return manifest.version > BACKUP_VERSION;
}

/** The entries an importer looks for, by name, so the page and the tests agree on them. */
export const BACKUP_ENTRIES = Object.freeze({
  manifest: MANIFEST_ENTRY,
  vocabulary: VOCABULARY_ENTRY,
  highlights: HIGHLIGHTS_ENTRY,
  settings: SETTINGS_ENTRY,
  articles: ARTICLES_ENTRY,
  books: BOOKS_ENTRY,
});
