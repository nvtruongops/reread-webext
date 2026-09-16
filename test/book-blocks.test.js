import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packableBlocks } from "../src/lib/book/blocks.js";

/**
 * Fake nodes carrying exactly what the walk reads: node type, local name,
 * children, text. No DOM under `node --test`, and none needed.
 *
 * @param {string} localName
 * @param {object[]} [children]
 */
const el = (localName, children = []) => ({ nodeType: 1, localName, childNodes: children });

/** @param {string} data */
const text = (data) => ({ nodeType: 3, nodeValue: data });

/** @param {object} root */
function blocksOf(root) {
  return [...packableBlocks(/** @type {Element} */ (/** @type {unknown} */ (root)))];
}

describe("packableBlocks", () => {
  it("dissolves the wrapper div an EPUB chapter arrives in", () => {
    const heading = el("h1", [text("Part II")]);
    const body = el("p", [text("Prose.")]);
    const root = el("div", [el("div", [text("\n\t"), heading, text("\n\t"), body, text("\n")])]);
    assert.deepEqual(blocksOf(root), [heading, body]);
  });

  it("dissolves nested wrappers all the way down", () => {
    const body = el("p", [text("Prose.")]);
    const root = el("div", [el("div", [el("div", [body])])]);
    assert.deepEqual(blocksOf(root), [body]);
  });

  it("passes a div with words of its own through whole", () => {
    // A div used as a paragraph: dissolving it would orphan its text.
    const paragraph = el("div", [text("Bare prose "), el("em", [text("inline")])]);
    const root = el("div", [paragraph]);
    assert.deepEqual(blocksOf(root), [paragraph]);
  });

  it("passes a div holding only text through whole", () => {
    const paragraph = el("div", [text("Bare prose.")]);
    const root = el("div", [paragraph]);
    assert.deepEqual(blocksOf(root), [paragraph]);
  });

  it("passes an empty div through for the import to skip", () => {
    // Nothing to dissolve into; the importer's no-text rule drops it later.
    const empty = el("div", [text(" \n ")]);
    const root = el("div", [empty]);
    assert.deepEqual(blocksOf(root), [empty]);
  });

  it("dissolves only div - other containers keep their shape", () => {
    const quote = el("blockquote", [el("p", [text("Quoted.")])]);
    const list = el("ul", [el("li", [text("One.")])]);
    const root = el("div", [quote, list]);
    assert.deepEqual(blocksOf(root), [quote, list]);
  });

  it("keeps an hr found inside a wrapper - the scene break survives", () => {
    const before = el("p", [text("Before.")]);
    const break_ = el("hr");
    const after = el("p", [text("After.")]);
    const root = el("div", [el("div", [before, break_, after])]);
    assert.deepEqual(blocksOf(root), [before, break_, after]);
  });

  it("walks a mixed chapter in reading order", () => {
    const heading = el("h2", [text("Chapter 4")]);
    const first = el("p", [text("First.")]);
    const loose = el("p", [text("Loose paragraph beside the wrapper.")]);
    const paragraphDiv = el("div", [text("A div with its own words.")]);
    const root = el("div", [el("div", [heading, first]), loose, paragraphDiv]);
    assert.deepEqual(blocksOf(root), [heading, first, loose, paragraphDiv]);
  });

  it("yields elements only, as the old children walk did", () => {
    const body = el("p", [text("Prose.")]);
    const root = el("div", [text("stray root text"), body]);
    assert.deepEqual(blocksOf(root), [body]);
  });
});
