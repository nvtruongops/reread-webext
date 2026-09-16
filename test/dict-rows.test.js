import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { entriesReadFrom, mergeSenses, rowBatches, utf8Length } from "../src/lib/dict/rows.js";
import { LIMITS } from "../src/lib/dict/text.js";

/**
 * @typedef {import("../src/lib/dict/rows.js").DictionaryRow} DictionaryRow
 */

/**
 * Entries the way `entriesOf` hands them out, positioned in the order given.
 *
 * @param {{ headword: string, senses: string[] }[]} entries
 * @returns {import("../src/lib/dict/import.js").Entry[]}
 */
function positioned(entries) {
  return entries.map((entry, position) => ({ position, ...entry }));
}

/**
 * What the database would hold after every batch went in: the rows as written,
 * with each addition folded into the row it names the way the writer does.
 *
 * @param {string} dictId
 * @param {{ headword: string, senses: string[] }[] | import("../src/lib/dict/import.js").Entry[]} entries
 * @param {import("../src/lib/dict/import.js").Alias[]} [aliases]
 * @param {{ batchSize?: number }} [options]
 * @returns {{ rows: DictionaryRow[], batches: number, appended: number } & import("../src/lib/dict/rows.js").RowSummary}
 *   `appended` being the bytes the additions added, counted the way the writer counts them
 */
function stored(dictId, entries, aliases = [], options = {}) {
  const source = {
    entries: "position" in (entries[0] ?? {}) ? /** @type {import("../src/lib/dict/import.js").Entry[]} */ (entries) : positioned(entries),
    aliases,
  };

  /** @type {Map<string, DictionaryRow>} */
  const table = new Map();
  let batches = 0;
  let appended = 0;
  const generator = rowBatches(dictId, source, options);

  let step = generator.next();
  while (!step.done) {
    batches += 1;
    for (const row of step.value.rows) table.set(row.key, row);
    for (const addition of step.value.additions) {
      const row = table.get(addition.key);
      assert.ok(row !== undefined, `an addition for ${addition.key} arrived before its row`);
      for (const sense of mergeSenses(row.senses, addition.senses)) appended += utf8Length(sense);
    }
    step = generator.next();
  }

  return { rows: [...table.values()], batches, appended, ...step.value };
}

/**
 * @param {DictionaryRow[]} rows
 * @param {string} key
 * @returns {DictionaryRow | undefined}
 */
function at(rows, key) {
  return rows.find((row) => row.key === key);
}

