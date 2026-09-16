import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { importKind } from "../src/lib/reader/import-kind.js";

/**
 * @param {Partial<{ name: string, type: string, head: number[] }>} file
 */
const kind = ({ name = "", type = "", head = [] } = {}) =>
  importKind({ name, type, head: Uint8Array.from(head) });

describe("importKind", () => {
  it("believes the extension first, in either case", () => {
    assert.equal(kind({ name: "dracula.epub" }), "book");
    assert.equal(kind({ name: "DRACULA.EPUB" }), "book");
    assert.equal(kind({ name: "reread-articles.json" }), "articles");
    assert.equal(kind({ name: "reread-articles.zip" }), "archive");
    // The extension outranks a lying MIME type: it is the word the person
    // picking the file can actually see.
    assert.equal(kind({ name: "dracula.epub", type: "application/json" }), "book");
    assert.equal(kind({ name: "backup.zip", type: "application/epub+zip" }), "archive");
  });

  it("asks the declared type when the name says nothing", () => {
    assert.equal(kind({ name: "book", type: "application/epub+zip" }), "book");
    assert.equal(kind({ name: "list", type: "application/json" }), "articles");
    assert.equal(kind({ name: "backup", type: "application/zip" }), "archive");
  });

  it("calls a nameless, typeless ZIP an archive, for its entries to decide", () => {
    // An EPUB and the backup with pictures open with the same two bytes;
    // which it is, `articles.json` inside says.
    assert.equal(kind({ name: "reading", head: [0x50, 0x4b, 0x03, 0x04] }), "archive");
  });

  it("falls to the articles reader when every voice is silent", () => {
    // Its failure sentence ("no articles in that file") is the gentler one.
    assert.equal(kind({ name: "reading" }), "articles");
    assert.equal(kind({ name: "reading", head: [0x7b] }), "articles");
    // A head shorter than the magic is no evidence, not half a match.
    assert.equal(kind({ name: "reading", head: [0x50] }), "articles");
  });
});
