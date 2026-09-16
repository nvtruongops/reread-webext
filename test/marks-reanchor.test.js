import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * A book's highlights laid against its text at import (D223): the call
 * sites on the reading list page where the rules (`reader-marks.test.js`,
 * `marks-copy.test.js`) meet the store - read the way `backup-page.test.js`
 * reads the backup's. What is held here: the laying happens before the
 * plan and only for books that stood here before this import; the parts a
 * document's marks name are read first and the whole book only after an
 * anchor fails; a part's prose is the search's own reading of a stored
 * block; and the report says what could not be placed, in every language.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the highlights laid against their book at import (D223)", () => {
  it("lays the file's book documents before the plan, skipping the books this import just wrote", async () => {
    const script = await source("reader/reader.js");
    const running = bodyOf(script, "runBackup");
    const written = running.indexOf("const written = new Set(");
    const laid = running.indexOf("const laid = await layBookMarks(offered.highlights, books, written);");
    const plan = running.indexOf("const plan = marksImportPlan(laid.documents, { articles, books, marks });");
    const notes = running.indexOf("...unplacedNotes(laid.unplaced)");
    assert.ok(written !== -1 && laid !== -1 && plan !== -1 && notes !== -1, "a step is missing");
    assert.ok(written < laid && laid < plan && plan < notes, "the marks are not laid before the plan");
    assert.match(running, /offered\.books\.plan\.toAdd\.map\(\(book\) => book\.meta\.id\)/, "the books this import wrote are not told apart");
    const laying = bodyOf(script, "layBookMarks");
    assert.match(laying, /if \(doc\.kind !== "book"\) \{\s*laid\.push\(doc\);\s*continue;\s*\}/, "an article document is not passed through as it is");
    assert.match(laying, /const copies = booksOf\(doc, books\);/, "the copies are not found by the plan's own rule");
    assert.match(
      laying,
      /if \(written\.has\(book\.id\)\) \{\s*laid\.push\(\{ \.\.\.doc, docId: book\.id \}\);\s*continue;\s*\}/,
      "a book just written is read back for nothing",
    );
    assert.match(laying, /laid\.push\(\{ \.\.\.doc, docId: book\.id, marks: placed\.marks \}\);/, "the laid marks are not addressed to their copy");
    assert.match(laying, /if \(placed\.lost > 0\) unplaced\.push\(\{ title: book\.title, count: placed\.lost \}\);/, "what could not be placed is not counted by book");
  });

  it("reads the marked parts first and the whole book only after an anchor fails", async () => {
    const script = await source("reader/reader.js");
    const placing = bodyOf(script, "placeBookMarks");
    const marked = placing.indexOf("const prose = await proseAt(mark.segmentIndex);");
    const guard = placing.indexOf("if (prose === null || !fitsProse(prose, mark)) {");
    const shortcut = placing.indexOf("if (fit) return { marks, healed: 0, lost: 0 };");
    const whole = placing.indexOf(
      "for (let index = 0; index < book.segmentCount; index += 1) whole.push((await proseAt(index)) ?? []);",
    );
    const laid = placing.indexOf("return reanchorMarks(whole, marks);");
    assert.ok(marked !== -1 && guard !== -1 && shortcut !== -1 && whole !== -1 && laid !== -1, "a step is missing");
    assert.ok(marked < guard && guard < shortcut && shortcut < whole && whole < laid, "the whole book is read before an anchor fails");
    // One reading of a stored block: the search's.
    assert.match(bodyOf(script, "bookPartProse"), /segment\.blocks\.map\(storedBlockText\)/, "a part's prose is not the search's reading of its blocks");
    assert.match(script, /import \{[^}]*storedBlockText[^}]*\} from "\.\/doc-search\.js";/, "storedBlockText is not the doc search's");
  });

  it("says what could not be placed, in every language, and nothing when everything was", async () => {
    const script = await source("reader/reader.js");
    const notes = bodyOf(script, "unplacedNotes");
    assert.match(notes, /if \(count === 0\) return \[\];/, "a report with nothing unplaced gets a sentence");
    assert.match(notes, /plural\(count, "reader_marks_import_unplaced", \[titleSample\(/, "the sentence does not count the marks with a sample of titles");
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      assert.ok(
        "reader_marks_import_unplaced_one" in catalogue && "reader_marks_import_unplaced_other" in catalogue,
        `${locale} lacks the sentence`,
      );
    }
  });
});
