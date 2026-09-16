import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { modelConfigYaml } from "../src/lib/translator/providers/bergamot/config.js";

/**
 * @param {string} yaml
 * @returns {Record<string, string>}
 */
function parse(yaml) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const line of yaml.split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(":");
    result[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return result;
}

describe("modelConfigYaml", () => {
  it("writes one setting per line, as Marian wants it", () => {
    const config = parse(modelConfigYaml());
    assert.equal(config["beam-size"], "1");
    assert.equal(config["gemm-precision"], "int8shiftAlphaAll");
  });

  it("keeps a float a float, which a JavaScript number would not", () => {
    assert.equal(parse(modelConfigYaml())["normalize"], "1.0");
  });

  it("lets a model's own metadata override the defaults", () => {
    const config = parse(modelConfigYaml({ "beam-size": 4 }));
    assert.equal(config["beam-size"], "4");
  });

  it("rewrites int8 to int8shiftAll, because that is all the WASM build has", () => {
    const config = parse(modelConfigYaml({ "gemm-precision": "int8" }));
    assert.equal(config["gemm-precision"], "int8shiftAll");
  });

  it("leaves a precision it already understands alone", () => {
    const config = parse(modelConfigYaml({ "gemm-precision": "int8shiftAlphaAll" }));
    assert.equal(config["gemm-precision"], "int8shiftAlphaAll");
  });

  it("does not let a model override what the harness owns", () => {
    const config = parse(modelConfigYaml({ workspace: 4096, quiet: false, alignment: "hard" }));
    assert.equal(config["workspace"], "128");
    assert.equal(config["quiet"], "true");
    assert.equal(config["alignment"], "soft");
  });

  it("drops nested settings rather than writing YAML that says something else", () => {
    const config = parse(modelConfigYaml({ nested: /** @type {any} */ ({ a: 1 }), "beam-size": 2 }));
    assert.equal(config["nested"], undefined);
    assert.equal(config["beam-size"], "2");
  });

  it("writes booleans and numbers as bare scalars", () => {
    const config = parse(modelConfigYaml({ "skip-cost": false, "word-penalty": 0.5 }));
    assert.equal(config["skip-cost"], "false");
    assert.equal(config["word-penalty"], "0.5");
  });

  it("ends with a newline, so appending never joins two settings", () => {
    assert.ok(modelConfigYaml().endsWith("\n"));
  });
});
