import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_DAYS,
  MIGRATIONS_KEY,
  SEMICOLON_BACKUP_KEY,
  hasSemicolon,
  migrateSemicolons,
  splitStoredMeanings,
  sweepSemicolonBackup,
} from "../src/lib/store/semicolon-migration.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const sourceOf = (path) => readFileSync(join(ROOT, path), "utf8");

/** @typedef {import("../src/lib/store/phrase.js").Phrase} Phrase */
/** @typedef {import("../src/lib/store/semicolon-migration.js").MigrationDeps} MigrationDeps */

// The one-time split of semicolons in the meanings saved before D203, held
// to its rules: only the reader's own lines split, a book's kept, the copy
// before the write, the flag after it, nothing twice. No browser in CI -
// the store, the storage and the dictionaries are stand-ins that remember
// what was asked of them and in what order.

const BOOK = "powiadomić kogoś; powiedzieć komuś o czymś";

/**
 * @param {string} id
 * @param {string[]} translations
 * @param {Partial<Phrase>} [over]
 * @returns {Phrase}
 */
function phrase(id, translations, over = {}) {
  return { id, langFrom: "en", langTo: "pl", phrase: `word ${id}`, normalized: `word ${id}`, translations, createdAt: 1000 + Number(id), ...over };
}

/**
 * A world to run the migration in: what the store holds, what the
 * dictionaries answer, what storage remembers, and the order of events.
 *
 * @param {Phrase[]} phrases
 * @param {{ lines?: Set<string> | null, flags?: Record<string, string>, backup?: unknown, failWrite?: boolean, version?: string, now?: number }} [world]
 */
function stage(phrases, { lines = new Set([BOOK]), flags, backup, failWrite = false, version = "0.5.55", now = 1_700_000_000_000 } = {}) {
  /** @type {Record<string, unknown>} */
  const storage = {};
  if (flags !== undefined) storage[MIGRATIONS_KEY] = flags;
  if (backup !== undefined) storage[SEMICOLON_BACKUP_KEY] = backup;
  /** @type {string[]} */
  const events = [];
  /** @type {string[]} */
  const logs = [];
  /** @type {string[]} */
  const askedFor = [];
  const store = phrases.map((one) => ({ ...one, translations: [...one.translations] }));
  /** @type {MigrationDeps} */
  const deps = {
    readFlags: async () => storage[MIGRATIONS_KEY],
    writeFlags: async (next) => {
      events.push("flags");
      storage[MIGRATIONS_KEY] = next;
    },
    list: async () => store.map((one) => ({ ...one, translations: [...one.translations] })),
    putAll: async (changed) => {
      events.push("write");
      if (failWrite) throw new Error("disk full");
      for (const next of changed) {
        const at = store.findIndex((one) => one.id === next.id);
        store[at] = next;
      }
    },
    dictionaryLines: async (one) => {
      askedFor.push(one.id);
      return lines;
    },
    readBackup: async () => storage[SEMICOLON_BACKUP_KEY],
    writeBackup: async (copy) => {
      events.push("backup");
      storage[SEMICOLON_BACKUP_KEY] = copy;
    },
    removeBackup: async () => {
      events.push("remove-backup");
      delete storage[SEMICOLON_BACKUP_KEY];
    },
    afterWrite: async () => {
      events.push("after-write");
    },
    now: () => now,
    version: () => version,
    log: (line) => logs.push(line),
  };
  return { deps, storage, events, logs, askedFor, store };
}

describe("splitStoredMeanings", () => {
  it("splits the reader's semicolon and keeps the book's, in place, in order", () => {
    const out = splitStoredMeanings(["a; b", BOOK, "c"], new Set([BOOK]));
    assert.deepEqual(out.translations, ["a", "b", BOOK, "c"]);
    assert.equal(out.split, 1);
    assert.equal(out.kept, 1);
  });

  it("splits everything with a semicolon where no dictionary can vouch for it", () => {
    const out = splitStoredMeanings(["a; b", BOOK], null);
    assert.deepEqual(out.translations, ["a", "b", "powiadomić kogoś", "powiedzieć komuś o czymś"]);
    assert.equal(out.split, 2);
    assert.equal(out.kept, 0);
  });

  it("keeps a meaning said twice once, where it first stood", () => {
    assert.deepEqual(splitStoredMeanings(["x; y", "y"], null).translations, ["x", "y"]);
    assert.deepEqual(splitStoredMeanings(["y", "x; y"], null).translations, ["y", "x"]);
  });

  it("matches a book's line trimmed, and leaves a meaning without a semicolon alone", () => {
    assert.deepEqual(splitStoredMeanings([` ${BOOK} `, "plain"], new Set([BOOK])).translations, [` ${BOOK} `, "plain"]);
    assert.equal(hasSemicolon(phrase("1", ["plain", "also plain"])), false);
    assert.equal(hasSemicolon(phrase("1", ["plain", "a; b"])), true);
  });
});

