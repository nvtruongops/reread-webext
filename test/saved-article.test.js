import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Segment,
  asSavedMeta,
  emptySentence,
  listedRows,
  savedArticle,
} from "../src/lib/store/saved-article.js";

/**
 * @param {Partial<Parameters<typeof savedArticle>[0]>} overrides
 */
function build(overrides) {
  return savedArticle({
    url: "https://example.com/story",
    title: "A story",
    content: "<p>Body</p>",
    savedAt: 1000,
    ...overrides,
  });
}

describe("savedArticle", () => {
  it("derives the hostname once, so the list never parses URLs", () => {
    const article = build({});
    assert.ok(article !== null);
    assert.equal(article.hostname, "example.com");
    assert.equal(article.title, "A story");
    assert.equal(article.savedAt, 1000);
  });

  it("starts unread - saving is putting it on the pile, not reading it", () => {
    assert.equal(build({})?.readAt, null);
  });

  it("falls back from a blank title to the hostname, and from there to the address", () => {
    assert.equal(build({ title: "   " })?.title, "example.com");
    assert.equal(build({ title: "", url: "file:///tmp/story.html" })?.title, "file:///tmp/story.html");
  });

  it("keeps dir and lang when they are short tokens and drops everything else", () => {
    const kept = build({ dir: "rtl", lang: " ar " });
    assert.equal(kept?.dir, "rtl");
    assert.equal(kept?.lang, "ar");

    const dropped = build({ dir: "", lang: "x".repeat(41) });
    assert.equal(dropped?.dir, null);
    assert.equal(dropped?.lang, null);

    assert.equal(build({})?.dir, null);
  });

  it("refuses an entry with no address, a bad address, or nothing to keep", () => {
    assert.equal(build({ url: "" }), null);
    assert.equal(build({ url: "not a url" }), null);
    assert.equal(build({ content: "" }), null);
    assert.equal(build({ savedAt: Number.NaN }), null);
  });

  it("takes only an address a page is read from: http, https or a file (D171)", () => {
    // The address becomes an `href` the reader hands out, and a backup file
    // is data anybody can write - `javascript:` parses as a URL and must not
    // get through on that account.
    assert.equal(build({ url: "http://a.example/page" })?.hostname, "a.example");
    assert.equal(build({ url: "file:///home/me/page.html" })?.hostname, "");
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "blob:https://a.example/x", "mailto:a@b.c"]) {
      assert.equal(build({ url }), null, `should refuse ${url}`);
    }
  });
});

describe("asSavedMeta", () => {
  it("keeps a wounded row rather than hiding somebody's saved reading", () => {
    const meta = asSavedMeta({ url: "https://example.com/a", hostname: 7, title: 7, savedAt: "x", readAt: "x" });
    assert.deepEqual(meta, {
      url: "https://example.com/a",
      hostname: "",
      title: "https://example.com/a",
      savedAt: 0,
      readAt: null,
    });
  });

  it("drops only what cannot be opened at all", () => {
    assert.equal(asSavedMeta(null), null);
    assert.equal(asSavedMeta("row"), null);
    assert.equal(asSavedMeta({ title: "no address" }), null);
  });

  it("carries the pictures' account only where there is one", () => {
    const row = { url: "https://example.com/a", hostname: "example.com", title: "A", savedAt: 1, readAt: null };
    assert.deepEqual(asSavedMeta({ ...row, pictures: { count: 3, bytes: 4096 } }), {
      ...row,
      pictures: { count: 3, bytes: 4096 },
    });
    // No pictures, none claimed, or an account that will not read: no field.
    assert.deepEqual(asSavedMeta(row), row);
    assert.deepEqual(asSavedMeta({ ...row, pictures: { count: 0, bytes: 0 } }), row);
    assert.deepEqual(asSavedMeta({ ...row, pictures: "three" }), row);
    // A fresh save starts without any.
    assert.equal("pictures" in (build({}) ?? {}), false);
  });

  it("passes a whole row through unchanged", () => {
    const row = { url: "https://example.com/a", hostname: "example.com", title: "A", savedAt: 5, readAt: 9 };
    assert.deepEqual(asSavedMeta(row), row);
  });
});

describe("listedRows", () => {
  const metas = [
    { url: "https://a.example/1", hostname: "a.example", title: "old unread", savedAt: 1, readAt: null },
    { url: "https://a.example/2", hostname: "a.example", title: "read", savedAt: 2, readAt: 10 },
    { url: "https://a.example/3", hostname: "a.example", title: "new unread", savedAt: 3, readAt: null },
  ];

  it("splits by segment and puts the newest saved first", () => {
    assert.deepEqual(
      listedRows(metas, Segment.UNREAD).map((meta) => meta.title),
      ["new unread", "old unread"],
    );
    assert.deepEqual(
      listedRows(metas, Segment.READ).map((meta) => meta.title),
      ["read"],
    );
  });

  it("puts the document read last on top, above everything saved since read", () => {
    const rows = [
      { url: "https://a.example/1", hostname: "a.example", title: "read long ago", savedAt: 1, readAt: null, lastReadAt: 4 },
      { url: "https://a.example/2", hostname: "a.example", title: "read yesterday", savedAt: 2, readAt: null, lastReadAt: 8 },
      { url: "https://a.example/3", hostname: "a.example", title: "never read", savedAt: 5, readAt: null },
    ];
    assert.deepEqual(
      listedRows(rows, Segment.UNREAD).map((meta) => meta.title),
      ["read yesterday", "never read", "read long ago"],
    );
  });

  it("a fresh save outranks an old reading of the same row", () => {
    // Saving anew is an act too: a re-saved article rises on its new date
    // even though its position row still carries the earlier reading.
    const rows = [
      { url: "https://a.example/1", hostname: "a.example", title: "re-saved", savedAt: 9, readAt: null, lastReadAt: 3 },
      { url: "https://a.example/2", hostname: "a.example", title: "read after saving", savedAt: 2, readAt: null, lastReadAt: 7 },
    ];
    assert.deepEqual(
      listedRows(rows, Segment.UNREAD).map((meta) => meta.title),
      ["re-saved", "read after saving"],
    );
  });

  it("orders ties by address, so the list cannot reshuffle between openings", () => {
    const tied = [
      { url: "https://a.example/b", hostname: "a.example", title: "b", savedAt: 1, readAt: null },
      { url: "https://a.example/a", hostname: "a.example", title: "a", savedAt: 1, readAt: null },
    ];
    assert.deepEqual(
      listedRows(tied, Segment.UNREAD).map((meta) => meta.title),
      ["a", "b"],
    );
  });

  it("does not touch the array it was given", () => {
    const before = metas.map((meta) => meta.title);
    listedRows(metas, Segment.UNREAD);
    assert.deepEqual(
      metas.map((meta) => meta.title),
      before,
    );
  });
});

describe("emptySentence", () => {
  it("says how to save the first article only when nothing is saved at all", () => {
    assert.match(emptySentence(0, Segment.UNREAD), /Save to reading list/);
    assert.match(emptySentence(0, Segment.READ), /Save to reading list/);
  });

  it("speaks to the segment when the list is merely filtered empty", () => {
    assert.match(emptySentence(3, Segment.UNREAD), /marked as read/);
    assert.match(emptySentence(3, Segment.READ), /Nothing is marked as read yet/);
  });

  it("never says the same thing for two different states", () => {
    const sentences = [
      emptySentence(0, Segment.UNREAD),
      emptySentence(3, Segment.UNREAD),
      emptySentence(3, Segment.READ),
    ];
    assert.equal(new Set(sentences).size, sentences.length);
  });
});
