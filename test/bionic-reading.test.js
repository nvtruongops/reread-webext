import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fixationLength,
  formatBionicWord,
  toBionicHtml,
} from "../src/lib/bionic.js";

describe("Bionic Reading Fixation Engine (Phase 4)", () => {
  it("computes fixation lengths correctly according to word scale", () => {
    assert.equal(fixationLength(1), 1); // "a" -> "a"
    assert.equal(fixationLength(3), 1); // "the" -> "t"
    assert.equal(fixationLength(4), 2); // "read" -> "re"
    assert.equal(fixationLength(6), 3); // "bionic" -> "bio"
    assert.equal(fixationLength(10), 5); // "comprehend" -> "compr"
  });

  it("formats single words with bold fixation parts while preserving punctuation", () => {
    assert.equal(formatBionicWord("read"), "<b>re</b>ad");
    assert.equal(formatBionicWord('"hello,"'), '"<b>he</b>llo,"');
    assert.equal(formatBionicWord("(fast)"), "(<b>fa</b>st)");
    assert.equal(formatBionicWord("Bücher"), "<b>Büc</b>her");
  });

  it("transforms multi-word paragraphs and preserves all spacing", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    const result = toBionicHtml(input);
    assert.ok(result.includes("<b>T</b>he"));
    assert.ok(result.includes("<b>qu</b>ick"));
    assert.ok(result.includes("<b>br</b>own"));
    assert.ok(result.includes("<b>d</b>og."));
  });

  it("handles empty or non-string inputs safely", () => {
    assert.equal(toBionicHtml(""), "");
    assert.equal(formatBionicWord(""), "");
  });
});
