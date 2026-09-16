import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { MAX_SENTENCE_LENGTH } from "../src/lib/sentence.js";
import {
  MAX_PHRASE_LENGTH,
  buildPhrase,
  cleanSentence,
  counted,
  countsOf,
  hasSentence,
  resaved,
  restored,
  withImportedSentence,
  withRestoredCounts,
  withSentence,
} from "../src/lib/store/phrase.js";

/**
 * @param {Partial<Parameters<typeof buildPhrase>[0]>} overrides
 * @returns {import("../src/lib/protocol.js").Result<import("../src/lib/store/phrase.js").Phrase>}
 */
function build(overrides) {
  return buildPhrase({
    text: "word",
    translations: ["slowo"],
    langFrom: "en",
    langTo: "pl",
    id: "id-1",
    now: 1000,
    ...overrides,
  });
}

describe("buildPhrase", () => {
  it("stores the phrase as it was written and the key case-folded", () => {
    assert.deepEqual(
      build({ text: "The Hague" }),
      ok({
        id: "id-1",
        langFrom: "en",
        langTo: "pl",
        phrase: "The Hague",
        normalized: "the hague",
        translations: ["slowo"],
        createdAt: 1000,
      }),
    );
  });

  it("does not keep the comma a drag-selection caught", () => {
    const built = build({ text: "word," });
    assert.ok(built.ok);
    assert.equal(built.value.phrase, "word");
    assert.equal(built.value.normalized, "word");
  });

  it("leaves punctuation inside a word alone", () => {
    for (const text of ["e-mail", "don't", "U.S.A"]) {
      const built = build({ text });
      assert.ok(built.ok);
      assert.equal(built.value.phrase, text, `should have kept ${text} whole`);
    }
  });

  it("stores meanings without tabs or newlines, which the TSV export cannot escape", () => {
    const built = build({ translations: ["one\ttwo\nthree"] });
    assert.ok(built.ok);
    assert.deepEqual(built.value.translations, ["one two three"]);
  });

  it("drops blank and repeated meanings and keeps the order of the rest", () => {
    const built = build({ translations: ["bank", "   ", "bank", "brzeg"] });
    assert.ok(built.ok);
    assert.deepEqual(built.value.translations, ["bank", "brzeg"]);
  });

  it("refuses a selection that is nothing but punctuation - there is no key to save it under", () => {
    assert.deepEqual(build({ text: "..." }), fail(ErrorCode.INTERNAL));
  });

  it("refuses a phrase with nothing to mean", () => {
    assert.deepEqual(build({ translations: [] }), fail(ErrorCode.INTERNAL));
    assert.deepEqual(build({ translations: ["  "] }), fail(ErrorCode.INTERNAL));
  });

  it("refuses a page sent in place of a phrase", () => {
    assert.deepEqual(build({ text: "x".repeat(MAX_PHRASE_LENGTH + 1) }), fail(ErrorCode.TOO_LONG));
  });

  it("accepts a phrase exactly at the limit", () => {
    const built = build({ text: "x".repeat(MAX_PHRASE_LENGTH) });
    assert.ok(built.ok);
  });

  it("keeps the sentence the phrase stood in, folded to one line (D210)", () => {
    const built = build({ context: "The  bank\nwas steep." });
    assert.ok(built.ok);
    assert.equal(built.value.context, "The bank was steep.");
    assert.ok(hasSentence(built.value));
  });

  it("writes no sentence field at all without one - a row from a save without the setting is a row from before D210", () => {
    for (const context of [undefined, "", "   "]) {
      const built = build({ context });
      assert.ok(built.ok);
      assert.equal("context" in built.value, false, `should have written no field for ${JSON.stringify(context)}`);
      assert.equal(hasSentence(built.value), false);
    }
  });

  it("leaves out a sentence longer than the bubble would ever offer - a paragraph sent by a malformed message", () => {
    const atLimit = build({ context: "x".repeat(MAX_SENTENCE_LENGTH) });
    assert.ok(atLimit.ok);
    assert.equal(atLimit.value.context?.length, MAX_SENTENCE_LENGTH);

    const past = build({ context: "x".repeat(MAX_SENTENCE_LENGTH + 1) });
    assert.ok(past.ok);
    assert.equal("context" in past.value, false);
  });
});

