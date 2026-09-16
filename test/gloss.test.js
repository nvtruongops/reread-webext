import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HINT_MAX_WORDS,
  afterChoosing,
  answeredElsewhere,
  choosableLines,
  dictionaryHint,
  entryBlocks,
  filingWarning,
  linkedWord,
  quietNote,
  savePress,
  toMeanings,
} from "../src/lib/gloss.js";

describe("toMeanings", () => {
  it("keeps one line as one meaning", () => {
    assert.deepEqual(toMeanings("brzeg"), ["brzeg"]);
  });

  it("makes a meaning of every line", () => {
    assert.deepEqual(toMeanings("brzeg\nbank"), ["brzeg", "bank"]);
  });

  it("splits a dictionary line that was several lines in the book", () => {
    // What `senses()` produces for an entry written a paragraph per meaning.
    // Kept whole it would reach the store as one meaning and come out with its
    // lines glued together by spaces - one long answer instead of three.
    assert.deepEqual(toMeanings("bank (instytucja)\nbrzeg (rzeki)\nławica"), [
      "bank (instytucja)",
      "brzeg (rzeki)",
      "ławica",
    ]);
  });

  it("drops blank lines and the space around a meaning", () => {
    assert.deepEqual(toMeanings("  brzeg  \n\n   \nbank\n"), ["brzeg", "bank"]);
  });

  it("has nothing to save in an empty box", () => {
    assert.deepEqual(toMeanings("   \n  \n"), []);
  });
});

describe("choosableLines", () => {
  it("leaves an entry that already had a meaning per sense alone", () => {
    assert.deepEqual(choosableLines(["bank (instytucja)", "brzeg"]), ["bank (instytucja)", "brzeg"]);
  });

  it("breaks up the one field a dictionary packed a whole entry into", () => {
    // WikDict's `nominate`, shortened. Pressed whole it made a four-line gloss
    // with a phonetic transcription in it; the reader wanted the last line.
    assert.deepEqual(
      choosableLines(["/ˈnɑ.mə.neɪt/, /ˈnɒm.ɪ.neɪt/\nverb\nto name someone for a particular role\nnominować"]),
      ["/ˈnɑ.mə.neɪt/, /ˈnɒm.ɪ.neɪt/", "verb", "to name someone for a particular role", "nominować"],
    );
  });

  it("gives every row something that can stand alone as a meaning", () => {
    // What the bubble is promised: press any row and exactly one meaning is
    // saved, never a row that would turn back into two.
    const rows = choosableLines(["a\nb\nc", "d", "  \ne  "]);
    for (const row of rows) assert.equal(toMeanings(row).length, 1);
    assert.deepEqual(rows, ["a", "b", "c", "d", "e"]);
  });

  it("has nothing to offer for an entry with nothing in it", () => {
    assert.deepEqual(choosableLines([]), []);
    assert.deepEqual(choosableLines(["", "   "]), []);
  });
});

describe("afterChoosing", () => {
  it("adds the pressed line under what the engine said", () => {
    assert.equal(afterChoosing("Wystąpienie", "okazja"), "Wystąpienie\nokazja");
  });

  it("collects several meanings in the order they were pressed", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja", "zjawisko"), "Wystąpienie\nokazja\nzjawisko");
  });

  it("takes a meaning back out when its line is pressed again", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja\nzjawisko", "okazja"), "Wystąpienie\nzjawisko");
  });

  it("leaves the rest alone when one of several goes", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja", "Wystąpienie"), "okazja");
  });

  it("adds to a gloss the reader has edited by hand", () => {
    assert.equal(afterChoosing("brzeg rzeki", "bank (instytucja)"), "brzeg rzeki\nbank (instytucja)");
  });

  it("does not keep the same meaning twice", () => {
    // The line is already in - pressing it means taking it out, which is what
    // the mark under it says. The engine and the dictionary agreeing is exactly
    // when this happens.
    assert.equal(afterChoosing("wydarzenie\nokazja", "wydarzenie"), "okazja");
  });

  it("gives nothing back rather than an empty gloss", () => {
    // The bubble declines this press: a phrase with no meaning has nothing to
    // save, and there is no state in which the last line may go.
    assert.equal(afterChoosing("okazja", "okazja"), "");
  });
});

