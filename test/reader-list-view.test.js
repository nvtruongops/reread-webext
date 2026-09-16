import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Segment } from "../src/lib/store/saved-article.js";
import {
  PAGE_SIZE,
  keptPicks,
  libraryView,
  pickedState,
  searchButtonState,
  searchableArticle,
  withAllPicked,
} from "../src/reader/list-view.js";

/**
 * @typedef {import("../src/lib/store/saved-article.js").SavedMeta &
 *   { lastReadAt?: number | null, kind?: "article" | "book" }} ListedMeta
 */

/**
 * @param {number} at
 * @param {Partial<ListedMeta>} [rest]
 * @returns {ListedMeta}
 */
function meta(at, rest = {}) {
  return {
    url: `https://example.org/article/${at}`,
    hostname: "example.org",
    title: `Article ${at}`,
    savedAt: at,
    readAt: null,
    ...rest,
  };
}

describe("searchableArticle", () => {
  it("finds a row by its title and by the site it came from", () => {
    const searchable = searchableArticle(meta(1, { title: "Old Chinese", hostname: "en.wikipedia.org" }));
    for (const word of ["old", "chinese", "wikipedia"]) {
      assert.ok(searchable.includes(word), `misses ${word}`);
    }
  });
});

describe("libraryView", () => {
  it("shows the segment asked for, most recent activity first", () => {
    const metas = [meta(1), meta(2, { readAt: 9 }), meta(3)];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.deepEqual(unread.rows.map((one) => one.savedAt), [3, 1]);
    assert.deepEqual([unread.matching, unread.inSegment], [2, 2]);

    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual(read.rows.map((one) => one.savedAt), [2]);
  });

  it("raises the row read last above rows saved after it, in both segments", () => {
    const metas = [
      meta(1, { lastReadAt: 50 }),
      meta(2),
      meta(3),
      meta(4, { readAt: 9, lastReadAt: 40 }),
      meta(5, { readAt: 9 }),
    ];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.deepEqual(unread.rows.map((one) => one.savedAt), [1, 3, 2]);

    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual(read.rows.map((one) => one.savedAt), [4, 5]);
  });

  it("cuts a long segment into pages and says how many there are", () => {
    const metas = Array.from({ length: 120 }, (_, at) => meta(at));

    const first = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.equal(first.rows.length, PAGE_SIZE);
    assert.equal(first.rows[0]?.savedAt, 119);
    assert.deepEqual([first.page, first.pages, first.matching], [1, 3, 120]);

    const third = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 3 });
    assert.equal(third.rows.length, 120 - 2 * PAGE_SIZE);
    assert.equal(third.rows[0]?.savedAt, 119 - 2 * PAGE_SIZE);
  });

  it("turns pages without losing a row at the seams", () => {
    const metas = Array.from({ length: 120 }, (_, at) => meta(at));

    const first = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    const second = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 2 });
    assert.equal(second.rows[0]?.savedAt, (first.rows.at(-1)?.savedAt ?? 0) - 1);
  });

  it("clamps a page the list no longer reaches, instead of showing a blank one", () => {
    // A delete takes the last row of the last page; a filter narrows pages
    // away. Either way the reader must land on a page that exists.
    const metas = Array.from({ length: PAGE_SIZE + 10 }, (_, at) => meta(at));

    assert.equal(libraryView(metas, { segment: Segment.UNREAD, query: "", page: 9 }).page, 2);
    assert.equal(libraryView(metas, { segment: Segment.UNREAD, query: "", page: 0 }).page, 1);
  });

  it("has one page to offer even when it is empty", () => {
    const view = libraryView([], { segment: Segment.UNREAD, query: "", page: 3 });
    assert.deepEqual([view.page, view.pages, view.matching, view.inSegment], [1, 1, 0, 0]);
    assert.deepEqual(view.rows, []);
  });

  it("filters by title and by site, whichever the reader remembers", () => {
    const metas = [
      meta(1, { title: "Old Chinese" }),
      meta(2, { title: "Grand Tour", hostname: "cycling.example" }),
      meta(3, { title: "Varieties of Chinese" }),
    ];

    const byTitle = libraryView(metas, { segment: Segment.UNREAD, query: "CHINESE", page: 1 });
    assert.deepEqual(byTitle.rows.map((one) => one.savedAt), [3, 1]);

    const bySite = libraryView(metas, { segment: Segment.UNREAD, query: "cycling", page: 1 });
    assert.deepEqual(bySite.rows.map((one) => one.savedAt), [2]);
  });

  it("needs every word of the query somewhere in the row", () => {
    const metas = [meta(1, { title: "Old Chinese" }), meta(2, { title: "Varieties of Chinese" })];

    const view = libraryView(metas, { segment: Segment.UNREAD, query: "old chinese", page: 1 });
    assert.deepEqual(view.rows.map((one) => one.savedAt), [1]);
  });

  it("searches only the segment on screen", () => {
    const metas = [meta(1, { title: "Old Chinese", readAt: 9 }), meta(2, { title: "Grand Tour" })];

    const view = libraryView(metas, { segment: Segment.UNREAD, query: "chinese", page: 1 });
    assert.deepEqual([view.matching, view.inSegment], [0, 1]);
  });

  it("tells a filtered-out list from an empty segment", () => {
    // Two different sentences on screen hang on this: "no match" needs
    // `inSegment` to stay above zero when only the filter emptied the rows.
    const view = libraryView([meta(1)], { segment: Segment.UNREAD, query: "nothing like this", page: 1 });
    assert.deepEqual([view.matching, view.inSegment], [0, 1]);
    assert.deepEqual(view.rows, []);
  });

  it("counts both whole segments for the tabs, whichever one is showing", () => {
    const metas = [meta(1), meta(2, { readAt: 9 }), meta(3), meta(4, { readAt: 9 })];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual([unread.unread, unread.read], [2, 2]);
    assert.deepEqual([read.unread, read.read], [2, 2]);
  });

  it("keeps the tab counts whole under a filter and across pages", () => {
    // The tab labels wear these numbers: a filter or a turned page narrows
    // the rows on screen, never what the tabs say they hold.
    const metas = Array.from({ length: PAGE_SIZE + 10 }, (_, at) =>
      meta(at, at % 2 === 0 ? { readAt: 9 } : {}),
    );

    const filtered = libraryView(metas, { segment: Segment.UNREAD, query: "article 1", page: 2 });
    assert.ok(filtered.matching < filtered.inSegment);
    assert.deepEqual([filtered.unread, filtered.read], [PAGE_SIZE / 2 + 5, PAGE_SIZE / 2 + 5]);
  });

  it("offers Select all the segment as filtered, every page of it, books included", () => {
    // Every page: the filter is how a reader says "these", a page is only
    // what fits on one screen - and since D218 a book is a document the
    // selection's file carries, so its row is offered like an article's.
    // 120 rows: the odd ones unread, the even ones read, every fourth a book.
    const metas = Array.from({ length: 120 }, (_, i) => i + 1).map((at) =>
      meta(at, { kind: at % 4 === 0 ? "book" : "article", readAt: at % 2 === 0 ? 9 : null }),
    );
    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 2 });
    assert.equal(unread.rows.length, 10);
    assert.equal(unread.selectable.length, 60);
    // The read half holds the thirty books, offered like the articles.
    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.equal(read.selectable.length, 60);
    const books = new Set(metas.filter((one) => one.kind === "book").map((one) => one.url));
    assert.equal(read.selectable.filter((url) => books.has(url)).length, 30);
  });
});

