import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import {
  chromeAiTranslator,
  createChromeAiTranslator,
  isChromeAiAvailable,
} from "../src/lib/translator/providers/chrome-ai.js";

describe("Chrome Built-in AI Translation Provider (Phase 2)", () => {
  it("reports unavailable when translation API is missing from global environment", async () => {
    const available = await isChromeAiAvailable("en", "es");
    assert.equal(available, false);
  });

  it("returns ENGINE_MISSING when API is absent and no fallback is set", async () => {
    const result = await chromeAiTranslator.translate({
      text: "hello",
      from: "en",
      to: "es",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ErrorCode.ENGINE_MISSING);
    }
  });

  it("delegates to fallback provider when native API is absent", async () => {
    let fallbackCalled = false;
    /** @type {import("../src/lib/translator/index.js").Provider} */
    const mockFallback = {
      id: "mock-bergamot",
      async translate(input) {
        fallbackCalled = true;
        return ok({ gloss: `[fallback] ${input.text}`, sentence: null });
      },
    };

    const providerWithFallback = createChromeAiTranslator({
      fallbackProvider: mockFallback,
    });

    const result = await providerWithFallback.translate({
      text: "world",
      from: "en",
      to: "de",
    });

    assert.equal(fallbackCalled, true);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.gloss, "[fallback] world");
    }
  });

  it("uses native translation API when present in global scope", async () => {
    // Mock global translation API
    /** @type {any} */ (globalThis).translation = {
      /** @param {{ sourceLanguage: string, targetLanguage: string }} param0 */
      async canTranslate({ sourceLanguage, targetLanguage }) {
        if (sourceLanguage === "en" && targetLanguage === "fr") return "readily";
        return "no";
      },
      /** @param {{ sourceLanguage: string, targetLanguage: string }} param0 */
      async createTranslator({ sourceLanguage, targetLanguage }) {
        return {
          /** @param {string} text */
          async translate(text) {
            return `bonjour ${text}`;
          },
        };
      },
    };

    try {
      const provider = createChromeAiTranslator();
      const result = await provider.translate({
        text: "friend",
        from: "en",
        to: "fr",
        context: "hello friend",
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.gloss, "bonjour friend");
        assert.equal(result.value.sentence, "bonjour hello friend");
      }
    } finally {
      delete /** @type {any} */ (globalThis).translation;
    }
  });

  it("falls back gracefully when native API returns 'no'", async () => {
    let fallbackHit = false;
    /** @type {import("../src/lib/translator/index.js").Provider} */
    const mockFallback = {
      id: "mock-bergamot",
      async translate() {
        fallbackHit = true;
        return ok({ gloss: "fallback-answer", sentence: null });
      },
    };

    /** @type {any} */ (globalThis).translation = {
      async canTranslate() {
        return "no";
      },
    };

    try {
      const provider = createChromeAiTranslator({ fallbackProvider: mockFallback });
      const result = await provider.translate({
        text: "test",
        from: "en",
        to: "xyz",
      });

      assert.equal(fallbackHit, true);
      assert.equal(result.ok, true);
    } finally {
      delete /** @type {any} */ (globalThis).translation;
    }
  });
});
