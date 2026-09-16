import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { languagesToAsk, lookupKeys } from "../src/lib/dict/lookup.js";
import { settle, shownSenses } from "../src/lib/dict/store.js";

/**
 * The pure half of asking the dictionaries (D121): which keys a phrase is
 * asked under, and when it is not a dictionary question at all; since D191
 * also which languages it is asked in, in what order, and which language's
 * answer the bubble gets. The database half (`lookupEntries`) lives on
 * IndexedDB and stays with the smoke tests; these are the rules its callers -
 * the background's translate ride, the quiet bubble on any page, the reader's
 * own hand - stand on.
 */
describe("lookupKeys", () => {
  it("asks under the normalized phrase first", () => {
    const keys = lookupKeys("  Elevation,  ", "en");
    assert.notEqual(keys, null);
    assert.equal(keys?.[0], "elevation");
  });

  it("answers null for a phrase that normalizes to nothing", () => {
    assert.equal(lookupKeys("", "en"), null);
    assert.equal(lookupKeys("   ", "en"), null);
  });

  it("answers null beyond four words - a sentence, not a headword", () => {
    assert.notEqual(lookupKeys("kick the bucket now", "en"), null);
    assert.equal(lookupKeys("kick the bucket right now", "en"), null);
  });

  it("offers base forms only for a single English word", () => {
    const inflected = lookupKeys("running", "en") ?? [];
    assert.equal(inflected[0], "running");
    // `running` sheds `ing` and the doubled letter - the dictionary has `run`.
    assert.ok(inflected.includes("run"), `expected run among ${inflected.join(", ")}`);

    // A phrase is not conjugated word by word: `takes off` stays as spelled.
    assert.deepEqual(lookupKeys("takes off", "en"), ["takes off"]);
  });

  it("never guesses endings in a language it does not know", () => {
    // Polish inflection is the `.syn` file's business, not a rule's: a wrong
    // guess would find a real entry for a word nobody selected.
    assert.deepEqual(lookupKeys("czytania", "pl"), ["czytania"]);
  });
});

describe("languagesToAsk", () => {
  it("asks the pair first and the page's declaration second", () => {
    // The Mastodon case (D191): the interface says Polish, the post is
    // English, the pair is English - the pair's dictionaries get the word
    // before the page's word counts for anything.
    assert.deepEqual(languagesToAsk({ pair: "en", declared: "pl" }), ["en", "pl"]);
  });

  it("asks a language named twice once", () => {
    assert.deepEqual(languagesToAsk({ pair: "en", declared: "en" }), ["en"]);
  });

  it("lets the detector's verdict replace the pair (D193)", () => {
    // A Polish "list" is not the English one: the pair's shelf would answer
    // about the wrong word, so it is left alone once the phrase is known
    // to be Polish.
    assert.deepEqual(languagesToAsk({ detected: "pl", pair: "en", declared: "pl" }), ["pl"]);
    assert.deepEqual(languagesToAsk({ detected: "de", pair: "en", declared: "pl" }), ["de", "pl"]);
    assert.deepEqual(languagesToAsk({ detected: "pl", pair: "en", declared: null }), ["pl"]);
    // No verdict: the pair first, as before.
    assert.deepEqual(languagesToAsk({ detected: "", pair: "en", declared: "pl" }), ["en", "pl"]);
    assert.deepEqual(languagesToAsk({ detected: null, pair: "en", declared: "pl" }), ["en", "pl"]);
  });

  it("asks only what was named, and nothing when nothing was", () => {
    // No pair (D165's stand-in the other way round): the page's own language
    // is all there is. No page language either: nothing to ask, and the
    // caller answers null rather than guessing.
    assert.deepEqual(languagesToAsk({ pair: null, declared: "pl" }), ["pl"]);
    assert.deepEqual(languagesToAsk({ pair: "en", declared: null }), ["en"]);
    assert.deepEqual(languagesToAsk({ pair: "en", declared: "" }), ["en"]);
    assert.deepEqual(languagesToAsk({ pair: null, declared: null }), []);
    assert.deepEqual(languagesToAsk({ pair: "  ", declared: "" }), []);
  });
});

