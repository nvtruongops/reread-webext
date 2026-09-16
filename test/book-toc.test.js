import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packableBlocks } from "../src/lib/book/blocks.js";
import {
  TOC_ENTRY_CAP,
  TOC_TITLE_CAP,
  cappedToc,
  headingEntries,
  renderedEntries,
  tocTitle,
} from "../src/lib/book/toc.js";

describe("headingEntries", () => {
  it("reads the chapters out of a segment's blocks", () => {
    const blocks = [
      "<h1>Part One</h1>",
      "<p>Prose.</p>",
      "<h2>Chapter I</h2>",
      "<p>More prose.</p>",
      "<h3>A section</h3>",
    ];
    assert.deepEqual(headingEntries(blocks, 4), [
      { title: "Part One", level: 1, segmentIndex: 4, blockIndex: 0 },
      { title: "Chapter I", level: 2, segmentIndex: 4, blockIndex: 2 },
      { title: "A section", level: 3, segmentIndex: 4, blockIndex: 4 },
    ]);
  });

  it("ignores everything that is not an h1-h3 block", () => {
    const blocks = [
      "<p>Prose.</p>",
      "<h4>Too deep</h4>",
      "<h5>Deeper</h5>",
      "<hr>",
      "<ul><li>a list</li></ul>",
      "<blockquote><p>quoted</p></blockquote>",
    ];
    assert.deepEqual(headingEntries(blocks, 0), []);
  });

  it("does not mistake hr or a nested heading for a chapter", () => {
    const blocks = ["<hr>", "<div>own text<h2>buried</h2></div>"];
    assert.deepEqual(headingEntries(blocks, 0), []);
  });

  it("reads a heading that carries attributes", () => {
    const blocks = ['<h2 lang="en" dir="ltr">Chapter II</h2>'];
    assert.deepEqual(headingEntries(blocks, 1), [
      { title: "Chapter II", level: 2, segmentIndex: 1, blockIndex: 0 },
    ]);
  });

  it("steps over a > inside a quoted attribute value", () => {
    const blocks = ['<h2 dir="a>b">Odd but honest</h2>'];
    assert.deepEqual(headingEntries(blocks, 0), [
      { title: "Odd but honest", level: 2, segmentIndex: 0, blockIndex: 0 },
    ]);
  });

  it("strips inline markup and keeps the words", () => {
    const blocks = ["<h2>The <em>fine</em> art of <span>reading</span></h2>"];
    assert.equal(headingEntries(blocks, 0)[0]?.title, "The fine art of reading");
  });

  it("decodes exactly the serializer's entities, ampersand last", () => {
    const blocks = ["<h2>Crime &amp; Punishment: 1 &lt; 2 &gt; 0&nbsp;&amp;lt;</h2>"];
    // The author's literal "&lt;" arrives serialized as "&amp;lt;" and must
    // come back as the five characters they wrote, not as "<".
    assert.equal(headingEntries(blocks, 0)[0]?.title, "Crime & Punishment: 1 < 2 > 0 &lt;");
  });

  it("collapses the whitespace a source spreads a title over", () => {
    const blocks = ["<h2>  A\n   spaced\t title  </h2>"];
    assert.equal(headingEntries(blocks, 0)[0]?.title, "A spaced title");
  });

  it("skips a heading with nothing to show", () => {
    const blocks = ["<h2><span></span></h2>", "<h2>   </h2>", "<h2>Kept</h2>"];
    assert.deepEqual(headingEntries(blocks, 0), [
      { title: "Kept", level: 2, segmentIndex: 0, blockIndex: 2 },
    ]);
  });

  it("cuts an abused title at the cap instead of refusing it", () => {
    const long = "word ".repeat(60).trim();
    const [entry] = headingEntries([`<h2>${long}</h2>`], 0);
    assert.ok(entry);
    assert.ok(entry.title.length <= TOC_TITLE_CAP);
    assert.ok(entry.title.endsWith("…"));
    assert.ok(entry.title.startsWith("word word"));
  });

  it("keeps a title exactly at the cap whole", () => {
    const exact = "x".repeat(TOC_TITLE_CAP);
    assert.equal(headingEntries([`<h2>${exact}</h2>`], 0)[0]?.title, exact);
  });
});

