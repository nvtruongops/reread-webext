import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGE_HTML } from "../src/lib/protocol.js";
import { MAX_NOTE_LENGTH, markRecord } from "../src/lib/reader/marks.js";
import {
  ARTICLES_FILENAME,
  fromArticlesFile,
  importPlan,
  toArticlesFile,
} from "../src/lib/store/articles-file.js";
import { savedArticle } from "../src/lib/store/saved-article.js";

/**
 * @param {string} path
 * @param {Partial<Parameters<typeof savedArticle>[0]> & { readAt?: number | null }} [overrides]
 * @returns {import("../src/lib/store/saved-article.js").SavedArticle}
 */
function article(path, overrides = {}) {
  const { readAt = null, ...rest } = overrides;
  const built = savedArticle({
    url: `https://example.com/${path}`,
    title: `Title of ${path}`,
    content: `<p>Body of ${path}</p>`,
    savedAt: 1000,
    ...rest,
  });
  assert.ok(built !== null);
  return { ...built, readAt };
}

/**
 * @param {Partial<import("../src/lib/reader/marks.js").Mark>} [over]
 * @returns {import("../src/lib/reader/marks.js").Mark}
 */
function mark(over = {}) {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: 4 },
    color: "yellow",
    createdAt: 500,
    text: "Body",
    ...over,
  });
  assert.ok(built !== null);
  return built;
}

describe("toArticlesFile", () => {
  it("writes a file the reader gets back article for article", () => {
    const kept = [
      article("one", { dir: "rtl", lang: "ar" }),
      article("two", { savedAt: 2000, readAt: 2500 }),
    ];
    const parsed = fromArticlesFile(toArticlesFile(kept));
    assert.equal(parsed.invalid, 0);
    assert.deepEqual(parsed.articles, kept);
  });

  it("writes oldest saved first, address as the tie, whatever order it was given", () => {
    const file = toArticlesFile([
      article("late", { savedAt: 3000 }),
      article("b-early", { savedAt: 1000 }),
      article("a-early", { savedAt: 1000 }),
    ]);
    const urls = fromArticlesFile(file).articles.map((one) => one.url);
    assert.deepEqual(urls, [
      "https://example.com/a-early",
      "https://example.com/b-early",
      "https://example.com/late",
    ]);
  });

  it("does not carry the hostname - import derives it the way saving does", () => {
    assert.ok(!toArticlesFile([article("one")]).includes("hostname"));
  });

  it("ends with a newline and names its format", () => {
    const file = toArticlesFile([]);
    assert.ok(file.endsWith("\n"));
    assert.equal(JSON.parse(file).format, "reread-articles");
  });

  it("carries an article's marks beside it, and no field at all without them", () => {
    const marked = article("marked");
    const bare = article("bare");
    const marks = new Map([[marked.url, [mark()]]]);

    const parsed = fromArticlesFile(toArticlesFile([marked, bare], marks));
    assert.equal(parsed.invalid, 0);
    const back = new Map(parsed.articles.map((one) => [one.url, one]));
    assert.deepEqual(back.get(marked.url)?.marks, [mark()]);
    // The file of somebody who never picked up the pen reads exactly as it
    // always did - not even an empty list.
    const bareBack = back.get(bare.url);
    assert.ok(bareBack !== undefined);
    assert.ok(!("marks" in bareBack));
    assert.ok(!toArticlesFile([bare]).includes("marks"));
  });

  it("carries a mark's note through the file both ways (D118)", () => {
    const marked = article("noted");
    const noted = mark({ note: "why this passage matters" });
    const parsed = fromArticlesFile(toArticlesFile([marked], new Map([[marked.url, [noted]]])));
    assert.equal(parsed.invalid, 0);
    assert.deepEqual(parsed.articles[0]?.marks, [noted]);
    // A hand-made note heals by the marks' own rule on the way in: flooded
    // text is cut at the cap rather than costing the mark or the article.
    const flooded = JSON.parse(toArticlesFile([marked], new Map([[marked.url, [noted]]])));
    flooded.articles[0].marks[0].note = "x".repeat(5000);
    const back = fromArticlesFile(JSON.stringify(flooded)).articles[0]?.marks?.[0]?.note;
    assert.equal(back?.length, MAX_NOTE_LENGTH);
  });
});

