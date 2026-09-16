import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monolingualLastResort } from "../src/lib/pairs.js";

const ENPL = { from: "en", to: "pl" };
const ENEN = { from: "en", to: "en" };
const PLEN = { from: "pl", to: "en" };
const PLPL = { from: "pl", to: "pl" };
const DEDE = { from: "de", to: "de" };

describe("monolingualLastResort", () => {
  it("drops a monolingual pair where a bilingual pair reads the same language (D166)", () => {
    // Michał's doubt: en -> en and pl -> pl in the popup's select, beside
    // en -> pl and pl -> en. The target language is only the shelf, and the
    // monolingual book already answers under the bilingual pair.
    assert.deepEqual(monolingualLastResort([ENEN, ENPL, PLEN, PLPL]), [ENPL, PLEN]);
  });

  it("keeps a monolingual pair that is the only one for its language", () => {
    // The reader whose only English book explains English in English: with
    // no pair there is no shelf at all (D120), so this one stays.
    assert.deepEqual(monolingualLastResort([ENEN, PLEN]), [ENEN, PLEN]);
    assert.deepEqual(monolingualLastResort([DEDE]), [DEDE]);
  });

  it("keeps the order it was given, and leaves an empty list empty", () => {
    assert.deepEqual(monolingualLastResort([PLEN, ENEN, ENPL]), [PLEN, ENPL]);
    assert.deepEqual(monolingualLastResort([]), []);
  });
});
