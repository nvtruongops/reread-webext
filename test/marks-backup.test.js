import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asMarksBackup,
  keptTitles,
  marksBackupOf,
  marksInBackup,
  readMarksBackup,
  rebuildMarksBackup,
  restoreMarks,
} from "../src/lib/store/marks-backup.js";

/** @typedef {import("../src/lib/reader/marks.js").Mark} Mark */
/** @typedef {import("../src/lib/store/marks-backup.js").MarksBackupDeps} MarksBackupDeps */
/** @typedef {import("../src/lib/store/marks-backup.js").DocTitle} DocTitle */

/**
 * The copy of the highlights, held to the vocabulary copy's rules and to its
 * own: rebuilt whole with the documents' titles beside the rows, restored
 * only into a library with nothing in it, and readable for the titles of
 * documents that are gone. No browser runs in CI - the store and the storage
 * are stand-ins that remember what was asked of them.
 */

/**
 * @param {number} block
 * @param {Partial<Mark>} [over]
 * @returns {Mark}
 */
function mark(block, over = {}) {
  return {
    segmentIndex: 0,
    start: { block, offset: 0 },
    end: { block, offset: 5 },
    color: "yellow",
    createdAt: 1000 + block,
    text: `quote ${block}`,
    ...over,
  };
}

/**
 * @param {{ marks?: Map<string, Mark[]>, titles?: Map<string, DocTitle>, empty?: boolean, snapshotFails?: boolean, stored?: unknown }} [script]
 */
function standIn(script = {}) {
  /** @type {string[]} */
  const asked = [];
  /** @type {import("../src/lib/store/marks-backup.js").MarksBackup | undefined} */
  let written;
  /** @type {import("../src/lib/store/marks-backup.js").BackupDoc[]} */
  let put = [];
  /** @type {MarksBackupDeps} */
  const deps = {
    snapshot: async () => {
      asked.push("snapshot");
      if (script.snapshotFails === true) throw new Error("the store would not open");
      return { marks: script.marks ?? new Map(), titles: script.titles ?? new Map() };
    },
    empty: async () => {
      asked.push("empty");
      return script.empty ?? false;
    },
    putRows: async (docs) => {
      asked.push(`putRows ${docs.length}`);
      put = docs;
    },
    read: async () => {
      asked.push("read");
      return script.stored;
    },
    write: async (backup) => {
      asked.push("write");
      written = backup;
    },
    now: () => 42,
  };
  return { deps, asked, written: () => written, put: () => put };
}

describe("the copy of the highlights", () => {
  it("carries every row with its document's kind and title, sorted by document", () => {
    const marks = new Map([
      ["https://b.example/", [mark(3), mark(1)]],
      ["book-1", [mark(0, { note: "mine" })]],
      ["https://gone.example/", [mark(2)]],
      ["https://empty.example/", []],
    ]);
    /** @type {Map<string, DocTitle>} */
    const titles = new Map([
      ["https://b.example/", { kind: "article", title: "B" }],
      ["book-1", { kind: "book", title: "A book" }],
    ]);
    const backup = marksBackupOf(marks, titles, 42);
    assert.deepEqual(
      backup.docs.map((doc) => [doc.docId, doc.kind, doc.title, doc.marks.map((one) => one.start.block)]),
      [
        ["book-1", "book", "A book", [0]],
        ["https://b.example/", "article", "B", [1, 3]],
        ["https://gone.example/", "article", "https://gone.example/", [2]],
      ],
      "an empty row is left out, an unnamed one keeps its key as its title, and quotes read in order",
    );
    assert.equal(marksInBackup(backup), 4);
    assert.deepEqual(asMarksBackup(JSON.parse(JSON.stringify(backup))), backup, "a trip through JSON loses nothing");
  });

  it("is no copy at all in another shape, and drops the rows that make no sense", () => {
    assert.equal(asMarksBackup(undefined), null);
    assert.equal(asMarksBackup({ version: 2, writtenAt: 1, docs: [] }), null);
    assert.equal(asMarksBackup({ version: 1, writtenAt: 1 }), null);
    const narrowed = asMarksBackup({
      version: 1,
      writtenAt: 1,
      docs: [
        { docId: "https://a.example/", kind: "article", title: "A", marks: [mark(1)] },
        { docId: "", kind: "article", title: "no key", marks: [mark(1)] },
        { docId: "x", kind: "page", title: "wrong kind", marks: [mark(1)] },
        { docId: "y", kind: "book", title: "no readable mark", marks: [{ nonsense: true }] },
        { docId: "z", kind: "article", title: "", marks: [mark(2)] },
      ],
    });
    assert.deepEqual(
      narrowed?.docs.map((doc) => [doc.docId, doc.title]),
      [
        ["https://a.example/", "A"],
        ["z", "z"],
      ],
    );
  });

  it("restores only into an empty library, and asks the store before it reads the copy", async () => {
    const stored = marksBackupOf(new Map([["https://a.example/", [mark(1)]]]), new Map(), 1);
    const wiped = standIn({ empty: true, stored });
    assert.equal(await restoreMarks(wiped.deps), 1);
    assert.deepEqual(wiped.asked, ["empty", "read", "putRows 1"]);
    assert.deepEqual(wiped.put().map((doc) => doc.docId), ["https://a.example/"]);

    const lived = standIn({ empty: false, stored });
    assert.equal(await restoreMarks(lived.deps), 0);
    assert.deepEqual(lived.asked, ["empty"], "a library with anything in it must not even cost the copy's read");

    assert.equal(await restoreMarks(standIn({ empty: true, stored: undefined }).deps), 0);
    assert.equal(await restoreMarks(standIn({ empty: true, stored: marksBackupOf(new Map(), new Map(), 1) }).deps), 0);
  });

  it("is rebuilt whole from the store, and not at all from a store that would not answer", async () => {
    /** @type {Map<string, Mark[]>} */
    const marks = new Map([["https://a.example/", [mark(1), mark(2)]]]);
    /** @type {Map<string, DocTitle>} */
    const titles = new Map([["https://a.example/", { kind: "article", title: "A" }]]);
    const fine = standIn({ marks, titles });
    assert.equal(await rebuildMarksBackup(fine.deps), 2);
    assert.deepEqual(fine.written(), marksBackupOf(marks, titles, 42));

    const broken = standIn({ marks, titles, snapshotFails: true });
    await assert.rejects(() => rebuildMarksBackup(broken.deps));
    assert.equal(broken.written(), undefined, "a copy replaced by a guess");
  });

  it("names the documents that are gone, and reads as nothing when the storage will not answer", async () => {
    const backup = marksBackupOf(
      new Map([
        ["book-1", [mark(0)]],
        ["https://a.example/", [mark(1)]],
      ]),
      new Map([["book-1", { kind: "book", title: "A book" }]]),
      7,
    );
    assert.deepEqual(
      [...keptTitles(backup)],
      [
        ["book-1", { kind: "book", title: "A book" }],
        ["https://a.example/", { kind: "article", title: "https://a.example/" }],
      ],
    );
    assert.deepEqual([...keptTitles(null)], []);

    assert.deepEqual(await readMarksBackup({ read: async () => backup }), backup);
    assert.equal(await readMarksBackup({ read: async () => undefined }), null);
    assert.equal(
      await readMarksBackup({
        read: async () => {
          throw new Error("no storage");
        },
      }),
      null,
    );
  });
});
