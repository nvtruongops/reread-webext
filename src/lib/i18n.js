/**
 * How the UI speaks the browser's language.
 *
 * Every sentence the extension shows lives in `_locales/<locale>/messages.json`
 * and is fetched through `i18n.getMessage` - the browser picks the catalogue
 * that matches its own UI language and falls back to English (`default_locale`)
 * for everything else. Nothing here decides the language; the browser already
 * did, and disagreeing with it would be a second setting for the same thing.
 *
 * This module is the mechanism only. Which key means what is the catalogues'
 * business, and the map from error codes to keys stays in `messages.js` - the
 * same split as everywhere else in `lib/`: rules in one place, plumbing in
 * another.
 *
 * Outside a browser - `node --test` - there is no `i18n` API. `t` answers with
 * an empty string rather than throwing, and the test bootstrap installs a fake
 * backed by the real English catalogue, so the tests read the same sentences a
 * reader would.
 */

import { webext } from "./browser.js";

/**
 * The message catalogues' own name for the language they are written in.
 *
 * `@@ui_locale` names the browser's language, which is not the same thing: a
 * browser set to Italian resolves every message from the English catalogue,
 * and the names around those messages - `Intl.DisplayNames`, plural rules -
 * have to follow the catalogue, not the browser, or the page comes out half
 * translated. Each catalogue therefore carries its own code under this key.
 */
const LOCALE_KEY = "locale_code";

/** @type {string | null} */
let locale = null;

/**
 * @param {string} key
 * @param {string | string[]} [substitutions]
 * @returns {string} the message, or `""` when there is no catalogue to ask -
 *   never an exception, because half the callers run inside `node --test`
 */
export function t(key, substitutions) {
  try {
    return webext().i18n.getMessage(key, substitutions);
  } catch {
    return "";
  }
}

/**
 * The language the catalogue in use is written in, e.g. `"pl"` - see
 * `LOCALE_KEY` for why this is not `@@ui_locale`. English outside a browser,
 * because English is the `default_locale` and the tests should read what a
 * fallen-back browser shows.
 *
 * @returns {string}
 */
export function uiLocale() {
  if (locale === null) {
    const declared = t(LOCALE_KEY);
    locale = declared.length > 0 ? declared : "en";
  }
  return locale;
}

/**
 * A counted message: `plural(count, "words")` picks `words_one`, `words_few`,
 * `words_many` or `words_other` the way the catalogue's language counts -
 * English needs two forms where Polish needs four, and the browser knows the
 * rules for both. A category the catalogue does not spell out falls back to
 * `_other`, so a language only writes the forms it distinguishes.
 *
 * The count travels as `$1` formatted with the reader's own digits, and any
 * extra substitutions follow it.
 *
 * @param {number} count
 * @param {string} base the key family, e.g. `"words"`
 * @param {string[]} [rest] substitutions beyond the count, becoming `$2` on
 * @returns {string}
 */
export function plural(count, base, rest = []) {
  const substitutions = [count.toLocaleString(), ...rest];
  const category = new Intl.PluralRules(uiLocale()).select(count);
  const exact = category === "other" ? "" : t(`${base}_${category}`, substitutions);
  return exact.length > 0 ? exact : t(`${base}_other`, substitutions);
}

/**
 * An optional technical detail as the parenthetical aside the catalogues leave
 * a `$DETAIL$` slot for: `" (404 Not Found)"`, or nothing at all. The bracket
 * is built here so that a missing detail removes the brackets with it - a
 * translation only decides where the aside stands in the sentence, never
 * whether half a bracket shows.
 *
 * The detail itself stays as the code produced it (a status line, a file name,
 * a count). It is diagnostic, not prose, and inventing five translations for
 * strings assembled deep in the parsers would buy no clarity back.
 *
 * @param {string} [detail]
 * @returns {string}
 */
export function aside(detail) {
  return detail === undefined || detail.length === 0 ? "" : ` (${detail})`;
}

/**
 * A size in megabytes, to one decimal, in the reader's own decimal mark:
 * `12.3` where the browser writes dots, `12,3` where it writes commas. The
 * unit needs no catalogue.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function megabytes(bytes) {
  const amount = (bytes / 1048576).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${amount} MB`;
}

/**
 * A file's size the way the line after an export says it (D153): whole
 * kilobytes under a megabyte, `megabytes` from there - "0.0 MB" for a
 * forty-kilobyte file would say nothing. Never under one kilobyte: a file
 * that exists is not "0 KB".
 *
 * @param {number} bytes
 * @returns {string}
 */
export function fileSize(bytes) {
  if (bytes >= 1048576) return megabytes(bytes);
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

/**
 * Swaps the English written in an extension page for the catalogue's language.
 *
 * The pages ship readable English in their markup and mark what is
 * translatable with `data-i18n` (text) and `data-i18n-title`,
 * `data-i18n-placeholder`, `data-i18n-aria-label` (the three attributes any of
 * them uses). Text goes in through `textContent`, the same door every other
 * string in this extension uses; a marked element must therefore hold text
 * only, and the locales test holds the markup to that.
 *
 * A key the catalogue cannot answer leaves the English in place - on a page
 * somebody is looking at, last year's language beats a blank line.
 */
export function localizePage() {
  document.documentElement.lang = uiLocale();

  for (const element of document.querySelectorAll("[data-i18n]")) {
    const text = t(element.getAttribute("data-i18n") ?? "");
    if (text.length > 0) element.textContent = text;
  }

  const attributes = /** @type {const} */ ([
    ["title", "data-i18n-title"],
    ["placeholder", "data-i18n-placeholder"],
    ["aria-label", "data-i18n-aria-label"],
  ]);
  for (const [attribute, marker] of attributes) {
    for (const element of document.querySelectorAll(`[${marker}]`)) {
      const text = t(element.getAttribute(marker) ?? "");
      if (text.length > 0) element.setAttribute(attribute, text);
    }
  }
}
