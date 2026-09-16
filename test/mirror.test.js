import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withDefaults } from "../src/lib/config.js";
import { asMirror, formAliases, mirrorMatches, mirrorOf } from "../src/lib/store/mirror.js";

// Through `withDefaults` rather than written out: the mirror cares about the
// language pair and nothing else, and it should not need editing every time
// some other setting is added.
const CONFIG = withDefaults({ sourceLang: "en", targetLang: "pl" });

/** A mirror with nothing computed for the forms (D208) - every mirror before them. */
const NO_FORMS = { forms: {}, formsStamp: "" };

/**
 * @param {string} normalized
 * @param {string[]} translations
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(normalized, translations) {
  return {
    id: `id-${normalized}`,
    langFrom: "en",
    langTo: "pl",
    phrase: normalized,
    normalized,
    translations,
    createdAt: 1000,
  };
}

describe("mirrorOf", () => {
  it("carries the pair it was built for and nothing a page has no use for", () => {
    assert.deepEqual(mirrorOf(CONFIG, [phrase("bank", ["bank", "brzeg"])]), {
      from: "en",
      to: "pl",
      entries: [["bank", ["bank", "brzeg"]]],
      ...NO_FORMS,
    });
  });

  it("is empty rather than absent when the vocabulary is empty", () => {
    assert.deepEqual(mirrorOf(CONFIG, []), { from: "en", to: "pl", entries: [], ...NO_FORMS });
  });

  it("mirrors an unchosen pair as the empty pair", () => {
    assert.deepEqual(mirrorOf({ ...CONFIG, sourceLang: null, targetLang: null }, []), {
      from: "",
      to: "",
      entries: [],
      ...NO_FORMS,
    });
  });

  it("carries the forms it was handed, under their stamp (D208)", () => {
    const known = { forms: { read: ["reads", "reading"], bank: [] }, stamp: "1|en|dict:10:5" };
    assert.deepEqual(mirrorOf(CONFIG, [phrase("read", ["czytać"])], known), {
      from: "en",
      to: "pl",
      entries: [["read", ["czytać"]]],
      forms: { read: ["reads", "reading"], bank: [] },
      formsStamp: "1|en|dict:10:5",
    });
  });
});

describe("mirrorMatches", () => {
  it("says yes only for the pair being read", () => {
    assert.equal(mirrorMatches({ from: "en", to: "pl", entries: [], ...NO_FORMS }, CONFIG), true);
    assert.equal(mirrorMatches({ from: "pl", to: "en", entries: [], ...NO_FORMS }, CONFIG), false);
    assert.equal(mirrorMatches({ from: "en", to: "de", entries: [], ...NO_FORMS }, CONFIG), false);
  });

  it("matches the empty mirror to the unchosen pair - a fresh install must go quiet, not ask", () => {
    const none = { ...CONFIG, sourceLang: null, targetLang: null };
    assert.equal(mirrorMatches({ from: "", to: "", entries: [], ...NO_FORMS }, none), true);
    // A mirror left behind by a chosen pair does not match the pairless
    // settings - and the pairless mirror answers no chosen pair.
    assert.equal(mirrorMatches({ from: "en", to: "pl", entries: [], ...NO_FORMS }, none), false);
    assert.equal(mirrorMatches({ from: "", to: "", entries: [], ...NO_FORMS }, CONFIG), false);
  });
});

describe("asMirror", () => {
  it("accepts what the background writes", () => {
    const mirror = mirrorOf(CONFIG, [phrase("word", ["slowo"])]);
    assert.deepEqual(asMirror(mirror), mirror);
  });

  it("answers nothing at all for a shape that is not a mirror", () => {
    for (const stored of [undefined, null, 7, "vocabIndex", [], {}, { from: "en", to: "pl" }, { from: 1, to: 2, entries: [] }]) {
      assert.equal(asMirror(stored), null, `should have rejected ${JSON.stringify(stored) ?? "undefined"}`);
    }
  });

  it("drops the rows that make no sense and keeps the ones that do", () => {
    const mirror = asMirror({
      from: "en",
      to: "pl",
      entries: [
        ["good", ["dobry"]],
        ["missing meanings", []],
        ["wrong meanings", "dobry"],
        [42, ["dobry"]],
        ["", ["dobry"]],
        ["too short"],
        "not a row",
        ["mixed", ["kept", 7, ""]],
      ],
    });

    assert.deepEqual(mirror, {
      from: "en",
      to: "pl",
      entries: [
        ["good", ["dobry"]],
        ["mixed", ["kept"]],
      ],
      ...NO_FORMS,
    });
  });

  it("reads a mirror from before the forms as one with none computed (D208)", () => {
    const mirror = asMirror({ from: "en", to: "pl", entries: [["good", ["dobry"]]] });
    assert.deepEqual(mirror?.forms, {});
    assert.equal(mirror?.formsStamp, "");
  });

  it("keeps the forms that make sense, an empty list included, and drops the rest", () => {
    const mirror = asMirror({
      from: "en",
      to: "pl",
      entries: [["read", ["czytać"]]],
      forms: {
        read: ["reads", "reading", 7, ""],
        // Asked about and found to have none: worth keeping, so that the
        // next rebuild does not ask the dictionaries again.
        bank: [],
        "": ["nothing"],
        broken: "reads",
      },
      formsStamp: "1|en|dict:10:5",
    });
    assert.deepEqual(mirror?.forms, { read: ["reads", "reading"], bank: [] });
    assert.equal(mirror?.formsStamp, "1|en|dict:10:5");
  });

  it("reads forms of a shape that is not a map as none, and a stamp that is not a string as none", () => {
    const mirror = asMirror({ from: "en", to: "pl", entries: [], forms: ["reads"], formsStamp: 7 });
    assert.deepEqual(mirror?.forms, {});
    assert.equal(mirror?.formsStamp, "");
  });
});

describe("formAliases", () => {
  /** @type {import("../src/lib/protocol.js").VocabEntry[]} */
  const entries = [
    ["read", ["czytać"]],
    ["reading", ["czytanie"]],
    ["bank", ["bank"]],
  ];

  it("maps each form to the key it stands for", () => {
    const aliases = formAliases(entries, { bank: ["banks"], read: ["reads"] });
    assert.deepEqual([...aliases], [
      ["reads", "read"],
      ["banks", "bank"],
    ]);
  });

  it("never makes a saved key an alias of another - the reader's own entry answers", () => {
    // `reading` is saved in its own right: a press on it opens its bubble,
    // not `read`'s.
    const aliases = formAliases(entries, { read: ["reads", "reading"] });
    assert.deepEqual([...aliases], [["reads", "read"]]);
  });

  it("gives a form two keys claim to the first of them", () => {
    // `reads` is `read`'s by the rules and `reading`'s by the dictionary's
    // entry for both; the oldest saved word wins, and the answer is the same
    // on every page.
    const aliases = formAliases(entries, { read: ["reads"], reading: ["reads", "readings"] });
    assert.deepEqual([...aliases], [
      ["reads", "read"],
      ["readings", "reading"],
    ]);
  });

  it("ignores the forms of a key that is not among the entries", () => {
    // A key left in the forms after its phrase was forgotten has no bubble
    // to open, and its forms must not be underlined.
    const aliases = formAliases(entries, { gone: ["goes", "going"] });
    assert.equal(aliases.size, 0);
  });

  it("has nothing to say without forms", () => {
    assert.equal(formAliases(entries, {}).size, 0);
    assert.equal(formAliases([], { read: ["reads"] }).size, 0);
  });
});
