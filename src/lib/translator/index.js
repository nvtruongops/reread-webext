/**
 * The facade every caller uses, and the only thing that knows an engine exists.
 *
 * Its job is to make the engine boring: one shape of answer, one list of error
 * codes, no exceptions escaping. Bergamot (M1) plugs in as a provider behind
 * this line, and so would Chromium's built-in Translator API if the port ever
 * wants it - callers stay unchanged either way.
 */

import { ErrorCode, fail, ok } from "../protocol.js";
import { noEngine } from "./providers/none.js";

/**
 * A tooltip is for a phrase or a sentence. Anything past this is a selection
 * somebody made by mistake, and translating it would cost model time nobody
 * asked for.
 */
export const MAX_INPUT_LENGTH = 1000;

/**
 * @typedef {object} TranslateInput
 * @property {string} text
 * @property {string} from
 * @property {string} to
 * @property {string} [context] the sentence the phrase was in, when there is one
 */

/**
 * @typedef {object} Provider
 * @property {string} id
 * @property {(input: TranslateInput) => Promise<import("../protocol.js").Result<import("../protocol.js").Translation>>} translate
 */

/** @type {Provider} */
let provider = noEngine;

/**
 * Swapped once, at startup, by whoever owns engine selection.
 * @param {Provider} next
 */
export function setProvider(next) {
  provider = next;
}

/** @returns {string} id of the provider currently answering. */
export function activeProviderId() {
  return provider.id;
}

/**
 * The sentence is an extra, so nothing about it may cost the reader the phrase:
 * one that is missing, too long, or the same text as the phrase is dropped here
 * and never reaches a provider.
 *
 * @param {TranslateInput} input
 * @param {string} text the phrase, already trimmed
 * @returns {string | undefined}
 */
function usableContext(input, text) {
  const context = (input.context ?? "").trim();
  if (context.length === 0 || context.length > MAX_INPUT_LENGTH) return undefined;
  return context === text ? undefined : context;
}

/**
 * @param {TranslateInput} input
 * @returns {Promise<import("../protocol.js").Result<import("../protocol.js").Translation>>}
 */
export async function translate(input) {
  const text = input.text.trim();
  if (text.length === 0) return ok({ gloss: "", sentence: null });
  if (text.length > MAX_INPUT_LENGTH) return fail(ErrorCode.TOO_LONG);

  const context = usableContext(input, text);
  if (input.from === input.to) return ok({ gloss: text, sentence: context ?? null });

  try {
    return await provider.translate({ ...input, text, context });
  } catch {
    // A provider that throws has a bug, and the reader still needs a bubble
    // with something in it. The code is the thing that gets logged.
    return fail(ErrorCode.INTERNAL);
  }
}