describe("resaved", () => {
  it("keeps what identifies the row and takes what the reader just decided", () => {
    /** @type {import("../src/lib/store/phrase.js").Phrase} */
    const existing = {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "bank",
      normalized: "bank",
      translations: ["bank"],
      createdAt: 1000,
      context: "on the bank of the river",
    };
    const incoming = { ...existing, id: "id-2", createdAt: 2000, phrase: "Bank", translations: ["brzeg"] };

    assert.deepEqual(resaved(existing, incoming), {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "Bank",
      normalized: "bank",
      translations: ["brzeg"],
      createdAt: 1000,
      context: "on the bank of the river",
    });
  });

  it("keeps the first sentence whatever a later save carries (D210)", () => {
    /** @type {import("../src/lib/store/phrase.js").Phrase} */
    const existing = {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "bank",
      normalized: "bank",
      translations: ["bank"],
      createdAt: 1000,
      context: "The bank was steep.",
    };
    // Met again in another sentence: the meanings move, the card's example stays.
    const again = { ...existing, id: "id-2", createdAt: 2000, translations: ["brzeg"], context: "A bank in the city." };
    assert.equal(resaved(existing, again).context, "The bank was steep.");
    // Saved again with the setting off, or from the phrases page: no sentence
    // on the way in, and none taken away.
    const { context: _dropped, ...bare } = again;
    assert.equal(resaved(existing, bare).context, "The bank was steep.");
  });

  it("takes a sentence into a row that has none - the phrase kept before the setting was on", () => {
    /** @type {import("../src/lib/store/phrase.js").Phrase} */
    const existing = {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "bank",
      normalized: "bank",
      translations: ["bank"],
      createdAt: 1000,
    };
    const incoming = { ...existing, id: "id-2", createdAt: 2000, context: "The bank was steep." };
    assert.deepEqual(resaved(existing, incoming), { ...existing, context: "The bank was steep." });
    // A hand-edited copy can hold an empty string there; that is no sentence.
    assert.equal(resaved({ ...existing, context: "" }, incoming).context, "The bank was steep.");
    assert.equal("context" in resaved(existing, { ...existing, id: "id-3" }), false);
  });
});

describe("hasSentence", () => {
  it("is a string with something in it, and nothing else - a copy edited by hand can hold anything", () => {
    /** @type {import("../src/lib/store/phrase.js").Phrase} */
    const bare = { id: "id-1", langFrom: "en", langTo: "pl", phrase: "bank", normalized: "bank", translations: ["brzeg"], createdAt: 1 };
    assert.equal(hasSentence(bare), false);
    assert.equal(hasSentence({ ...bare, context: "" }), false);
    assert.equal(hasSentence({ ...bare, context: /** @type {any} */ (42) }), false);
    assert.equal(hasSentence({ ...bare, context: "The bank was steep." }), true);
  });
});

