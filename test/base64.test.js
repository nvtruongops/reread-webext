import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromBase64, toBase64 } from "../src/lib/base64.js";

describe("bytes as base64", () => {
  it("round-trips bytes of every value, across more than one chunk", () => {
    const bytes = new Uint8Array(100_000);
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 256;
    const text = toBase64(bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64"));
    assert.deepEqual(fromBase64(text), bytes);
    // A buffer and its view read the same.
    assert.equal(toBase64(bytes.buffer), text);
    assert.equal(toBase64(new Uint8Array(0)), "");
    assert.deepEqual(fromBase64(""), new Uint8Array(0));
  });

  it("answers nothing for text that is not base64, rather than throwing", () => {
    assert.equal(fromBase64("not base64!"), null);
    assert.equal(fromBase64("abc"), null);
    assert.equal(fromBase64("ab=c"), null);
    assert.equal(fromBase64(42), null);
    assert.equal(fromBase64(null), null);
    assert.equal(fromBase64(undefined), null);
  });
});
