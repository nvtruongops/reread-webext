import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_QUERY,
  SHOWN_SNIPPETS,
  chapterOf,
  findHits,
  foldForSearch,
  foldQuery,
  hitsInText,
  isSearchableQuery,
  metaMatches,
  snippetAround,
  snippetPlan,
} from "../src/lib/reader/search.js";

// The invisibles, written as code so they stay visible in the diff.
const SHY = String.fromCodePoint(0x00ad);
const ZWSP = String.fromCodePoint(0x200b);
const ACUTE = String.fromCodePoint(0x0301);

describe("foldForSearch", () => {
  it("lowercases with a one-to-one map when nothing else moves", () => {
    const fold = foldForSearch("AbC");
    assert.equal(fold.folded, "abc");
    assert.deepEqual(fold.starts, [0, 1, 2]);
    assert.deepEqual(fold.ends, [1, 2, 3]);
  });

  it("drops the layout artifacts and lets spans cover them", () => {
    const fold = foldForSearch(`hy${SHY}phen`);
    assert.equal(fold.folded, "hyphen");
    // The span of the whole word must reach past the soft hyphen it crossed.
    assert.equal(fold.starts[0], 0);
    assert.equal(fold.ends[5], 7);
    assert.equal(foldForSearch(`a${ZWSP}b`).folded, "ab");
  });

  it("presses a whitespace run to one space standing for all of it", () => {
    const fold = foldForSearch("a  \n b");
    assert.equal(fold.folded, "a b");
    // The one space maps to the whole run it stands for.
    assert.equal(fold.starts[1], 1);
    assert.equal(fold.ends[1], 5);
  });

  it("emits nothing for leading air", () => {
    const fold = foldForSearch("  ab");
    assert.equal(fold.folded, "ab");
    assert.deepEqual(fold.starts, [2, 3]);
  });

  it("maps a fold that grew under lowercasing back to its one cluster", () => {
    // Dotted capital I lowercases to two units (i + combining dot); both
    // must point home to the one character they came from.
    const fold = foldForSearch("İx");
    assert.equal(fold.folded.length, 3);
    assert.equal(fold.starts[0], 0);
    assert.equal(fold.starts[1], 0);
    assert.equal(fold.ends[1], 1);
    assert.equal(fold.starts[2], 1);
  });

  it("composes a combining run so spelling does not decide a match", () => {
    // NFD in the text ("e" + combining acute), NFC in the query: one fold.
    const decomposed = foldForSearch(`cafe${ACUTE}`);
    assert.equal(decomposed.folded, "café");
    // The composed unit's span covers both source units.
    assert.equal(decomposed.starts[3], 3);
    assert.equal(decomposed.ends[3], 5);
    assert.equal(foldQuery("Café"), "café");
  });

  it("keeps diacritics apart - laska must not find its l-stroke cousin", () => {
    assert.notEqual(foldForSearch("łaska").folded, "laska");
  });
});

describe("foldQuery and isSearchableQuery", () => {
  it("folds and trims what was typed", () => {
    assert.equal(foldQuery(`  Fo${SHY}o  Bar `), "foo bar");
  });

  it("needs at least MIN_QUERY folded characters", () => {
    assert.equal(isSearchableQuery(""), false);
    assert.equal(isSearchableQuery("   "), false);
    assert.equal(isSearchableQuery("a"), false);
    assert.equal(isSearchableQuery(" a "), false);
    assert.equal(isSearchableQuery(SHY + SHY), false);
    assert.equal(isSearchableQuery("ab"), true);
    assert.equal(isSearchableQuery("ł "), false);
    assert.equal(MIN_QUERY, 2);
  });
});

