import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collapseWhitespace, normalize, trimPhrase } from "../src/lib/normalize.js";

// Spelled out by code point: these are the characters the function exists for,
// and a literal one in a test file is a character nobody reviewing it can see.
const NBSP = String.fromCodePoint(0x00a0);
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const E_ACUTE = String.fromCodePoint(0x00e9);

describe("collapseWhitespace", () => {
  it("keeps the case it was given", () => {
    assert.equal(collapseWhitespace("The Hague"), "The Hague");
  });

  it("turns a selection spanning a line break into one line", () => {
    assert.equal(
      collapseWhitespace("a phrase\n  broken  across\tlines"),
      "a phrase broken across lines",
    );
  });

  it("trims the whitespace a drag-selection picks up at the edges", () => {
    assert.equal(collapseWhitespace("  word  "), "word");
  });

  it("treats a non-breaking space as a space", () => {
    assert.equal(collapseWhitespace(`non${NBSP}breaking`), "non breaking");
  });

  it("drops a soft hyphen left over from justified text", () => {
    assert.equal(collapseWhitespace(`hy${SOFT_HYPHEN}phen`), "hyphen");
  });

  it("drops a zero-width space used as a break opportunity", () => {
    assert.equal(collapseWhitespace(`break${ZERO_WIDTH_SPACE}here`), "breakhere");
  });

  it("composes decomposed characters, so the same word has one form", () => {
    assert.equal(collapseWhitespace(`cafe${COMBINING_ACUTE}`), `caf${E_ACUTE}`);
  });

  it("answers an empty string for a selection of nothing but whitespace", () => {
    assert.equal(collapseWhitespace(" \n\t "), "");
  });
});

describe("trimPhrase", () => {
  it("keeps the case, like collapseWhitespace", () => {
    assert.equal(trimPhrase("The Hague"), "The Hague");
  });

  it("takes off the punctuation a drag-selection catches at either end", () => {
    assert.equal(trimPhrase("word,"), "word");
    assert.equal(trimPhrase('"quoted"'), "quoted");
    assert.equal(trimPhrase("(aside)"), "aside");
    assert.equal(trimPhrase("...and then"), "and then");
  });

  it("leaves the whitespace a stripped comma left behind", () => {
    assert.equal(trimPhrase("  word , "), "word");
  });

  it("does not reach inside a word", () => {
    for (const text of ["e-mail", "don't", "U.S.A", "rock 'n' roll"]) {
      assert.equal(trimPhrase(text), text);
    }
  });

  it("answers an empty string for a selection of nothing but punctuation", () => {
    assert.equal(trimPhrase("..."), "");
    assert.equal(trimPhrase(" - "), "");
  });
});

describe("normalize", () => {
  it("folds case, so the same word at the start of a sentence is the same word", () => {
    assert.equal(normalize("The Hague"), normalize("the hague"));
  });

  it("agrees with collapseWhitespace on everything else", () => {
    assert.equal(normalize(`  Caf${E_ACUTE}  Noir `), `caf${E_ACUTE} noir`);
  });

  it("reduces a selection with a comma and one without to the same key", () => {
    // The reason this rule exists: page text is matched token by token, so a
    // key with a comma in it would never underline anything, ever.
    assert.equal(normalize("word,"), normalize("word"));
    assert.equal(normalize('"Word."'), normalize("word"));
  });

  it("is idempotent - normalizing a key again returns the key", () => {
    const key = normalize(`  "Some${SOFT_HYPHEN} Phrase!"\n`);
    assert.equal(normalize(key), key);
  });
});
