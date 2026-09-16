import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { crc32, describeZipProblem, readZip } from "../src/lib/dict/zip.js";

/** @param {number} value */
function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

/** @param {number} value */
function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return all;
}

/**
 * @typedef {object} TestFile
 * @property {string} name
 * @property {Uint8Array} data
 * @property {0 | 8} [method]
 * @property {number} [flags]
 * @property {number} [crc] to lie about the checksum
 * @property {number} [uncompressedSize] to lie about the size
 * @property {number} [localExtraLength] padding only the local header knows about
 */

/**
 * Builds a real little zip, byte by byte - the same layout `readZip` parses,
 * assembled independently so the two cannot share a bug.
 *
 * @param {TestFile[]} files
 * @param {{ count?: number, comment?: string }} [tweaks]
 * @returns {ArrayBuffer}
 */
function buildZip(files, tweaks = {}) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array[]} */
  const locals = [];
  /** @type {Uint8Array[]} */
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const method = file.method ?? 8;
    const stored = method === 0 ? file.data : new Uint8Array(deflateRawSync(file.data));
    const crc = file.crc ?? crc32(file.data);
    const uncompressedSize = file.uncompressedSize ?? file.data.byteLength;
    const flags = file.flags ?? 0;
    const localExtra = new Uint8Array(file.localExtraLength ?? 0);

    const local = concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u32(0),
      u32(crc), u32(stored.byteLength), u32(uncompressedSize),
      u16(name.byteLength), u16(localExtra.byteLength), name, localExtra, stored,
    ]);
    locals.push(local);

    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u32(0),
      u32(crc), u32(stored.byteLength), u32(uncompressedSize),
      u16(name.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.byteLength;
  }

  const central = concat(centrals);
  const comment = encoder.encode(tweaks.comment ?? "");
  const count = tweaks.count ?? files.length;
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(count), u16(count),
    u32(central.byteLength), u32(offset), u16(comment.byteLength), comment,
  ]);

  return concat([...locals, central, eocd]).buffer;
}

const text = (/** @type {string} */ value) => new TextEncoder().encode(value);

