import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENTITIES } from "../src/lib/dict/entities.js";

/**
 * The generated table (`tools/entities.mjs`) against what the standard says
 * of its own: 2,231 references, of which 2,125 end in a semicolon, every
 * name a letter followed by letters and digits, every value one or two code
 * points. The decoding itself is tested with `fieldText` (`dict-text.test.js`);
 * this is the shape of the data it stands on, so that a regeneration that
 * went wrong fails here and not in a bubble.
 */
describe("ENTITIES", () => {
  it("has every name of the standard's table that ends in a semicolon", () => {
    assert.equal(Object.keys(ENTITIES).length, 2125);
    assert.ok(Object.isFrozen(ENTITIES));
  });

  it("names are names and values are characters", () => {
    for (const [name, value] of Object.entries(ENTITIES)) {
      assert.match(name, /^[A-Za-z][A-Za-z0-9]*$/u, name);
      const points = [...value].length;
      assert.ok(points === 1 || points === 2, `${name} stands for ${points} code points`);
    }
  });

  it("reads the lines a dictionary leans on the way the standard does", () => {
    assert.equal(ENTITIES.lsqb, "[");
    assert.equal(ENTITIES.rsqb, "]");
    assert.equal(ENTITIES.amp, "&");
    assert.equal(ENTITIES.AMP, "&");
    assert.equal(ENTITIES.lt, "<");
    assert.equal(ENTITIES.quot, '"');
    assert.equal(ENTITIES.bsol, "\\");
    assert.equal(ENTITIES.nbsp, String.fromCodePoint(0xa0));
    assert.equal(ENTITIES.mdash, String.fromCodePoint(0x2014));
    assert.equal(ENTITIES.lrm, String.fromCodePoint(0x200e));
    assert.equal(ENTITIES.frac12, "½");
    assert.equal(ENTITIES.prime, String.fromCodePoint(0x2032));
    assert.equal(ENTITIES.Prime, String.fromCodePoint(0x2033));
    assert.equal(ENTITIES.NotNestedGreaterGreater, String.fromCodePoint(0x2aa2, 0x0338));
    // The legacy spellings without a semicolon are not in the table under
    // any name, and the prototype's properties are not references.
    assert.equal(Object.hasOwn(ENTITIES, "constructor"), false);
    assert.equal(Object.hasOwn(ENTITIES, "__proto__"), false);
  });
});
