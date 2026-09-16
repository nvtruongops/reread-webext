import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { MAX_INPUT_LENGTH, activeProviderId, setProvider, translate } from "../src/lib/translator/index.js";
import { noEngine } from "../src/lib/translator/providers/none.js";

afterEach(() => {
  setProvider(noEngine);
});

/**
 * @param {string} gloss
 * @param {string | null} [sentence]
 * @returns {import("../src/lib/protocol.js").Result<import("../src/lib/protocol.js").Translation>}
 */
function translated(gloss, sentence = null) {
  return ok({ gloss, sentence });
}

/**
 * @param {(input: import("../src/lib/translator/index.js").TranslateInput) => Promise<import("../src/lib/protocol.js").Result<import("../src/lib/protocol.js").Translation>>} translateFn
 * @returns {import("../src/lib/translator/index.js").Provider}
 */
function provider(translateFn) {
  return { id: "fake", translate: translateFn };
}

describe("translate", () => {
  it("starts with no engine, and says so rather than inventing a translation", async () => {
    assert.equal(activeProviderId(), "none");
    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.ENGINE_MISSING));
  });

  it("answers an empty string for an empty selection without asking the engine", async () => {
    let asked = false;
    setProvider(
      provider(async () => {
        asked = true;
        return translated("should not happen");
      }),
    );

    assert.deepEqual(await translate({ text: "   ", from: "en", to: "pl" }), translated(""));
    assert.equal(asked, false);
  });

  it("refuses a selection longer than a tooltip is for", async () => {
    const text = "x".repeat(MAX_INPUT_LENGTH + 1);
    assert.deepEqual(await translate({ text, from: "en", to: "pl" }), fail(ErrorCode.TOO_LONG));
  });

  it("accepts a selection exactly at the limit", async () => {
    setProvider(provider(async (input) => translated(input.text.length.toString())));
    const text = "x".repeat(MAX_INPUT_LENGTH);

    assert.deepEqual(await translate({ text, from: "en", to: "pl" }), translated(String(MAX_INPUT_LENGTH)));
  });

  it("passes text through when both languages are the same", async () => {
    setProvider(
      provider(async () => {
        throw new Error("the engine should not have been asked");
      }),
    );

    assert.deepEqual(await translate({ text: "  hello  ", from: "en", to: "en" }), translated("hello"));
  });

  it("hands the engine text that is already trimmed", async () => {
    /** @type {string | null} */
    let seen = null;
    setProvider(
      provider(async (input) => {
        seen = input.text;
        return translated("witaj");
      }),
    );

    await translate({ text: "  hello ", from: "en", to: "pl" });
    assert.equal(seen, "hello");
  });

  it("turns a provider that throws into an error code, never an exception", async () => {
    setProvider(
      provider(async () => {
        throw new Error("model file is corrupt");
      }),
    );

    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.INTERNAL));
  });

  it("passes a provider's own failure through unchanged", async () => {
    setProvider(provider(async () => fail(ErrorCode.MODEL_MISSING)));

    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.MODEL_MISSING));
  });

  describe("the sentence around the phrase", () => {
    /**
     * @returns {{ seen: () => string | undefined | "not called" }}
     */
    function watchContext() {
      /** @type {string | undefined | "not called"} */
      let context = "not called";
      setProvider(
        provider(async (input) => {
          context = input.context;
          return translated("witaj", input.context === undefined ? null : "zdanie");
        }),
      );
      return { seen: () => context };
    }

    it("reaches the provider trimmed", async () => {
      const watch = watchContext();
      await translate({ text: "bank", context: "  The bank was steep.  ", from: "en", to: "pl" });
      assert.equal(watch.seen(), "The bank was steep.");
    });

    it("comes back as the second half of the answer", async () => {
      watchContext();
      assert.deepEqual(
        await translate({ text: "bank", context: "The bank was steep.", from: "en", to: "pl" }),
        translated("witaj", "zdanie"),
      );
    });

    it("is dropped when it says the same thing as the phrase", async () => {
      const watch = watchContext();
      await translate({ text: "The bank was steep.", context: "The bank was steep.", from: "en", to: "pl" });
      assert.equal(watch.seen(), undefined);
    });

    it("is dropped rather than refused when it is too long", async () => {
      const watch = watchContext();
      const context = "x".repeat(MAX_INPUT_LENGTH + 1);

      const result = await translate({ text: "bank", context, from: "en", to: "pl" });
      assert.equal(watch.seen(), undefined);
      assert.deepEqual(result, translated("witaj", null));
    });

    it("is dropped when it is nothing but whitespace", async () => {
      const watch = watchContext();
      await translate({ text: "bank", context: "   \n  ", from: "en", to: "pl" });
      assert.equal(watch.seen(), undefined);
    });

    it("survives a pair that needs no engine", async () => {
      setProvider(
        provider(async () => {
          throw new Error("the engine should not have been asked");
        }),
      );

      assert.deepEqual(
        await translate({ text: "bank", context: "The bank was steep.", from: "en", to: "en" }),
        translated("bank", "The bank was steep."),
      );
    });
  });
});