describe("crc32", () => {
  it("matches the check value every CRC-32 implementation agrees on", () => {
    assert.equal(crc32(text("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });
});

describe("readZip", () => {
  it("reads stored and deflated entries alike, dropping directories", async () => {
    const zip = buildZip([
      { name: "wikdict-en-pl/", data: new Uint8Array(0), method: 0 },
      { name: "wikdict-en-pl/a.ifo", data: text("bookname=Test"), method: 8 },
      { name: "wikdict-en-pl/a.idx", data: text("raw"), method: 0 },
    ]);

    const result = await readZip(zip);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      result.value.map((entry) => entry.name),
      ["wikdict-en-pl/a.ifo", "wikdict-en-pl/a.idx"],
    );
    assert.equal(new TextDecoder().decode(result.value[0]?.bytes), "bookname=Test");
    assert.equal(new TextDecoder().decode(result.value[1]?.bytes), "raw");
  });

  it("finds the directory record behind a trailing comment", async () => {
    const zip = buildZip([{ name: "a.ifo", data: text("x") }], { comment: "made by hand" });
    const result = await readZip(zip);
    assert.ok(result.ok);
  });

  it("honours the local header's own extra field when placing the data", async () => {
    // Central says no extra field, local carries one - real archives do this,
    // and reading the data where the central directory alone would point lands
    // in the padding.
    const zip = buildZip([{ name: "a.ifo", data: text("payload"), localExtraLength: 13 }]);
    const result = await readZip(zip);
    assert.ok(result.ok);
    assert.equal(new TextDecoder().decode(result.value[0]?.bytes), "payload");
  });

  it("answers not_zip for bytes that never were one", async () => {
    for (const rubbish of [new Uint8Array(0), new Uint8Array(10), text("PK but not really, just text")]) {
      const result = await readZip(rubbish.slice().buffer);
      assert.ok(!result.ok);
      assert.equal(result.problem, "not_zip");
    }
  });

  it("refuses what it does not speak, by name", async () => {
    const cases = /** @type {const} */ ([
      ["an encrypted entry", buildZip([{ name: "a.ifo", data: text("x"), flags: 0x1 }]), "zip_unsupported"],
      ["an exotic compression method", buildZip([{ name: "a.ifo", data: text("x"), method: /** @type {8} */ (12) }]), "zip_unsupported"],
      ["a zip64 size marker", buildZip([{ name: "a.ifo", data: text("x"), uncompressedSize: 0xffffffff }]), "zip_unsupported"],
      ["a checksum that does not match", buildZip([{ name: "a.ifo", data: text("x"), crc: 1 }]), "zip_bad"],
      ["a size the data contradicts", buildZip([{ name: "a.ifo", data: text("x"), uncompressedSize: 999 }]), "zip_bad"],
      // A megabyte of zeros deflates to a kilobyte; the directory says eight
      // bytes, and the inflate stops there rather than at the megabyte (D171).
      ["an entry that unpacks past the size the directory claims", buildZip([{ name: "a.dict", data: new Uint8Array(1 << 20), uncompressedSize: 8 }]), "zip_bad"],
      ["an empty archive", buildZip([], { count: 0 }), "zip_bad"],
      ["only directories inside", buildZip([{ name: "folder/", data: new Uint8Array(0), method: 0 }]), "zip_bad"],
      ["an entry claiming more than the total cap", buildZip([{ name: "a.ifo", data: text("x"), uncompressedSize: 257 * 1024 * 1024 }]), "zip_too_big"],
    ]);

    for (const [what, zip, problem] of cases) {
      const result = await readZip(zip);
      assert.ok(!result.ok, `should have refused ${what}`);
      assert.equal(result.problem, problem, `${what} should be ${problem}, was ${result.problem}`);
    }
  });

  it("unpacks only the wanted members, and counts only them against the cap", async () => {
    // A Wiktionary build ships a picture per hundred entries beside its four
    // files; none of them is inflated, and an unwanted member may claim any
    // size at all - it is never what fills memory.
    const zip = buildZip([
      { name: "dict-data.ifo", data: text("bookname=Test") },
      ...Array.from({ length: 200 }, (_, index) => ({ name: `res/${index}.gif`, data: text("GIF89a") })),
      { name: "res/huge.bin", data: text("x"), uncompressedSize: 300 * 1024 * 1024 },
    ]);
    const result = await readZip(zip, { wanted: (name) => name.endsWith(".ifo") });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.value.map((entry) => entry.name), ["dict-data.ifo"]);
  });

  it("answers with no files, not a refusal, when nothing inside is wanted", async () => {
    // What is missing is for the caller to name - "no .ifo among these" says
    // more than "bad archive" would.
    const result = await readZip(buildZip([{ name: "readme.txt", data: text("hi") }]), { wanted: () => false });
    assert.ok(result.ok);
    assert.deepEqual(result.value, []);
  });

  it("calls a truncated archive damaged rather than reading past its end", async () => {
    const whole = buildZip([{ name: "a.ifo", data: text("a longer payload so truncation lands in the data") }]);
    // Keep the central directory and the end record, lose the file data: the
    // offsets then point at bytes that are not there.
    const bytes = new Uint8Array(whole);
    const cut = concat([bytes.slice(10), new Uint8Array(0)]);
    const result = await readZip(cut.buffer);
    assert.ok(!result.ok);
  });

  it("has a sentence for every problem, each ending in what was stored - nothing", () => {
    for (const problem of /** @type {const} */ (["not_zip", "zip_unsupported", "zip_bad", "zip_too_big"])) {
      const sentence = describeZipProblem(problem, "detail");
      assert.match(sentence, /[Nn]othing was stored/);
    }
  });
});
