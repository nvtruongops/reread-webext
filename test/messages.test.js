import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeError } from "../src/lib/messages.js";
import { ErrorCode } from "../src/lib/protocol.js";

describe("describeError", () => {
  it("has a sentence for every error code", () => {
    for (const code of Object.values(ErrorCode)) {
      const sentence = describeError(code);
      assert.ok(sentence.length > 0, `${code} has no sentence`);
      assert.ok(sentence.endsWith("."), `${code} is not a sentence: ${sentence}`);
    }
  });

  it("does not say the same thing about two different failures", () => {
    // Two codes worth telling apart are two codes a reader can act on
    // differently. `internal` is the exception: it is the fallback as well.
    const codes = Object.values(ErrorCode).filter((code) => code !== ErrorCode.INTERNAL);
    const sentences = new Set(codes.map(describeError));

    assert.equal(sentences.size, codes.length);
  });

  it("says something rather than nothing for a code from a future version", () => {
    const sentence = describeError(/** @type {any} */ ("code_from_the_future"));
    assert.ok(sentence.length > 0);
  });
});
