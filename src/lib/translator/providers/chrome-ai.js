/**
 * Chrome Built-in On-Device AI Translation Provider.
 * Integrates with Chromium's native On-Device Translation API (`window.translation` / `self.translation`),
 * enabling instant zero-network translation with zero additional model downloads when supported.
 */

import { ErrorCode, fail, ok } from "../../protocol.js";

/**
 * Resolves the active global scope across Browser, Worker, and Node environments.
 * @returns {any}
 */
function getGlobalScope() {
  if (typeof window !== "undefined") return window;
  if (typeof self !== "undefined") return self;
  if (typeof globalThis !== "undefined") return globalThis;
  return null;
}

/**
 * Checks whether native Chromium translation is available for the given language pair.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @returns {Promise<boolean>}
 */
export async function isChromeAiAvailable(sourceLanguage, targetLanguage) {
  const globalScope = getGlobalScope();
  const translationApi = globalScope?.translation || globalScope?.ai?.translator;

  if (!translationApi || typeof translationApi.canTranslate !== "function") {
    return false;
  }

  try {
    const status = await translationApi.canTranslate({ sourceLanguage, targetLanguage });
    return status === "readily" || status === "yes" || status === "after-download";
  } catch {
    return false;
  }
}

/**
 * Creates the Chrome AI translation provider.
 * @param {Object} [options]
 * @param {import("../index.js").Provider} [options.fallbackProvider] Fallback provider (e.g. Bergamot) if pair unsupported
 * @returns {import("../index.js").Provider}
 */
export function createChromeAiTranslator({ fallbackProvider = undefined } = {}) {
  return {
    id: "chrome-ai",
    async translate(input) {
      const globalScope = getGlobalScope();
      const translationApi = globalScope?.translation || globalScope?.ai?.translator;

      if (!translationApi || typeof translationApi.createTranslator !== "function") {
        if (fallbackProvider) {
          return fallbackProvider.translate(input);
        }
        return fail(ErrorCode.ENGINE_MISSING);
      }

      try {
        const can = await translationApi.canTranslate({
          sourceLanguage: input.from,
          targetLanguage: input.to,
        });

        if (can === "no") {
          if (fallbackProvider) {
            return fallbackProvider.translate(input);
          }
          return fail(ErrorCode.UNSUPPORTED_PAIR);
        }

        const translator = await translationApi.createTranslator({
          sourceLanguage: input.from,
          targetLanguage: input.to,
        });

        const gloss = await translator.translate(input.text);
        let sentence = null;
        if (input.context) {
          sentence = await translator.translate(input.context);
        }

        return ok({
          gloss: typeof gloss === "string" ? gloss : String(gloss ?? ""),
          sentence: typeof sentence === "string" ? sentence : null,
        });
      } catch {
        if (fallbackProvider) {
          return fallbackProvider.translate(input);
        }
        return fail(ErrorCode.INTERNAL);
      }
    },
  };
}

export const chromeAiTranslator = createChromeAiTranslator();
