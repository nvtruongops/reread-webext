import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_ORIGINAL_BYTES,
  MAX_STORED_SIDE,
  SOURCE_ATTRIBUTE,
  asPictureRow,
  asPicturesSummary,
  encodedType,
  fitWithin,
  isIllustration,
  keepsOriginal,
  pictureSources,
  picturesSummary,
  sniffPictureType,
} from "../src/lib/reader/pictures.js";

/**
 * A rebuilt tree, in as much of a DOM as the walk reads (see
 * `reader-article.test.js` for why a fake).
 *
 * @param {string} tagName
 * @param {Record<string, string>} [attributes]
 * @param {object[]} [children]
 */
function el(tagName, attributes = {}, children = []) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    /** @param {string} name */
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  };
}

/** @param {string} data */
const text = (data) => ({ nodeType: 3, nodeValue: data, childNodes: [] });

/** @param {object} root */
const sourcesOf = (root) => pictureSources(/** @type {Element} */ (/** @type {unknown} */ (root)));

/** @param {number[]} values */
const bytes = (values) => new Uint8Array(values);

/** @param {string} ascii */
const ascii = (ascii) => new TextEncoder().encode(ascii);

describe("an article's pictures", () => {
  it("asks for each address once, in reading order, off the rebuilt tree", () => {
    const root = el("div", {}, [
      el("p", {}, [el("img", { [SOURCE_ATTRIBUTE]: "https://a.test/1.jpg" })]),
      el("figure", {}, [
        el("img", { [SOURCE_ATTRIBUTE]: "https://a.test/2.jpg", alt: "two" }),
        el("figcaption", {}, [text("a caption")]),
      ]),
      el("img", { [SOURCE_ATTRIBUTE]: "https://a.test/1.jpg" }),
      el("img", {}),
      el("img", { [SOURCE_ATTRIBUTE]: "" }),
    ]);
    assert.deepEqual(sourcesOf(root), ["https://a.test/1.jpg", "https://a.test/2.jpg"]);
    assert.deepEqual(sourcesOf(el("div", {}, [text("no pictures")])), []);
  });

  it("knows a download by its first bytes, never by a header", () => {
    assert.equal(sniffPictureType(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00])), "image/jpeg");
    assert.equal(sniffPictureType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    assert.equal(sniffPictureType(ascii("GIF89a......")), "image/gif");
    assert.equal(sniffPictureType(ascii("RIFF....WEBPVP8 ")), "image/webp");
    assert.equal(sniffPictureType(ascii('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="a">')), "image/svg+xml");
    // A byte-order mark first (U+FEFF, written as a code so it can be seen).
    assert.equal(sniffPictureType(ascii(String.fromCodePoint(0xfeff) + "<svg>")), "image/svg+xml");
    assert.equal(sniffPictureType(ascii("<!DOCTYPE svg><svg viewBox='0 0 1 1'/>")), "image/svg+xml");
    // What is not a picture: a page, an empty answer, a file cut too short.
    assert.equal(sniffPictureType(ascii("<html><body>not found</body></html>")), null);
    assert.equal(sniffPictureType(ascii("<svgfoo>")), null);
    assert.equal(sniffPictureType(bytes([])), null);
    assert.equal(sniffPictureType(bytes([0xff, 0xd8])), null);
    assert.equal(sniffPictureType(ascii("RIFF....WAVE")), null);
  });

  it("keeps icons, spacers and counting pixels out", () => {
    assert.equal(isIllustration(1, 1), false);
    assert.equal(isIllustration(49, 400), false);
    assert.equal(isIllustration(400, 49), false);
    assert.equal(isIllustration(50, 50), true);
  });

  it("scales the longest side to the limit, keeps proportions, and never scales up", () => {
    assert.deepEqual(fitWithin(3200, 1600), { width: MAX_STORED_SIDE, height: MAX_STORED_SIDE / 2 });
    assert.deepEqual(fitWithin(1000, 4000), { width: 400, height: MAX_STORED_SIDE });
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(MAX_STORED_SIDE, 1), { width: MAX_STORED_SIDE, height: 1 });
    assert.deepEqual(fitWithin(5000, 1), { width: MAX_STORED_SIDE, height: 1 });
    assert.deepEqual(fitWithin(300, 200, 100), { width: 100, height: 67 });
  });

  it("keeps an original that fits and draws the rest again, as PNG or JPEG by its kind", () => {
    const fits = { type: /** @type {const} */ ("image/jpeg"), byteLength: MAX_ORIGINAL_BYTES, width: MAX_STORED_SIDE, height: 900 };
    assert.equal(keepsOriginal(fits), true);
    assert.equal(keepsOriginal({ ...fits, byteLength: MAX_ORIGINAL_BYTES + 1 }), false);
    assert.equal(keepsOriginal({ ...fits, width: MAX_STORED_SIDE + 1 }), false);
    assert.equal(keepsOriginal({ ...fits, height: MAX_STORED_SIDE + 1 }), false);
    assert.equal(keepsOriginal({ ...fits, type: "image/gif" }), true);
    // An SVG is never stored as one: pixels only.
    assert.equal(keepsOriginal({ ...fits, type: "image/svg+xml", byteLength: 10 }), false);

    assert.equal(encodedType("image/png"), "image/png");
    assert.equal(encodedType("image/gif"), "image/png");
    assert.equal(encodedType("image/svg+xml"), "image/png");
    assert.equal(encodedType("image/jpeg"), "image/jpeg");
    assert.equal(encodedType("image/webp"), "image/jpeg");
  });

  it("sums the rows into the light row's account, and reads one back", () => {
    assert.deepEqual(picturesSummary([]), { count: 0, bytes: 0 });
    assert.deepEqual(
      picturesSummary([{ data: new ArrayBuffer(10) }, { data: new ArrayBuffer(5) }]),
      { count: 2, bytes: 15 },
    );
    assert.deepEqual(asPicturesSummary({ count: 2, bytes: 15 }), { count: 2, bytes: 15 });
    assert.equal(asPicturesSummary({ count: 0, bytes: 0 }), null);
    assert.equal(asPicturesSummary({ count: 2, bytes: -1 }), null);
    assert.equal(asPicturesSummary({ count: "2", bytes: 15 }), null);
    assert.equal(asPicturesSummary(undefined), null);
  });

  it("narrows a picture row, and refuses a torn one", () => {
    const row = {
      url: "https://a.test/article",
      index: 0,
      src: "https://a.test/1.jpg",
      mime: "image/jpeg",
      width: 800,
      height: 600,
      data: new ArrayBuffer(12),
    };
    assert.deepEqual(asPictureRow(row), row);
    assert.equal(asPictureRow({ ...row, index: -1 }), null);
    assert.equal(asPictureRow({ ...row, index: 1.5 }), null);
    assert.equal(asPictureRow({ ...row, mime: "image/svg+xml" }), null);
    assert.equal(asPictureRow({ ...row, width: 0 }), null);
    assert.equal(asPictureRow({ ...row, data: new ArrayBuffer(0) }), null);
    assert.equal(asPictureRow({ ...row, data: new Uint8Array(12) }), null);
    assert.equal(asPictureRow({ ...row, src: "" }), null);
    assert.equal(asPictureRow("not a row"), null);
  });
});
