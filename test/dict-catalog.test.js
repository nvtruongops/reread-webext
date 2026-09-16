import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { catalogDictionaries, catalogSource, parseCatalog } from "../src/lib/dict/catalog.js";

/**
 * @param {Partial<Record<string, unknown>>} [overrides]
 */
function entry(overrides = {}) {
  return {
    from: "en",
    to: "pl",
    url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-pl.zip",
    ...overrides,
  };
}

describe("parseCatalog", () => {
  it("takes a well-formed entry", () => {
    const { dictionaries, problems } = parseCatalog({ dictionaries: [entry()] });
    assert.deepEqual(problems, []);
    assert.deepEqual(dictionaries, [entry()]);
  });

  it("sorts by the pair, whatever order the file has", () => {
    const { dictionaries } = parseCatalog({
      dictionaries: [entry({ from: "pl", to: "en" }), entry(), entry({ to: "de" })],
    });
    assert.deepEqual(
      dictionaries.map((one) => `${one.from}-${one.to}`),
      ["en-de", "en-pl", "pl-en"],
    );
  });

  it("drops the entry that is wrong and keeps the ones that are not", () => {
    const cases = /** @type {[string, unknown][]} */ ([
      ["an address that is not https", entry({ url: "http://download.wikdict.com/x.zip" })],
      ["a code that is not a language", entry({ from: "english" })],
      ["a code in upper case", entry({ from: "EN" })],
      ["a dictionary from a language to itself", entry({ to: "en" })],
      ["a shape that is not an object", 42],
    ]);

    for (const [what, broken] of cases) {
      const { dictionaries, problems } = parseCatalog({ dictionaries: [broken, entry({ from: "de" })] });
      assert.equal(dictionaries.length, 1, `should have dropped ${what}`);
      assert.equal(problems.length, 1, `should have reported ${what}`);
    }
  });

  it("keeps the first of two entries for the same pair and says so", () => {
    const { dictionaries, problems } = parseCatalog({ dictionaries: [entry(), entry()] });
    assert.equal(dictionaries.length, 1);
    assert.match(problems[0] ?? "", /twice/);
  });

  it("survives a file that is not a catalogue at all", () => {
    for (const rubbish of [null, 42, "dictionaries", {}, { dictionaries: {} }]) {
      const { dictionaries, problems } = parseCatalog(rubbish);
      assert.deepEqual(dictionaries, []);
      assert.equal(problems.length, 1);
    }
  });
});

describe("the catalogue that ships in the package", () => {
  it("parses with nothing dropped", async () => {
    const raw = JSON.parse(await readFile(new URL("../src/lib/dict/catalog.json", import.meta.url), "utf8"));
    const { dictionaries, problems } = parseCatalog(raw);
    assert.deepEqual(problems, [], "the shipped catalogue has entries this build would ignore");
    assert.ok(dictionaries.length > 0);
  });

  it("points every download at the one place WikDict publishes", () => {
    for (const one of catalogDictionaries()) {
      assert.match(
        one.url,
        /^https:\/\/download\.wikdict\.com\/dictionaries\/stardict\/wikdict-[a-z-]+\.zip$/,
        `${one.from}-${one.to} is downloaded from somewhere else`,
      );
    }
  });

  it("has the pairs the default configuration would look for", () => {
    const pairs = new Set(catalogDictionaries().map((one) => `${one.from}-${one.to}`));
    assert.ok(pairs.has("en-pl"), "no en-pl dictionary listed");
    assert.ok(pairs.has("pl-en"), "no pl-en dictionary listed");
  });

  it("says where its addresses came from", () => {
    const { source, checkedAt } = catalogSource();
    assert.match(source, /^https:\/\//);
    assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  });
});