describe("migrateSemicolons", () => {
  it("rewrites the reader's semicolon lines and keeps the book's, copy before write before flag", async () => {
    const world = stage([phrase("1", ["a; b", BOOK]), phrase("2", ["plain"])]);
    const report = await migrateSemicolons(world.deps);
    assert.equal(report.ran, true);
    assert.deepEqual(world.store[0]?.translations, ["a", "b", BOOK]);
    assert.deepEqual(world.store[1]?.translations, ["plain"]);
    assert.deepEqual(world.events, ["backup", "write", "after-write", "flags"]);
    assert.deepEqual(world.storage[MIGRATIONS_KEY], { semicolon: "done" });
    // Only the phrase with a semicolon asked the dictionaries.
    assert.deepEqual(world.askedFor, ["1"]);
    assert.equal(report.phrases, 2);
    assert.equal(report.candidates, 1);
    assert.equal(report.split, 1);
    assert.equal(report.kept, 1);
    assert.equal(report.withoutDictionary, 0);
    assert.equal(report.written, 1);
    // The copy holds every phrase as it stood, with the version that wrote it.
    const copy = /** @type {{ version: number, extension: string, phrases: Phrase[] }} */ (world.storage[SEMICOLON_BACKUP_KEY]);
    assert.equal(copy.version, 1);
    assert.equal(copy.extension, "0.5.55");
    assert.deepEqual(copy.phrases.map((one) => one.translations), [["a; b", BOOK], ["plain"]]);
    assert.match(world.logs[0] ?? "", /2 phrases read, 1 with a semicolon, 1 meanings split, 1 kept as a dictionary's line, 0 without a dictionary/);
  });

  it("splits the book's line too where the book is gone, and counts the phrase as unverified", async () => {
    const world = stage([phrase("1", ["a; b", BOOK])], { lines: null });
    const report = await migrateSemicolons(world.deps);
    assert.deepEqual(world.store[0]?.translations, ["a", "b", "powiadomić kogoś", "powiedzieć komuś o czymś"]);
    assert.equal(report.withoutDictionary, 1);
    assert.equal(report.split, 2);
  });

  it("drops a duplicate the split would make", async () => {
    const world = stage([phrase("1", ["x; y", "y"])], { lines: null });
    await migrateSemicolons(world.deps);
    assert.deepEqual(world.store[0]?.translations, ["x", "y"]);
  });

  it("does nothing the second time: no read of the store, the copy untouched", async () => {
    const world = stage([phrase("1", ["a; b"])], { flags: { semicolon: "done" }, backup: { version: 1, writtenAt: 5, extension: "0.5.55", phrases: [] } });
    const report = await migrateSemicolons(world.deps);
    assert.equal(report.ran, false);
    assert.equal(report.written, 0);
    assert.deepEqual(world.events, []);
    assert.deepEqual(world.store[0]?.translations, ["a; b"]);
    assert.deepEqual(world.storage[SEMICOLON_BACKUP_KEY], { version: 1, writtenAt: 5, extension: "0.5.55", phrases: [] });
    assert.match(world.logs[0] ?? "", /already ran/);
  });

  it("leaves the flag unset and the store as it was when the write fails - the copy is what was there", async () => {
    const world = stage([phrase("1", ["a; b"])], { lines: null, failWrite: true });
    await assert.rejects(migrateSemicolons(world.deps), /disk full/);
    assert.equal(world.storage[MIGRATIONS_KEY], undefined);
    assert.deepEqual(world.store[0]?.translations, ["a; b"]);
    assert.deepEqual(world.events, ["backup", "write"]);
    const copy = /** @type {{ phrases: Phrase[] }} */ (world.storage[SEMICOLON_BACKUP_KEY]);
    assert.deepEqual(copy.phrases, world.store);
  });

  it("sets the flag and writes no copy over an empty store, or a store with nothing to split", async () => {
    const empty = stage([]);
    await migrateSemicolons(empty.deps);
    assert.deepEqual(empty.events, ["flags"]);
    assert.equal(empty.storage[SEMICOLON_BACKUP_KEY], undefined);
    const clean = stage([phrase("1", ["plain"]), phrase("2", [BOOK])]);
    const report = await migrateSemicolons(clean.deps);
    assert.deepEqual(clean.events, ["flags"]);
    assert.equal(report.candidates, 1);
    assert.equal(report.kept, 1);
    assert.equal(report.written, 0);
  });

  it("keeps other flags that stand under the key", async () => {
    const world = stage([], { flags: { other: "done" } });
    await migrateSemicolons(world.deps);
    assert.deepEqual(world.storage[MIGRATIONS_KEY], { other: "done", semicolon: "done" });
  });
});

describe("sweepSemicolonBackup", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("keeps a copy of this version younger than thirty days", async () => {
    const world = stage([], { backup: { version: 1, writtenAt: 1_700_000_000_000 - 10 * DAY, extension: "0.5.55", phrases: [] } });
    assert.equal(await sweepSemicolonBackup(world.deps), false);
    assert.deepEqual(world.events, []);
  });

  it("takes the copy away after thirty days, or at the first start of a later version", async () => {
    const old = stage([], { backup: { version: 1, writtenAt: 1_700_000_000_000 - (BACKUP_DAYS + 1) * DAY, extension: "0.5.55", phrases: [] } });
    assert.equal(await sweepSemicolonBackup(old.deps), true);
    assert.equal(old.storage[SEMICOLON_BACKUP_KEY], undefined);
    const later = stage([], { backup: { version: 1, writtenAt: 1_700_000_000_000, extension: "0.5.55", phrases: [] }, version: "0.5.56" });
    assert.equal(await sweepSemicolonBackup(later.deps), true);
    // A copy of a shape this version does not know is nobody's.
    const odd = stage([], { backup: { something: "else" } });
    assert.equal(await sweepSemicolonBackup(odd.deps), true);
    // No copy, nothing to do.
    const none = stage([]);
    assert.equal(await sweepSemicolonBackup(none.deps), false);
  });
});

