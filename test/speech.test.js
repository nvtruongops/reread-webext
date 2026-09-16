import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_CHUNK, chunkText, wordSpan } from "../src/lib/reader/speech.js";

/**
 * What the page hands in: the article's text with a line break for every block
 * boundary (`prosePieces`).
 *
 * @param {string[]} blocks
 * @returns {string}
 */
function article(blocks) {
  return blocks.map((block) => `\n${block}\n`).join("");
}

/**
 * @param {string} text
 * @param {import("../src/lib/reader/speech.js").Chunk[]} chunks
 * @returns {string[]}
 */
function spoken(text, chunks) {
  return chunks.map((chunk) => text.slice(chunk.start, chunk.end));
}

describe("chunkText", () => {
  it("cuts at sentence ends and keeps the punctuation with its sentence", () => {
    const text = "The rain fell. The road was empty! Was it?";
    assert.deepEqual(spoken(text, chunkText(text)), [
      "The rain fell.",
      "The road was empty!",
      "Was it?",
    ]);
  });

  it("does not cut inside an abbreviation, an initial or a number", () => {
    // The same rule the bubble finds a sentence with, and the reason it is
    // shared: a breath in the middle of a name is audible.
    const text = "Mr. Smith paid 3.14 to J. R. Tolkien.";
    assert.deepEqual(spoken(text, chunkText(text)), [text]);
  });

  it("keeps a closing quotation mark with the sentence it ends", () => {
    // The other half of the shared rule: a voice that stopped at the `!` would
    // breathe in the middle of `he said`, and start the next utterance on a
    // quotation mark with nothing in front of it.
    const text = "He said “stop!” and the driver braked. “It is over.” She left.";
    assert.deepEqual(spoken(text, chunkText(text)), [
      "He said “stop!” and the driver braked.",
      "“It is over.”",
      "She left.",
    ]);
  });

  it("ends a chunk at every block boundary, punctuated or not", () => {
    // A heading has no full stop and is still its own utterance: the line
    // break the page's blocks leave behind is an ending.
    const text = article(["A heading with no full stop", "And a paragraph under it."]);
    assert.deepEqual(spoken(text, chunkText(text)), [
      "A heading with no full stop",
      "And a paragraph under it.",
    ]);
  });

  it("leaves out everything that is only whitespace", () => {
    // Nested blocks put two breaks in a row, and an empty utterance would be
    // a silent step the bar's Forward would have to walk through.
    const text = article(["", "  ", "Something to say."]);
    assert.deepEqual(spoken(text, chunkText(text)), ["Something to say."]);
    assert.deepEqual(chunkText("\n \n\n \n"), []);
    assert.deepEqual(chunkText(""), []);
  });

  it("hands out chunks in order, inside the text, never overlapping", () => {
    const text = article(["One. Two. Three.", "Four? Five!"]);
    const chunks = chunkText(text);

    let previous = -1;
    for (const chunk of chunks) {
      assert.ok(chunk.start > previous, "chunks overlap");
      assert.ok(chunk.start < chunk.end, "a chunk says nothing");
      assert.ok(chunk.end <= text.length, "a chunk runs past the text");
      // Trimmed at both ends: a chunk that began on the break between two
      // paragraphs would underline the gap between them.
      assert.doesNotMatch(text.slice(chunk.start, chunk.end), /^\s|\s$/u);
      previous = chunk.end;
    }
  });

  it("cuts a wall of text at a word boundary rather than mid-word", () => {
    // A page of transcript with no punctuation at all: something has to give,
    // and what gives is the length - never a word.
    const text = "alpha bravo ".repeat(80).trim();
    const chunks = chunkText(text);

    assert.ok(chunks.length > 1, "an unpunctuated wall was left whole");
    for (const chunk of chunks) {
      assert.ok(chunk.end - chunk.start <= MAX_CHUNK, "a chunk went past the limit");
      const piece = text.slice(chunk.start, chunk.end);
      assert.doesNotMatch(piece, /^(?:lpha|ravo)/u, "a chunk starts mid-word");
      assert.doesNotMatch(piece, /(?:alph|brav)$/u, "a chunk ends mid-word");
    }
    // Nothing of the text is lost between the cuts.
    assert.equal(spoken(text, chunks).join(" "), text);
  });

  it("says one enormous token rather than nothing at all", () => {
    const text = "x".repeat(MAX_CHUNK * 2);
    const chunks = chunkText(text);
    assert.equal(spoken(text, chunks).join(""), text);
  });
});

describe("wordSpan", () => {
  const text = "The rain, don't you know, fell on well-known roofs.";

  /**
   * @param {number} index
   * @param {number} [length]
   * @returns {string | null}
   */
  const word = (index, length) => {
    const span = wordSpan(text, index, length);
    return span === null ? null : text.slice(span.start, span.end);
  };

  it("takes the engine's own length when it starts on the word", () => {
    assert.equal(word(4, 4), "rain");
  });

  it("walks the word out of the text when no length is given", () => {
    // Firefox and Android both send boundaries with no `charLength` at all,
    // and the whole underline depends on this path.
    assert.equal(word(4), "rain");
    assert.equal(word(4, 0), "rain");
  });

  it("skips whitespace an engine pointed at instead of the word", () => {
    assert.equal(word(3), "rain");
  });

  it("drops punctuation an engine counted into the word", () => {
    // "rain," with the comma: underlining it reads as a mistake.
    assert.equal(word(4, 5), "rain");
  });

  it("keeps an apostrophe and a hyphen inside a word", () => {
    assert.equal(word(10), "don't");
    assert.equal(word(34), "well-known");
  });

  it("stops at the end of the word the engine pointed at", () => {
    assert.equal(word(0), "The");
    assert.equal(word(45), "roofs");
  });

  it("answers nothing where there is no word left to underline", () => {
    assert.equal(wordSpan(text, text.length), null);
    assert.equal(wordSpan(text, text.length - 1), null);
    assert.equal(wordSpan(text, -1), null);
    assert.equal(wordSpan(text, 1.5), null);
    assert.equal(wordSpan("word   ", 4), null);
    assert.equal(wordSpan("word ...", 5), null);
  });
});
