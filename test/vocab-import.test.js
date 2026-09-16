import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The file for Anki travelling back (D212): its third column is the
 * sentence, and an import may add a sentence to a phrase already saved -
 * and nothing else. The rules have their own tests (`fromTsv`,
 * `withImportedSentence`, the protocol); this reads the call sites they
 * meet at, the way the filter's state line is tested: the background handing
 * the sentence to the row whatever the setting says, the page saying before
 * the yes how many rows bring one and after it how many phrases took one.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("importing the file for Anki", () => {
  it("hands the file's sentence to the row whatever the setting says, and rebuilds the copy when one was filled in", async () => {
    const importing = bodyOf(await source("background/vocabulary.js"), "importPhrases");
    assert.match(importing, /context: row\.context,/, "the file's sentence does not reach the row");
    assert.doesNotMatch(importing, /saveSentence/, "the import is gated by the bubble's own setting");
    assert.match(importing, /const \{ added, skipped, sentenced \} = await putMissingPhrases\(rows\);/, "the store does not say how many saved rows took a sentence");
    // The mirror carries no sentence, but the copy does: a sentence filled
    // in must reach it, or the browser's next deletion loses it again.
    assert.match(importing, /if \(added > 0 \|\| sentenced > 0 \|\| restored > 0\) await afterWrite\(config\);/, "a sentence filled into a saved row never reaches the copy");
    assert.match(importing, /return ok\(\{ added, skipped, sentenced, invalid \}\);/, "the report leaves the filled sentences out");
  });

  it("says before the yes how many rows bring a sentence, and after it how many phrases took one", async () => {
    const page = await source("vocab/vocab.js");
    const offer = bodyOf(page, "renderImportOffer");
    assert.match(offer, /const withSentence = pending\.rows\.filter\(\(row\) => row\.context !== undefined\)\.length;\s*importSentences\.hidden = withSentence === 0;/, "the offer does not count the rows with a sentence, or shows an empty line");
    assert.match(offer, /plural\(withSentence, "vocab_import_with_sentence"\)/, "the count is not the catalogue's sentence");
    const run = bodyOf(page, "runImport");
    assert.match(run, /if \(report\.sentenced > 0\) sentences\.push\(plural\(report\.sentenced, "vocab_import_sentenced"\)\);/, "the report does not say how many phrases took a sentence, or says it at zero");
    assert.match(await source("vocab/vocab.html"), /<ul id="import-sample" class="import-sample"><\/ul>\s*(?:<!--[\s\S]*?-->\s*)?<p id="import-sentences" class="hint" hidden><\/p>/, "the sentence line does not stand under the sample, hidden until it has something to say");
  });

  it("keeps the store's promise: a saved row's meanings are never rewritten by a file", async () => {
    const store = bodyOf(await source("lib/store/vocab.js"), "putMissingPhrases");
    assert.match(store, /const filled = withImportedSentence\(existing, phrase\);\s*if \(filled !== existing\) \{\s*await promisify\(store\.put\(filled\)\);\s*sentenced \+= 1;\s*\}/, "a saved row is rewritten by something other than the sentence rule");
    assert.doesNotMatch(store, /resaved\(/, "an import re-saves a phrase as a bubble would");
  });
});