describe("where the migration runs", () => {
  it("is the background's start, after the store is settled and before any door opens", () => {
    const background = sourceOf("src/background/vocabulary.js");
    const started = background.slice(background.indexOf("const started = settled()"), background.indexOf("export async function refreshVocabulary("));
    assert.match(started, /await ensureBackup\(\);\s*await migrateSemicolonsOnce\(\);\s*await sweepSemicolonBackup\(\);/);
    // Every door waits on it.
    for (const door of ["savePhrase", "forgetPhrase", "importPhrases", "listVocabulary"]) {
      const body = background.slice(background.indexOf(`export async function ${door}(`));
      assert.match(body.slice(0, body.indexOf("\n}\n")), /await started;/, `${door} waits for the start`);
    }
  });

  it("is the phrases page's first read, after the restore, quiet on failure", () => {
    const page = sourceOf("src/vocab/vocab.js");
    const reload = page.slice(page.indexOf("async function reload("), page.indexOf("async function reload(") + 2600);
    const restore = reload.indexOf("await restoreVocabulary()");
    const migrate = reload.indexOf("await migrateSemicolonsOnce().catch(() => undefined);");
    const list = reload.indexOf("listPairs(),");
    assert.ok(restore >= 0 && migrate > restore && list > migrate, "restore, then the migration, then the list");
  });

  it("writes the changed phrases in one transaction of the store", () => {
    const store = sourceOf("src/lib/store/vocab.js");
    const put = store.slice(store.indexOf("export async function putPhrases("), store.indexOf("export async function getPhrase("));
    assert.match(put, /withPhrases\("readwrite", async \(store\) => \{\s*for \(const phrase of phrases\) await promisify\(store\.put\(phrase\)\);/);
  });
});
