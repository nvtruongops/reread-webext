import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asBackup,
  backupOf,
  ensureBackup,
  readBackupSummary,
  rebuildBackup,
  restoreVocabulary,
} from "../src/lib/store/backup.js";

/** @typedef {import("../src/lib/store/phrase.js").Phrase} Phrase */
/** @typedef {import("../src/lib/store/backup.js").BackupDeps} BackupDeps */

/**
 * The copy of the vocabulary that outlives the database, held to its three
 * rules: written whole and only from a store that could be read, restored
 * only into an empty store, never touching a row that exists. No browser
 * runs in CI - the store and the storage are stand-ins that remember what was
 * asked of them and in what order.
 */

/**
 * @param {string} id
 * @param {Partial<Phrase>} [over]
 * @returns {Phrase}
 */
function phrase(id, over = {}) {
  return {
    id,
    langFrom: "en",
    langTo: "pl",
    phrase: `word ${id}`,
    normalized: `word ${id}`,
    translations: ["słowo"],
    createdAt: 1000 + Number(id),
    ...over,
  };
}

/**
 * @param {{ phrases?: Phrase[], listFails?: boolean, stored?: unknown, putMissing?: (rows: Phrase[]) => { added: number, skipped: number } }} [script]
 */
function standIn(script = {}) {
  const phrases = script.phrases ?? [];
  /** @type {string[]} */
  const asked = [];
  /** @type {import("../src/lib/store/backup.js").VocabBackup | undefined} */
  let written;
  /** @type {BackupDeps} */
  const deps = {
    empty: async () => {
      asked.push("empty");
      return phrases.length === 0;
    },
    list: async () => {
      asked.push("list");
      if (script.listFails === true) throw new Error("the store would not open");
      return phrases;
    },
    putMissing: async (rows) => {
      asked.push(`putMissing ${rows.length}`);
      return script.putMissing === undefined ? { added: rows.length, skipped: 0 } : script.putMissing(rows);
    },
    read: async () => {
      asked.push("read");
      return script.stored;
    },
    write: async (backup) => {
      asked.push("write");
      written = backup;
    },
    now: () => 42,
  };
  return { deps, asked, written: () => written };
}

describe("the copy of the vocabulary", () => {
  it("survives a trip through JSON with every field, the optional ones included", () => {
    const rows = [phrase("1"), phrase("2", { langFrom: "de", context: "ein Satz", sourceUrl: "https://example.org/" })];
    const stored = JSON.parse(JSON.stringify(backupOf(rows, 42)));
    assert.deepEqual(asBackup(stored), { version: 1, writtenAt: 42, phrases: rows });
  });

  it("carries the counts (D209) as counts, and restores a phrase without a count that is not one", () => {
    const counted = phrase("1", { recallCount: 3, lastRecallAt: 50, readCount: 12, lastReadAt: 60 });
    assert.deepEqual(asBackup(JSON.parse(JSON.stringify(backupOf([counted], 42))))?.phrases, [counted]);

    const narrowed = asBackup({
      version: 1,
      writtenAt: 1,
      phrases: [
        { ...phrase("2"), recallCount: "3", lastRecallAt: 50 },
        { ...phrase("3"), recallCount: -1, readCount: 1.5 },
        { ...phrase("4"), lastRecallAt: 50, lastReadAt: 60 },
        { ...phrase("5"), recallCount: 0, readCount: 0 },
        { ...phrase("6"), recallCount: 2, lastRecallAt: "then" },
      ],
    });
    assert.deepEqual(narrowed?.phrases, [
      phrase("2"),
      phrase("3"),
      phrase("4"),
      phrase("5"),
      { ...phrase("6"), recallCount: 2 },
    ]);
  });

  it("is no copy at all in another shape, and drops the rows that make no sense", () => {
    assert.equal(asBackup(undefined), null);
    assert.equal(asBackup(null), null);
    assert.equal(asBackup({ version: 2, writtenAt: 1, phrases: [] }), null);
    assert.equal(asBackup({ version: 1, writtenAt: "yesterday", phrases: [] }), null);
    assert.equal(asBackup({ version: 1, writtenAt: 1 }), null);

    const kept = phrase("1");
    const narrowed = asBackup({
      version: 1,
      writtenAt: 1,
      phrases: [
        kept,
        { ...phrase("2"), translations: [] },
        { ...phrase("3"), id: "" },
        { ...phrase("4"), createdAt: "then" },
        { ...phrase("5"), extra: "field" },
        "not a row",
      ],
    });
    assert.deepEqual(narrowed?.phrases, [kept, phrase("5")], "the good rows, without the unknown field");
  });

  it("restores only into an empty store, and asks the store before it reads the copy", async () => {
    const wiped = standIn({ phrases: [], stored: backupOf([phrase("1"), phrase("2"), phrase("3")], 1) });
    assert.equal(await restoreVocabulary(wiped.deps), 3);
    assert.deepEqual(wiped.asked, ["empty", "read", "putMissing 3"]);

    const full = standIn({ phrases: [phrase("9")], stored: backupOf([phrase("1")], 1) });
    assert.equal(await restoreVocabulary(full.deps), 0);
    assert.deepEqual(full.asked, ["empty"], "a store with phrases must not even cost the copy's read");
  });

  it("brings nothing back from no copy, an empty copy, or a copy of rows that already exist", async () => {
    assert.equal(await restoreVocabulary(standIn({ stored: undefined }).deps), 0);
    assert.equal(await restoreVocabulary(standIn({ stored: backupOf([], 1) }).deps), 0);
    const skipped = standIn({
      stored: backupOf([phrase("1"), phrase("2")], 1),
      putMissing: () => ({ added: 1, skipped: 1 }),
    });
    assert.equal(await restoreVocabulary(skipped.deps), 1, "only what was actually added counts as restored");
  });

  it("is rebuilt whole from the store, and not at all from a store that would not answer", async () => {
    const rows = [phrase("1"), phrase("2")];
    const fine = standIn({ phrases: rows });
    assert.equal(await rebuildBackup(fine.deps), 2);
    assert.deepEqual(fine.written(), backupOf(rows, 42));

    const broken = standIn({ phrases: rows, listFails: true });
    await assert.rejects(() => rebuildBackup(broken.deps));
    assert.equal(broken.written(), undefined, "a copy replaced by a guess");
    assert.deepEqual(broken.asked, ["list"]);
  });

  it("is written once for a vocabulary that has none, and left alone otherwise", async () => {
    const before = standIn({ phrases: [phrase("1")], stored: undefined });
    assert.equal(await ensureBackup(before.deps), true);
    assert.deepEqual(before.written(), backupOf([phrase("1")], 42));

    const already = standIn({ phrases: [phrase("1")], stored: backupOf([phrase("1")], 7) });
    assert.equal(await ensureBackup(already.deps), false);
    assert.equal(already.written(), undefined);

    const nothing = standIn({ phrases: [], stored: undefined });
    assert.equal(await ensureBackup(nothing.deps), false, "an empty store has nothing to copy");
    assert.equal(nothing.written(), undefined);
  });

  it("tells the settings page how many phrases the copy holds and since when", async () => {
    assert.equal(await readBackupSummary(standIn({ stored: undefined }).deps), null);
    assert.deepEqual(await readBackupSummary(standIn({ stored: backupOf([phrase("1"), phrase("2")], 9) }).deps), {
      count: 2,
      writtenAt: 9,
    });
  });
});
