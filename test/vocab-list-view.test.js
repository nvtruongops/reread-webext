import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Order,
  PAGE_SIZE,
  anyCounted,
  asOrder,
  listView,
  markSegments,
  newestFirst,
  ordered,
  pairChoicesFor,
  searchablePhrase,
  sentenceSegments,
} from "../src/vocab/list-view.js";

/**
 * @param {number} at
 * @param {Partial<import("../src/lib/store/phrase.js").Phrase>} [rest]
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(at, rest = {}) {
  return {
    id: `id-${String(at).padStart(4, "0")}`,
    langFrom: "en",
    langTo: "pl",
    phrase: `word${at}`,
    normalized: `word${at}`,
    translations: [`meaning${at}`],
    createdAt: at,
    ...rest,
  };
}

describe("newestFirst", () => {
  it("turns the store's oldest-first into newest-first", () => {
    const sorted = newestFirst([phrase(1), phrase(2), phrase(3)]);
    assert.deepEqual(sorted.map((one) => one.createdAt), [3, 2, 1]);
  });

  it("holds the order of two phrases saved in the same millisecond", () => {
    const twins = [phrase(5, { id: "id-a" }), phrase(5, { id: "id-b" })];
    assert.deepEqual(newestFirst(twins).map((one) => one.id), ["id-b", "id-a"]);
    assert.deepEqual(newestFirst([...twins].reverse()).map((one) => one.id), ["id-b", "id-a"]);
  });

  it("answers a copy rather than reordering the caller's list", () => {
    const kept = [phrase(1), phrase(2)];
    newestFirst(kept);
    assert.deepEqual(kept.map((one) => one.createdAt), [1, 2]);
  });
});

describe("searchablePhrase", () => {
  it("finds a phrase by how it is written and by every meaning", () => {
    const searchable = searchablePhrase(phrase(1, { phrase: "Bank", translations: ["brzeg", "instytucja"] }));
    for (const word of ["bank", "brzeg", "instytucja"]) {
      assert.ok(searchable.includes(word), `misses ${word}`);
    }
  });
});

describe("listView", () => {
  it("shows the first hundred of a long list, and says how long it is", () => {
    const view = listView(Array.from({ length: 250 }, (_, at) => phrase(at)), { query: "", page: 1 });

    assert.equal(view.rows.length, PAGE_SIZE);
    assert.equal(view.rows[0]?.createdAt, 0);
    assert.deepEqual([view.page, view.pages, view.matching], [1, 3, 250]);
  });

  it("turns pages without losing a row at the seams", () => {
    const phrases = Array.from({ length: 250 }, (_, at) => phrase(at));

    const second = listView(phrases, { query: "", page: 2 });
    const third = listView(phrases, { query: "", page: 3 });

    assert.equal(second.rows[0]?.createdAt, 100);
    assert.equal(second.rows.length, PAGE_SIZE);
    assert.equal(third.rows[0]?.createdAt, 200);
    assert.equal(third.rows.length, 50);
  });

  it("clamps a page the list no longer reaches, instead of showing a blank one", () => {
    // Learned takes the last row of the last page; a filter narrows ten pages
    // to one. Either way the reader must land on a page that exists.
    const phrases = Array.from({ length: 150 }, (_, at) => phrase(at));

    assert.equal(listView(phrases, { query: "", page: 9 }).page, 2);
    assert.equal(listView(phrases, { query: "", page: 0 }).page, 1);
  });

  it("has one page to offer even when it is empty", () => {
    const view = listView([], { query: "", page: 3 });
    assert.deepEqual([view.page, view.pages, view.matching], [1, 1, 0]);
    assert.deepEqual(view.rows, []);
  });

  it("filters by phrase and by meaning, whichever the reader remembers", () => {
    const phrases = [
      phrase(1, { phrase: "bank", translations: ["brzeg"] }),
      phrase(2, { phrase: "shore", translations: ["brzeg", "wybrzeże"] }),
      phrase(3, { phrase: "watch", translations: ["zegarek"] }),
    ];

    assert.deepEqual(
      listView(phrases, { query: "brzeg", page: 1 }).rows.map((one) => one.phrase),
      ["bank", "shore"],
    );
    assert.deepEqual(
      listView(phrases, { query: "WATCH", page: 1 }).rows.map((one) => one.phrase),
      ["watch"],
    );
  });

  it("needs every word of the query somewhere in the row", () => {
    const phrases = [
      phrase(1, { phrase: "bank", translations: ["brzeg"] }),
      phrase(2, { phrase: "bank holiday", translations: ["dzień wolny"] }),
    ];

    assert.deepEqual(
      listView(phrases, { query: "bank brzeg", page: 1 }).rows.map((one) => one.phrase),
      ["bank"],
    );
  });

  it("says when nothing matches, with a page to stand on", () => {
    const view = listView([phrase(1)], { query: "nothing like this", page: 1 });
    assert.deepEqual([view.matching, view.pages, view.page], [0, 1, 1]);
  });
});

describe("markSegments", () => {
  it("hands the text back whole when there is no query", () => {
    assert.deepEqual(markSegments("bank holiday", ""), [{ text: "bank holiday", hit: false }]);
    assert.deepEqual(markSegments("bank holiday", "   "), [{ text: "bank holiday", hit: false }]);
  });

  it("marks every occurrence of every word, case-folded", () => {
    assert.deepEqual(markSegments("Bank am Bankufer", "bank"), [
      { text: "Bank", hit: true },
      { text: " am ", hit: false },
      { text: "Bank", hit: true },
      { text: "ufer", hit: false },
    ]);
  });

  it("merges overlapping words into one marked stretch", () => {
    assert.deepEqual(markSegments("abc", "ab bc"), [{ text: "abc", hit: true }]);
  });

  it("always hands back the text it was given, in order", () => {
    const text = "der Bankangestellte an der Bank";
    const joined = markSegments(text, "bank an").map((segment) => segment.text).join("");
    assert.equal(joined, text);
  });

  it("marks nothing rather than marking wrong when folding shifts letters", () => {
    // One dotted capital I becomes two code units in lower case; the folded
    // indexes then stop pointing into the original.
    assert.equal("İstanbul".toLowerCase().length, "İstanbul".length + 1);
    assert.deepEqual(markSegments("İstanbul", "istanbul"), [{ text: "İstanbul", hit: false }]);
  });
});

describe("pairChoicesFor", () => {
  const READING = { sourceLang: "en", targetLang: "pl" };

  it("offers every pair with anything saved, by name, counts along", () => {
    const choices = pairChoicesFor(READING, [
      { langFrom: "pl", langTo: "en", count: 7 },
      { langFrom: "en", langTo: "pl", count: 1243 },
    ]);

    assert.deepEqual(choices, [
      { pair: "enpl", from: "en", to: "pl", count: 1243 },
      { pair: "plen", from: "pl", to: "en", count: 7 },
    ]);
  });

  it("offers the configured pair even when nothing is saved for it", () => {
    // A control must never disagree with the settings it shows - the popup's
    // rule, and this select writes the same settings.
    const choices = pairChoicesFor(READING, [{ langFrom: "de", langTo: "pl", count: 3 }]);

    assert.deepEqual(choices[0], { pair: "enpl", from: "en", to: "pl", count: 0 });
    assert.equal(choices.length, 2);
  });

  it("offers the configured pair alone on a fresh install", () => {
    assert.deepEqual(pairChoicesFor(READING, []), [
      { pair: "enpl", from: "en", to: "pl", count: 0 },
    ]);
  });

  it("offers exactly the pairs that hold phrases while no pair is chosen", () => {
    const none = { sourceLang: null, targetLang: null };
    assert.deepEqual(pairChoicesFor(none, [{ langFrom: "de", langTo: "pl", count: 3 }]), [
      { pair: "depl", from: "de", to: "pl", count: 3 },
    ]);
    // Nothing chosen, nothing saved: an empty select behind the page's own
    // empty state.
    assert.deepEqual(pairChoicesFor(none, []), []);
  });
});

describe("ordered", () => {
  const rows = [
    phrase(1, { phrase: "zebra", recallCount: 2, readCount: 10 }),
    phrase(2, { phrase: "Émile", recallCount: 5 }),
    phrase(3, { phrase: "apple", readCount: 10 }),
    phrase(4, { phrase: "eagle" }),
  ];
  /** @param {import("../src/lib/store/phrase.js").Phrase[]} list */
  const names = (list) => list.map((one) => one.phrase);

  it("keeps newest first as the page's own order, whatever order the rows came in", () => {
    assert.deepEqual(names(ordered(rows, Order.NEWEST, "en")), ["eagle", "apple", "Émile", "zebra"]);
    assert.deepEqual(names(ordered([...rows].reverse(), Order.NEWEST, "en")), ["eagle", "apple", "Émile", "zebra"]);
  });

  it("puts the most checked first, the other count second, newest after that", () => {
    assert.deepEqual(names(ordered(rows, Order.RECALLED, "en")), ["Émile", "zebra", "apple", "eagle"]);
  });

  it("puts the most read first, the other count second, newest after that", () => {
    assert.deepEqual(names(ordered(rows, Order.READ, "en")), ["zebra", "apple", "Émile", "eagle"]);
  });

  it("orders the alphabet with the language's collator - accents beside their letters, case aside", () => {
    assert.deepEqual(names(ordered(rows, Order.ALPHABETICAL, "en")), ["apple", "eagle", "Émile", "zebra"]);
    assert.deepEqual(names(ordered(rows, Order.ALPHABETICAL, "")), ["apple", "eagle", "Émile", "zebra"]);
  });

  it("does not touch the list it was given", () => {
    const copy = [...rows];
    ordered(rows, Order.READ, "en");
    assert.deepEqual(rows, copy);
  });

  it("names an order for the select's value, newest first for anything else", () => {
    assert.equal(asOrder("read"), Order.READ);
    assert.equal(asOrder("recalled"), Order.RECALLED);
    assert.equal(asOrder("alphabetical"), Order.ALPHABETICAL);
    for (const other of [undefined, null, "", "oldest", 3]) assert.equal(asOrder(other), Order.NEWEST);
  });
});

