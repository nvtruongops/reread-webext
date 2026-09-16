import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { editedMeanings, splitMeanings } from "../src/lib/meanings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const sourceOf = (path) => readFileSync(join(ROOT, path), "utf8");

describe("splitMeanings", () => {
  it("splits at semicolons, in the order typed", () => {
    assert.deepEqual(splitMeanings("uleganie; kapitulacja"), ["uleganie", "kapitulacja"]);
    assert.deepEqual(splitMeanings("a;b;c"), ["a", "b", "c"]);
  });

  it("leaves a line without a semicolon as the one meaning it is", () => {
    assert.deepEqual(splitMeanings("popyt"), ["popyt"]);
    assert.deepEqual(splitMeanings("a marker ☞ kept as typed"), ["a marker ☞ kept as typed"]);
  });

  it("gives nothing for nothing - empty, blank, or semicolons alone", () => {
    assert.deepEqual(splitMeanings(""), []);
    assert.deepEqual(splitMeanings("   "), []);
    assert.deepEqual(splitMeanings(";"), []);
    assert.deepEqual(splitMeanings(";; ; ;"), []);
  });

  it("trims each piece and drops the empty ones between doubled or trailing semicolons", () => {
    assert.deepEqual(splitMeanings("popyt;; ; zapotrzebowanie ;"), ["popyt", "zapotrzebowanie"]);
    assert.deepEqual(splitMeanings("  a ;b  "), ["a", "b"]);
    assert.deepEqual(splitMeanings("a;"), ["a"]);
    assert.deepEqual(splitMeanings(";a"), ["a"]);
  });

  it("keeps the spaces inside a piece, and the letters of any script", () => {
    assert.deepEqual(splitMeanings("brzeg rzeki; instytucja finansowa"), ["brzeg rzeki", "instytucja finansowa"]);
    assert.deepEqual(splitMeanings("значення; sens; 意味"), ["значення", "sens", "意味"]);
  });

  it("keeps a piece said twice - the callers decide what is already saved", () => {
    assert.deepEqual(splitMeanings("a; a"), ["a", "a"]);
  });
});

describe("editedMeanings", () => {
  const book = "powiadomić kogoś; powiedzieć komuś o czymś";

  it("keeps a line the box opened with as it is, semicolons and all", () => {
    assert.deepEqual(editedMeanings([book], [book]), [book]);
    // Trimmed the way the box's lines are read: spaces around an untouched
    // line are the editor's, not a change.
    assert.deepEqual(editedMeanings([book], [`  ${book} `]), [book]);
  });

  it("splits a line the reader added, its pieces after what stood before", () => {
    assert.deepEqual(editedMeanings([book, "popyt"], [book, "popyt", "popyt; zapotrzebowanie"]), [
      book,
      "popyt",
      "zapotrzebowanie",
    ]);
  });

  it("splits a line the reader changed, its pieces in the line's place", () => {
    assert.deepEqual(editedMeanings(["popyt", "x"], ["popyt; żądanie", "x"]), ["popyt", "żądanie", "x"]);
    // A typo fixed inside a book's semicolon line splits it - the price of
    // the rule, mended in the same box.
    assert.deepEqual(editedMeanings([book], ["powiadomić kogoś; powiedzieć komuś o czymś!"]), [
      "powiadomić kogoś",
      "powiedzieć komuś o czymś!",
    ]);
  });

  it("drops a line the reader removed, and blank lines", () => {
    assert.deepEqual(editedMeanings(["a", "b", "c"], ["a", "", "c", "   "]), ["a", "c"]);
    assert.deepEqual(editedMeanings(["a"], []), []);
  });

  it("keeps a meaning said twice once, where it first stood", () => {
    assert.deepEqual(editedMeanings(["a"], ["b; a", "a", "b"]), ["b", "a"]);
    assert.deepEqual(editedMeanings([], ["x; x; y"]), ["x", "y"]);
  });

  it("follows the box's order, not the opening one", () => {
    assert.deepEqual(editedMeanings(["a", "b"], ["b", "a"]), ["b", "a"]);
  });
});

describe("where the rules are applied", () => {
  it("is the quick field of the reader's own meanings, piece by piece, the saved ones skipped", () => {
    const box = sourceOf("src/lib/lookup-box.js");
    const own = box.slice(box.indexOf("async function savedOwn("), box.indexOf("function ownSection("));
    assert.match(own, /for \(const piece of splitMeanings\(collapseWhitespace\(state\.ownDraft\)\)\)/);
    assert.match(own, /if \(!isSaved\(meanings, piece\)\) meanings\.push\(piece\)/);
    // Nothing new to keep - every piece already saved - writes nothing and
    // says nothing: the field empties, the caret stays.
    assert.match(own, /if \(meanings\.length > state\.meanings\.length\)/);
  });

  it("is the bubble's edit box: the opening lines remembered, the save reckoned from them", () => {
    const bubble = sourceOf("src/content/tooltip.js");
    const opening = bubble.slice(bubble.indexOf("function startEditing("), bubble.indexOf("function stopEditing("));
    assert.match(opening, /initialLines = toMeanings\(bodyElement\.textContent \?\? ""\)/);
    assert.match(opening, /editor\.value = initialLines\.join\(MEANING_SEPARATOR\)/);
    const current = bubble.slice(bubble.indexOf("function currentMeanings("), bubble.indexOf("function build("));
    assert.match(current, /editedMeanings\(initialLines, toMeanings\(editor\.value\)\)/);
    const closing = bubble.slice(bubble.indexOf("function stopEditing("), bubble.indexOf("function stopEditing(") + 600);
    assert.match(closing, /setBody\(editedMeanings\(initialLines, toMeanings\(editor\.value\)\)\.join\(MEANING_SEPARATOR\)\)/);
    // Enter still saves; Shift+Enter is the new line the textarea gives.
    const keys = bubble.slice(bubble.indexOf("function onEditorKeyDown("), bubble.indexOf("function refreshControls("));
    assert.match(keys, /event\.key === "Enter" && !event\.shiftKey/);
    assert.match(keys, /emit\("save"\)/);
    // The one line under the box, shown with it and hidden with it.
    assert.match(bubble, /editorHintElement\.textContent = t\("bubble_edit_separator_hint"\)/);
    assert.match(opening, /editorHintElement\.hidden = false/);
    assert.match(closing, /editorHintElement\.hidden = true/);
    assert.match(bubble, /\.editor-hint \{/);
  });

  it("is the phrases page's edit box, by the same rule and one implementation", () => {
    const page = sourceOf("src/vocab/vocab.js");
    const save = page.slice(page.indexOf("async function saveEdit("), page.indexOf("async function exportPhrases("));
    assert.match(save, /editedMeanings\(phrase\.translations, toMeanings\(draft\)\)/);
    assert.doesNotMatch(save, /draft\s*\.split\("\\n"\)/);
    const editor = page.slice(page.indexOf("function editorFor("), page.indexOf("function refocusRow("));
    assert.match(editor, /t\("bubble_edit_separator_hint"\)/);
    assert.match(editor, /event\.key === "Enter" && !event\.shiftKey/);
  });

  it("is not the import: a file's cell keeps its own rule, semicolon-space between meanings", () => {
    const tsv = sourceOf("src/lib/store/tsv.js");
    assert.match(tsv, /const JOINER = "; ";/);
    assert.doesNotMatch(tsv, /splitMeanings/);
  });
});
