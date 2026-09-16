import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyModelFiles,
  describeClassifyProblem,
  isGzip,
  parsePair,
} from "../src/lib/models/files.js";

const EN_PL = [
  "model.enpl.intgemm.alphas.bin",
  "lex.50.50.enpl.s2t.bin",
  "vocab.enpl.spm",
];

describe("isGzip", () => {
  it("recognises the two bytes gzip starts with", () => {
    assert.equal(isGzip(new Uint8Array([0x1f, 0x8b, 0x08, 0x00])), true);
  });

  it("says no to anything else, including an empty file", () => {
    assert.equal(isGzip(new Uint8Array([0x1f])), false);
    assert.equal(isGzip(new Uint8Array([])), false);
    assert.equal(isGzip(new Uint8Array([0x00, 0x1f, 0x8b])), false);
  });

  it("takes an ArrayBuffer as readily as a view", () => {
    assert.equal(isGzip(new Uint8Array([0x1f, 0x8b]).buffer), true);
  });
});

describe("parsePair", () => {
  it("finds the pair in each of the three file names", () => {
    for (const name of EN_PL) {
      assert.deepEqual(parsePair(name), { pair: "enpl", from: "en", to: "pl" });
    }
  });

  it("is not fooled by the numbers in a shortlist name", () => {
    assert.equal(parsePair("lex.50.50.plen.s2t.bin")?.pair, "plen");
  });

  it("sees through a .gz suffix", () => {
    assert.equal(parsePair("vocab.enpl.spm.gz")?.pair, "enpl");
  });

  it("answers null when nothing looks like a pair", () => {
    assert.equal(parsePair("model.bin"), null);
    assert.equal(parsePair("notes.txt"), null);
  });
});

describe("classifyModelFiles", () => {
  it("sorts a complete direction into its three roles", () => {
    const result = classifyModelFiles(EN_PL);
    assert.ok(result.ok);
    assert.equal(result.value.pair, "enpl");
    assert.equal(result.value.from, "en");
    assert.equal(result.value.to, "pl");
    assert.deepEqual(result.value.byRole.model, ["model.enpl.intgemm.alphas.bin"]);
    assert.deepEqual(result.value.byRole.shortlist, ["lex.50.50.enpl.s2t.bin"]);
    assert.deepEqual(result.value.byRole.vocab, ["vocab.enpl.spm"]);
  });

  it("accepts the files exactly as they are published, gzipped", () => {
    const result = classifyModelFiles(EN_PL.map((name) => `${name}.gz`));
    assert.ok(result.ok);
    assert.equal(result.value.pair, "enpl");
  });

  it("does not care what order they were picked in", () => {
    const result = classifyModelFiles([...EN_PL].reverse());
    assert.ok(result.ok);
    assert.deepEqual(result.value.byRole.model, ["model.enpl.intgemm.alphas.bin"]);
  });

  it("takes both vocabularies when a pair ships two", () => {
    const result = classifyModelFiles([...EN_PL, "vocab.enpl.spm.2"]);
    assert.ok(result.ok);
    assert.equal(result.value.byRole.vocab.length, 2);
  });

  it("refuses an empty selection", () => {
    const result = classifyModelFiles([]);
    assert.ok(!result.ok);
    assert.equal(result.problem, "empty");
  });

  it("names the file it did not recognise", () => {
    const result = classifyModelFiles([...EN_PL, "notes.txt"]);
    assert.ok(!result.ok);
    assert.equal(result.problem, "unknown_file");
    assert.equal(result.detail, "notes.txt");
  });

  it("refuses two directions at once, which would load as one", () => {
    const result = classifyModelFiles([...EN_PL, "model.plen.intgemm.alphas.bin"]);
    assert.ok(!result.ok);
    assert.equal(result.problem, "mixed_pairs");
    assert.equal(result.detail, "enpl, plen");
  });

  it("says which of the three is missing", () => {
    for (const [missing, problem] of [
      ["model.enpl.intgemm.alphas.bin", "missing_model"],
      ["lex.50.50.enpl.s2t.bin", "missing_shortlist"],
      ["vocab.enpl.spm", "missing_vocab"],
    ]) {
      const result = classifyModelFiles(EN_PL.filter((name) => name !== missing));
      assert.ok(!result.ok, `should have refused without ${missing}`);
      assert.equal(result.problem, problem);
    }
  });

  it("refuses a file whose name carries no pair", () => {
    const result = classifyModelFiles(["model.bin", "lex.bin", "vocab.spm"]);
    assert.ok(!result.ok);
    assert.equal(result.problem, "unknown_pair");
  });
});

describe("describeClassifyProblem", () => {
  it("has a sentence for every problem it can report", () => {
    const problems = /** @type {const} */ ([
      "empty",
      "unknown_file",
      "unknown_pair",
      "mixed_pairs",
      "missing_model",
      "missing_shortlist",
      "missing_vocab",
    ]);

    const sentences = new Set();
    for (const problem of problems) {
      const sentence = describeClassifyProblem(problem, "example.bin");
      assert.ok(sentence.length > 0, `${problem} has no sentence`);
      sentences.add(sentence);
    }

    assert.equal(sentences.size, problems.length, "two problems say the same thing");
  });
});