describe("the selection (D152)", () => {
  const covered = ["a", "b", "c"];

  it("shows Select all clear, half-ticked or ticked over the rows it covers", () => {
    assert.equal(pickedState(covered, new Set()), "none");
    assert.equal(pickedState(covered, new Set(["b"])), "some");
    assert.equal(pickedState(covered, new Set(["a", "b", "c"])), "all");
    // A tick elsewhere is not one of these rows.
    assert.equal(pickedState(covered, new Set(["z"])), "none");
    assert.equal(pickedState([], new Set(["a"])), "none");
  });

  it("ticks and clears only the rows Select all covers, keeping the others", () => {
    // A tick made on the other segment or under another filter was the
    // reader's own; the box over this view must not take it away.
    const ticked = withAllPicked(new Set(["z"]), covered, true);
    assert.deepEqual([...ticked].sort(), ["a", "b", "c", "z"]);

    const cleared = withAllPicked(ticked, covered, false);
    assert.deepEqual([...cleared], ["z"]);
  });

  it("drops a tick whose document is gone, and holds a book like an article", () => {
    const entries = [
      { url: "a", kind: /** @type {const} */ ("article") },
      { url: "book:1", kind: /** @type {const} */ ("book") },
    ];
    const kept = keptPicks(new Set(["a", "deleted", "book:1"]), entries);
    assert.deepEqual([...kept].sort(), ["a", "book:1"]);
  });
});

describe("searchButtonState", () => {
  it("has nothing to press over an empty box, whichever the scope", () => {
    for (const texts of [false, true]) {
      assert.deepEqual(
        searchButtonState({ query: "", applied: "", texts }),
        { enabled: false, stale: false },
      );
    }
  });

  it("takes any word over the titles, but two characters over the texts", () => {
    assert.deepEqual(searchButtonState({ query: "t", applied: "", texts: false }), {
      enabled: true,
      stale: true,
    });
    assert.deepEqual(searchButtonState({ query: "t", applied: "", texts: true }), {
      enabled: false,
      stale: false,
    });
    assert.equal(searchButtonState({ query: "te", applied: "", texts: true }).enabled, true);
  });

  it("is lit while the box holds words the list was not narrowed by", () => {
    assert.equal(searchButtonState({ query: "test", applied: "", texts: false }).stale, true);
    assert.equal(searchButtonState({ query: "testy", applied: "test", texts: true }).stale, true);
    assert.equal(searchButtonState({ query: "test", applied: "test", texts: false }).stale, false);
    assert.equal(searchButtonState({ query: "test", applied: "test", texts: true }).stale, false);
  });

  it("does not light up over trailing air", () => {
    assert.equal(searchButtonState({ query: "test ", applied: "test", texts: false }).stale, false);
    assert.equal(searchButtonState({ query: " test", applied: "test ", texts: true }).stale, false);
  });

  it("never lights a greyed button", () => {
    // A single character over the texts: not pressable, so not a cue either,
    // even though the list stands narrowed by something else.
    assert.deepEqual(searchButtonState({ query: "t", applied: "test", texts: true }), {
      enabled: false,
      stale: false,
    });
  });
});
