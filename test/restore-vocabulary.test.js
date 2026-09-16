import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The vocabulary of the backup of everything written back (D213): the rules
 * have their own tests (`restored`, `withRestoredCounts`, the file, the
 * protocol); this reads the call sites they meet at - the background
 * building each row from the file's own pair and day, handing it the counts,
 * rebuilding the copies when anything moved - and the router's door.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("restoring the vocabulary from the backup of everything", () => {
  it("builds every row from the file's own pair and day, with its sentence and counts, whatever the settings say", async () => {
    const restoring = bodyOf(await source("background/vocabulary.js"), "restoreFromBackup");
    assert.notEqual(restoring.length, 0, "no restoreFromBackup in the background");
    assert.match(restoring, /langFrom: row\.langFrom,\s*langTo: row\.langTo,/, "the row does not land in its own pair");
    assert.match(restoring, /now: row\.createdAt \?\? now \+ at,/, "the file's day is not the row's");
    assert.match(restoring, /context: row\.context,/, "the sentence does not reach the row");
    assert.match(restoring, /rows\.push\(withRestoredCounts\(built\.value, row\)\)/, "the counts do not reach the row");
    assert.doesNotMatch(restoring, /pairOf\(config\)|chosenPair|saveSentence/, "the restore is gated by the pair being read or by the sentence setting");
    assert.match(restoring, /const report = await restorePhrases\(rows\);/, "the rows do not go through the store's restore");
    assert.match(restoring, /if \(report\.added > 0 \|\| report\.sentenced > 0 \|\| report\.counted > 0 \|\| restored > 0\) await afterWrite\(config\);/, "a change never reaches the mirror and the copy");
    assert.match(restoring, /return ok\(\{ \.\.\.report, invalid \}\);/, "the report leaves the broken rows out");
  });

  it("answers at the router's door, and nowhere a content script listens", async () => {
    const router = await source("background/index.js");
    assert.match(router, /case Message\.RESTORE_VOCABULARY:\s*return await restoreFromBackup\(request\);/, "the message has no door");
  });

  it("keeps the store's promise: a saved row's meanings are never rewritten, and nothing is written when nothing rises", async () => {
    const store = bodyOf(await source("lib/store/vocab.js"), "restorePhrases");
    assert.match(store, /const merged = restored\(existing, phrase\);\s*if \(merged === existing\) continue;\s*await promisify\(store\.put\(merged\)\);/, "a saved row is rewritten by something other than the restore rule, or rewritten unchanged");
    assert.doesNotMatch(store, /resaved\(|translations:/, "a restore re-saves a phrase as a bubble would");
  });
});
