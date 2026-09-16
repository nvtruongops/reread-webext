import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FORMS_REVISION, formsIn, formsStamp } from "../src/lib/dict/forms.js";

/**
 * The dictionary's word on which forms are really forms (D208): the rules
 * in `deinflect.js` propose, and `formsIn` keeps what one dictionary vouches
 * for - by an alias row (the .syn file's own line, D30) or, for a form the
 * dictionary has as a word of its own, by the longest base the dictionary
 * knows. The database half (`readForms` in `store.js`) runs this over the
 * installed dictionaries and stays with the smoke tests; these are the
 * rules it stands on, run over a dictionary made of a table.
 */

/**
 * A dictionary as a table: a headword maps to nothing, an alias to the key
 * it points at. Counts the reads, because the reads are the cost the cache
 * exists for.
 *
 * @param {Record<string, string | null>} rows
 * @returns {{ row: import("../src/lib/dict/forms.js").RowReader, reads: () => number }}
 */
function dictionary(rows) {
  let reads = 0;
  return {
    row: async (key) => {
      reads += 1;
      if (!Object.hasOwn(rows, key)) return undefined;
      const aliasOf = rows[key];
      return aliasOf === null || aliasOf === undefined ? {} : { aliasOf };
    },
    reads: () => reads,
  };
}

/**
 * Something like WikDict en-pl once imported: the .syn's forms as aliases,
 * except where the form is a word of its own (`reading`, `used`, `building`),
 * which an alias never shadows (`rows.js`).
 */
const WIKDICT = dictionary({
  read: null,
  reads: "read",
  reading: null,
  readings: "reading",
  reader: null,
  use: null,
  uses: "use",
  used: null,
  using: "use",
  user: null,
  us: null,
  car: null,
  cars: "car",
  care: null,
  cared: "care",
  cares: "care",
  caring: "care",
  carer: null,
  go: null,
  goes: "go",
  going: null,
  went: "go",
  gone: "go",
  big: null,
  bigger: "big",
  biggest: "big",
  love: null,
  loves: "love",
  loved: "love",
  loving: "love",
  lover: null,
  new: null,
  news: null,
  newer: "new",
  build: null,
  builds: "build",
  building: null,
  buildings: "building",
  hat: null,
  hats: "hat",
  hate: null,
  hated: null,
  hates: "hate",
  hating: "hate",
  fly: null,
  flies: "fly",
  flying: null,
  cool: null,
  cooler: null,
  coolest: "cool",
});

