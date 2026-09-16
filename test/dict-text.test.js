import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS, TEXT_REVISION, about, catchUp, fieldText, senses } from "../src/lib/dict/text.js";

describe("fieldText", () => {
  it("passes plain text through, tidied, a blank line kept as one", () => {
    // A blank line in a plain field is a paragraph's end (D197) - kept as
    // exactly one, whatever the indentation around it.
    assert.equal(fieldText({ type: "m", text: "  brzeg   rzeki \n\n  bank  " }), "brzeg rzeki\n\nbank");
    assert.equal(fieldText({ type: "m", text: "brzeg\n \n\n  \nbank" }), "brzeg\n\nbank");
  });

  it("takes the tags off HTML and keeps the line breaks they stood for", () => {
    // `<br>` begins a line, `<p>` a paragraph: the section's end comes out as
    // a blank line, which the bubble drops and the read-only field keeps.
    const html = "<b>bank</b><br>1. brzeg<br />2. instytucja<p>3. ława</p>";
    assert.equal(fieldText({ type: "h", text: html }), "bank\n1. brzeg\n2. instytucja\n\n3. ława");
  });

  it("keeps a book's sections apart and its lists together (D197)", () => {
    // reader.dict's `news`, shortened: headings and notes as paragraphs, the
    // senses as list items, a nested list for a synonym. Flattened to one
    // line per element it read as one long list (Michał's screenshot).
    const html =
      "<p><b>Noun</b></p><ol><li>New information of interest.</li>" +
      '<ol style="list-style-type:lower-alpha"><li>Synonym: word</li></ol>' +
      "<li>(<i>Internet</i>) Messages posted on newsgroups.</li></ol>" +
      "<p><b>Verb</b></p><ol><li>(transitive,&#32;archaic) To report; to make known.</li></ol>" +
      "<p>From Middle English <i>newes</i>.</p>";
    // A heading is a paragraph of its own, as the book wrote it: the space
    // on both sides of "Noun" is the space its `<p>` has on a page.
    assert.equal(
      fieldText({ type: "h", text: html }),
      "Noun\n\nNew information of interest.\nSynonym: word\n(Internet) Messages posted on newsgroups.\n\n" +
        "Verb\n\n(transitive, archaic) To report; to make known.\n\nFrom Middle English newes.",
    );
    // Two list items are two lines, never two paragraphs; `</li><li>` used
    // to count as two breaks with an empty line between them, and the list
    // itself begins no line - its first item does.
    assert.equal(fieldText({ type: "h", text: "x<ul><li>a</li><li>b</li></ul>" }), "x\na\nb");
    // However many paragraph ends stand in a row, one blank line - and none
    // at either edge of the entry.
    assert.equal(fieldText({ type: "h", text: "<p>a</p><p></p><div></div><p>b</p>" }), "a\n\nb");
    // Two breaks in a row are the one way an entry written in `<br>` says
    // "paragraph"; an empty line the tags leave behind otherwise is not one.
    assert.equal(fieldText({ type: "h", text: "<br><br>a<br><br>b<p></p>" }), "a\n\nb");
    assert.equal(fieldText({ type: "h", text: "a<br>\n\n  <br />b" }), "a\n\nb");
    assert.equal(fieldText({ type: "h", text: "a</li>\n\n<li>b" }), "a\nb");
  });

  it("decodes the entities markup arrives with", () => {
    assert.equal(fieldText({ type: "h", text: "R&amp;D &lt;i&gt; &#65; &#x42; &nbsp;end" }), "R&D <i> A B end");
  });

  it("leaves an unknown entity alone rather than eating it", () => {
    assert.equal(fieldText({ type: "h", text: "&zzz; &#x110000;" }), "&zzz; &#x110000;");
  });

  it("takes WikDict's source annotations out of a pronunciation line", () => {
    // Straight from the wikdict-en-pl build (Michał's screenshot): the
    // references and qualifiers ride as entities, so the tag strip cannot
    // touch them and the decoding is what surfaced them in the bubble. The
    // slash the note leans on goes with it, so no `//` is left behind.
    assert.equal(
      fieldText({
        type: "h",
        text:
          '/<font color="gray">ʃuːld/&lt;ref:&lt;&lt;name:Dobson&gt;&gt;&gt;</font>/, ' +
          '/<font color="gray">ʃəd</font>/',
      }),
      "/ʃuːld/, /ʃəd/",
    );
    assert.equal(
      fieldText({
        type: "h",
        text:
          "/ˈdænəl/&lt;a:obsolete&gt;&lt;ref:{{R:en:Dobson:1957|II|334|986}} !!! " +
          "{{R:Hall PGSMS|2|3}}&gt;/",
      }),
      "/ˈdænəl/",
    );
    // A plain field may carry the notation as itself.
    assert.equal(fieldText({ type: "m", text: "/wʊd/<a:Early Modern,weak form>/" }), "/wʊd/");
    // The other qualifiers the en-pl and pl-en files write, counted in the
    // raw files (2026-09-12): which sense (`q`), which age (`qq`), which
    // accent (`aa`, nested pairs inside), which term (`t`). `<a:affricated>`
    // reached the saved-phrases page on Michał's screenshot from a
    // dictionary imported before the strip knew even `a`.
    assert.equal(
      fieldText({
        type: "h",
        text:
          '/<font color="gray">ˈæb.lə.ɡeɪt/&lt;q:verb&gt;</font>/, ' +
          '/<font color="gray">ˈæb.lə.ɡət/&lt;q:noun&gt;</font>/',
      }),
      "/ˈæb.lə.ɡeɪt/, /ˈæb.lə.ɡət/",
    );
    assert.equal(
      fieldText({
        type: "h",
        text:
          '/<font color="gray">ˈkʌvət/&lt;qq:dated&gt;</font>/, ' +
          '/<font color="gray">ˈkʊ.ɹi/&lt;aa:Northern England&gt;</font>/, ' +
          '/<font color="gray">ˈɹuː.lə/&lt;t:measuring device&gt;</font>/, ' +
          '/<font color="gray">[luːx]&lt;aa:&lt;&lt;Liverpool&gt;&gt; variant&gt;</font>/',
      }),
      "/ˈkʌvət/, /ˈkʊ.ɹi/, /ˈɹuː.lə/, /[luːx]/",
    );
    // Markup the build wrote as entities: the glide's superscript in the
    // pl-en transcriptions keeps its letter, the tag goes; reader.dict's
    // transliteration note goes whole - the entry gives it in brackets
    // beside the word already.
    assert.equal(fieldText({ type: "h", text: "/ˌadɛ̃ˈnɔ&lt;sup&gt;j&lt;/sup&gt;it/" }), "/ˌadɛ̃ˈnɔjit/");
    assert.equal(
      fieldText({ type: "h", text: "Clipping of Russian абха́з&lt;tr:abxáz&gt; (abxáz&lt;tr:abxáz&gt;)." }),
      "Clipping of Russian абха́з (abxáz).",
    );
  });

  it("never mistakes an honest angle bracket for an annotation", () => {
    assert.equal(fieldText({ type: "h", text: "a &lt; b, and &lt;i&gt; stays" }), "a < b, and <i> stays");
    assert.equal(fieldText({ type: "m", text: "compare a < b" }), "compare a < b");
  });

  it("decodes the marks a book sets its entries in", () => {
    // Reported from a real entry: `From even +&lrm; handed` reached the bubble
    // with the ampersand still in it, because the invisible marks were not on
    // the list. The bidi mark is kept rather than dropped - in an entry quoting
    // a right-to-left script it is what puts the punctuation in the right place.
    assert.equal(
      fieldText({ type: "h", text: "From even +&lrm; handed" }),
      `From even +${String.fromCodePoint(0x200e)} handed`,
    );
    assert.equal(
      fieldText({ type: "h", text: "sense &mdash; gloss, 1914&ndash;1918, o&rsquo;clock, 40&deg;" }),
      `sense ${String.fromCodePoint(0x2014)} gloss, 1914${String.fromCodePoint(0x2013)}1918, o’clock, 40°`,
    );
  });

  it("tells two entities apart that differ only in case", () => {
    // `&Prime;` is the double prime of a measurement, `&prime;` the single one;
    // lower-casing every name would answer the second for both. `&AMP;` is a
    // line of the standard's table, not a spelling the decoder forgives.
    assert.equal(fieldText({ type: "h", text: "5&prime;7&Prime; &AMP; more" }), "5′7″ & more");
  });

  it("decodes every name the standard's table has, not a list of the ones met so far", () => {
    // reader.dict's English edition (Michał's screenshot of the popup,
    // 2026-09-12): `&lsqb;from 14th c.&rsqb;` after a sense, twelve thousand
    // times over - and, counted in the raw file, `&minus;`, `&rarr;`, the
    // Greek letters, `&NoBreak;`, `&ZeroWidthSpace;` and `&frac12;`, a name
    // with a digit in it that the old expression could not match at all.
    assert.equal(
      fieldText({ type: "h", text: "A large wild feline. &lsqb;from 14th c.&rsqb; &minus;1 &rarr; &frac12;" }),
      `A large wild feline. [from 14th c.] ${String.fromCodePoint(0x2212)}1 ${String.fromCodePoint(0x2192)} ½`,
    );
    assert.equal(
      fieldText({ type: "h", text: "&alpha;&beta;&Gamma; x&NoBreak;y a&ZeroWidthSpace;b" }),
      `αβΓ x${String.fromCodePoint(0x2060)}y a${String.fromCodePoint(0x200b)}b`,
    );
    // A name that stands for two code points, and a name of the other case.
    assert.equal(
      fieldText({ type: "h", text: "&NotNestedGreaterGreater; &Aring;&aring;" }),
      `${String.fromCodePoint(0x2aa2, 0x0338)} Åå`,
    );
  });

  it("takes the name as written and nothing else", () => {
    // `&Lsqb;` is nobody's, `&bnsp;` is a misspelling reader.dict really
    // writes, and `&constructor;` is a property every object has - none of
    // them is a reference, and each stays as the book wrote it.
    assert.equal(fieldText({ type: "h", text: "&Lsqb;a&rsqb; &bnsp; &constructor; &toString;" }), "&Lsqb;a] &bnsp; &constructor; &toString;");
    // Without the semicolon nothing is a reference: `&para` in running text
    // is the standard's legacy rule, which no dictionary needs and which eats
    // the start of "&parameter".
    assert.equal(fieldText({ type: "h", text: "&parameter &copy 2020 R&D" }), "&parameter &copy 2020 R&D");
  });

  it("reads a numeric reference the way a browser does", () => {
    // Decimal, hexadecimal in either case, and the C1 range as Windows-1252
    // meant it: `&#150;` is an en dash in a book built with Windows tools,
    // `&#146;` a closing quote, never a control character.
    assert.equal(
      fieldText({ type: "h", text: "&#65;&#x42;&#X43; 1914&#150;1918 o&#146;clock &#x96;" }),
      `ABC 1914${String.fromCodePoint(0x2013)}1918 o’clock ${String.fromCodePoint(0x2013)}`,
    );
    // The five bytes Windows-1252 leaves unassigned decode as written; a
    // number that is no code point, or no number, stays as the book wrote it.
    assert.equal(fieldText({ type: "h", text: "x&#129;y" }), `x${String.fromCodePoint(0x81)}y`);
    assert.equal(fieldText({ type: "h", text: "&#0; &#xD800; &#12ab; &#x110000;" }), "&#0; &#xD800; &#12ab; &#x110000;");
  });

  it("brings a sense an earlier import stored up to date, and leaves a current one alone", () => {
    // What a dictionary imported before the whole table (TEXT_REVISION 2)
    // holds: the entities beyond the old list as written, the source notes
    // the old decoding surfaced, the markup it decoded from entities - each
    // exactly what the tail of `fieldText` would have done to it.
    assert.equal(TEXT_REVISION, 2);
    assert.equal(catchUp("A large wild feline. &lsqb;from 14th c.&rsqb;"), "A large wild feline. [from 14th c.]");
    assert.equal(catchUp("/ʃuːld/<ref:<<name:Dobson>>>/, /ʃəd/"), "/ʃuːld/, /ʃəd/");
    assert.equal(catchUp("/ˌadɛ̃ˈnɔ<sup>j</sup>it/"), "/ˌadɛ̃ˈnɔjit/");
    // A sense that needs nothing comes back as it is: its paragraphs (D197),
    // its lines, its honest angle bracket.
    const current = "Noun\n\nNew information.\nSynonym: word\n\nFrom a < b.";
    assert.equal(catchUp(current), current);
  });

  it("drops the headword XDXF repeats in front of every entry", () => {
    assert.equal(fieldText({ type: "x", text: "<k>bank</k><def>brzeg</def>" }), "brzeg");
  });

  it("strips Pango markup", () => {
    assert.equal(fieldText({ type: "g", text: '<span foreground="blue">brzeg</span>' }), "brzeg");
  });

  it("has nothing to show for a sound, a picture or a file list", () => {
    for (const type of ["W", "P", "X", "r"]) {
      assert.equal(fieldText({ type, text: "whatever" }), "");
    }
  });

  it("reads only so much of a field, and never walks a hostile one twice over (D171)", () => {
    // A field of nothing but `<` used to cost every one of them a walk to the
    // end and back; now the tag expression stops at the next `<`, and the
    // field is cut before any expression sees it. Both together make this
    // return at once - a test that hung would be the failure.
    const started = Date.now();
    const hostile = fieldText({ type: "h", text: "<".repeat(LIMITS.field * 4) });
    assert.equal(hostile.length, LIMITS.field);
    assert.ok(Date.now() - started < 2000, "took a walk over the whole field");
    // The cut lands before the clamp, on plain fields too: what is past it is
    // never read, and what is before it reads as before.
    const long = fieldText({ type: "m", text: `${"word ".repeat(LIMITS.field)}tail` });
    assert.ok(long.length <= LIMITS.field && long.startsWith("word word") && !long.includes("tail"));
    // A `<` inside a tag is not markup any dictionary writes; a tag is stripped
    // to its first `>` as before.
    assert.equal(fieldText({ type: "h", text: "a <b>bold</b> b" }), "a bold b");
  });
});

