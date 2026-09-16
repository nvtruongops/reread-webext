/**
 * Turning a language code into something a person recognises.
 *
 * The names come from the browser's own `Intl.DisplayNames`, not from a table
 * in this package: the labels match what the browser calls the same languages
 * everywhere else, there is nothing for us to keep up to date, and nothing to
 * audit beyond this file. The one massaging needed is the underscore -
 * Mozilla's model index writes `zh_hant`, BCP-47 writes `zh-Hant`, and
 * `Intl.DisplayNames` only reads the latter.
 *
 * The names follow the catalogue the rest of the page speaks (`uiLocale`), not
 * the browser's regional settings: a page whose sentences fell back to English
 * has to call the languages English names too, or it reads as two pages.
 *
 * A code with no name - malformed, private, or simply unknown to the browser -
 * comes back as itself. A code on screen is poorer than a name, but it is
 * honest, and it still tells apart the two things it needs to tell apart.
 */

import { t, uiLocale } from "./i18n.js";

/** @type {Intl.DisplayNames | null} */
let names = null;

/**
 * @param {string} code as the model registry writes it, e.g. `"en"`, `"zh_hant"`
 * @returns {string} `"English"`, or the code itself when there is no name for it
 */
export function languageName(code) {
  names ??= new Intl.DisplayNames([uiLocale()], { type: "language" });
  try {
    return names.of(code.replace(/_/g, "-")) ?? code;
  } catch {
    return code;
  }
}

/**
 * The one way a direction is written on screen, so every page writes it the
 * same way. The joining word is the catalogue's: `"English to Polish"` in
 * English, an arrow where the language's grammar would bend the names.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function pairLabel(from, to) {
  return t("pair_label", [languageName(from), languageName(to)]);
}
