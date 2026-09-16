import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { idxEntries, isWord, parseIfo, readFields, synEntries } from "../src/lib/dict/stardict.js";
import { concat, cstring, ifo, index, syn, u32, u64, utf8 } from "./stardict-fixture.js";

describe("parseIfo", () => {
  it("reads the fields a dictionary describes itself with", () => {
    const parsed = parseIfo(
      ifo({
        version: "3.0.0",
        bookname: "English-Polish",
        wordcount: 16362,
        idxoffsetbits: 64,
        sametypesequence: "m",
        author: "FreeDict",
        website: "https://freedict.org",
      }),
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.bookname, "English-Polish");
    assert.equal(parsed.value.wordcount, 16362);
    assert.equal(parsed.value.offsetBits, 64);
    assert.equal(parsed.value.sametypesequence, "m");
    assert.equal(parsed.value.credit, "FreeDict - https://freedict.org");
  });

  it("defaults to 32-bit offsets and to a type byte on every field", () => {
    const parsed = parseIfo(ifo({ version: "2.4.2", bookname: "Old" }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.offsetBits, 32);
    assert.equal(parsed.value.sametypesequence, "");
    assert.equal(parsed.value.credit, null);
  });

  it("falls back to the file name when the dictionary does not name itself", () => {
    const parsed = parseIfo(ifo({ version: "3.0.0", wordcount: 1 }), "wikdict-en-pl");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.bookname, "wikdict-en-pl");
  });

  it("refuses a file that is not a StarDict dictionary", () => {
    const parsed = parseIfo("something else entirely\nbookname=No");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.problem, "not_stardict");
  });

  it("says which other kind of StarDict file arrived", () => {
    const parsed = parseIfo("StarDict's treedict ifo file\nbookname=Tree");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.detail, "a tree dictionary");
  });

  it("survives carriage returns and stray lines", () => {
    const parsed = parseIfo("StarDict's dict ifo file\r\nbookname=Windows\r\n\r\nnonsense\r\n");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.bookname, "Windows");
  });
});

describe("idxEntries", () => {
  it("reads word, offset and size", () => {
    const { idx } = index([
      { word: "bank", data: utf8("brzeg") },
      { word: "watch", data: utf8("zegarek") },
    ]);

    assert.deepEqual(
      [...idxEntries(idx, 32)],
      [
        { word: "bank", offset: 0, size: 5 },
        { word: "watch", offset: 5, size: 7 },
      ],
    );
  });

  it("reads 64-bit offsets when the .ifo said so", () => {
    const { idx } = index([{ word: "bank", data: utf8("brzeg") }], { offsetBits: 64 });
    assert.deepEqual([...idxEntries(idx, 64)], [{ word: "bank", offset: 0, size: 5 }]);
  });

  it("stops at a truncated tail and keeps what was whole", () => {
    const { idx } = index([
      { word: "bank", data: utf8("brzeg") },
      { word: "watch", data: utf8("zegarek") },
    ]);
    const cut = idx.slice(0, idx.length - 2);

    assert.deepEqual([...idxEntries(cut, 32)], [{ word: "bank", offset: 0, size: 5 }]);
  });

  it("stops rather than inventing words when the offset width is wrong", () => {
    // 64-bit offsets read as 32-bit: the second word starts inside a number and
    // runs on until something says otherwise, which is what the length cap is for.
    const { idx } = index(
      [
        { word: "bank", data: utf8("brzeg") },
        { word: "x".repeat(300), data: utf8("nonsense") },
      ],
      { offsetBits: 64 },
    );

    assert.ok([...idxEntries(idx, 32)].filter(isWord).length < 2);
  });

  it("yields an empty word and a word with no data, because positions count them", () => {
    const idx = concat([
      cstring(""),
      u32(0),
      u32(4),
      cstring("real"),
      u32(0),
      u32(4),
      cstring("hollow"),
      u32(4),
      u32(0),
    ]);

    const entries = [...idxEntries(idx, 32)];
    assert.deepEqual(entries.map(isWord), [false, true, false]);
    assert.deepEqual(entries[1], { word: "real", offset: 0, size: 4 });
  });

  it("keeps the same word twice, because homographs are two entries", () => {
    const { idx } = index([
      { word: "bank", data: utf8("brzeg") },
      { word: "bank", data: utf8("instytucja") },
    ]);
    assert.equal([...idxEntries(idx, 32)].length, 2);
  });

  it("walks a long index one record at a time, to the end", () => {
    // The generator is the point: a dictionary of a million words costs one
    // record of memory at a time, and the walk still ends where the file does.
    const { idx } = index(Array.from({ length: 1000 }, (_, at) => ({ word: `w${at}`, data: utf8("x") })));
    let count = 0;
    for (const entry of idxEntries(idx, 32)) {
      assert.equal(entry.word, `w${count}`);
      count += 1;
    }
    assert.equal(count, 1000);
  });
});