describe("senses", () => {
  it("makes one meaning of each field", () => {
    const found = senses([
      { type: "m", text: "brzeg" },
      { type: "m", text: "instytucja" },
    ]);
    assert.deepEqual(found, ["brzeg", "instytucja"]);
  });

  it("keeps a transcription on the line of the meaning it belongs to", () => {
    const found = senses([
      { type: "t", text: "/wɒtʃ/" },
      { type: "m", text: "zegarek" },
    ]);
    assert.deepEqual(found, ["/wɒtʃ/ zegarek"]);
  });

  it("shows a transcription that has nothing after it rather than losing it", () => {
    assert.deepEqual(senses([{ type: "t", text: "/wɒtʃ/" }]), ["/wɒtʃ/"]);
  });

  it("drops fields that reduce to nothing", () => {
    assert.deepEqual(senses([{ type: "h", text: "<br><br>" }, { type: "m", text: "brzeg" }]), ["brzeg"]);
  });

  it("cuts a meaning that is an article, and says it was cut", () => {
    const long = `${"słowo ".repeat(400)}koniec`;
    const [only] = senses([{ type: "m", text: long }]);
    assert.ok(only !== undefined);
    assert.ok(only.length <= LIMITS.senseLength + 3);
    assert.ok(only.endsWith("..."));
    // Cut on a word boundary, not in the middle of one.
    assert.ok(!only.includes("słow..."));
  });

  it("keeps a meaning that is exactly at the limit whole", () => {
    const exact = "a".repeat(LIMITS.senseLength);
    assert.deepEqual(senses([{ type: "m", text: exact }]), [exact]);
  });

  it("stops at the tenth meaning", () => {
    const many = Array.from({ length: 30 }, (_, at) => ({ type: "m", text: `znaczenie ${at}` }));
    assert.equal(senses(many).length, LIMITS.senses);
  });

  it("has nothing to say about an entry of only pictures", () => {
    assert.deepEqual(senses([{ type: "P", text: "binary" }]), []);
  });
});