describe("formsIn", () => {
  it("keeps the forms the dictionary lists as aliases of the word", async () => {
    assert.deepEqual(await formsIn("car", WIKDICT.row), ["cars"]);
    assert.deepEqual(await formsIn("love", WIKDICT.row), ["loves", "loved", "loving"]);
  });

  it("keeps a form the dictionary has as a word of its own when the word is its longest known base", async () => {
    // `reading` is a noun with an entry, so no alias points it at `read` -
    // the base `read` is known and `reade` is not, which makes it `read`'s.
    assert.deepEqual(await formsIn("read", WIKDICT.row), ["reads", "reading"]);
    assert.deepEqual(await formsIn("build", WIKDICT.row), ["builds", "building"]);
    assert.deepEqual(await formsIn("go", WIKDICT.row), []);
  });

  it("refuses a form the dictionary attributes to another word", async () => {
    // `cared`, `cares` and `caring` are aliases of `care`: not `car`'s.
    assert.deepEqual(await formsIn("car", WIKDICT.row), ["cars"]);
    // `used` is a word of its own whose bases are `us` and `use`; the longer
    // one wins, so a saved `us` gets nothing - the proposal's own example.
    assert.deepEqual(await formsIn("us", WIKDICT.row), []);
    assert.deepEqual(await formsIn("use", WIKDICT.row), ["uses", "used", "using"]);
    // `hated` strips to `hat` and `hate`, both known: `hate`'s, by length.
    assert.deepEqual(await formsIn("hat", WIKDICT.row), ["hats"]);
    assert.deepEqual(await formsIn("hate", WIKDICT.row), ["hates", "hated", "hating"]);
  });

  it("takes a grade only on the dictionary's word - a word of its own is not one", async () => {
    // `bigger` is an alias of `big`; `lover`, `reader` and `user` are words
    // of their own and would pass the quiet test on their ending alone.
    assert.deepEqual(await formsIn("big", WIKDICT.row), ["bigger", "biggest"]);
    assert.ok(!(await formsIn("love", WIKDICT.row)).includes("lover"));
    assert.ok(!(await formsIn("read", WIKDICT.row)).includes("reader"));
    assert.ok(!(await formsIn("use", WIKDICT.row)).includes("user"));
    // The comparative that is also a noun is lost with it - the accepted cost.
    assert.deepEqual(await formsIn("cool", WIKDICT.row), ["coolest"]);
  });

  it("follows a saved alias to its entry, and takes the entry as a form", async () => {
    // `went` is an alias of `go`: its forms are `go`'s, and `go` is one of them -
    // the only one, because `go` is too short to have forms proposed of its
    // own (`inflectedForms`); `flies` reaches `fly` and `flying` both.
    assert.deepEqual(await formsIn("went", WIKDICT.row), ["go"]);
    assert.deepEqual(await formsIn("flies", WIKDICT.row), ["fly", "flying"]);
  });

  it("has nothing to say about a word the dictionary does not know", async () => {
    assert.deepEqual(await formsIn("zorble", WIKDICT.row), []);
  });

  it("never offers the word itself", async () => {
    for (const word of ["read", "reading", "went", "use"]) {
      assert.ok(!(await formsIn(word, WIKDICT.row)).includes(word), word);
    }
  });

  it("cannot tell a word that merely looks like a form from a form - the known residue", async () => {
    // `news` is a word of its own whose only known base is `new`: kept, and
    // wrongly. The bubble names the saved word over it, and the switch is off
    // by default; the rows hold nothing that would tell it from `builds`.
    assert.deepEqual(await formsIn("new", WIKDICT.row), ["news", "newer"]);
  });

  it("refuses a form two equally long bases claim for different words", async () => {
    const tied = dictionary({ pan: null, pane: null, paned: null, pin: null, pine: null, pined: null });
    // `paned` strips to `pan` and `pane`: the longer wins - `pane`'s.
    assert.deepEqual(await formsIn("pan", tied.row), []);
    // A dictionary where two bases of one length point at different entries
    // answers nothing for either.
    const split = dictionary({ ab: null, abs: null, ads: null, ad: "ab" });
    assert.deepEqual(await formsIn("abs", split.row), []);
  });

  it("costs a point read per candidate and no more than a few per word", async () => {
    const counted = dictionary({ walk: null, walks: "walk", walked: "walk", walking: "walk" });
    await formsIn("walk", counted.row);
    // The word, its candidates - and nothing over a base for an alias, which
    // needs no quiet test.
    assert.ok(counted.reads() <= 8, `${counted.reads()} reads for one word`);
  });
});

describe("formsStamp", () => {
  const books = [
    { id: "b", langFrom: "en", ready: true, entryCount: 10, aliasCount: 5 },
    { id: "a", langFrom: "en", ready: true, entryCount: 20, aliasCount: 0 },
    { id: "c", langFrom: "pl", ready: true, entryCount: 30, aliasCount: 1 },
    { id: "d", langFrom: "en", ready: false, entryCount: 40, aliasCount: 2 },
  ];

  it("names the rules' revision, the language and every ready dictionary of it, in one order", () => {
    assert.equal(formsStamp("en", books), `${FORMS_REVISION}|en|a:20:0|b:10:5`);
    assert.equal(formsStamp("pl", books), `${FORMS_REVISION}|pl|c:30:1`);
    assert.equal(formsStamp("de", books), `${FORMS_REVISION}|de`);
  });

  it("changes when a dictionary comes, goes, finishes or is imported again", () => {
    const before = formsStamp("en", books);
    assert.notEqual(formsStamp("en", books.filter((book) => book.id !== "a")), before);
    assert.notEqual(formsStamp("en", books.map((book) => (book.id === "d" ? { ...book, ready: true } : book))), before);
    assert.notEqual(formsStamp("en", books.map((book) => (book.id === "a" ? { ...book, entryCount: 21 } : book))), before);
    // The order of the shelf is not the stamp's business: the forms are a
    // union over the dictionaries.
    assert.equal(formsStamp("en", [...books].reverse()), before);
  });
});