describe("counted", () => {
  /** @type {import("../src/lib/store/phrase.js").Phrase} */
  const kept = {
    id: "id-1",
    langFrom: "en",
    langTo: "pl",
    phrase: "bank",
    normalized: "bank",
    translations: ["brzeg"],
    createdAt: 1000,
  };

  it("adds a batch of counts and stamps the time of each count that grew", () => {
    assert.deepEqual(counted(kept, { recalled: 2, read: 5 }, 5000), {
      ...kept,
      recallCount: 2,
      lastRecallAt: 5000,
      readCount: 5,
      lastReadAt: 5000,
    });
    const once = counted(kept, { recalled: 1, read: 0 }, 5000);
    assert.deepEqual(once, { ...kept, recallCount: 1, lastRecallAt: 5000 });
    assert.deepEqual(counted(once, { recalled: 0, read: 3 }, 6000), {
      ...kept,
      recallCount: 1,
      lastRecallAt: 5000,
      readCount: 3,
      lastReadAt: 6000,
    });
  });

  it("gives the row back untouched - the same object - when the batch adds nothing", () => {
    assert.equal(counted(kept, { recalled: 0, read: 0 }, 5000), kept);
    assert.equal(counted(kept, { recalled: -1, read: 1.5 }, 5000), kept);
    assert.equal(counted(kept, { recalled: Number.NaN, read: 0 }, 5000), kept);
  });

  it("reads a row from before the counts as zero, and keeps every other field", () => {
    assert.deepEqual(countsOf(kept), { recalls: 0, reads: 0 });
    const withContext = { ...kept, context: "on the bank", recallCount: 4 };
    assert.deepEqual(countsOf(withContext), { recalls: 4, reads: 0 });
    assert.deepEqual(counted(withContext, { recalled: 1, read: 0 }, 7000), {
      ...withContext,
      recallCount: 5,
      lastRecallAt: 7000,
    });
  });

  it("survives a save of the same phrase again - resaved keeps the counts", () => {
    const existing = { ...kept, recallCount: 3, lastRecallAt: 2000, readCount: 9, lastReadAt: 3000 };
    const incoming = { ...kept, id: "id-2", createdAt: 4000, phrase: "Bank", translations: ["brzeg rzeki"] };
    assert.deepEqual(resaved(existing, incoming), { ...existing, phrase: "Bank", translations: ["brzeg rzeki"] });
  });
});

describe("withImportedSentence", () => {
  /**
   * @param {string} [context]
   * @returns {import("../src/lib/store/phrase.js").Phrase}
   */
  function bank(context) {
    const built = buildPhrase({ text: "bank", translations: ["brzeg"], langFrom: "en", langTo: "pl", id: "id-bank", now: 1, context });
    assert.ok(built.ok);
    return built.value;
  }

  it("gives a saved row the file's sentence when the row has none (D212)", () => {
    const existing = bank();
    const filled = withImportedSentence(existing, bank("The bank was steep."));
    assert.equal(filled.context, "The bank was steep.");
    // Nothing else of the row moves: the file's meanings are not taken.
    assert.deepEqual({ ...filled, context: undefined }, { ...existing, context: undefined });
  });

  it("hands the same row back when it has a sentence already, or the file none - nothing to write", () => {
    const kept = bank("The first sentence.");
    assert.equal(withImportedSentence(kept, bank("Another sentence.")), kept);
    const bare = bank();
    assert.equal(withImportedSentence(bare, bank()), bare);
  });
});

describe("withSentence", () => {
  /**
   * @param {string} [context]
   * @returns {import("../src/lib/store/phrase.js").Phrase}
   */
  function bank(context) {
    const built = buildPhrase({ text: "bank", translations: ["brzeg"], langFrom: "en", langTo: "pl", id: "id-bank", now: 1, context });
    assert.ok(built.ok);
    return built.value;
  }

  it("gives a row kept without a sentence the one its bubble opened in, folded to one line (D216)", () => {
    const existing = { ...bank(), recallCount: 3, lastRecallAt: 500 };
    const filled = withSentence(existing, "The  bank\n was steep.");
    assert.equal(filled.context, "The bank was steep.");
    // Nothing else of the row moves - not the meanings, not the counts.
    assert.deepEqual({ ...filled, context: undefined }, { ...existing, context: undefined });
  });

  it("keeps the first sentence: a row with one hands itself back whatever the bubble stood in", () => {
    const kept = bank("The first sentence.");
    assert.equal(withSentence(kept, "Another sentence."), kept);
  });

  it("hands the same row back for no sentence, or one past the ceiling - nothing to write", () => {
    const bare = bank();
    assert.equal(withSentence(bare, undefined), bare);
    assert.equal(withSentence(bare, ""), bare);
    assert.equal(withSentence(bare, "   "), bare);
    assert.equal(withSentence(bare, "x".repeat(MAX_SENTENCE_LENGTH + 1)), bare);
    assert.equal(withSentence(bare, "x".repeat(MAX_SENTENCE_LENGTH)).context?.length, MAX_SENTENCE_LENGTH);
    // A hand-edited copy can hold an empty string there; that is no sentence.
    assert.equal(withSentence({ ...bare, context: "" }, "The bank was steep.").context, "The bank was steep.");
  });
});