describe("settle", () => {
  const ENTRY = { dictionary: "WikDict", headword: "pan", senses: ["patelnia"] };

  it("answers with the first language whose dictionaries knew the word", () => {
    // The order is the caller's: the pair's answer stands even when the
    // page's dictionaries would have had something to say - `lookupEntries`
    // never asks them once the pair's knew the word.
    const pair = { entries: [ENTRY], dictionaries: 2, lang: "en" };
    const page = { entries: [ENTRY], dictionaries: 1, lang: "pl" };
    assert.deepEqual(settle([pair, page]), pair);
    // And the page's, one step later, for the word the pair's did not know:
    // a Polish word on a Polish page with a Polish dictionary (D165's case).
    const silent = { entries: [], dictionaries: 2, lang: "en" };
    assert.deepEqual(settle([silent, page]), page);
  });

  it("says 'not in your dictionaries' of the shelf that was consulted", () => {
    // Nobody knew the word, but the pair's dictionaries were asked: the count
    // and the language are theirs, so the bubble says "not in your
    // dictionaries" rather than sending anybody to install a Polish one.
    const silent = { entries: [], dictionaries: 2, lang: "en" };
    const none = { entries: [], dictionaries: 0, lang: "pl" };
    assert.deepEqual(settle([silent, none]), silent);
    // The other way round as well: no dictionary for the pair, the page's
    // dictionaries asked and silent - the answer is about them.
    assert.deepEqual(settle([none, silent]), silent);
  });

  it("names the first language asked when there is no dictionary at all", () => {
    // Zero dictionaries everywhere: "no dictionary for English yet" names
    // the pair's language - the one somebody reading with an English pair
    // would install - and never the interface language of a Polish site.
    const pair = { entries: [], dictionaries: 0, lang: "en" };
    const page = { entries: [], dictionaries: 0, lang: "pl" };
    assert.deepEqual(settle([pair, page]), { entries: [], dictionaries: 0, lang: "en" });
    assert.deepEqual(settle([]), { entries: [], dictionaries: 0, lang: "" });
  });
});

/**
 * The one thing a lookup does to a stored sense on its way out (0.5.56): a
 * dictionary imported before the whole entity table has no `textRevision` on
 * its record, and its senses are decoded as they are read - so `&lsqb;` reads
 * as a bracket without the dictionary being imported again. One imported
 * since carries the revision and is left exactly as stored: what it holds as
 * `&trade;` is text its book wrote as `&amp;trade;`, about the reference.
 */
describe("shownSenses", () => {
  /** @type {import("../src/lib/dict/store.js").Dictionary} */
  const record = {
    id: "d1",
    name: "reader.dict",
    langFrom: "en",
    langTo: "en",
    entryCount: 1,
    aliasCount: 0,
    bytes: 1,
    addedAt: 0,
    rank: 0,
    ready: true,
    credit: null,
  };
  const stored = ["A large wild feline. &lsqb;from 14th c.&rsqb;", "Synonym of snow leopard. &lsqb;from 18th c.&rsqb;"];

  it("decodes what an import from before the table left as written", () => {
    assert.deepEqual(shownSenses(record, stored), [
      "A large wild feline. [from 14th c.]",
      "Synonym of snow leopard. [from 18th c.]",
    ]);
    assert.deepEqual(shownSenses({ ...record, textRevision: 1 }, stored), shownSenses(record, stored));
  });

  it("leaves a dictionary imported with the table exactly as stored", () => {
    const current = ["write &trade; for the mark", "Noun\n\nA sense."];
    assert.equal(shownSenses({ ...record, textRevision: 2 }, current), current);
    assert.equal(shownSenses({ ...record, textRevision: 3 }, current), current);
  });
});
