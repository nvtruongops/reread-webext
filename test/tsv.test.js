import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ankiExportFilename, exportFilename, fromTsv, pairFromFilename, toAnkiTsv, toTsv } from "../src/lib/store/tsv.js";

/**
 * @param {string} text
 * @param {string[]} translations
 * @param {string} [context] the sentence the phrase was kept from (D210)
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(text, translations, context) {
  /** @type {import("../src/lib/store/phrase.js").Phrase} */
  const row = {
    id: "id-" + text,
    langFrom: "en",
    langTo: "pl",
    phrase: text,
    normalized: text.toLowerCase(),
    translations,
    createdAt: 0,
  };
  if (context !== undefined) row.context = context;
  return row;
}

describe("toTsv", () => {
  it("writes nothing for an empty vocabulary", () => {
    assert.equal(toTsv([]), "");
  });

  it("writes phrase TAB meaning, one row per phrase, every row newline-terminated", () => {
    assert.equal(
      toTsv([phrase("hello", ["cześć"]), phrase("world", ["świat"])]),
      "hello\tcześć\nworld\tświat\n",
    );
  });

  it("joins several meanings into one cell with a semicolon and a space", () => {
    assert.equal(toTsv([phrase("bank", ["brzeg", "instytucja"])]), "bank\tbrzeg; instytucja\n");
  });

  it("writes no header row", () => {
    assert.ok(toTsv([phrase("hello", ["cześć"])]).startsWith("hello\t"));
  });

  it("lets nothing into a field that would break the file", () => {
    // A tab would open a column and a newline a row. Stored phrases are
    // already clean; this holds even for a caller that is not the store.
    assert.equal(toTsv([phrase("a\tb", ["c\nd"])]), "a b\tc d\n");
  });

  it("leaves the sentence out of the sister plugin's file - two columns, whatever the row holds (D210)", () => {
    assert.equal(toTsv([phrase("bank", ["brzeg"], "The bank was steep.")]), "bank\tbrzeg\n");
  });
});

describe("toAnkiTsv", () => {
  it("writes the sentence as a third column, empty on a row without one, so the columns never shift", () => {
    assert.equal(
      toAnkiTsv([phrase("bank", ["brzeg", "instytucja"], "The bank was steep."), phrase("hello", ["cześć"])]),
      "bank\tbrzeg; instytucja\tThe bank was steep.\nhello\tcześć\t\n",
    );
  });

  it("writes nothing for an empty vocabulary, and no header row", () => {
    assert.equal(toAnkiTsv([]), "");
    assert.ok(toAnkiTsv([phrase("hello", ["cześć"])]).startsWith("hello\t"));
  });

  it("lets nothing into the sentence that would break the file", () => {
    assert.equal(toAnkiTsv([phrase("a", ["b"], "one\ttwo\nthree")]), "a\tb\tone two three\n");
  });

  it("is read back by the importer, sentences along - the file for Anki doubles as the backup (D212)", () => {
    const written = toAnkiTsv([phrase("bank", ["brzeg"], "The bank was steep."), phrase("hello", ["cześć"])]);
    assert.deepEqual(fromTsv(written), {
      rows: [
        { text: "bank", translations: ["brzeg"], context: "The bank was steep." },
        { text: "hello", translations: ["cześć"] },
      ],
      invalid: 0,
    });
  });
});

