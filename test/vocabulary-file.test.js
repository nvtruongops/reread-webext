import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VOCABULARY_ENTRY, fromVocabularyFile, toVocabularyFile, vocabularyRows } from "../src/lib/store/vocabulary-file.js";

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

describe("vocabularyRows", () => {
  it("writes every pair, by pair and then oldest first, the id as the tie", () => {
    const rows = vocabularyRows([
      phrase("late", { createdAt: 30 }),
      phrase("Haus", { langFrom: "de", createdAt: 50 }),
      phrase("early", { createdAt: 10 }),
      phrase("twin-b", { id: "id-b", createdAt: 20 }),
      phrase("twin-a", { id: "id-a", createdAt: 20 }),
    ]);
    assert.deepEqual(
      rows.map((row) => `${row.langFrom}-${row.langTo}:${row.text}`),
      ["de-pl:Haus", "en-pl:early", "en-pl:twin-a", "en-pl:twin-b", "en-pl:late"],
    );
  });

  it("carries what the TSV cannot - the day, the sentence, the counts - and writes no field a row lacks", () => {
    const [bare, full] = vocabularyRows([
      phrase("bare"),
      phrase("full", {
        createdAt: 11,
        context: "A full sentence.",
        recallCount: 3,
        lastRecallAt: 100,
        readCount: 2,
        lastReadAt: 200,
      }),
    ]);
    assert.deepEqual(bare, { langFrom: "en", langTo: "pl", text: "bare", translations: ["znaczenie"], createdAt: 10 });
    assert.deepEqual(full, {
      langFrom: "en",
      langTo: "pl",
      text: "full",
      translations: ["znaczenie"],
      createdAt: 11,
      context: "A full sentence.",
      recallCount: 3,
      lastRecallAt: 100,
      readCount: 2,
      lastReadAt: 200,
    });
    // A zero count and a moment without its count are not written.
    const [zero] = vocabularyRows([phrase("zero", { recallCount: 0, lastRecallAt: 5, readCount: 0 })]);
    assert.deepEqual(zero, { langFrom: "en", langTo: "pl", text: "zero", translations: ["znaczenie"], createdAt: 10 });
  });

  it("does not carry the id or the normalized form - the store mints one and derives the other", () => {
    const [row] = vocabularyRows([phrase("Bank")]);
    assert.ok(row !== undefined);
    assert.equal("id" in row, false);
    assert.equal("normalized" in row, false);
  });
});

describe("toVocabularyFile and fromVocabularyFile", () => {
  it("survive a roundtrip row for row", () => {
    const phrases = [
      phrase("bank", { translations: ["brzeg", "bank"], context: "The bank was steep.", recallCount: 2, lastRecallAt: 7 }),
      phrase("Haus", { langFrom: "de", readCount: 1, lastReadAt: 9 }),
    ];
    const text = toVocabularyFile(phrases);
    assert.match(text, /"format": "reread-vocabulary"/);
    assert.match(text, /"version": 1/);
    assert.deepEqual(fromVocabularyFile(text), { rows: vocabularyRows(phrases), invalid: 0 });
  });

  it("names the entry the backup of everything writes it under", () => {
    assert.equal(VOCABULARY_ENTRY, "vocabulary.json");
  });

  it("reads zero rows out of a text that is not this file, and counts a broken entry", () => {
    assert.deepEqual(fromVocabularyFile("not json"), { rows: [], invalid: 0 });
    assert.deepEqual(fromVocabularyFile("[]"), { rows: [], invalid: 0 });
    assert.deepEqual(fromVocabularyFile(JSON.stringify({ format: "reread-articles", articles: [] })), { rows: [], invalid: 0 });
    const mixed = JSON.stringify({
      format: "reread-vocabulary",
      version: 1,
      phrases: [
        { langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"] },
        { langFrom: "english", langTo: "pl", text: "bank", translations: ["brzeg"] },
        { langFrom: "en", langTo: "pl", text: "", translations: ["brzeg"] },
        7,
      ],
    });
    assert.deepEqual(fromVocabularyFile(mixed), {
      rows: [{ langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"] }],
      invalid: 3,
    });
  });

  it("reads a newer file's rows as far as it can - the version is not a gate", () => {
    const newer = JSON.stringify({
      format: "reread-vocabulary",
      version: 9,
      phrases: [{ langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"], tone: "future" }],
    });
    assert.deepEqual(fromVocabularyFile(newer).rows, [{ langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"] }]);
  });
});