describe("anyCounted", () => {
  it("says whether any row on the page carries a count - the legend's cue", () => {
    assert.equal(anyCounted([]), false);
    assert.equal(anyCounted([phrase(1), phrase(2)]), false);
    assert.equal(anyCounted([phrase(1, { recallCount: 0, readCount: 0 })]), false);
    assert.equal(anyCounted([phrase(1), phrase(2, { recallCount: 1 })]), true);
    assert.equal(anyCounted([phrase(1, { readCount: 3 })]), true);
  });

  it("reads a count the way the row does - a stored oddity is no count", () => {
    // @ts-expect-error - a value the store would never write, as an old row might carry
    assert.equal(anyCounted([phrase(1, { recallCount: "7" })]), false);
    assert.equal(anyCounted([phrase(1, { readCount: -2 })]), false);
  });
});

describe("sentenceSegments", () => {
  it("marks the phrase's first occurrence in its sentence, case-folded, and only that one", () => {
    assert.deepEqual(sentenceSegments("Miracles happen; miracles are rare.", "miracles"), [
      { text: "Miracles", hit: true },
      { text: " happen; miracles are rare.", hit: false },
    ]);
    assert.deepEqual(sentenceSegments("It became clear.", "became"), [
      { text: "It ", hit: false },
      { text: "became", hit: true },
      { text: " clear.", hit: false },
    ]);
    assert.deepEqual(sentenceSegments("nevertheless willing", "nevertheless willing"), [
      { text: "nevertheless willing", hit: true },
    ]);
  });

  it("hands the sentence back plain when the phrase is not in it - another form, a longer selection, nothing", () => {
    assert.deepEqual(sentenceSegments("She was becoming tired.", "became"), [{ text: "She was becoming tired.", hit: false }]);
    assert.deepEqual(sentenceSegments("A sentence.", ""), [{ text: "A sentence.", hit: false }]);
    assert.deepEqual(sentenceSegments("A sentence.", "   "), [{ text: "A sentence.", hit: false }]);
  });

  it("always hands back the sentence it was given, in order", () => {
    const sentence = "One of the miracles of the international systems of the world.";
    const joined = sentenceSegments(sentence, "miracles").map((segment) => segment.text).join("");
    assert.equal(joined, sentence);
  });

  it("marks nothing rather than marking wrong when folding shifts letters", () => {
    assert.deepEqual(sentenceSegments("İstanbul is far.", "istanbul"), [{ text: "İstanbul is far.", hit: false }]);
  });
});