describe("fromTsv", () => {
  it("reads what the sister plugin writes", () => {
    assert.deepEqual(fromTsv("hello\tcześć\nworld\tświat\n"), {
      rows: [
        { text: "hello", translations: ["cześć"] },
        { text: "world", translations: ["świat"] },
      ],
      invalid: 0,
    });
  });

  it("splits a cell into meanings on semicolon-space exactly", () => {
    assert.deepEqual(fromTsv("bank\tbrzeg; instytucja\n").rows, [
      { text: "bank", translations: ["brzeg", "instytucja"] },
    ]);
    // A bare semicolon is part of a meaning, not a list.
    assert.deepEqual(fromTsv("a\tb;c\n").rows, [{ text: "a", translations: ["b;c"] }]);
  });

  it("survives an export-import roundtrip cell for cell", () => {
    const phrases = [phrase("bank", ["brzeg", "instytucja"]), phrase("hello", ["cześć"])];
    assert.deepEqual(fromTsv(toTsv(phrases)), {
      rows: [
        { text: "bank", translations: ["brzeg", "instytucja"] },
        { text: "hello", translations: ["cześć"] },
      ],
      invalid: 0,
    });
  });

  it("tolerates CRLF line endings and blank lines, counting neither", () => {
    assert.deepEqual(fromTsv("hello\tcześć\r\n\r\n\nworld\tświat\r\n"), {
      rows: [
        { text: "hello", translations: ["cześć"] },
        { text: "world", translations: ["świat"] },
      ],
      invalid: 0,
    });
  });

  it("collapses whitespace inside cells the way the store would", () => {
    assert.deepEqual(fromTsv("a  b\t c \n").rows, [{ text: "a b", translations: ["c"] }]);
  });

  it("counts a line with no tab rather than keeping or throwing it", () => {
    assert.deepEqual(fromTsv("just words\nhello\tcześć\n"), {
      rows: [{ text: "hello", translations: ["cześć"] }],
      invalid: 1,
    });
  });

  it("reads a third column as the sentence, cleaned the way the store cleans one (D212)", () => {
    assert.deepEqual(fromTsv("a\tb\tThe   sentence.\n"), {
      rows: [{ text: "a", translations: ["b"], context: "The sentence." }],
      invalid: 0,
    });
    // An empty third cell is a row without a sentence, and so is a paragraph
    // past the ceiling - left out rather than kept, the row itself staying.
    assert.deepEqual(fromTsv("a\tb\t\n"), { rows: [{ text: "a", translations: ["b"] }], invalid: 0 });
    assert.deepEqual(fromTsv(`a\tb\t${"x".repeat(601)}\n`), { rows: [{ text: "a", translations: ["b"] }], invalid: 0 });
  });

  it("counts a line with a fourth column - that is some other format", () => {
    assert.deepEqual(fromTsv("a\tb\tc\td\n"), { rows: [], invalid: 1 });
  });

  it("counts a row that lost either cell", () => {
    assert.deepEqual(fromTsv("\tb\n"), { rows: [], invalid: 1 });
    assert.deepEqual(fromTsv("a\t\n"), { rows: [], invalid: 1 });
    assert.deepEqual(fromTsv("a\t ; \n"), { rows: [], invalid: 1 });
  });
});

describe("exportFilename", () => {
  it("carries the pair behind our own prefix", () => {
    assert.equal(exportFilename({ langFrom: "en", langTo: "pl" }), "reread-en-pl.tsv");
  });

  it("lets no hand-edited code name a path", () => {
    assert.equal(exportFilename({ langFrom: "e/n", langTo: "p l" }), "reread-e_n-p_l.tsv");
  });

  it("names the file for Anki apart from the plugin's, behind the same pair suffix (D210)", () => {
    assert.equal(ankiExportFilename({ langFrom: "en", langTo: "pl" }), "reread-anki-en-pl.tsv");
    assert.equal(ankiExportFilename({ langFrom: "e/n", langTo: "p l" }), "reread-anki-e_n-p_l.tsv");
    assert.deepEqual(pairFromFilename(ankiExportFilename({ langFrom: "en", langTo: "pl" })), { langFrom: "en", langTo: "pl" });
  });
});

describe("pairFromFilename", () => {
  it("reads the pair off the suffix whatever the prefix", () => {
    assert.deepEqual(pairFromFilename("offlinetranslate-en-pl.tsv"), { langFrom: "en", langTo: "pl" });
    assert.deepEqual(pairFromFilename("reread-en-pl.tsv"), { langFrom: "en", langTo: "pl" });
    assert.deepEqual(pairFromFilename("en-pl.tsv"), { langFrom: "en", langTo: "pl" });
  });

  it("knows the registry's longer code shapes", () => {
    assert.deepEqual(pairFromFilename("reread-zh_hant-en.tsv"), { langFrom: "zh_hant", langTo: "en" });
    assert.deepEqual(pairFromFilename("reread-en-hbs.tsv"), { langFrom: "en", langTo: "hbs" });
  });

  it("sees through what a browser hangs on a second download", () => {
    assert.deepEqual(pairFromFilename("reread-en-pl(1).tsv"), { langFrom: "en", langTo: "pl" });
    assert.deepEqual(pairFromFilename("reread-en-pl (2).tsv"), { langFrom: "en", langTo: "pl" });
  });

  it("reads a shouted name the same as a whispered one", () => {
    assert.deepEqual(pairFromFilename("Reread-EN-PL.TSV"), { langFrom: "en", langTo: "pl" });
  });

  it("answers null rather than guessing", () => {
    for (const name of [
      "vocabulary.tsv",
      "reread-english-polish.tsv",
      "reread-en-pl.csv",
      "reread.tsv",
      "reread-en-pl.tsv.txt",
      "",
    ]) {
      assert.equal(pairFromFilename(name), null, `should have refused ${JSON.stringify(name)}`);
    }
  });
});
