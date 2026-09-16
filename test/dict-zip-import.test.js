import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dictionaryFromZip, isDictionaryFile } from "../src/lib/dict/import.js";

/**
 * @param {string} name
 * @param {string} [content]
 * @returns {import("../src/lib/dict/zip.js").ZipEntry}
 */
function file(name, content = name) {
  return { name, bytes: new TextEncoder().encode(content) };
}

describe("dictionaryFromZip", () => {
  it("sorts a WikDict archive into its roles, ignoring archive clutter", () => {
    const result = dictionaryFromZip([
      file("wikdict-en-pl/wikdict-en-pl.ifo", "ifo bytes"),
      file("wikdict-en-pl/wikdict-en-pl.idx", "idx bytes"),
      file("wikdict-en-pl/wikdict-en-pl.dict.dz", "dict bytes"),
      file("wikdict-en-pl/wikdict-en-pl.syn", "syn bytes"),
      file("wikdict-en-pl/README.txt", "clutter"),
      file("__MACOSX/wikdict-en-pl/._wikdict-en-pl.ifo", "resource fork"),
      file(".DS_Store", "more clutter"),
    ]);

    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.base, "wikdict-en-pl");
    assert.equal(new TextDecoder().decode(/** @type {Uint8Array} */ (result.value.files.ifo)), "ifo bytes");
    assert.equal(new TextDecoder().decode(/** @type {Uint8Array} */ (result.value.files.dict)), "dict bytes");
    assert.ok(result.value.files.syn !== undefined);
  });

  it("works without the synonym file, which is optional in the format", () => {
    const result = dictionaryFromZip([file("a.ifo"), file("a.idx"), file("a.dict")]);
    assert.ok(result.ok);
    assert.equal(result.value.files.syn, undefined);
  });

  it("misses nothing quietly - each absent role has its name", () => {
    const missing = dictionaryFromZip([file("a.ifo"), file("a.idx")]);
    assert.ok(!missing.ok);
    assert.equal(missing.problem, "missing_dict");

    const empty = dictionaryFromZip([]);
    assert.ok(!empty.ok);
    assert.equal(empty.problem, "empty");
  });

  it("refuses an archive holding two dictionaries", () => {
    const result = dictionaryFromZip([
      file("a.ifo"), file("a.idx"), file("a.dict"),
      file("b.ifo"), file("b.idx"), file("b.dict"),
    ]);
    assert.ok(!result.ok);
    assert.equal(result.problem, "mixed");
  });

  it("does not let clutter turn into a second dictionary", () => {
    // The resource fork copies the real file's name - counting it would read
    // as a second base and refuse an archive somebody had every right to open.
    const result = dictionaryFromZip([
      file("a.ifo"), file("a.idx"), file("a.dict"),
      file("__MACOSX/._a.ifo"),
    ]);
    assert.ok(result.ok);
  });
});

describe("isDictionaryFile", () => {
  it("knows the four kinds of file, compressed or not, and nothing else", () => {
    for (const name of ["a.ifo", "dir/a.idx", "a.idx.gz", "a.dict", "wikdict-en-pl/a.dict.dz", "a.syn", "A.IFO"]) {
      assert.ok(isDictionaryFile(name), name);
    }
    for (const name of ["res/1.gif", "a.ifo.txt", "readme", "dir/", "", "a.dict.zip", "a.idx.oft"]) {
      assert.ok(!isDictionaryFile(name), name);
    }
  });

  it("leaves a Mac's clutter where it is", () => {
    for (const name of ["__MACOSX/a/._a.ifo", "__MACOSX/a.ifo", "a/.a.ifo", ".DS_Store"]) {
      assert.ok(!isDictionaryFile(name), name);
    }
  });
});