describe("findHits", () => {
  it("finds every occurrence in order", () => {
    assert.deepEqual(findHits("one two one", "one"), [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("never overlaps - the next search starts where the last hit ended", () => {
    assert.deepEqual(findHits("aaaa", "aa"), [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("answers nothing for an absent phrase and an empty one", () => {
    assert.deepEqual(findHits("abc", "xy"), []);
    assert.deepEqual(findHits("abc", ""), []);
  });
});

describe("hitsInText", () => {
  it("matches case-insensitively and answers original offsets", () => {
    assert.deepEqual(hitsInText("The Cat sat.", foldQuery("cat")), [{ start: 4, end: 7 }]);
  });

  it("crosses a nested block boundary through its line break", () => {
    // `prosePieces` writes "\n" where a nested block begins; the fold reads
    // it as the space between two words of one phrase.
    assert.deepEqual(hitsInText("one\ntwo", foldQuery("one two")), [{ start: 0, end: 7 }]);
  });

  it("reaches over a soft hyphen the reader cannot see", () => {
    assert.deepEqual(hitsInText(`a hy${SHY}phen here`, foldQuery("hyphen")), [
      { start: 2, end: 9 },
    ]);
  });

  it("spans cover a whitespace run inside the phrase", () => {
    assert.deepEqual(hitsInText("foo  \n bar", foldQuery("foo bar")), [{ start: 0, end: 10 }]);
  });
});

describe("snippetAround", () => {
  const text = "The quick brown fox jumps over the lazy dog near the river bank today";

  it("cuts a breath of context either side and says where it cut", () => {
    const span = { start: text.indexOf("jumps"), end: text.indexOf("jumps") + 5 };
    const snippet = snippetAround(text, span, 10);
    assert.equal(snippet.before, "…brown fox ");
    assert.equal(snippet.match, "jumps");
    assert.equal(snippet.after, " over the …");
  });

  it("leaves the ellipsis off an edge the block really ends at", () => {
    assert.deepEqual(snippetAround("cat sat", { start: 0, end: 3 }, 10), {
      before: "",
      match: "cat",
      after: " sat",
    });
    assert.deepEqual(snippetAround("cat sat", { start: 4, end: 7 }, 10), {
      before: "cat ",
      match: "sat",
      after: "",
    });
  });

  it("shows the prose on one line", () => {
    const snippet = snippetAround("one\ntwo three", { start: 4, end: 7 }, 10);
    assert.equal(snippet.before, "one ");
    assert.equal(snippet.match, "two");
  });

  it("drops a half surrogate the budget cut stranded", () => {
    const grin = String.fromCodePoint(0x1f600);
    const text = `${grin}${grin}match${grin}${grin}`;
    const snippet = snippetAround(text, { start: 4, end: 9 }, 3);
    assert.equal(snippet.before, `…${grin}`);
    assert.equal(snippet.after, `${grin}…`);
  });
});

describe("metaMatches", () => {
  it("finds the phrase in a row's own words, folded like the text", () => {
    assert.equal(metaMatches("The Quick Fox example.com", foldQuery("quick fox")), true);
    assert.equal(metaMatches(`Hy${SHY}phenated Title`, foldQuery("hyphenated")), true);
    assert.equal(metaMatches("Some Title example.com", foldQuery("nothing")), false);
  });

  it("answers nothing for an empty question", () => {
    assert.equal(metaMatches("Some Title", ""), false);
  });
});

describe("snippetPlan", () => {
  it("shows the first few and counts the rest", () => {
    assert.deepEqual(snippetPlan(0), { shown: 0, more: 0 });
    assert.deepEqual(snippetPlan(2), { shown: 2, more: 0 });
    assert.deepEqual(snippetPlan(SHOWN_SNIPPETS), { shown: SHOWN_SNIPPETS, more: 0 });
    assert.deepEqual(snippetPlan(50), { shown: SHOWN_SNIPPETS, more: 50 - SHOWN_SNIPPETS });
    assert.deepEqual(snippetPlan(-1), { shown: 0, more: 0 });
  });
});

describe("chapterOf", () => {
  /** @type {import("../src/lib/book/toc.js").TocEntry[]} */
  const toc = [
    { title: "One", level: 1, segmentIndex: 0, blockIndex: 2 },
    { title: "Two", level: 1, segmentIndex: 1, blockIndex: 0 },
    { title: "Three", level: 2, segmentIndex: 1, blockIndex: 5 },
  ];

  it("answers the last heading at or before the place", () => {
    assert.equal(chapterOf(toc, 0, 2)?.title, "One");
    assert.equal(chapterOf(toc, 0, 9)?.title, "One");
    assert.equal(chapterOf(toc, 1, 4)?.title, "Two");
    assert.equal(chapterOf(toc, 1, 5)?.title, "Three");
    assert.equal(chapterOf(toc, 2, 0)?.title, "Three");
  });

  it("answers nothing before the first heading and without a table", () => {
    assert.equal(chapterOf(toc, 0, 1), null);
    assert.equal(chapterOf([], 3, 3), null);
  });
});
