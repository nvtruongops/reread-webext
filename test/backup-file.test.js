import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULTS, withDefaults } from "../src/lib/config.js";
import { markRecord } from "../src/lib/reader/marks.js";
import {
  BACKUP_ENTRIES,
  BACKUP_FILENAME,
  BACKUP_VERSION,
  SELECTION_FILENAME,
  backupEntries,
  fromManifest,
  isNewerBackup,
  manifestOf,
} from "../src/lib/store/backup-file.js";
import { fromMarksCopy } from "../src/lib/store/marks-copy.js";
import { savedArticle } from "../src/lib/store/saved-article.js";
import { fromSettingsFile } from "../src/lib/store/settings-file.js";
import { fromVocabularyFile, vocabularyRows } from "../src/lib/store/vocabulary-file.js";

/**
 * The backup of everything (D213): a manifest and the parts, each exactly
 * the file its own module writes - so each comes back through its own
 * reader. The ZIP itself is the reader page's; here the entries are values.
 */

/**
 * @param {string} path
 * @returns {import("../src/lib/store/saved-article.js").SavedArticle}
 */
function article(path) {
  const built = savedArticle({
    url: `https://example.com/${path}`,
    title: `Title of ${path}`,
    content: `<p>Body of ${path}</p>`,
    savedAt: 1000,
  });
  assert.ok(built !== null);
  return { ...built, readAt: null };
}

/**
 * @param {string} text
 * @param {Partial<import("../src/lib/store/phrase.js").Phrase>} [rest]
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(text, rest = {}) {
  return {
    id: "id-" + text,
    langFrom: "en",
    langTo: "pl",
    phrase: text,
    normalized: text.toLowerCase(),
    translations: ["znaczenie"],
    createdAt: 10,
    ...rest,
  };
}

/** @returns {import("../src/lib/reader/marks.js").Mark} */
function mark() {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: 4 },
    color: "yellow",
    createdAt: 5,
    text: "Body",
  });
  assert.ok(built !== null);
  return built;
}

/** @returns {import("../src/lib/store/backup-file.js").BackupInput} */
function input() {
  const one = article("one");
  return {
    app: "0.5.56",
    now: 1234,
    articles: [one, article("two")],
    marks: new Map([[one.url, [mark()]]]),
    pictures: false,
    positions: new Map([[one.url, { docId: one.url, segmentIndex: 0, blockIndex: 3, updatedAt: 7 }]]),
    phrases: [phrase("bank", { recallCount: 2 }), phrase("Haus", { langFrom: "de" })],
    highlights: [{ kind: "article", url: one.url, title: one.title, marks: [mark()] }],
    // With a pair chosen: a pair of nulls is no choice, and no patch.
    settings: withDefaults({ ...DEFAULTS, sourceLang: "en", targetLang: "pl", ttsRate: 120 }),
  };
}

/** @param {Uint8Array} data */
const text = (data) => new TextDecoder().decode(data);