describe("entryBlocks", () => {
  /**
   * @param {string} dictionary
   * @param {string} headword
   * @returns {import("../src/lib/protocol.js").DictEntry}
   */
  const entry = (dictionary, headword) => ({ dictionary, headword, senses: ["a meaning"] });

  it("prints neither half when the entry only repeats the page back", () => {
    // One book, and it found exactly what was selected: a label would say
    // nothing the page and the list do not already say.
    const [block] = entryBlocks([entry("WikDict", "watch")], "watch");
    assert.deepEqual(block, { headword: "", dictionary: "", lines: ["a meaning"] });
  });

  it("names the found form when it is not what was selected", () => {
    // The selection was "watches", the book knows "watch" - the label has to
    // say which word the definition is of. The comparison runs through the
    // key, so a difference of case or accent alone stays quiet.
    const [inflected] = entryBlocks([entry("WikDict", "watch")], "watches");
    assert.equal(inflected?.headword, "watch");
    const [cased] = entryBlocks([entry("WikDict", "Watch")], "watch");
    assert.equal(cased?.headword, "");
  });

  it("names the book only when there are books to tell apart", () => {
    const alone = entryBlocks([entry("WikDict", "watch")], "watch");
    assert.equal(alone[0]?.dictionary, "");

    const crowd = entryBlocks([entry("WikDict", "watch"), entry("PONS", "watch")], "watch");
    assert.deepEqual(
      crowd.map((block) => block.dictionary),
      ["WikDict", "PONS"],
    );
  });

  it("splits an entry's senses into one line per meaning", () => {
    const [block] = entryBlocks(
      [{ dictionary: "WikDict", headword: "watch", senses: ["verb\nobserwować", "zegarek"] }],
      "watch",
    );
    assert.deepEqual(block?.lines, ["verb", "obserwować", "zegarek"]);
  });
});

describe("quietNote", () => {
  it("says nothing while there are entries to show", () => {
    assert.equal(quietNote({ entries: 2, dictionaries: 1, findable: true }), null);
    assert.equal(quietNote({ entries: 1, dictionaries: 1, findable: false }), null);
  });

  it("names the missing dictionary first, then the gesture, then the miss", () => {
    // Michał's screenshot (2026-09-01): a fragment of a word, model off, and
    // the bubble stood on two icons and no word. The missing dictionary
    // outranks the gesture - it is the one state that outlasts this phrase.
    assert.equal(quietNote({ entries: 0, dictionaries: 0, findable: true }), "no-dictionary");
    assert.equal(quietNote({ entries: 0, dictionaries: 0, findable: false }), "no-dictionary");
    assert.equal(quietNote({ entries: 0, dictionaries: 1, findable: false }), "whole-words");
    assert.equal(quietNote({ entries: 0, dictionaries: 3, findable: true }), "not-in-dictionary");
  });
});

describe("dictionaryHint", () => {
  it("is about a word or two, and nothing longer", () => {
    // Michał's measure (2026-09-11): the engine guesses worst at a word on
    // its own; past two words a selection is a phrase it handles.
    assert.equal(HINT_MAX_WORDS, 2);
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: 0, findable: true }), "no-dictionary");
    assert.equal(dictionaryHint({ words: 2, entries: 0, dictionaries: 0, findable: true }), "no-dictionary");
    assert.equal(dictionaryHint({ words: 3, entries: 0, dictionaries: 0, findable: true }), null);
    assert.equal(dictionaryHint({ words: 0, entries: 0, dictionaries: 0, findable: true }), null);
  });

  it("tells the missing dictionary from the silent ones by the count", () => {
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: 0, findable: true }), "no-dictionary");
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: 2, findable: true }), "not-in-dictionary");
  });

  it("says nothing without a count - a fault never reads as a missing dictionary", () => {
    // A lookup that gave no answer, or a background from before the field:
    // the same silence D164 keeps in the quiet bubble.
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: undefined, findable: true }), null);
  });

  it("says nothing while the dictionaries have answered", () => {
    assert.equal(dictionaryHint({ words: 1, entries: 1, dictionaries: 2, findable: true }), null);
  });

  it("leaves a fragment of a word to the gesture, not to the dictionaries", () => {
    // The quiet bubble says "select whole words" there (quietNote); the
    // translating bubble has no such line and says nothing. The missing
    // dictionary still outranks the gesture, as in quietNote.
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: 2, findable: false }), null);
    assert.equal(dictionaryHint({ words: 1, entries: 0, dictionaries: 0, findable: false }), "no-dictionary");
  });
});

