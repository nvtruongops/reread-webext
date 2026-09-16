import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The sentence a recall bubble opened in, filled into a phrase kept without
 * one (D216): the rules have their own tests (`withSentence`, the report,
 * the protocol); this reads the call sites they meet at, the way the import
 * of the file for Anki is read - the page handing the sentence to the
 * report with the opening, the background writing it under the setting and
 * rebuilding the copy but not the mirror, the store writing nothing but the
 * sentence.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * A top-level function's text to the brace that closes it at the margin.
 * `bodyOf` stops at the first brace after the name, which for `showSaved`
 * is the `{}` its last parameter defaults to.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function functionText(source, name) {
  const at = source.indexOf(`function ${name}(`);
  if (at === -1) return "";
  const end = source.indexOf("\n}\n", at);
  return end === -1 ? "" : source.slice(at, end + 3);
}

describe("the sentence a recall bubble opened in", () => {
  it("rides the opening's report from the page, whatever the setting - the page does not read it", async () => {
    const page = await source("content/reading.js");
    const recall = functionText(page, "showSaved");
    assert.notEqual(recall.length, 0, "no showSaved on the page");
    assert.match(recall, /report\.recalled\(key, context\);\s*scheduleReport\(\);/, "the opening is reported without the sentence it stood in");
    assert.doesNotMatch(page, /saveSentence/, "the page reads the setting the background answers for");
  });

  it("is written by the background only while the setting asks for it, and reaches the copy but not the mirror", async () => {
    const counting = bodyOf(await source("background/vocabulary.js"), "countPhrases");
    assert.notEqual(counting.length, 0, "no countPhrases in the background");
    assert.match(counting, /const sentences = config\.saveSentence \? mergeSentences\(request\) : null;/, "the sentence is written without the setting, or the setting is not read fresh");
    assert.match(counting, /await fillSentences\(pair, sentences\)/, "the sentences do not reach the store");
    // A sentence filled in is vocabulary, so the copy that outlives the
    // database must carry it; the mirror carries no sentence, and a rewrite
    // would repaint every open tab for nothing - the counts' own rule.
    assert.match(counting, /if \(restored > 0\) await afterWrite\(config\);\s*else if \(filled > 0\) await rebuildBackup\(\);/, "a filled sentence rebuilds the mirror, or never reaches the copy");
  });

  it("keeps the store's promise: nothing but the sentence moves, and a row with one is not written", async () => {
    const store = bodyOf(await source("lib/store/vocab.js"), "fillSentences");
    assert.notEqual(store.length, 0, "no fillSentences in the store");
    assert.match(store, /const next = withSentence\(existing, sentence\);\s*if \(next === existing\) continue;\s*await promisify\(store\.put\(next\)\);/, "a row is rewritten by something other than the sentence rule, or rewritten unchanged");
    assert.doesNotMatch(store, /resaved\(|translations:|counted\(/, "the fill re-saves a phrase as a bubble would, or touches the counts");
  });
});