describe("cleanSentence", () => {
  it("folds a sentence to one line and leaves out what is no sentence - empty, or past the ceiling", () => {
    assert.equal(cleanSentence("The  bank\n was steep."), "The bank was steep.");
    assert.equal(cleanSentence("   "), undefined);
    assert.equal(cleanSentence("x".repeat(601)), undefined);
    assert.equal(cleanSentence(undefined), undefined);
  });
});

describe("withRestoredCounts", () => {
  /** @returns {import("../src/lib/store/phrase.js").Phrase} */
  function bank() {
    const built = buildPhrase({ text: "bank", translations: ["brzeg"], langFrom: "en", langTo: "pl", id: "id-bank", now: 1 });
    assert.ok(built.ok);
    return built.value;
  }

  it("takes the file's counts and their moments onto a fresh row (D213)", () => {
    const row = withRestoredCounts(bank(), { recallCount: 3, lastRecallAt: 100, readCount: 2, lastReadAt: 200 });
    assert.equal(row.recallCount, 3);
    assert.equal(row.lastRecallAt, 100);
    assert.equal(row.readCount, 2);
    assert.equal(row.lastReadAt, 200);
  });

  it("writes no count of zero and drops what is no count, keeping the phrase", () => {
    const row = withRestoredCounts(bank(), { recallCount: 0, lastRecallAt: 5, readCount: -1, lastReadAt: 6 });
    assert.equal("recallCount" in row, false);
    assert.equal("lastRecallAt" in row, false);
    assert.equal("readCount" in row, false);
    assert.equal(row.phrase, "bank");
    // A count without a usable moment keeps the count alone.
    const bare = withRestoredCounts(bank(), { recallCount: 2, lastRecallAt: Number.NaN });
    assert.equal(bare.recallCount, 2);
    assert.equal("lastRecallAt" in bare, false);
  });
});

describe("restored", () => {
  /**
   * @param {Partial<import("../src/lib/store/phrase.js").Phrase>} [rest]
   * @returns {import("../src/lib/store/phrase.js").Phrase}
   */
  function bank(rest = {}) {
    const built = buildPhrase({ text: "bank", translations: ["brzeg"], langFrom: "en", langTo: "pl", id: "id-bank", now: 1 });
    assert.ok(built.ok);
    return { ...built.value, ...rest };
  }

  it("takes the greater of each count with the later moment, and never lowers one (D213)", () => {
    const existing = bank({ recallCount: 5, lastRecallAt: 500, readCount: 1, lastReadAt: 50 });
    const incoming = bank({ recallCount: 8, lastRecallAt: 300, readCount: 1, lastReadAt: 900 });
    const merged = restored(existing, incoming);
    assert.equal(merged.recallCount, 8);
    assert.equal(merged.lastRecallAt, 500, "the later of the two moments stays");
    assert.equal(merged.readCount, 1, "an equal count does not move");
    assert.equal(merged.lastReadAt, 50, "an equal count keeps its own moment");
    // The other way round: the file knows less, the row keeps its own.
    assert.equal(restored(incoming, existing).recallCount, 8);
  });

  it("fills the sentence where there was none, and never rewrites the meanings or the day", () => {
    const existing = bank({ translations: ["brzeg"], createdAt: 1 });
    const incoming = bank({ translations: ["instytucja"], createdAt: 99, context: "The bank was steep." });
    const merged = restored(existing, incoming);
    assert.equal(merged.context, "The bank was steep.");
    assert.deepEqual(merged.translations, ["brzeg"]);
    assert.equal(merged.createdAt, 1);
    assert.equal(restored(bank({ context: "Mine." }), incoming).context, "Mine.");
  });

  it("hands the same row back when nothing rises - the same file twice writes nothing", () => {
    const existing = bank({ context: "Mine.", recallCount: 4, lastRecallAt: 10, readCount: 2, lastReadAt: 20 });
    assert.equal(restored(existing, bank({ context: "Other.", recallCount: 4, readCount: 1 })), existing);
    assert.equal(restored(existing, bank()), existing);
  });
});
