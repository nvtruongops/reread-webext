import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIndex, findMatches } from "../src/lib/matcher/index.js";
import { keyTokens, tokenize } from "../src/lib/matcher/tokenize.js";

// By code point, because a curly apostrophe and a straight one are the same
// character to everybody reading a diff and different characters to a computer.
const RIGHT_SINGLE_QUOTE = String.fromCodePoint(0x2019);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const E_ACUTE = String.fromCodePoint(0x00e9);

/**
 * @param {string} text
 * @param {string[]} keys
 * @returns {string[]} the matched substrings, taken back out of the text by offset
 */
function matched(text, keys) {
  return findMatches(text, buildIndex(keys)).map((match) => text.slice(match.start, match.end));
}

describe("tokenize", () => {
  it("says where each token was, in the string it was given", () => {
    assert.deepEqual(tokenize("The Hague"), [
      { text: "the", start: 0, end: 3 },
      { text: "hague", start: 4, end: 9 },
    ]);
  });

  it("keeps offsets usable after composing characters", () => {
    // NFC would shorten this string; doing it per token instead is what keeps
    // the offsets pointing at the original text.
    const text = `cafe${COMBINING_ACUTE} noir`;
    const [first] = tokenize(text);
    assert.equal(first?.text, `caf${E_ACUTE}`);
    assert.equal(text.slice(first?.start, first?.end), `cafe${COMBINING_ACUTE}`);
  });

  it("treats everything that is not a letter or a digit as a gap", () => {
    assert.deepEqual(
      tokenize("e-mail, don't!").map((token) => token.text),
      ["e", "mail", "don", "t"],
    );
  });

  it("has nothing to say about a string without words", () => {
    assert.deepEqual(tokenize("   ... --- "), []);
  });
});

describe("findMatches", () => {
  it("finds a word and not the longer word it starts", () => {
    assert.deepEqual(matched("read the reading list", ["read"]), ["read"]);
  });

  it("ignores case", () => {
    assert.deepEqual(matched("Ocean and ocean", ["ocean"]), ["Ocean", "ocean"]);
  });

  it("matches across the punctuation inside a phrase", () => {
    const text = "The world's oceans hit their hottest ever recorded temperatures";
    assert.deepEqual(matched(text, ["world's oceans", "hottest ever"]), [
      "world's oceans",
      "hottest ever",
    ]);
  });

  it("does not care which apostrophe the page uses", () => {
    const text = `it doesn${RIGHT_SINGLE_QUOTE}t matter`;
    assert.deepEqual(matched(text, ["doesn't"]), [`doesn${RIGHT_SINGLE_QUOTE}t`]);
  });

  it("finds a word the page spelled with a combining mark", () => {
    const text = `a cafe${COMBINING_ACUTE} in Paris`;
    assert.deepEqual(matched(text, [`caf${E_ACUTE}`]), [`cafe${COMBINING_ACUTE}`]);
  });

  it("takes the longest phrase that starts where it is looking", () => {
    const text = "The world's oceans are warming";
    assert.deepEqual(matched(text, ["world", "world's oceans"]), ["world's oceans"]);
  });

  it("never returns overlapping matches", () => {
    const text = "sea surface temperature";
    const matches = findMatches(text, buildIndex(["sea surface", "surface temperature"]));
    assert.deepEqual(
      matches.map((match) => text.slice(match.start, match.end)),
      ["sea surface"],
    );
  });

  it("says which saved phrase each match is, not just where it is", () => {
    const matches = findMatches("the oceans are warming", buildIndex(["oceans"]));
    assert.deepEqual(matches, [{ start: 4, end: 10, normalized: "oceans" }]);
  });

  it("finds every occurrence, not only the first", () => {
    assert.equal(matched("bank, bank and bank", ["bank"]).length, 3);
  });

  it("ignores a key with no words in it rather than matching everything", () => {
    assert.deepEqual(matched("anything at all", ["", "..."]), []);
  });
});