describe("fromArticlesFile", () => {
  it("holds zero articles when the file is not ours at all", () => {
    assert.deepEqual(fromArticlesFile("not json"), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile("[]"), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile('{"articles":[]}'), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile('{"format":"reread-vocab","articles":[]}'), {
      articles: [],
      invalid: 0,
    });
  });

  it("counts a broken entry between good ones rather than dropping the file", () => {
    const file = JSON.stringify({
      format: "reread-articles",
      version: 1,
      articles: [
        { url: "https://example.com/good", title: "Good", content: "<p>x</p>", savedAt: 1 },
        { url: "not a url", title: "Bad address", content: "<p>x</p>", savedAt: 1 },
        // Parses as a URL and would become the "Open original" link (D171).
        { url: "javascript:alert(1)", title: "A script for an address", content: "<p>x</p>", savedAt: 1 },
        { url: "https://example.com/empty", title: "No content", content: "", savedAt: 1 },
        { url: "https://example.com/when", title: "No date", content: "<p>x</p>" },
        "not an entry",
      ],
    });
    const parsed = fromArticlesFile(file);
    assert.equal(parsed.invalid, 5);
    assert.deepEqual(
      parsed.articles.map((one) => one.url),
      ["https://example.com/good"],
    );
  });

  it("derives hostname and title fresh rather than believing the file", () => {
    const file = JSON.stringify({
      format: "reread-articles",
      version: 1,
      articles: [
        { url: "https://example.com/a", title: "  ", content: "<p>x</p>", savedAt: 1, hostname: "evil.example" },
      ],
    });
    const [one] = fromArticlesFile(file).articles;
    assert.equal(one?.hostname, "example.com");
    assert.equal(one?.title, "example.com");
  });

  it("keeps a readable read mark and reads anything else as unread", () => {
    const rows = [
      { url: "https://example.com/read", title: "t", content: "<p>x</p>", savedAt: 1, readAt: 42 },
      { url: "https://example.com/unread", title: "t", content: "<p>x</p>", savedAt: 1, readAt: "yes" },
      { url: "https://example.com/silent", title: "t", content: "<p>x</p>", savedAt: 1 },
    ];
    const parsed = fromArticlesFile(JSON.stringify({ format: "reread-articles", articles: rows }));
    assert.deepEqual(
      parsed.articles.map((one) => one.readAt),
      [42, null, null],
    );
  });

  it("narrows an entry's marks one by one, never refusing the article over them", () => {
    const rows = [
      {
        url: "https://example.com/marked",
        title: "t",
        content: "<p>x</p>",
        savedAt: 1,
        marks: [
          // Out of reading order on purpose - the file's order is not trusted.
          { ...mark(), start: { block: 2, offset: 0 }, end: { block: 2, offset: 3 } },
          mark(),
          { ...mark(), text: "" },
          "not a mark",
        ],
      },
      { url: "https://example.com/plain", title: "t", content: "<p>x</p>", savedAt: 1, marks: "no" },
    ];
    const parsed = fromArticlesFile(JSON.stringify({ format: "reread-articles", articles: rows }));
    assert.equal(parsed.invalid, 0);
    const [marked, plain] = parsed.articles;
    assert.deepEqual(
      marked?.marks?.map((one) => one.start.block),
      [0, 2],
    );
    assert.ok(plain !== undefined && !("marks" in plain));
  });

  it("refuses an entry bigger than the biggest page the reader can be handed", () => {
    const rows = [
      {
        url: "https://example.com/huge",
        title: "t",
        content: "x".repeat(MAX_PAGE_HTML + 1),
        savedAt: 1,
      },
    ];
    const parsed = fromArticlesFile(JSON.stringify({ format: "reread-articles", articles: rows }));
    assert.equal(parsed.articles.length, 0);
    assert.equal(parsed.invalid, 1);
  });
});

describe("importPlan", () => {
  it("adds what the list is missing and skips what it already holds", () => {
    const held = article("held");
    const missing = article("missing");
    const plan = importPlan([held.url], [held, missing]);
    assert.deepEqual(plan.toAdd, [missing]);
    assert.equal(plan.skipped, 1);
  });

  it("adds a twice-named address once, the first winning", () => {
    const first = article("twice", { title: "First" });
    const second = article("twice", { title: "Second" });
    const plan = importPlan([], [first, second]);
    assert.deepEqual(plan.toAdd, [first]);
    assert.equal(plan.skipped, 1);
  });

  it("carries whatever an entry brought - its marks - out the other side", () => {
    const marked = { ...article("marked"), marks: [mark()] };
    const plan = importPlan([], [marked]);
    assert.deepEqual(plan.toAdd, [marked]);
  });

  it("adds nothing the second time - importing the same file twice is safe", () => {
    const file = [article("one"), article("two")];
    const first = importPlan([], file);
    assert.equal(first.toAdd.length, 2);

    const existing = first.toAdd.map((one) => one.url);
    const second = importPlan(existing, file);
    assert.deepEqual(second, { toAdd: [], skipped: 2 });
  });
});

describe("the exported file's name", () => {
  it("is one name - the list is one list", () => {
    assert.equal(ARTICLES_FILENAME, "reread-articles.json");
  });
});

describe("where the reader stopped, in the file (D213)", () => {
  it("carries an article's position beside it without the address said twice, and no field without one", () => {
    const one = article("one");
    const two = article("two");
    const positions = new Map([[one.url, { docId: one.url, segmentIndex: 0, blockIndex: 12, updatedAt: 500, percent: 40 }]]);
    const text = toArticlesFile([one, two], new Map(), positions);
    const rows = JSON.parse(text).articles;
    assert.deepEqual(rows[0].position, { segmentIndex: 0, blockIndex: 12, updatedAt: 500, percent: 40 });
    assert.equal("position" in rows[1], false);
    // Back in, the position wears its document again.
    const read = fromArticlesFile(text);
    assert.deepEqual(read.articles[0]?.position, { docId: one.url, segmentIndex: 0, blockIndex: 12, updatedAt: 500, percent: 40 });
    assert.equal("position" in (read.articles[1] ?? {}), false);
  });

  it("drops a position that is no place and keeps the article, and reads a file from before positions as it did", () => {
    const one = article("one");
    const rows = JSON.parse(toArticlesFile([one])).articles;
    rows[0].position = { segmentIndex: -1, blockIndex: "3" };
    const read = fromArticlesFile(JSON.stringify({ format: "reread-articles", version: 1, articles: rows }));
    assert.equal(read.articles.length, 1);
    assert.equal("position" in (read.articles[0] ?? {}), false);
    assert.equal(read.invalid, 0);
    assert.deepEqual(fromArticlesFile(toArticlesFile([one])).articles[0]?.position, undefined);
  });

  it("carries the position through the import plan with the article, as it carries the marks", () => {
    const one = article("one");
    const position = { docId: one.url, segmentIndex: 0, blockIndex: 2, updatedAt: 9 };
    const { toAdd } = importPlan([], [{ ...one, position }]);
    assert.deepEqual(toAdd[0]?.position, position);
  });
});
