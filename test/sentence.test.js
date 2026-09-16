import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_SENTENCE_LENGTH, sentenceAround } from "../src/lib/sentence.js";

/**
 * Marks the selection in the text with `[` and `]`, so a case reads as the
 * reader would see it rather than as two numbers.
 *
 * @param {string} marked
 * @returns {string | null}
 */
function around(marked) {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  return sentenceAround(text, start, end);
}

describe("sentenceAround", () => {
  it("takes the sentence the selection sits in, and only that one", () => {
    assert.equal(
      around("He sat down. The [bank] of the river was steep. Nobody was there."),
      "The bank of the river was steep.",
    );
  });

  it("starts at the beginning of the text when nothing ends before it", () => {
    assert.equal(around("The [bank] of the river was steep. Then it rained."), "The bank of the river was steep.");
  });

  it("ends at the end of the text when nothing ends after it", () => {
    assert.equal(around("He stopped. The [bank] of the river was steep"), "The bank of the river was steep");
  });

  it("does not break on a decimal point", () => {
    assert.equal(around("The rate fell to 3.5 per [cent] last year."), "The rate fell to 3.5 per cent last year.");
  });

  it("does not break on initials", () => {
    assert.equal(
      around("J. R. R. Tolkien wrote about a [ring] in a hole."),
      "J. R. R. Tolkien wrote about a ring in a hole.",
    );
  });

  it("does not break on an abbreviation followed by a name", () => {
    assert.equal(around("Mr. Smith kept the [ledger] in his desk."), "Mr. Smith kept the ledger in his desk.");
  });

  it("does not break on a lower-case word after the stop", () => {
    assert.equal(around("It cost 40 p. per [sheet] of paper."), "It cost 40 p. per sheet of paper.");
  });

  it("breaks on a question mark and an exclamation mark", () => {
    assert.equal(around("Where is it? The [key] was here!"), "The key was here!");
    assert.equal(around("Stop! The [key] is gone."), "The key is gone.");
  });

  it("breaks on an ellipsis", () => {
    assert.equal(around("He waited… The [door] opened."), "The door opened.");
  });

  it("finds the stop a closing quotation mark hides", () => {
    // Half of a news article is written like this, and without the rule the
    // context grows backwards until it is thrown away for being too long -
    // which the reader sees as a bubble with no sentence in it at all.
    assert.equal(around("It “ended.” She [walked] away."), "She walked away.");
    assert.equal(around('It "ended." She [walked] away.'), "She walked away.");
    assert.equal(around("It ‘ended.’ She [walked] away."), "She walked away.");
    assert.equal(around("It ended (really.) She [walked] away."), "She walked away.");
    assert.equal(around("To koniec.” Ona [poszła] sobie."), "Ona poszła sobie.");
    assert.equal(around("C'est fini.» Elle [partit] sans un mot."), "Elle partit sans un mot.");
  });

  it("keeps the closing quotation mark with the sentence it closes", () => {
    assert.equal(
      around("He wrote, “I think he [should] go.” Nobody replied."),
      "He wrote, “I think he should go.”",
    );
  });

  it("does not break on a question or an exclamation inside a quotation", () => {
    assert.equal(
      around("He said “stop!” and the [driver] braked hard."),
      "He said “stop!” and the driver braked hard.",
    );
    assert.equal(
      around("He asked “why?” and the [driver] shrugged twice."),
      "He asked “why?” and the driver shrugged twice.",
    );
    assert.equal(
      around("He waited… and the [driver] braked hard at last."),
      "He waited… and the driver braked hard at last.",
    );
  });

  it("breaks after a quoted question or exclamation that did end the sentence", () => {
    assert.equal(around("He said “stop!” She [walked] away."), "She walked away.");
    assert.equal(around("He asked “why?” She [walked] away."), "She walked away.");
  });

  it("steps over the footnote reference a page hangs off the stop", () => {
    // Offsets by hand: the brackets of a footnote are the brackets this file
    // marks a selection with.
    const text = "He was born in 1809.[1] She walked away.";
    const at = text.indexOf("walked");
    assert.equal(sentenceAround(text, at, at + 6), "She walked away.");
  });

  it("does not break on a semicolon, a colon or a dash", () => {
    assert.equal(around("He came home; the [light] was on."), "He came home; the light was on.");
    assert.equal(around("One thing was clear: the [driver] had not seen it."), "One thing was clear: the driver had not seen it.");
    assert.equal(around("The plan - his own - was [simple] enough."), "The plan - his own - was simple enough.");
  });

  it("still calls a long newspaper sentence a sentence", () => {
    const text = `The report said ${"that it went on and on ".repeat(20)}until the [end].`;
    const length = text.length - 2;
    assert.ok(length > 400 && length < MAX_SENTENCE_LENGTH, `the case is ${length} characters long`);
    assert.equal(around(text), text.replace("[", "").replace("]", ""));
  });

  it("breaks on a line inside one block", () => {
    assert.equal(around("First line\nThe [second] line"), "The second line");
  });

  it("keeps a full stop that belongs to the selection", () => {
    assert.equal(around("Read [the whole thing. Then] stop."), "Read the whole thing. Then stop.");
  });

  it("says nothing when the selection already is the sentence", () => {
    assert.equal(around("[The bank was steep.]"), null);
    assert.equal(around("He stopped. [The bank was steep.] Then it rained."), null);
  });

  it("says nothing when the selection is the sentence bar its punctuation", () => {
    assert.equal(around("[The bank was steep]."), null);
  });

  it("says nothing when what is around the selection is not a sentence", () => {
    const long = `${"word ".repeat(MAX_SENTENCE_LENGTH)}here.`;
    assert.equal(sentenceAround(long, 0, 4), null);
  });

  it("says nothing about offsets that make no sense", () => {
    assert.equal(sentenceAround("The bank was steep.", 5, 5), null);
    assert.equal(sentenceAround("The bank was steep.", -1, 4), null);
    assert.equal(sentenceAround("The bank was steep.", 4, 100), null);
    assert.equal(sentenceAround("The bank was steep.", 1.5, 4), null);
    assert.equal(sentenceAround("", 0, 0), null);
  });

  it("trims the whitespace a block leaves around its text", () => {
    assert.equal(around("  \n  The [bank] was steep.   "), "The bank was steep.");
  });

  it("works in Polish, where the abbreviations are lower-case", () => {
    assert.equal(
      around("Kupił chleb, mleko itd. Potem [wrócił] do domu. Było ciemno."),
      "Potem wrócił do domu.",
    );
    assert.equal(around("Zebranie o godz. 15 w [sali] numer 3."), "Zebranie o godz. 15 w sali numer 3.");
  });

  it("does not break inside a domain or a file name", () => {
    assert.equal(around("Read it on example.com before the [meeting] starts."), "Read it on example.com before the meeting starts.");
  });
});
