import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { companionFor } from "../src/lib/translator/providers/bergamot/padding.js";

describe("companionFor", () => {
  it("gives a short phrase a sentence to travel with", () => {
    const companion = companionFor("en", ["match"]);
    assert.ok(companion !== null);
    assert.ok(companion.length > "match".length);
  });

  it("adds nothing when every row can stand on its own", () => {
    const companion = /** @type {string} */ (companionFor("en", ["match"]));
    const long = "x".repeat(companion.length);
    assert.equal(companionFor("en", [long]), null);
    assert.equal(companionFor("en", [long, long]), null);
  });

  /**
   * The sentence behind "More" is a long row, and it is not a substitute: a
   * phrase travelling with its own sentence still came back as `Zegark` where
   * the same batch with this companion gave `Zegarek`.
   */
  it("still helps a short phrase that already travels with a sentence", () => {
    const companion = /** @type {string} */ (companionFor("en", ["match"]));
    assert.equal(companionFor("en", ["watch", "My watch is running five minutes slow again."]), companion);
  });

  it("counts what the engine will see, not the whitespace around it", () => {
    const companion = /** @type {string} */ (companionFor("en", ["match"]));
    const padded = `   ${"x".repeat(companion.length - 1)}   `;
    assert.equal(companionFor("en", [padded]), companion);
  });

  it("says nothing for a language we have not measured", () => {
    assert.equal(companionFor("pl", ["zapałka"]), null);
    assert.equal(companionFor("de", ["Streichholz"]), null);
    assert.equal(companionFor("", ["match"]), null);
  });

  it("says nothing for an empty batch", () => {
    assert.equal(companionFor("en", []), null);
  });

  /**
   * The point of the companion is to be the longest row in the batch. A future
   * edit that shortens it below the threshold it defines would leave a sentence
   * that is translated, thrown away, and helps nobody.
   */
  it("is itself long enough to be worth sending", () => {
    const companion = /** @type {string} */ (companionFor("en", ["match"]));
    assert.ok(companion.trim().length >= 33, `companion is only ${companion.length} characters`);
    assert.equal(companionFor("en", [companion]), null);
  });

  it("does not take a prototype property for a language", () => {
    assert.equal(companionFor("toString", ["match"]), null);
    assert.equal(companionFor("constructor", ["match"]), null);
  });
});
