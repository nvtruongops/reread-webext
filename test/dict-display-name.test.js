import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISPLAY_NAME_LIMIT, cleanDisplayName, nameHolder, shownName } from "../src/lib/dict/display-name.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
function sourceOf(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("cleanDisplayName", () => {
  it("tidies what was typed and keeps a real name", () => {
    assert.equal(cleanDisplayName("FreeDict en-pl"), "FreeDict en-pl");
    // Spaces around and doubled inside are typing, not naming.
    assert.equal(cleanDisplayName("  FreeDict   en-pl \n"), "FreeDict en-pl");
  });

  it("reads an empty field as no name of the reader's own", () => {
    assert.equal(cleanDisplayName(""), null);
    assert.equal(cleanDisplayName("   \t "), null);
  });

  it("cuts at the limit by characters, never inside one", () => {
    assert.equal(DISPLAY_NAME_LIMIT, 40);
    const long = "English-Polish FreeDict+WikDict dictionary (en-pl)";
    assert.ok(long.length > DISPLAY_NAME_LIMIT);
    const cut = cleanDisplayName(long);
    assert.equal(cut, long.slice(0, DISPLAY_NAME_LIMIT).trimEnd());
    assert.ok(cut !== null && [...cut].length <= DISPLAY_NAME_LIMIT);
    // Exactly the limit passes whole.
    const exact = "x".repeat(DISPLAY_NAME_LIMIT);
    assert.equal(cleanDisplayName(exact), exact);
    // A character outside the basic plane at the cut is kept or dropped
    // whole - two code units, one character.
    const emoji = "\u{1F4D6}";
    const withEmoji = "x".repeat(DISPLAY_NAME_LIMIT - 1) + emoji + "y";
    assert.equal(cleanDisplayName(withEmoji), "x".repeat(DISPLAY_NAME_LIMIT - 1) + emoji);
    // A space landing at the cut does not end the name.
    assert.equal(cleanDisplayName("x".repeat(DISPLAY_NAME_LIMIT - 1) + " y"), "x".repeat(DISPLAY_NAME_LIMIT - 1));
  });
});

describe("shownName", () => {
  it("is the reader's own name when they gave one, else the file's", () => {
    const file = "English-Polish FreeDict+WikDict dictionary (en-pl)";
    assert.equal(shownName({ name: file }), file);
    assert.equal(shownName({ name: file, displayName: "FreeDict en-pl" }), "FreeDict en-pl");
    // A record should never carry an empty name, but one that did would be
    // shown under the file's - never under nothing.
    assert.equal(shownName({ name: file, displayName: "" }), file);
  });
});

describe("nameHolder", () => {
  const books = [
    { id: "a", name: "English-Polish FreeDict+WikDict dictionary (en-pl)", displayName: "FreeDict en-pl" },
    { id: "b", name: "WikDict en-pl" },
    { id: "c", name: "reader.dict EN", displayName: "Reader" },
  ];

  it("finds the book already shown under the name, by its own name or its file's", () => {
    assert.equal(nameHolder(books, "b", "FreeDict en-pl")?.id, "a");
    assert.equal(nameHolder(books, "a", "WikDict en-pl")?.id, "b");
    assert.equal(nameHolder(books, "a", "Reader")?.id, "c");
  });

  it("does not tell two names apart by case alone", () => {
    assert.equal(nameHolder(books, "b", "freedict EN-PL")?.id, "a");
    assert.equal(nameHolder(books, "a", "wikdict en-pl")?.id, "b");
  });

  it("lets a book keep or take its own name, and a free one", () => {
    // Its own display name, its own file name: no other book holds them.
    assert.equal(nameHolder(books, "a", "FreeDict en-pl"), null);
    assert.equal(nameHolder(books, "b", "WikDict en-pl"), null);
    assert.equal(nameHolder(books, "b", "WikDict"), null);
    // A file name a book no longer stands under is free for another: `c` is
    // shown as "Reader", so nothing on the shelf says "reader.dict EN".
    assert.equal(nameHolder(books, "b", "reader.dict EN"), null);
  });
});

describe("the name on the shelf", () => {
  it("is what the store answers a lookup with", () => {
    // `entryGroups` groups by the entry's dictionary name, so the name the
    // reader gave has to be the one the entry carries - nothing downstream
    // has to know a display name exists.
    const store = sourceOf("src/lib/dict/store.js");
    assert.match(store, /dictionary: shownName\(dictionary\)/);
    assert.doesNotMatch(store, /dictionary: dictionary\.name/);
  });

  it("is written by the store cleaned, and taken back with null", () => {
    const store = sourceOf("src/lib/dict/store.js");
    const rename = store.slice(store.indexOf("export async function renameDictionary("));
    assert.match(rename, /cleanDisplayName\(displayName\)/);
    // The field leaves the record rather than staying as an empty string.
    assert.match(rename, /const \{ displayName: _, \.\.\.rest \} = existing;/);
    assert.match(rename, /name === null \? rest : \{ \.\.\.rest, displayName: name \}/);
  });
});

describe("the settings page's field", () => {
  const options = sourceOf("src/options/options.js");
  const field = options.slice(options.indexOf("function renameField("), options.indexOf("async function renameFromField("));
  const save = options.slice(options.indexOf("async function renameFromField("), options.indexOf("async function removeDictionary("));
  const row = options.slice(options.indexOf("function renderDictionary("), options.indexOf("function refreshRowName("));

  it("stops typing at the record's limit and shows the file's name as the placeholder", () => {
    assert.match(field, /field\.maxLength = DISPLAY_NAME_LIMIT;/);
    assert.match(field, /field\.placeholder = dictionary\.name;/);
    assert.match(field, /field\.value = dictionary\.displayName \?\? "";/);
  });

  it("saves when the field is left, not on every keystroke", () => {
    assert.match(field, /addEventListener\("change"/);
    assert.doesNotMatch(field, /addEventListener\("input"/);
  });

  it("refuses a name another dictionary is shown under, over the store's own list", () => {
    assert.match(save, /nameHolder\(await listDictionaries\(\), dictionary\.id, wanted\)/);
    assert.match(save, /options_dictionary_name_taken/);
  });

  it("stands in the Details fold of every finished row, and of no unfinished one", () => {
    // The fold is built after the unfinished row has returned: an import
    // that stopped halfway is still being named by its files.
    assert.ok(row.indexOf("renderUnfinished(row, head, dictionary)") < row.indexOf("renameField(dictionary)"));
    const fold = row.slice(row.indexOf('element("details", "dictionary-details")'));
    assert.match(fold, /options_dictionary_details/);
    assert.match(fold, /renameField\(dictionary\)/);
    assert.match(fold, /options_dictionary_file_name", dictionary\.name/);
    // Unconditional: a book without a credit has a fold with the field and
    // the file's name in it.
    assert.doesNotMatch(fold.slice(0, fold.indexOf("row.append(details)")), /if \(dictionary\.credit !== null\) \{/);
  });

  it("says the new name on the row in place, with no redraw and no sentence", () => {
    // A redraw would shut the fold the name was typed in and drop the focus;
    // the title changing is the answer, so no status line either (block 2 of
    // the seventh brief: no toast).
    assert.doesNotMatch(save, /renderCatalog\(\)/);
    assert.match(save, /refreshRowName\(row, dictionary\)/);
    assert.doesNotMatch(save, /options_dictionary_renamed|options_dictionary_name_restored/);
    // The record the row's later actions read learns the name too.
    assert.match(save, /delete dictionary\.displayName/);
    assert.match(save, /dictionary\.displayName = wanted/);
    // And the row's title is the shown name from the first draw.
    assert.match(row, /element\("p", "dictionary-name", shown\)/);
  });
});