describe("synEntries", () => {
  it("reads a synonym and the record it points at", () => {
    assert.deepEqual([...synEntries(syn([{ word: "went", target: 3 }]))], [{ word: "went", target: 3 }]);
  });

  it("stops at a truncated tail", () => {
    const whole = syn([
      { word: "went", target: 3 },
      { word: "gone", target: 3 },
    ]);
    assert.deepEqual([...synEntries(whole.slice(0, whole.length - 3))], [{ word: "went", target: 3 }]);
  });

  it("is empty for an empty file", () => {
    assert.deepEqual([...synEntries(new Uint8Array())], []);
  });
});

describe("readFields", () => {
  it("reads one field when every word has the same single type", () => {
    const { dict } = index([{ word: "bank", data: utf8("brzeg") }]);
    const fields = readFields(dict, { word: "bank", offset: 0, size: 5 }, "m");
    assert.deepEqual(fields, [{ type: "m", text: "brzeg" }]);
  });

  it("drops the terminator only from the last field of a word", () => {
    // sametypesequence=tm: the phonetic string keeps its \0, the meaning does not.
    const data = concat([cstring("/bæŋk/"), utf8("brzeg")]);
    const fields = readFields(data, { word: "bank", offset: 0, size: data.length }, "tm");
    assert.deepEqual(fields, [
      { type: "t", text: "/bæŋk/" },
      { type: "m", text: "brzeg" },
    ]);
  });

  it("reads a type byte in front of every field when there is no sequence", () => {
    const data = concat([utf8("t"), cstring("/bæŋk/"), utf8("m"), cstring("brzeg")]);
    const fields = readFields(data, { word: "bank", offset: 0, size: data.length }, "");
    assert.deepEqual(fields, [
      { type: "t", text: "/bæŋk/" },
      { type: "m", text: "brzeg" },
    ]);
  });

  it("steps over a size-prefixed picture without reading it", () => {
    const picture = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const data = concat([utf8("P"), u32(picture.length), picture, utf8("m"), cstring("brzeg")]);
    const fields = readFields(data, { word: "bank", offset: 0, size: data.length }, "");
    assert.deepEqual(fields, [{ type: "m", text: "brzeg" }]);
  });

  it("forgives a missing terminator on the last field without a sequence", () => {
    const data = concat([utf8("m"), utf8("brzeg")]);
    const fields = readFields(data, { word: "bank", offset: 0, size: data.length }, "");
    assert.deepEqual(fields, [{ type: "m", text: "brzeg" }]);
  });

  it("reads a word out of the middle of the file", () => {
    const { dict } = index([
      { word: "bank", data: utf8("brzeg") },
      { word: "watch", data: utf8("zegarek") },
    ]);
    const fields = readFields(dict, { word: "watch", offset: 5, size: 7 }, "m");
    assert.deepEqual(fields, [{ type: "m", text: "zegarek" }]);
  });

  it("answers null for an entry pointing past the end of the file", () => {
    const { dict } = index([{ word: "bank", data: utf8("brzeg") }]);
    assert.equal(readFields(dict, { word: "bank", offset: 4, size: 40 }, "m"), null);
    assert.equal(readFields(dict, { word: "bank", offset: 4000, size: 1 }, "m"), null);
  });

  it("does not run past the end of one entry into the next", () => {
    // No terminator anywhere: without the size bound, `bank` would read the
    // whole file and every word would mean everything.
    const dict = concat([utf8("brzeg"), utf8("zegarek")]);
    const fields = readFields(dict, { word: "bank", offset: 0, size: 5 }, "m");
    assert.deepEqual(fields, [{ type: "m", text: "brzeg" }]);
  });
});
