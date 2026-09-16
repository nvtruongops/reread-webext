import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withDefaults } from "../src/lib/config.js";
import { mirrorWithForms } from "../src/lib/store/forms.js";

/**
 * The mirror rebuilt with the other forms of its words (D208): when the
 * dictionaries are asked at all, which words they are asked about, and
 * what the standing mirror spares them - the rules `background/vocabulary.js`
 * and the phrases page's migration stand on. The dictionary store itself
 * (`readForms`) lives on IndexedDB and stays with the smoke tests; here it
 * is a fake that records what it was asked.
 */

const CONFIG = withDefaults({ sourceLang: "en", targetLang: "pl", underlineForms: true });

/**
 * @param {string} normalized
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(normalized) {
  return {
    id: `id-${normalized}`,
    langFrom: "en",
    langTo: "pl",
    phrase: normalized,
    normalized,
    translations: ["x"],
    createdAt: 1000,
  };
}

/**
 * @param {import("../src/lib/store/mirror.js").VocabMirror | null} standing
 * @param {Record<string, string[]>} [answers] what the dictionaries say per word
 * @param {string} [stamp] the shelf's stamp now
 */
function deps(standing, answers = {}, stamp = "1|en|dict:10:5") {
  /** @type {Array<{ lang: string, keys: string[], known: Record<string, string[]>, stamp: string }>} */
  const asked = [];
  return {
    asked,
    standing: async () => standing,
    /** @type {import("../src/lib/store/forms.js").FormsDeps["readForms"]} */
    readForms: async (lang, of) => {
      asked.push({ lang, ...of });
      const reuse = of.stamp === stamp ? of.known : {};
      /** @type {Record<string, string[]>} */
      const forms = {};
      for (const key of of.keys) forms[key] = reuse[key] ?? answers[key] ?? [];
      return { stamp, forms };
    },
  };
}

describe("mirrorWithForms", () => {
  it("asks the dictionaries about the single words of the pair, and writes what they said", async () => {
    const fake = deps(null, { read: ["reads", "reading"] });
    const mirror = await mirrorWithForms(CONFIG, [phrase("read"), phrase("take off"), phrase("bank")], fake);

    assert.deepEqual(fake.asked, [{ lang: "en", keys: ["read", "bank"], known: {}, stamp: "" }]);
    assert.deepEqual(mirror.forms, { read: ["reads", "reading"], bank: [] });
    assert.equal(mirror.formsStamp, "1|en|dict:10:5");
    assert.deepEqual(mirror.entries, [
      ["read", ["x"]],
      ["take off", ["x"]],
      ["bank", ["x"]],
    ]);
  });

  it("hands the standing mirror's forms and stamp over, so only the new words cost reads", async () => {
    /** @type {import("../src/lib/store/mirror.js").VocabMirror} */
    const standing = {
      from: "en",
      to: "pl",
      entries: [["read", ["x"]]],
      forms: { read: ["reads", "reading"], gone: ["goes"] },
      formsStamp: "1|en|dict:10:5",
    };
    const fake = deps(standing, { bank: ["banks"] });
    const mirror = await mirrorWithForms(CONFIG, [phrase("read"), phrase("bank")], fake);

    assert.deepEqual(fake.asked[0]?.known, standing.forms);
    assert.equal(fake.asked[0]?.stamp, standing.formsStamp);
    // The forgotten word's forms are not carried: the mirror answers for the
    // words it has.
    assert.deepEqual(mirror.forms, { read: ["reads", "reading"], bank: ["banks"] });
  });

  it("writes no forms and opens no dictionary while the switch is off", async () => {
    const fake = deps(null, { read: ["reads"] });
    const mirror = await mirrorWithForms(withDefaults({ sourceLang: "en", targetLang: "pl" }), [phrase("read")], fake);

    assert.equal(fake.asked.length, 0);
    assert.deepEqual(mirror.forms, {});
    assert.equal(mirror.formsStamp, "");
  });

  it("writes no forms for a language the rules do not know, or with no pair", async () => {
    const polish = withDefaults({ sourceLang: "pl", targetLang: "en", underlineForms: true });
    const fake = deps(null, { czytać: ["czytam"] });
    assert.deepEqual((await mirrorWithForms(polish, [phrase("czytać")], fake)).forms, {});

    const none = withDefaults({ underlineForms: true });
    assert.deepEqual((await mirrorWithForms(none, [], fake)).forms, {});
    assert.equal(fake.asked.length, 0);
  });

  it("keeps the standing forms when the dictionary database will not open - stale beats none", async () => {
    /** @type {import("../src/lib/store/mirror.js").VocabMirror} */
    const standing = {
      from: "en",
      to: "pl",
      entries: [["read", ["x"]]],
      forms: { read: ["reads"] },
      formsStamp: "1|en|dict:10:5",
    };
    const broken = {
      standing: async () => standing,
      /** @type {import("../src/lib/store/forms.js").FormsDeps["readForms"]} */
      readForms: async () => {
        throw new Error("The dictionary database is in use by another page");
      },
    };
    const mirror = await mirrorWithForms(CONFIG, [phrase("read"), phrase("bank")], broken);

    assert.deepEqual(mirror.entries, [
      ["read", ["x"]],
      ["bank", ["x"]],
    ]);
    assert.deepEqual(mirror.forms, { read: ["reads"] });
    assert.equal(mirror.formsStamp, "1|en|dict:10:5");
  });
});