describe("the backup of everything", () => {
  it("is named for what it is, and says in its manifest what it holds", () => {
    assert.equal(BACKUP_FILENAME, "reread-backup.zip");
    const manifest = manifestOf(input());
    assert.deepEqual(manifest, {
      format: "reread-backup",
      scope: "everything",
      version: BACKUP_VERSION,
      createdAt: 1234,
      app: "0.5.56",
      holds: { phrases: 2, pairs: 2, highlights: 1, articles: 2, pictures: false, settings: true, books: 0, bookPictures: false },
    });
  });

  it("writes the manifest first, then each light part exactly as its own module writes it - the reading list is the page's stream (D222)", () => {
    const entries = backupEntries(input());
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [BACKUP_ENTRIES.manifest, BACKUP_ENTRIES.vocabulary, BACKUP_ENTRIES.highlights, BACKUP_ENTRIES.settings],
    );
    const byName = new Map(entries.map((entry) => [entry.name, text(entry.data)]));
    const manifest = fromManifest(byName.get(BACKUP_ENTRIES.manifest) ?? "");
    assert.ok(manifest !== null);
    assert.equal(manifest.holds.phrases, 2);
    // Each part comes back through the reader it always had.
    assert.deepEqual(fromVocabularyFile(byName.get(BACKUP_ENTRIES.vocabulary) ?? "").rows, vocabularyRows(input().phrases));
    assert.equal(fromMarksCopy(byName.get(BACKUP_ENTRIES.highlights) ?? "").documents.length, 1);
    assert.deepEqual(fromSettingsFile(byName.get(BACKUP_ENTRIES.settings) ?? ""), input().settings);
  });

  it("says whether the articles' pictures ride along by the light rows' account, before any is read (D222)", () => {
    const base = input();
    const illustrated = { ...article("three"), pictures: { count: 2, bytes: 4096 } };
    // Not asked for: none, whatever the rows say.
    assert.equal(manifestOf({ ...base, articles: [...base.articles, illustrated] }).holds.pictures, false);
    // Asked for, but no row promises any: none.
    assert.equal(manifestOf({ ...base, pictures: true }).holds.pictures, false);
    assert.equal(manifestOf({ ...base, pictures: true, articles: [...base.articles, illustrated] }).holds.pictures, true);
    assert.equal(fromManifest(JSON.stringify(manifestOf({ ...base, pictures: true, articles: [illustrated] })))?.holds.pictures, true);
  });

  it("leaves the settings out when not asked for, and still says so in the manifest", () => {
    const without = { ...input(), settings: null };
    assert.equal(manifestOf(without).holds.settings, false);
    assert.equal(backupEntries(without).some((entry) => entry.name === BACKUP_ENTRIES.settings), false);
  });

  it("reads a manifest with its claims healed, and none out of a text that is not one", () => {
    assert.equal(fromManifest("not json"), null);
    assert.equal(fromManifest(JSON.stringify({ format: "reread-articles" })), null);
    const healed = fromManifest(JSON.stringify({ format: "reread-backup", version: "2", holds: { phrases: -1, pictures: "yes" } }));
    assert.deepEqual(healed, {
      format: "reread-backup",
      scope: "everything",
      version: BACKUP_VERSION,
      createdAt: 0,
      app: "",
      holds: { phrases: 0, pairs: 0, highlights: 0, articles: 0, pictures: false, settings: false, books: 0, bookPictures: false },
    });
  });

  it("knows a file written by a newer re/read - the one thing the version gates", () => {
    const newer = fromManifest(JSON.stringify({ format: "reread-backup", version: BACKUP_VERSION + 1 }));
    assert.ok(newer !== null);
    assert.equal(isNewerBackup(newer), true);
    assert.equal(isNewerBackup(manifestOf(input())), false);
  });
});

describe("the books in the manifest (D218)", () => {
  it("says how many books the archive holds and whether their pictures ride along, and reads it back", () => {
    /** @type {import("../src/lib/store/book.js").BookMeta} */
    const plain = { id: "b-1", title: "A Novel", author: null, lang: null, segmentCount: 1, totalChars: 10, addedAt: 1, readAt: null, toc: [] };
    const base = { app: "0.5.60", now: 5, articles: [], marks: new Map(), pictures: false, positions: new Map(), phrases: [], highlights: [], settings: null };
    const without = manifestOf(base);
    assert.equal(without.holds.books, 0);
    assert.equal(without.holds.bookPictures, false);
    const withBooks = manifestOf({ ...base, books: [plain, { ...plain, id: "b-2", pictures: { count: 1, bytes: 100 } }] });
    assert.equal(withBooks.holds.books, 2);
    assert.equal(withBooks.holds.bookPictures, true);
    const read = fromManifest(JSON.stringify(withBooks));
    assert.equal(read?.holds.books, 2);
    assert.equal(read?.holds.bookPictures, true);
    // A manifest from before books says none.
    const older = fromManifest(JSON.stringify({ format: "reread-backup", version: 1, createdAt: 1, app: "0.5.59", holds: { articles: 3 } }));
    assert.equal(older?.holds.books, 0);
    assert.equal(older?.holds.bookPictures, false);
    assert.equal(BACKUP_ENTRIES.books, "books.json");
  });
});

describe("a selection in the backup's format (D218)", () => {
  it("says so in its manifest and leaves the vocabulary's entry out rather than writing it empty", () => {
    const base = { app: "0.5.60", now: 5, articles: [], marks: new Map(), pictures: false, positions: new Map(), phrases: [], highlights: [], settings: null };
    assert.equal(manifestOf(base).scope, "everything");
    const selection = manifestOf({ ...base, selection: true });
    assert.equal(selection.scope, "selection");
    assert.equal(fromManifest(JSON.stringify(selection))?.scope, "selection");
    assert.equal(fromManifest(JSON.stringify({ format: "reread-backup", version: 1 }))?.scope, "everything");
    const names = backupEntries({ ...base, selection: true }).map((entry) => entry.name);
    assert.deepEqual(names, [BACKUP_ENTRIES.manifest, BACKUP_ENTRIES.highlights]);
    assert.ok(backupEntries(base).map((entry) => entry.name).includes(BACKUP_ENTRIES.vocabulary), "the backup of everything lost its vocabulary");
    assert.equal(SELECTION_FILENAME, "reread-selection.zip");
  });
});
