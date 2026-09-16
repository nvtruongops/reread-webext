import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SAMPLE_CHARS, detectLanguage, foreignLanguage, phraseLanguage, sample } from "../src/lib/detect.js";

/** @param {string} language @param {number} percentage */
const sure = (language, percentage = 99) => ({ isReliable: true, languages: [{ language, percentage }] });

const PAIR = { from: "en", to: "pl", declared: null };

describe("foreignLanguage", () => {
  it("takes a confident reading of the pair's target language - the reader's own (D193)", () => {
    // Michał's page: Polish text under en → pl, the engine fed the wrong
    // language. The detector reads the sentence as Polish, and that is
    // the one verdict the engine steps aside for.
    assert.equal(foreignLanguage(sure("pl"), PAIR), "pl");
    assert.equal(foreignLanguage(sure("pl-PL"), PAIR), "pl");
  });

  it("takes the page's declared language when the detector agrees", () => {
    // A German page under en → pl says it is German and reads as German:
    // two witnesses, and the engine has no German to translate.
    assert.equal(foreignLanguage(sure("de"), { from: "en", to: "pl", declared: "de" }), "de");
    // The detector alone naming some third language is not enough: close
    // relatives are confused, and a pair reading one must not lose its
    // engine to the other.
    assert.equal(foreignLanguage(sure("de"), PAIR), "");
    assert.equal(foreignLanguage(sure("nn"), { from: "nb", to: "en", declared: null }), "");
  });

  it("never names the pair's own source", () => {
    assert.equal(foreignLanguage(sure("en"), PAIR), "");
    assert.equal(foreignLanguage(sure("en-US"), { from: "en", to: "pl", declared: "en" }), "");
  });

  it("says nothing without confidence, without a leading language, or without a detector", () => {
    assert.equal(foreignLanguage({ isReliable: false, languages: [{ language: "pl", percentage: 99 }] }, PAIR), "");
    assert.equal(foreignLanguage({ isReliable: true, languages: [] }, PAIR), "");
    assert.equal(foreignLanguage(null, PAIR), "");
    // A text split down the middle is nobody's.
    assert.equal(
      foreignLanguage(
        { isReliable: true, languages: [{ language: "pl", percentage: 55 }, { language: "en", percentage: 45 }] },
        PAIR,
      ),
      "",
    );
  });

  it("reads the leading language whatever order the detector lists them in", () => {
    assert.equal(
      foreignLanguage(
        { isReliable: true, languages: [{ language: "en", percentage: 10 }, { language: "pl", percentage: 90 }] },
        PAIR,
      ),
      "pl",
    );
  });
});

describe("phraseLanguage", () => {
  it("is the detector's verdict where there is one", () => {
    assert.equal(phraseLanguage({ detected: "pl", answered: "en", entries: 3, pairFrom: "en" }), "pl");
  });

  it("falls back to the dictionary that knew the word, when it is another language's", () => {
    // The word the detector was unsure about - a heading, a lone word -
    // that a Polish dictionary recognised while the English ones did not.
    assert.equal(phraseLanguage({ detected: "", answered: "pl", entries: 1, pairFrom: "en" }), "pl");
    assert.equal(phraseLanguage({ detected: "", answered: "pl-PL", entries: 1, pairFrom: "en-US" }), "pl");
  });

  it("names nothing for the pair's own language, or for no witness at all", () => {
    assert.equal(phraseLanguage({ detected: "", answered: "en", entries: 2, pairFrom: "en" }), "");
    assert.equal(phraseLanguage({ detected: "", answered: "pl", entries: 0, pairFrom: "en" }), "");
    assert.equal(phraseLanguage({ detected: "", answered: null, entries: 0, pairFrom: "en" }), "");
  });
});

describe("sample", () => {
  it("hands the detector at most four hundred characters of the sentence, and nothing of a blank one", () => {
    // The promise PRIVACY.md makes about what a browser component is handed:
    // the sentence around the selection, never more than this.
    assert.equal(SAMPLE_CHARS, 400);
    assert.equal(sample("  Zaznacz słowo.  "), "Zaznacz słowo.");
    assert.equal(sample("x".repeat(1000)).length, SAMPLE_CHARS);
    assert.equal(sample("   "), "");
  });
});

describe("detectLanguage", () => {
  it("answers null where the browser has no detector, rather than throwing", async () => {
    // The English catalogue's fake `browser` carries `i18n.getMessage` and
    // nothing else - the shape of a browser without the call (Safari).
    assert.equal(await detectLanguage("Zaznacz słowo."), null);
  });
});