describe("rowBatches", () => {
  it("keys a word the same way the vocabulary keys a phrase", () => {
    const { rows } = stored("d1", [{ headword: "Bank", senses: ["brzeg"] }]);
    assert.deepEqual(rows, [{ dictId: "d1", key: "bank", headword: "Bank", senses: ["brzeg"] }]);
  });

  it("merges the entries that normalising brings together", () => {
    const { rows, entryCount } = stored("d1", [
      { headword: "Bank", senses: ["instytucja"] },
      { headword: "bank", senses: ["brzeg"] },
    ]);

    assert.equal(entryCount, 1);
    assert.deepEqual(at(rows, "bank")?.senses, ["instytucja", "brzeg"]);
    // The first spelling wins, because it is the one the dictionary sorted first.
    assert.equal(at(rows, "bank")?.headword, "Bank");
  });

  it("does not let a dictionary that repeats itself repeat itself in the bubble", () => {
    const { rows } = stored("d1", [
      { headword: "bank", senses: ["brzeg"] },
      { headword: "bank", senses: ["brzeg", "instytucja"] },
    ]);
    assert.deepEqual(at(rows, "bank")?.senses, ["brzeg", "instytucja"]);
  });

  it("stops merging at the tenth meaning", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      headword: "bank",
      senses: [`znaczenie ${index}`],
    }));
    const { rows } = stored("d1", many);
    assert.equal(at(rows, "bank")?.senses.length, LIMITS.senses);
  });

  it("drops a headword that has no key to be found under", () => {
    const { rows, entryCount, skipped } = stored("d1", [{ headword: "---", senses: ["nic"] }]);
    assert.equal(entryCount, 0);
    assert.equal(rows.length, 0);
    assert.equal(skipped, 0);
  });

  it("counts an entry that could not be read, and leaves it out", () => {
    const { rows, entryCount, skipped } = stored("d1", [
      { headword: "bank", senses: [] },
      { headword: "go", senses: ["iść"] },
    ]);
    assert.equal(skipped, 1);
    assert.equal(entryCount, 1);
    assert.deepEqual(rows.map((row) => row.key), ["go"]);
  });

  it("ends with nothing when no entry could be read, and says how many", () => {
    const { rows, entryCount, skipped, batches } = stored("d1", [
      { headword: "bank", senses: [] },
      { headword: "go", senses: [] },
    ]);
    assert.equal(entryCount, 0);
    assert.equal(skipped, 2);
    assert.equal(rows.length, 0);
    assert.equal(batches, 0);
  });

  it("turns a synonym into a row that points at the word it means", () => {
    const { rows, aliasCount } = stored("d1", [{ headword: "go", senses: ["iść"] }], [{ headword: "went", target: 0 }]);

    assert.equal(aliasCount, 1);
    assert.deepEqual(at(rows, "went"), {
      dictId: "d1",
      key: "went",
      headword: "went",
      senses: [],
      aliasOf: "go",
    });
  });

  it("never lets a synonym shadow a word the dictionary has itself", () => {
    const { rows, aliasCount } = stored(
      "d1",
      [
        { headword: "go", senses: ["iść"] },
        { headword: "went", senses: ["poszedł"] },
      ],
      [{ headword: "went", target: 0 }],
    );

    assert.equal(aliasCount, 0);
    assert.deepEqual(at(rows, "went")?.senses, ["poszedł"]);
  });

  it("ignores a synonym pointing at nothing, and one pointing at itself", () => {
    const { rows, aliasCount } = stored(
      "d1",
      [{ headword: "go", senses: ["iść"] }],
      [
        { headword: "gone", target: 7 },
        { headword: "Go", target: 0 },
      ],
    );

    assert.equal(aliasCount, 0);
    assert.equal(rows.length, 1);
  });

  it("ignores a synonym pointing at an entry that could not be read", () => {
    const { rows, aliasCount } = stored(
      "d1",
      [
        { headword: "go", senses: [] },
        { headword: "walk", senses: ["iść"] },
      ],
      [{ headword: "went", target: 0 }],
    );

    assert.equal(aliasCount, 0);
    assert.deepEqual(rows.map((row) => row.key), ["walk"]);
  });

  it("follows positions, not the count of readable words", () => {
    // The index had a record at position 1 that was not a word (see
    // `isWord`), so `entriesOf` never yielded it - and the synonym file,
    // written against the index as it is, still counts it.
    const entries = [
      { position: 0, headword: "bank", senses: ["brzeg"] },
      { position: 2, headword: "go", senses: ["iść"] },
    ];
    const { rows } = stored("d1", entries, [{ headword: "went", target: 2 }]);
    assert.equal(at(rows, "went")?.aliasOf, "go");
  });

  it("lets a second synonym of the same spelling go, whichever came first", () => {
    const { rows, aliasCount } = stored(
      "d1",
      [
        { headword: "go", senses: ["iść"] },
        { headword: "walk", senses: ["chodzić"] },
      ],
      [
        { headword: "went", target: 0 },
        { headword: "went", target: 1 },
      ],
    );
    assert.equal(aliasCount, 1);
    assert.equal(at(rows, "went")?.aliasOf, "go");
  });

  it("counts what the text costs, in the bytes it will take up", () => {
    const { bytes } = stored("d1", [{ headword: "bank", senses: ["ławka"] }]);
    // "bank" twice, as the key and as the headword, plus a meaning whose ł is
    // two bytes where the rest are one.
    assert.equal(bytes, 4 + 4 + 6);
  });

  it("counts a character outside the basic plane once, not twice", () => {
    const { bytes } = stored("d1", [{ headword: "a", senses: ["😀"] }]);
    assert.equal(bytes, 1 + 1 + 4);
  });

  it("cuts the rows into batches of the size asked for", () => {
    const entries = Array.from({ length: 12 }, (_, at) => ({ headword: `w${at}`, senses: ["x"] }));
    const { batches, entryCount } = stored("d1", entries, [{ headword: "alias", target: 0 }], { batchSize: 5 });
    // 12 words in batches of 5, the last batch holding two words and the alias.
    assert.equal(batches, 3);
    assert.equal(entryCount, 12);
  });

  it("says how far it is, in records read", () => {
    const entries = Array.from({ length: 4 }, (_, at) => ({ headword: `w${at}`, senses: ["x"] }));
    const aliases = [{ headword: "a", target: 0 }];
    const seen = [...rowBatches("d1", { entries: positioned(entries), aliases }, { batchSize: 2 })].map(
      (batch) => batch.done,
    );
    assert.deepEqual(seen, [2, 4, 5]);
  });

  it("sends the senses of a word whose row an earlier batch wrote as an addition", () => {
    // `'bank'` loses its quotes to normalising and lands on a key written two
    // batches ago; the row cannot be merged here, so the senses travel after it.
    const entries = [
      { headword: "bank", senses: ["brzeg"] },
      { headword: "go", senses: ["iść"] },
      { headword: "walk", senses: ["chodzić"] },
      { headword: "'bank'", senses: ["instytucja", "brzeg"] },
    ];
    const batches = [...rowBatches("d1", { entries: positioned(entries), aliases: [] }, { batchSize: 2 })];

    assert.equal(batches.length, 2);
    assert.deepEqual(batches[1]?.rows.map((row) => row.key), ["walk"]);
    assert.deepEqual(batches[1]?.additions, [{ dictId: "d1", key: "bank", senses: ["instytucja", "brzeg"] }]);
  });

  it("makes the same rows whatever the batch size, additions folded in", () => {
    const entries = [
      { headword: "Bank", senses: ["instytucja"] },
      { headword: "go", senses: ["iść"] },
      { headword: "bank", senses: ["brzeg", "instytucja"] },
      { headword: "went", senses: ["poszedł"] },
      { headword: "'go'", senses: ["jechać"] },
      { headword: "walk", senses: ["chodzić"] },
      { headword: "\"bank\"", senses: ["ławka"] },
      ...Array.from({ length: 12 }, (_, at) => ({ headword: "bank", senses: [`znaczenie ${at}`] })),
    ];
    const aliases = [
      { headword: "gone", target: 1 },
      { headword: "went", target: 1 },
      { headword: "walked", target: 5 },
      { headword: "walked", target: 1 },
    ];

    const whole = stored("d1", entries, aliases, { batchSize: 1000 });
    const pieces = stored("d1", entries, aliases, { batchSize: 2 });
    const ones = stored("d1", entries, aliases, { batchSize: 1 });

    assert.equal(whole.batches, 1);
    assert.ok(pieces.batches > 1);
    for (const split of [pieces, ones]) {
      assert.deepEqual(split.rows, whole.rows);
      assert.equal(split.entryCount, whole.entryCount);
      assert.equal(split.aliasCount, whole.aliasCount);
      // What the additions added is exactly what the one-batch run had in its
      // rows from the start.
      assert.ok(split.appended > 0);
      assert.equal(split.bytes + split.appended, whole.bytes);
    }
    assert.equal(at(whole.rows, "bank")?.senses.length, LIMITS.senses);
    assert.deepEqual(at(whole.rows, "go")?.senses, ["iść", "jechać"]);
    assert.equal(at(whole.rows, "walked")?.aliasOf, "walk");
  });
});