describe("renderedEntries", () => {
  const block = (/** @type {string} */ localName, /** @type {string} */ text) => ({
    localName,
    text,
  });

  it("reads an article's map off its rendered blocks", () => {
    const blocks = [
      block("p", "An opening paragraph."),
      block("h2", "Background"),
      block("p", "Prose."),
      block("h3", "The details"),
      block("hr", ""),
      block("h2", "Conclusions"),
    ];
    assert.deepEqual(renderedEntries(blocks, 0), [
      { title: "Background", level: 2, segmentIndex: 0, blockIndex: 1 },
      { title: "The details", level: 3, segmentIndex: 0, blockIndex: 3 },
      { title: "Conclusions", level: 2, segmentIndex: 0, blockIndex: 5 },
    ]);
  });

  it("carries the asked-for segment and skips what is not a chapter", () => {
    const blocks = [block("h4", "Too deep"), block("h1", "Kept"), block("h2", "   ")];
    assert.deepEqual(renderedEntries(blocks, 7), [
      { title: "Kept", level: 1, segmentIndex: 7, blockIndex: 1 },
    ]);
  });

  it("applies the shared title rule to rendered text", () => {
    const [entry] = renderedEntries([block("h2", "  spread \n out ".repeat(20))], 0);
    assert.ok(entry);
    assert.ok(entry.title.startsWith("spread out"));
    assert.ok(entry.title.length <= TOC_TITLE_CAP);
    assert.ok(entry.title.endsWith("…"));
  });
});

describe("tocTitle", () => {
  it("collapses, trims, and refuses emptiness", () => {
    assert.equal(tocTitle("  A\n  title "), "A title");
    assert.equal(tocTitle("   "), null);
    assert.equal(tocTitle(""), null);
  });
});

describe("an article's map through the dissolving walk", () => {
  // The regression Michał hit on the first live article: Readability hands
  // the whole text back inside one wrapper div, so the headings are not
  // children of the rendered root - only the walk that dissolves packaging
  // (the book import's own) sees them. This is the reader's composition,
  // run over fakes carrying what the two pieces read.

  /**
   * @param {string} localName
   * @param {object[]} [children]
   * @param {string} [textContent]
   */
  const el = (localName, children = [], textContent = "") => ({
    nodeType: 1,
    localName,
    childNodes: children,
    textContent,
  });

  /** @param {string} data */
  const text = (data) => ({ nodeType: 3, nodeValue: data });

  it("finds the headings a wrapper div was hiding", () => {
    const article = el("div", [
      el("div", [
        text("\n  "),
        el("p", [text("An opening.")], "An opening."),
        el("h2", [text("X marks the spot")], "X marks the spot"),
        el("p", [text("Prose.")], "Prose."),
        text("\n"),
      ]),
    ]);
    const walked = [
      ...packableBlocks(/** @type {Element} */ (/** @type {unknown} */ (article))),
    ].map((block) => ({
      localName: /** @type {{ localName: string }} */ (block).localName,
      text: /** @type {{ textContent?: string }} */ (block).textContent ?? "",
    }));
    assert.deepEqual(renderedEntries(walked, 0), [
      { title: "X marks the spot", level: 2, segmentIndex: 0, blockIndex: 1 },
    ]);
  });
});

describe("cappedToc", () => {
  it("lets an honest list through untouched", () => {
    const entries = headingEntries(["<h1>One</h1>", "<h2>Two</h2>"], 0);
    assert.equal(cappedToc(entries), entries);
  });

  it("keeps the first chapters of a pathological book", () => {
    const entries = Array.from({ length: TOC_ENTRY_CAP + 7 }, (_, index) => ({
      title: `Chapter ${index}`,
      level: /** @type {2} */ (2),
      segmentIndex: 0,
      blockIndex: index,
    }));
    const capped = cappedToc(entries);
    assert.equal(capped.length, TOC_ENTRY_CAP);
    assert.equal(capped[0]?.title, "Chapter 0");
    assert.equal(capped[TOC_ENTRY_CAP - 1]?.title, `Chapter ${TOC_ENTRY_CAP - 1}`);
  });
});
