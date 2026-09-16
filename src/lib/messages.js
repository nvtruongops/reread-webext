/**
 * Every error code, said in a sentence a reader can act on.
 *
 * Keeping this in one module is what makes the rule in `protocol.js` real: a
 * new code that nobody can phrase does not get added, because the switch below
 * stops compiling without it.
 *
 * The sentences themselves live in `_locales/` and come back through `t` in
 * whichever language the browser reads - this module only holds the map from
 * code to key. A code from a future version of the background falls through to
 * the `internal` sentence: older pages meeting a newer background is a thing
 * that happens mid-update, and "something went wrong" is true of it.
 */

import { t } from "./i18n.js";
import { ErrorCode } from "./protocol.js";

/**
 * @param {import("./protocol.js").ErrorCodeValue} code
 * @returns {string}
 */
export function describeError(code) {
  switch (code) {
    case ErrorCode.ENGINE_MISSING:
      return t("error_engine_missing");
    case ErrorCode.MODEL_MISSING:
      // Not "not downloaded": a model can just as well be added from files, and
      // the sentence has to be true either way. What the reader needs is where
      // to fix it, and that both ways of fixing it are there.
      return t("error_model_missing");
    case ErrorCode.UNSUPPORTED_PAIR:
      return t("error_unsupported_pair");
    case ErrorCode.TOO_LONG:
      return t("error_too_long");
    case ErrorCode.NO_PAGE:
      // Says what to do about it, because there usually is something: this is
      // what a reader gets after pressing the button on a settings page, a PDF,
      // or a tab they have since closed.
      return t("error_no_page");
    case ErrorCode.UNKNOWN_MESSAGE:
      return t("error_unknown_message");
    case ErrorCode.INTERNAL:
      return t("error_internal");
    default:
      return t("error_internal");
  }
}
