import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aliasesOf,
  classifyDictionaryFiles,
  describeImportProblem,
  entriesOf,
  gunzip,
  openDictionary,
} from "../src/lib/dict/import.js";
import { concat, cstring, gzip, ifo, index, syn, u32, utf8 } from "./stardict-fixture.js";

/** @type {import("../src/lib/dict/import.js").ImportProblem[]} */
const PROBLEMS = [
  "empty",
  "missing_ifo",
  "missing_idx",
  "missing_dict",
  "mixed",
  "not_stardict",
  "unpack",
  "no_entries",
];

const FILES = ["dict.ifo", "dict.idx", "dict.dict.dz", "dict.syn"];

describe("classifyDictionaryFiles", () => {
  it("sorts the four files of a dictionary out", () => {
    const classified = classifyDictionaryFiles(FILES);
    assert.equal(classified.ok, true);
    assert.deepEqual(classified.value, {
      base: "dict",
      ifo: "dict.ifo",
      idx: "dict.idx",
      dict: "dict.dict.dz",
      syn: "dict.syn",
    });
  });

  it("takes a dictionary without a synonym file", () => {
    const classified = classifyDictionaryFiles(["x.ifo", "x.idx", "x.dict"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.syn, undefined);
  });

  it("sees through .gz and .dz", () => {
    const classified = classifyDictionaryFiles(["x.ifo.gz", "x.idx.gz", "x.dict.dz"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.idx, "x.idx.gz");
  });

  it("ignores the other things a dictionary folder holds", () => {
    const classified = classifyDictionaryFiles([...FILES, "dict.idx.oft", "README", "res/logo.png"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.base, "dict");
  });

  it("refuses two dictionaries at once, and says which", () => {
    const classified = classifyDictionaryFiles(["a.ifo", "a.idx", "a.dict", "b.ifo", "b.idx", "b.dict"]);
    assert.equal(classified.ok, false);
    assert.equal(classified.problem, "mixed");
    assert.equal(classified.detail, "a, b");
  });

  it("names the file that is missing", () => {
    /** @param {string[]} names */
    const problemOf = (names) => {
      const classified = classifyDictionaryFiles(names);
      return classified.ok ? null : classified.problem;
    };

    assert.equal(problemOf([]), "empty");
    assert.equal(problemOf(["x.txt"]), "missing_ifo");
    assert.equal(problemOf(["x.ifo"]), "missing_idx");
    assert.equal(problemOf(["x.ifo", "x.idx"]), "missing_dict");
  });
});

/**
 * A dictionary of three words, in the shape most real ones have: one meaning
 * per word, plain text, and a synonym file carrying an inflected form.
 *
 * @param {{ sametypesequence?: string }} [options]
 */
function dictionary({ sametypesequence = "m" } = {}) {
  const entries = [
    { word: "bank", data: utf8("brzeg") },
    { word: "go", data: utf8("iść") },
    { word: "watch", data: utf8("zegarek") },
  ];
  const built = index(sametypesequence === "" ? entries.map(withTypeByte) : entries);

  return {
    ifo: utf8(ifo({ version: "3.0.0", bookname: "Test Dictionary", wordcount: 3, sametypesequence })),
    idx: built.idx,
    dict: built.dict,
    syn: syn([{ word: "went", target: 1 }]),
  };
}

/**
 * @param {{ word: string, data: Uint8Array }} entry
 * @returns {{ word: string, data: Uint8Array }}
 */
function withTypeByte(entry) {
  return { word: entry.word, data: concat([utf8("m"), entry.data, [0]]) };
}

/**
 * @param {import("../src/lib/dict/import.js").DictionaryFiles} files
 * @param {{ fallbackName?: string }} [options]
 * @returns {Promise<import("../src/lib/dict/import.js").OpenDictionary>}
 */
async function opened(files, options) {
  const result = await openDictionary(files, options);
  assert.equal(result.ok, true, result.ok ? "" : result.problem);
  return /** @type {Extract<typeof result, { ok: true }>} */ (result).value;
}

describe("openDictionary", () => {
  it("opens a dictionary and hands its words out one at a time", async () => {
    const book = await opened(dictionary());
    assert.equal(book.name, "Test Dictionary");
    assert.equal(book.words, 3);
    assert.equal(book.synonyms, 1);
    assert.deepEqual(
      [...entriesOf(book)],
      [
        { position: 0, headword: "bank", senses: ["brzeg"] },
        { position: 1, headword: "go", senses: ["iść"] },
        { position: 2, headword: "watch", senses: ["zegarek"] },
      ],
    );
    assert.deepEqual([...aliasesOf(book)], [{ headword: "went", target: 1 }]);
  });

  it("reads one with a type byte on every field just the same", async () => {
    const book = await opened(dictionary({ sametypesequence: "" }));
    assert.equal([...entriesOf(book)].length, 3);
  });

  it("unpacks whatever arrived compressed, whatever it is called", async () => {
    const files = dictionary();
    const book = await opened({
      ifo: await gzip(files.ifo),
      idx: await gzip(files.idx),
      // A .dict.dz is a gzip file, so this is what one looks like from here.
      dict: await gzip(files.dict),
      syn: files.syn,
    });

    assert.equal([...entriesOf(book)].length, 3);
  });

  it("reads files from a picker as they are, compressed or not", async () => {
    const files = dictionary();
    /** @param {Uint8Array} bytes */
    const blob = (bytes) => new Blob([bytes.slice().buffer]);
    const book = await opened({
      ifo: blob(files.ifo),
      idx: blob(await gzip(files.idx)),
      dict: blob(await gzip(files.dict)),
      syn: blob(files.syn),
    });

    assert.deepEqual(
      [...entriesOf(book)].map((entry) => entry.headword),
      ["bank", "go", "watch"],
    );
    assert.deepEqual([...aliasesOf(book)], [{ headword: "went", target: 1 }]);
  });

  it("inflates into a buffer sized by the hint, and survives a hint that is wrong", async () => {
    // The hint only sizes the buffer: too small costs a copy, too large a
    // view, and the bytes come out the same either way.
    const text = utf8("brzeg iść zegarek ".repeat(200));
    const packed = await gzip(text);
    for (const hint of [text.length, 1, 0, text.length * 3]) {
      const stream = new Blob([packed.slice().buffer]).stream();
      assert.deepEqual(await gunzip(stream, hint), text, `hint ${hint}`);
    }
  });

  it("stops at the cap rather than inflating past it (D171)", async () => {
    const text = utf8("a".repeat(64 * 1024));
    const packed = await gzip(text);
    // The cap holds the read, whatever the trailer claims - and it holds the
    // first allocation too: a trailer claiming four gigabytes does not get
    // four gigabytes allocated on its word.
    for (const hint of [text.length, 4 * 1024 * 1024 * 1024]) {
      const stream = new Blob([packed.slice().buffer]).stream();
      await assert.rejects(gunzip(stream, hint, 1024), /unpacks to more than 1024 bytes/);
    }
    // Under the cap nothing changes.
    assert.deepEqual(await gunzip(new Blob([packed.slice().buffer]).stream(), text.length, text.length), text);
  });

  it("takes the files it was given, so nobody else keeps them", async () => {
    const files = dictionary();
    await opened(files);
    assert.deepEqual(Object.keys(files), []);
  });

  it("yields a bad entry with no senses, and keeps the positions after it", async () => {
    const files = dictionary();
    // Break the first entry by sending it past the end of the body.
    const broken = concat([cstring("bank"), u32(9000), u32(5), files.idx.subarray(13)]);

    const book = await opened({ ...files, idx: broken });
    const entries = [...entriesOf(book)];
    assert.deepEqual(entries[0], { position: 0, headword: "bank", senses: [] });
    assert.equal(entries[1]?.headword, "go");
    // `went` still means the second record, whatever became of the first.
    assert.deepEqual([...aliasesOf(book)], [{ headword: "went", target: 1 }]);
  });

  it("counts a record that is not a word as a position, because the synonym file does", async () => {
    const files = dictionary();
    // Some tools leave an empty record behind; the synonym file was written
    // against the index as it is, empty record and all.
    const padded = concat([cstring(""), u32(0), u32(0), files.idx]);

    const book = await opened({ ...files, idx: padded, syn: syn([{ word: "went", target: 2 }]) });
    assert.equal(book.words, 3);
    assert.deepEqual(
      [...entriesOf(book)].map((entry) => [entry.position, entry.headword]),
      [
        [1, "bank"],
        [2, "go"],
        [3, "watch"],
      ],
    );
  });

  it("walks through an index padded with zeros to the real end", async () => {
    // Seen in the wild: an .idx file twice the size its .ifo claims, the
    // second half all zeros. Every zero run is an empty record, none is a word.
    const files = dictionary();
    const book = await opened({ ...files, idx: concat([files.idx, new Uint8Array(90)]) });
    assert.equal(book.words, 3);
    assert.equal([...entriesOf(book)].length, 3);
  });

  it("takes the name from the file when the dictionary does not give one", async () => {
    const files = dictionary();
    const book = await opened(
      { ...files, ifo: utf8(ifo({ version: "3.0.0", sametypesequence: "m" })) },
      { fallbackName: "wikdict-en-pl" },
    );
    assert.equal(book.name, "wikdict-en-pl");
  });

  it("refuses something that is not a StarDict dictionary at all", async () => {
    const files = dictionary();
    const result = await openDictionary({ ...files, ifo: utf8("# just a text file\n") });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "not_stardict");
  });

  it("refuses before unpacking the rest, when the .ifo already says no", async () => {
    const files = dictionary();
    const result = await openDictionary({
      ...files,
      ifo: utf8("# just a text file\n"),
      // A body that would fail to unpack, had anybody tried.
      dict: concat([[0x1f, 0x8b], new Uint8Array(10)]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "not_stardict");
  });

  it("says when a compressed file cannot be unpacked", async () => {
    const files = dictionary();
    const result = await openDictionary({ ...files, dict: concat([[0x1f, 0x8b], new Uint8Array(10)]) });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "unpack");
  });

  it("refuses an empty index without pretending it was a near miss", async () => {
    const files = dictionary();
    const result = await openDictionary({ ...files, idx: new Uint8Array() });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "no_entries");
    assert.equal(result.detail, undefined);
  });

  it("hands out the words before the boundary with their headword alone", async () => {
    const files = dictionary();
    // A body nothing can be read from: had the first two words been read,
    // they would come out skipped, and they do not - they were not read.
    const book = await opened({ ...files, dict: new Uint8Array(2) });
    assert.deepEqual(
      [...entriesOf(book, { readFrom: 2 })].map((entry) => [entry.position, entry.headword, entry.senses]),
      [
        [0, "bank", []],
        [1, "go", []],
        [2, "watch", []],
      ],
    );
    const whole = await opened({ ...dictionary(), dict: files.dict });
    assert.deepEqual(
      [...entriesOf(whole, { readFrom: 2 })].map((entry) => entry.senses),
      [[], [], ["zegarek"]],
    );
  });

  it("reads a dictionary without a synonym file", async () => {
    const { syn: _, ...files } = dictionary();
    const book = await opened(files);
    assert.equal(book.synonyms, 0);
    assert.deepEqual([...aliasesOf(book)], []);
  });
});

describe("describeImportProblem", () => {
  it("has a different sentence for every problem", () => {
    const sentences = PROBLEMS.map((problem) => describeImportProblem(problem));
    assert.equal(new Set(sentences).size, PROBLEMS.length);
  });

  it("always says what happened to the data, because nothing did", () => {
    for (const problem of PROBLEMS) {
      assert.ok(describeImportProblem(problem).includes("Nothing was stored"), problem);
      assert.ok(describeImportProblem(problem, "detail").includes("Nothing was stored"), problem);
    }
  });

  it("says which dictionaries were mixed together", () => {
    assert.ok(describeImportProblem("mixed", "a, b").includes("a, b"));
  });
});
