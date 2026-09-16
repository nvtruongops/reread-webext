import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pairChoices } from "../src/popup/choices.js";

const ENPL = { pair: "enpl", from: "en", to: "pl" };
const PLEN = { pair: "plen", from: "pl", to: "en" };
const DEEN = { pair: "deen", from: "de", to: "en" };

describe("the popup's pair choices", () => {
  it("offers the installed models, sorted by pair", () => {
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, [PLEN, DEEN, ENPL]), [
      DEEN,
      ENPL,
      PLEN,
    ]);
  });

  it("offers only what is installed - downloading is the settings page's job", () => {
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, [ENPL]), [ENPL]);
  });

  it("still offers the configured pair when its model is not here", () => {
    // A control must never disagree with the settings it shows: swapping in
    // the first installed pair would claim somebody chose what they did not.
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "uk" }, [PLEN]), [
      { pair: "enuk", from: "en", to: "uk" },
      PLEN,
    ]);
  });

  it("offers the configured pair alone when nothing is installed at all", () => {
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, []), [
      { pair: "enpl", from: "en", to: "pl" },
    ]);
  });

  it("does not double the configured pair when its model is installed", () => {
    assert.deepEqual(pairChoices({ sourceLang: "pl", targetLang: "en" }, [ENPL, PLEN]), [ENPL, PLEN]);
  });

  it("offers exactly the installed models while no pair is chosen", () => {
    const none = { sourceLang: null, targetLang: null };
    assert.deepEqual(pairChoices(none, [PLEN, ENPL]), [ENPL, PLEN]);
    // A fresh install: nothing installed, nothing chosen, an empty select -
    // which the popup never shows, its rows rule swaps it for the setup line.
    assert.deepEqual(pairChoices(none, []), []);
  });

  it("lists the dictionaries' pairs beside the models when handed them (D165)", () => {
    // Under the trim the dictionaries are what works: a Polish page with a
    // pl-en dictionary is read under pl -> en without a walk to the settings.
    // A pair both a model and a dictionary offer is one row, and the
    // configured pair is still never doubled.
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, [ENPL], [PLEN, ENPL]), [ENPL, PLEN]);
    assert.deepEqual(pairChoices({ sourceLang: "pl", targetLang: "en" }, [], [PLEN]), [PLEN]);
    // Handed nothing extra - the model-on popup - nothing changes.
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, [ENPL], []), [ENPL]);
  });

  it("offers a monolingual book's pair only as the last resort for its language (D166)", () => {
    const ENEN = { pair: "enen", from: "en", to: "en" };
    const PLPL = { pair: "plpl", from: "pl", to: "pl" };
    // Michał's popup: en -> en and pl -> pl beside en -> pl and pl -> en -
    // second shelves for languages that have one. Gone.
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "pl" }, [], [ENEN, ENPL, PLEN, PLPL]), [
      ENPL,
      PLEN,
    ]);
    // The only book for English: its pair is the one shelf there is.
    assert.deepEqual(pairChoices({ sourceLang: null, targetLang: null }, [], [ENEN]), [ENEN]);
    // Standing on the monolingual shelf, it stays listed while chosen.
    assert.deepEqual(pairChoices({ sourceLang: "en", targetLang: "en" }, [ENPL], [ENEN]), [ENEN, ENPL]);
  });
});