describe("about", () => {
  it("turns what a dictionary says about itself into something printable", () => {
    const ifo =
      'Publisher: Karl Bartel<br>Licensed under the <a href="https://creativecommons.org/licenses/by-sa/4.0/legalcode">Creative Commons Attribution-ShareAlike 4.0 International</a> license<br>Base data from <a href="https://www.wiktionary.org/">Wiktionary.org</a> via DBnary.';

    assert.equal(
      about(ifo),
      "Publisher: Karl Bartel\nLicensed under the Creative Commons Attribution-ShareAlike 4.0 International license\nBase data from Wiktionary.org via DBnary.",
    );
  });

  it("cuts a description that is an essay, on a word", () => {
    const essay = `Publisher: FreeDict<br>${"This dictionary comes to you through nice people. ".repeat(40)}`;
    const shown = about(essay);

    assert.ok(shown !== null);
    assert.ok(shown.length <= LIMITS.credit + 3);
    assert.ok(shown.startsWith("Publisher: FreeDict\n"));
    assert.ok(shown.endsWith("..."));
  });

  it("answers null when there is nothing to say, or nothing left after the tags", () => {
    assert.equal(about(null), null);
    assert.equal(about(""), null);
    assert.equal(about("<br><br>"), null);
  });

  it("takes its own limit, because a name is not a paragraph", () => {
    assert.equal(about("Nowy <b>Slownik</b>", LIMITS.name), "Nowy Slownik");
  });
});
