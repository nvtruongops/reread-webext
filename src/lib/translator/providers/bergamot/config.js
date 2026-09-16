/**
 * The configuration string handed to a Marian translation model.
 *
 * Marian takes its settings as YAML text, which is why this exists at all: the
 * values are few and flat, so a table plus a joiner beats pulling in a YAML
 * parser for a document that never nests.
 *
 * Every value is kept as a **string**, not a number. `normalize: 1.0` written
 * from a JavaScript number comes out as `1`, and guessing whether Marian minds
 * is not a thing to leave to chance.
 */

/**
 * What a model gets unless its own metadata says otherwise. These are the
 * values the reference implementation ships, which is to say the values Firefox
 * translates with.
 */
const DEFAULTS = Object.freeze({
  "beam-size": "1",
  normalize: "1.0",
  "word-penalty": "0",
  "cpu-threads": "0",
  "gemm-precision": "int8shiftAlphaAll",
  "skip-cost": "true",
});

/**
 * What no model gets to override, because these describe the harness rather
 * than the model: how much it may allocate, how loud it is, how long a segment
 * may get before it is broken up.
 */
const FIXED = Object.freeze({
  alignment: "soft",
  quiet: "true",
  "quiet-translation": "true",
  "max-length-break": "128",
  "mini-batch-words": "1024",
  workspace: "128",
  "max-length-factor": "2.0",
});

/**
 * Builds the YAML text for one model.
 *
 * @param {Record<string, string | number | boolean>} [overrides] from the model's own metadata
 * @returns {string}
 */
export function modelConfigYaml(overrides = {}) {
  /** @type {Record<string, string>} */
  const config = { ...DEFAULTS };

  for (const [key, value] of Object.entries(overrides)) {
    // Nested settings would need a real serializer, and no model ships one.
    // Dropping them beats emitting YAML that says something else.
    if (typeof value === "object" || value === null || value === undefined) continue;
    config[key] = String(value);
  }

  // Marian compiled to WebAssembly only has the shifted-all kernels. A model
  // asking for plain `int8` would load and then translate nonsense, which is
  // the worst kind of failure to leave to a smoke test.
  if (config["gemm-precision"] === "int8") config["gemm-precision"] = "int8shiftAll";

  Object.assign(config, FIXED);

  return (
    Object.entries(config)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n") + "\n"
  );
}
