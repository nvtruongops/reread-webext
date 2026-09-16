import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  findRegistryModel,
  modelRows,
  parseRegistry,
  registryModels,
  registrySource,
} from "../src/lib/models/registry.js";

const SUM = "a".repeat(64);

/**
 * @param {Partial<Record<string, unknown>>} [overrides]
 */
function file(overrides = {}) {
  return { role: "model", url: "https://example.test/model.bin.gz", downloadBytes: 10, bytes: 20, sha256: SUM, ...overrides };
}

/**
 * @param {Partial<Record<string, unknown>>} [overrides]
 */
function model(overrides = {}) {
  return {
    pair: "enpl",
    from: "en",
    to: "pl",
    files: [
      file(),
      file({ role: "shortlist", url: "https://example.test/lex.bin.gz", downloadBytes: 3, bytes: 4 }),
      file({ role: "vocab", url: "https://example.test/vocab.spm.gz", downloadBytes: 1, bytes: 2 }),
    ],
    ...overrides,
  };
}

describe("parseRegistry", () => {
  it("takes a well-formed entry and keeps its files in load order", () => {
    const { models, problems } = parseRegistry({ models: [model()] });
    assert.deepEqual(problems, []);
    assert.equal(models.length, 1);
    assert.deepEqual(
      models[0]?.files.map((entry) => entry.role),
      ["model", "shortlist", "vocab"],
    );
  });

  it("adds the sizes up itself, so a stale total cannot understate a download", () => {
    const { models } = parseRegistry({ models: [{ ...model(), downloadBytes: 1, bytes: 1 }] });
    assert.equal(models[0]?.downloadBytes, 14);
    assert.equal(models[0]?.bytes, 26);
  });

  it("sorts by pair, whatever order the file lists them in", () => {
    const { models } = parseRegistry({
      models: [model({ pair: "plen", from: "pl", to: "en" }), model()],
    });
    assert.deepEqual(
      models.map((entry) => entry.pair),
      ["enpl", "plen"],
    );
  });

  it("takes the codes Mozilla's index really uses, not only two-letter ones", () => {
    const { models, problems } = parseRegistry({
      models: [
        model({ pair: "hbsen", from: "hbs", to: "en" }),
        model({ pair: "zh_hanten", from: "zh_hant", to: "en" }),
        model({ pair: "enzh_hant", from: "en", to: "zh_hant" }),
      ],
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(
      models.map((entry) => entry.pair),
      ["enzh_hant", "hbsen", "zh_hanten"],
    );
  });

  it("takes both vocabularies when a pair ships one per side", () => {
    const two = model();
    two.files.push(file({ role: "vocab", url: "https://example.test/vocab.2.spm.gz", downloadBytes: 1, bytes: 2 }));
    const { models, problems } = parseRegistry({ models: [two] });
    assert.deepEqual(problems, []);
    assert.equal(models[0]?.files.filter((entry) => entry.role === "vocab").length, 2);
  });

  it("drops the entry that is wrong and keeps the one that is not", () => {
    const { models, problems } = parseRegistry({
      models: [model({ pair: "enfr" }), model({ pair: "plen", from: "pl", to: "en" })],
    });
    assert.deepEqual(
      models.map((entry) => entry.pair),
      ["plen"],
    );
    assert.equal(problems.length, 1);
  });

  it("refuses the things that would make a download unverifiable", () => {
    const cases = [
      ["an address that is not https", model({ files: [file({ url: "http://example.test/model.bin" }), ...model().files.slice(1)] })],
      ["a sum that is not a sha256", model({ files: [file({ sha256: "nope" }), ...model().files.slice(1)] })],
      ["a size of zero", model({ files: [file({ bytes: 0 }), ...model().files.slice(1)] })],
      ["a role nothing loads", model({ files: [file({ role: "readme" }), ...model().files.slice(1)] })],
      ["no shortlist", model({ files: [file(), file({ role: "vocab" })] })],
      ["no vocabulary", model({ files: [file(), file({ role: "shortlist" })] })],
      ["two model files", model({ files: [...model().files, file({ url: "https://example.test/other.bin" })] })],
      ["a pair that contradicts its languages", model({ pair: "enfr" })],
      ["a language of one letter", model({ pair: "epl", from: "e" })],
      ["a language that is a sentence", model({ pair: "not a codepl", from: "not a code" })],
      ["a language in upper case", model({ pair: "ENpl", from: "EN" })],
      ["no files at all", model({ files: [] })],
    ];

    for (const [what, broken] of cases) {
      const { models, problems } = parseRegistry({ models: [broken] });
      assert.equal(models.length, 0, `should have refused ${what}`);
      assert.equal(problems.length, 1, `should have reported ${what}`);
    }
  });

  it("keeps the first of two entries for the same pair and says so", () => {
    const { models, problems } = parseRegistry({ models: [model(), model()] });
    assert.equal(models.length, 1);
    assert.match(problems[0] ?? "", /twice/);
  });

  it("survives a file that is not a registry at all", () => {
    for (const rubbish of [null, 42, "models", {}, { models: {} }]) {
      const { models, problems } = parseRegistry(rubbish);
      assert.deepEqual(models, []);
      assert.equal(problems.length, 1);
    }
  });
});

describe("modelRows", () => {
  const { models: available } = parseRegistry({
    models: [model(), model({ pair: "plen", from: "pl", to: "en" })],
  });

  /**
   * @param {string} pair
   * @returns {import("../src/lib/models/store.js").ModelMeta}
   */
  const meta = (pair) => ({
    pair,
    from: pair.slice(0, 2),
    to: pair.slice(2),
    bytes: 100,
    addedAt: 1,
  });

  it("shows every downloadable pair, even with nothing installed", () => {
    const rows = modelRows([], available);
    assert.deepEqual(
      rows.map((row) => row.pair),
      ["enpl", "plen"],
    );
    assert.ok(rows.every((row) => row.installed === null && row.available !== null));
  });

  it("marks the ones that are here without listing them twice", () => {
    const rows = modelRows([meta("enpl")], available);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.installed?.pair, "enpl");
    assert.ok(rows[0]?.available, "an installed model stopped being downloadable");
    assert.equal(rows[1]?.installed, null);
  });

  it("keeps a model added from files, which no registry knows about", () => {
    const rows = modelRows([meta("defr")], available);
    assert.deepEqual(
      rows.map((row) => row.pair),
      ["defr", "enpl", "plen"],
    );
    assert.equal(rows[0]?.available, null);
    assert.equal(rows[0]?.from, "de");
    assert.equal(rows[0]?.to, "fr");
  });

  it("lists nothing at all rather than inventing a row", () => {
    assert.deepEqual(modelRows([], []), []);
  });
});

describe("the registry that ships in the package", () => {
  it("parses with nothing dropped", async () => {
    const raw = JSON.parse(await readFile(new URL("../src/lib/models/registry.json", import.meta.url), "utf8"));
    const { models, problems } = parseRegistry(raw);
    assert.deepEqual(problems, [], "the shipped registry has entries this build would ignore");
    assert.ok(models.length > 0);
  });

  it("has the pair the extension is configured for by default", () => {
    const enpl = findRegistryModel("en", "pl");
    assert.ok(enpl, "no en to pl model listed");
    assert.equal(enpl.pair, "enpl");
    // Large enough to be a real model rather than a placeholder somebody left
    // behind, and small enough that a mistaken unit is caught here.
    assert.ok(enpl.downloadBytes > 1_000_000 && enpl.downloadBytes < 200_000_000);
  });

  it("answers null for a pair nobody published", () => {
    assert.equal(findRegistryModel("en", "xx"), null);
  });

  it("points every download at the one place these models are published", () => {
    for (const entry of registryModels()) {
      for (const { url } of entry.files) {
        assert.match(url, /^https:\/\/storage\.googleapis\.com\//, `${entry.pair} is downloaded from somewhere else`);
      }
    }
  });

  it("says where its addresses came from", () => {
    const { source, checkedAt } = registrySource();
    assert.match(source, /^https:\/\//);
    assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  });
});