/**
 * `entriesOf` with `readFrom`, over entries already in memory: the ones before
 * the boundary come out with their headword only, as the importer would hand
 * them to a resumed run.
 *
 * @param {import("../src/lib/dict/import.js").Entry[]} entries
 * @param {number} readFrom
 * @returns {import("../src/lib/dict/import.js").Entry[]}
 */
function readFrom(entries, readFrom) {
  return entries.map((entry) => (entry.position < readFrom ? { ...entry, senses: [] } : entry));
}

describe("rowBatches, resumed", () => {
  // A dictionary with every shape the resume has to get right: homographs in
  // one batch and across batches, an unreadable entry, a punctuation-only
  // headword, a gap in the positions, synonyms that shadow, point at nothing,
  // point at an unreadable entry, repeat a spelling, and one plain one.
  const entries = [
    { position: 0, headword: "Bank", senses: ["instytucja"] },
    { position: 1, headword: "go", senses: ["iść"] },
    { position: 2, headword: "bank", senses: ["brzeg", "instytucja"] },
    { position: 3, headword: "broken", senses: [] },
    { position: 4, headword: "---", senses: ["nic"] },
    { position: 6, headword: "went", senses: ["poszedł"] },
    { position: 7, headword: "'go'", senses: ["jechać"] },
    { position: 8, headword: "walk", senses: ["chodzić"] },
    { position: 9, headword: "\"bank\"", senses: ["ławka"] },
    { position: 10, headword: "run", senses: ["biec"] },
    { position: 11, headword: "Run", senses: ["prowadzić"] },
  ];
  const aliases = [
    { headword: "gone", target: 1 },
    { headword: "went", target: 1 },
    { headword: "walked", target: 8 },
    { headword: "walked", target: 1 },
    { headword: "broke", target: 3 },
    { headword: "ran", target: 10 },
    { headword: "Ran", target: 11 },
    { headword: "runs", target: 99 },
  ];

  /** The uninterrupted run, and every batch of it with the progress it carried. */
  const whole = stored("d1", entries, aliases, { batchSize: 1000 });
  const batches = [...rowBatches("d1", { entries, aliases }, { batchSize: 2 })];

  it("marks where each batch leaves the import", () => {
    const marks = batches.map((batch) => [batch.progress.phase, batch.progress.next]);
    // Two rows a batch: `Bank` and `go` fill the first, so the next one has
    // to start reading at position 2. The last batch filled up at the sixth
    // synonym; the two after it made no row, so nothing was written after
    // them and the mark stays at six - a resumed run looks at them again.
    assert.deepEqual(marks[0], ["entries", 2]);
    assert.deepEqual(marks[marks.length - 1], ["aliases", 6]);
    assert.deepEqual(batches[batches.length - 1]?.progress.skipped, [3]);
    assert.equal(batches[batches.length - 1]?.progress.done, entries.length + 6);
  });

  it("ends in the same rows from every point it could have stopped at", () => {
    for (let k = 0; k < batches.length; k += 1) {
      // What the database holds after batches 0..k landed, and nothing more.
      /** @type {Map<string, DictionaryRow>} */
      const table = new Map();
      let appended = 0;
      for (const batch of batches.slice(0, k + 1)) {
        // Copied: the additions below write into the row, and the batches
        // are read again for every k.
        for (const row of batch.rows) table.set(row.key, { ...row, senses: [...row.senses] });
        for (const addition of batch.additions) {
          const row = table.get(addition.key);
          assert.ok(row !== undefined);
          for (const sense of mergeSenses(row.senses, addition.senses)) appended += utf8Length(sense);
        }
      }

      const resume = /** @type {import("../src/lib/dict/rows.js").RowProgress} */ (batches[k]?.progress);
      const resumed = rowBatches(
        "d1",
        { entries: readFrom(entries, entriesReadFrom(resume)), aliases },
        { batchSize: 2, resume },
      );
      let step = resumed.next();
      while (!step.done) {
        for (const row of step.value.rows) table.set(row.key, row);
        for (const addition of step.value.additions) {
          const row = table.get(addition.key);
          assert.ok(row !== undefined, `resumed at ${k}: an addition for ${addition.key} has no row`);
          for (const sense of mergeSenses(row.senses, addition.senses)) appended += utf8Length(sense);
        }
        step = resumed.next();
      }

      const rows = [...table.values()].sort((a, b) => a.key.localeCompare(b.key));
      const expected = [...whole.rows].sort((a, b) => a.key.localeCompare(b.key));
      assert.deepEqual(rows, expected, `resumed after batch ${k}`);
      assert.equal(step.value.entryCount, whole.entryCount, `entryCount after ${k}`);
      assert.equal(step.value.aliasCount, whole.aliasCount, `aliasCount after ${k}`);
      assert.equal(step.value.skipped, whole.skipped, `skipped after ${k}`);
      assert.equal(step.value.bytes + appended, whole.bytes, `bytes after ${k}`);
    }
  });

  it("reads nothing twice: a resumed run never asks for data before the boundary", () => {
    const resume = /** @type {import("../src/lib/dict/rows.js").RowProgress} */ (batches[1]?.progress);
    assert.equal(resume.phase, "entries");
    // Entries before `next` arrive with no senses and must not count as
    // skipped, nor turn into rows - their rows are already in.
    const resumed = [...rowBatches("d1", { entries: readFrom(entries, resume.next), aliases }, { batchSize: 1000, resume })];
    const keys = resumed.flatMap((batch) => batch.rows.map((row) => row.key));
    assert.ok(!keys.includes("go"));
    assert.ok(!keys.includes("walk"));
    assert.ok(keys.includes("run"));
    // The word before the boundary had no data to give, and was not skipped for it.
    assert.equal(resumed[resumed.length - 1]?.progress.skipped.length, 1);
  });

  it("walks the whole index for keys alone once the synonyms are under way", () => {
    const last = /** @type {import("../src/lib/dict/rows.js").RowProgress} */ (batches[batches.length - 1]?.progress);
    assert.equal(last.phase, "aliases");
    assert.equal(entriesReadFrom(last), Number.POSITIVE_INFINITY);
    assert.equal(entriesReadFrom(null), 0);
  });
});

describe("mergeSenses", () => {
  it("adds what is new, in order, and says what it added", () => {
    const senses = ["a", "b"];
    assert.deepEqual(mergeSenses(senses, ["b", "c", "a", "d"]), ["c", "d"]);
    assert.deepEqual(senses, ["a", "b", "c", "d"]);
  });

  it("stops at the limit a bubble can show", () => {
    const senses = Array.from({ length: LIMITS.senses - 1 }, (_, at) => `s${at}`);
    assert.deepEqual(mergeSenses(senses, ["x", "y"]), ["x"]);
    assert.equal(senses.length, LIMITS.senses);
  });
});
