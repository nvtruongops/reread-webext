import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLine, isHeading, isPronunciation, isReference } from "../src/lib/dict/line-classifier.js";

/**
 * The line classifier (the panel's second round): which lines of an entry
 * are meanings to tick, and which are a transcription, a label or a
 * cross-reference. The lines below are real ones - the en-pl and pl-en
 * WikDict builds and reader.dict's English and Polish editions, read with
 * the import's own reader on 2026-09-12 - plus the counterexamples the
 * brief names.
 */

describe("classifyLine", () => {
  it("takes a transcription out: slashes or brackets with a mark of the IPA in them, or slashes alone", () => {
    for (const line of [
      // WikDict en-pl, "news": eight transcriptions on one line.
      "/n(j)udʒ/, /n(j)uz/, /njus/, /njuːz/, /nuz/, /nuːz/, /[nɪu̯z]/, /[ɲus]/",
      // WikDict en-pl, "newlywed", "newness".
      "/ˈnjuːliˌwɛd/",
      "/ˈn(j)uːnəs/",
      // WikDict pl-en, "adenoid", after the decoded superscript is gone.
      "/ˌadɛ̃ˈnɔjit/",
      // reader.dict EN, the one line it writes between slashes.
      "/haʊ̯ əm aɪ̯/ → /haʊ̯ m‿aɪ̯/",
      // Slashes alone, no mark of the IPA in them.
      "/nuz/, /njus/",
      // Brackets with a mark in them (the en-pl "curry").
      "[ˈkʌ.ɹi]",
    ]) {
      assert.equal(classifyLine(line, "en"), "pronunciation", line);
    }
  });

  it("takes a label out: the whole line a part of speech or a section's name, in the book's language or in English", () => {
    for (const line of [
      // WikDict, lower case, English in every language pair.
      "noun",
      "adjective",
      "phraseologicalUnit",
      "cardinalNumeral",
      "acronym",
      "proverb",
      // reader.dict EN: capitalised, its own sections too.
      "Noun",
      "Verb",
      "Proper Noun",
      "Usage Note",
      "Synonyms",
      "Prefix",
    ]) {
      assert.equal(classifyLine(line, "en"), "heading", line);
    }
    // reader.dict PL writes Polish headings; the English list still applies
    // beside them, because WikDict's pl-en labels are English.
    for (const line of ["Rzeczownik", "Czasownik", "Synonimy", "Odmiana", "Fraza", "noun"]) {
      assert.equal(classifyLine(line, "pl"), "heading", line);
    }
    // A full stop after the label is the label still.
    assert.ok(isHeading("Noun.", "en"));
  });

  it("takes a cross-reference out: the brief's prefixes", () => {
    for (const line of [
      // reader.dict EN, "news" and others.
      "Synonym: word",
      "Synonyms: (chiefly Britain) telly, (slang) tube",
      "Antonyms: silence",
      "See also Thesaurus:news",
      "See also: newspaper",
      "Hyponyms: breaking news",
      "Hypernym: information",
      "Related: newsworthy",
    ]) {
      assert.equal(classifyLine(line, "en"), "reference", line);
    }
  });

  it("leaves every other line a meaning - the counterexamples", () => {
    for (const line of [
      // A path begins with a slash and has no mark of the IPA, and it is not
      // closed slashes with commas between them.
      "/usr/bin/env",
      // A label with words after it is a meaning that starts with one.
      "Noun phrase meaning X",
      // reader.dict's 27,000 definitions that begin "Synonym of" say what
      // the word means; the colon is what makes a reference.
      "Synonym of nowina",
      // A bracket at the start is a qualifier, not a transcription.
      "(transitive, archaic) To report; to make known.",
      // A bilingual one-liner from an en-pl book.
      "bad news zła wiadomość",
      // A fraction, and a bracketed qualifier without the IPA.
      "1/2, 3/4",
      "[Internet] messages posted on newsgroups",
      // The etymology paragraph reader.dict ends an entry with.
      "From Middle English newes, newys (“new things”), equivalent to new + -s.",
    ]) {
      assert.equal(classifyLine(line, "en"), "meaning", line);
    }
    assert.equal(isPronunciation("/usr/bin/env"), false);
    assert.equal(isReference("Synonym of nowina"), false);
  });

  it("knows the labels of a language it has a list for, and English for every book", () => {
    assert.ok(isHeading("Substantiv", "de"));
    assert.ok(isHeading("nom commun", "fr"));
    assert.ok(isHeading("sustantivo", "es"));
    assert.ok(isHeading("іменник", "uk"));
    // A language without a list still reads WikDict's English labels.
    assert.ok(isHeading("noun", "it"));
    assert.equal(isHeading("rzeczownik", "en"), false);
    // The words left out on purpose: everyday translations in the other
    // direction, whatever a book uses them for as headings.
    for (const word of ["symbol", "idiom", "article", "particle"]) {
      assert.equal(isHeading(word, "en"), false, word);
    }
  });
});