describe("linkedWord", () => {
  it("cuts the sentence around the word the catalogue put in, wherever it stands", () => {
    assert.deepEqual(linkedWord("add one in the settings", "settings"), {
      before: "add one in the ",
      word: "settings",
      after: "",
    });
    // German puts the verb's tail after it.
    assert.deepEqual(linkedWord("fügen Sie eines in den Einstellungen hinzu", "Einstellungen"), {
      before: "fügen Sie eines in den ",
      word: "Einstellungen",
      after: " hinzu",
    });
  });

  it("cuts nothing when the word is not in the sentence, or is nothing", () => {
    // A catalogue that dropped the placeholder still reads as a sentence.
    assert.equal(linkedWord("add one in the settings", ""), null);
    assert.equal(linkedWord("add one", "settings"), null);
  });

  it("takes the first occurrence", () => {
    assert.deepEqual(linkedWord("a b a", "a"), { before: "", word: "a", after: " b a" });
  });
});

describe("answeredElsewhere", () => {
  it("is the two signals agreeing: entries from a dictionary of another language than the pair's (D193)", () => {
    // Michał's screenshot (2026-09-11): "książkach" on a Polish page under
    // en → pl - with a Polish dictionary that knows the word, the phrase is
    // Polish and the engine's "księgowa" is a guess at the wrong language.
    assert.equal(answeredElsewhere({ entries: 1, reading: "pl", pairFrom: "en" }), true);
  });

  it("cries no wolf on one signal alone", () => {
    // Nothing found in the page's language: an English quote on a Polish
    // page, or a Polish word no dictionary holds - the engine's answer stands.
    assert.equal(answeredElsewhere({ entries: 0, reading: "pl", pairFrom: "en" }), false);
    // The pair's own dictionary answered: nothing foreign about it.
    assert.equal(answeredElsewhere({ entries: 2, reading: "en", pairFrom: "en" }), false);
    // No language named on either side says nothing.
    assert.equal(answeredElsewhere({ entries: 2, reading: "", pairFrom: "en" }), false);
    assert.equal(answeredElsewhere({ entries: 2, reading: "pl", pairFrom: "" }), false);
  });
});

describe("filingWarning", () => {
  it("warns only where the page's language and a dictionary of it agree (D167)", () => {
    // Michał's rule: lang=pl on the page and the word found in a Polish
    // book - then Save filing under en -> pl is worth a sentence.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "pl", pairFrom: "en" }), true);
    // One signal alone cries wolf: nothing found in Polish books may mean an
    // English quote on a Polish page, where en -> pl is the right shelf.
    assert.equal(filingWarning({ entries: 0, findable: true, reading: "pl", pairFrom: "en" }), false);
    // Same language, no mismatch to speak of.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "en", pairFrom: "en" }), false);
    // No Save on offer, nothing to warn about.
    assert.equal(filingWarning({ entries: 2, findable: false, reading: "pl", pairFrom: "en" }), false);
    // Nobody named a language on either side.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "", pairFrom: "en" }), false);
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "pl", pairFrom: "" }), false);
  });
});

describe("savePress", () => {
  it("keeps whenever there is a meaning to keep", () => {
    assert.equal(savePress({ meanings: 1, lines: 0, editing: false }), "save");
    assert.equal(savePress({ meanings: 2, lines: 4, editing: true }), "save");
  });

  it("answers an empty press with the sentence while there are lines to press", () => {
    assert.equal(savePress({ meanings: 0, lines: 3, editing: false }), "prompt");
    assert.equal(savePress({ meanings: 0, lines: 1, editing: false }), "prompt");
  });

  it("stays out of reach with no line to point at, and over an open edit box", () => {
    assert.equal(savePress({ meanings: 0, lines: 0, editing: false }), "nothing");
    assert.equal(savePress({ meanings: 0, lines: 3, editing: true }), "nothing");
  });
});
