import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pageHtml } from "../src/lib/reader/page-html.js";

/**
 * A page in as much of a DOM as the copy reads: a root that serializes, the
 * `noscript` elements under it, and an inert document to copy into. Nothing
 * here parses - `node --test` has no DOM - so what the test can pin down is
 * the shape of the work: which `noscript` gets re-read, from what text, into
 * which document, and that the live page is left exactly as it was. The real
 * page this was written for is reproduced with a real parser in
 * `tmp/goodereader-probe/verify-fix.mjs` (jsdom, outside the gate).
 */

/**
 * @param {{ text?: string, elements?: number }} [shape]
 */
function noscript({ text = "", elements = 0 } = {}) {
  /** @type {unknown[][]} */
  const replaced = [];
  return {
    tagName: "NOSCRIPT",
    textContent: text,
    childElementCount: elements,
    replaced,
    /** @param {unknown[]} nodes */
    replaceChildren: (...nodes) => {
      replaced.push(nodes);
    },
  };
}

/**
 * @param {{ noscripts?: ReturnType<typeof noscript>[], root?: boolean }} [shape]
 */
function fakePage({ noscripts = [], root = true } = {}) {
  /** The live root: serializes to a fixed string, so a result is traceable. */
  const liveRoot = { outerHTML: "<html live>" };
  /** The copies the inert document holds, one per live `noscript`. */
  const copied = noscripts.map((one) => noscript({ text: one.textContent, elements: one.childElementCount }));
  const copy = {
    documentElement: {
      outerHTML: "<html copy>",
      /** @param {unknown} node */
      replaceWith: (node) => {
        copy.replaced = node;
      },
    },
    /** @type {unknown} */
    replaced: null,
    imported: 0,
    /** @param {unknown} node @param {boolean} deep */
    importNode(node, deep) {
      this.imported += 1;
      assert.equal(node, liveRoot);
      assert.equal(deep, true);
      return { outerHTML: "<html imported>" };
    },
    /** @param {string} selector */
    querySelectorAll: (selector) => {
      assert.equal(selector, "noscript");
      return copied;
    },
  };
  const doc = {
    documentElement: root ? liveRoot : null,
    /** @param {string} tag */
    getElementsByTagName: (tag) => {
      assert.equal(tag, "noscript");
      return noscripts;
    },
    implementation: { createHTMLDocument: () => copy },
  };
  /** What each copied noscript was given, in page order. */
  const given = () => copied.map((one) => one.replaced);
  // Cast: the fake is as much of a Document as the copy reads.
  return { doc: /** @type {Document} */ (/** @type {unknown} */ (doc)), copy, given };
}

/** A parser that remembers what it was asked and answers with named nodes. */
function fakeParser() {
  /** @type {string[]} */
  const asked = [];
  /** @param {string} html */
  const parse = (html) => {
    asked.push(html);
    return {
      head: { childNodes: [`head of ${asked.length}`] },
      body: { childNodes: [`body of ${asked.length}`, `more of ${asked.length}`] },
    };
  };
  return { asked, parse };
}

describe("pageHtml", () => {
  it("serializes the live root itself when the page has no noscript", () => {
    const { doc, copy } = fakePage();
    const { asked, parse } = fakeParser();
    assert.equal(pageHtml(doc, { parse }), "<html live>");
    assert.equal(copy.imported, 0);
    assert.deepEqual(asked, []);
  });

  it("re-reads the text a noscript holds into elements, in an inert copy", () => {
    const live = noscript({ text: '<img src="a"><noscript><img src="b"></noscript>' });
    const { doc, copy, given } = fakePage({ noscripts: [live] });
    const { asked, parse } = fakeParser();

    assert.equal(pageHtml(doc, { parse }), "<html copy>");
    // One deep import of the live root, stood up as the copy's root.
    assert.equal(copy.imported, 1);
    assert.deepEqual(copy.replaced, { outerHTML: "<html imported>" });
    // The text went to the parser whole, and what it spelled replaced the text
    // - the head's share first, then the body's.
    assert.deepEqual(asked, ['<img src="a"><noscript><img src="b"></noscript>']);
    assert.deepEqual(given(), [[["head of 1", "body of 1", "more of 1"]]]);
    // The live page's own noscript was never touched.
    assert.deepEqual(live.replaced, []);
  });

  it("leaves a noscript that already holds elements alone", () => {
    const built = noscript({ text: "built by a script", elements: 2 });
    const { doc, given } = fakePage({ noscripts: [built] });
    const { asked, parse } = fakeParser();

    pageHtml(doc, { parse });
    assert.deepEqual(asked, []);
    assert.deepEqual(given(), [[]]);
  });

  it("skips a blank noscript rather than spelling nothing", () => {
    const blank = noscript({ text: "  \n\t " });
    const { doc, given } = fakePage({ noscripts: [blank] });
    const { asked, parse } = fakeParser();

    pageHtml(doc, { parse });
    assert.deepEqual(asked, []);
    assert.deepEqual(given(), [[]]);
  });

  it("re-reads every text noscript on the page, each from its own text", () => {
    const first = noscript({ text: "<img src=1>" });
    const second = noscript({ text: "<iframe src=2></iframe>" });
    const { doc, given } = fakePage({ noscripts: [first, second] });
    const { asked, parse } = fakeParser();

    pageHtml(doc, { parse });
    assert.deepEqual(asked, ["<img src=1>", "<iframe src=2></iframe>"]);
    assert.deepEqual(given(), [
      [["head of 1", "body of 1", "more of 1"]],
      [["head of 2", "body of 2", "more of 2"]],
    ]);
  });

  it("has nothing to say for a document without a root element", () => {
    const { doc } = fakePage({ root: false });
    const { asked, parse } = fakeParser();
    assert.equal(pageHtml(doc, { parse }), "");
    assert.deepEqual(asked, []);
  });
});
