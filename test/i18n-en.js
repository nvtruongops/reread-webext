/**
 * The English catalogue, installed as `browser.i18n` for every test process.
 *
 * Preloaded through `node --test --import` (see package.json), so the modules
 * under test read their sentences exactly the way a fallen-back browser would:
 * out of `src/_locales/en/messages.json`, placeholders and all. The tests keep
 * asserting on English sentences, and those assertions now hold the real
 * catalogue - a key that goes missing or loses its placeholder fails a test
 * instead of blanking a bubble.
 *
 * Substitution follows the WebExtension rules the extension relies on: each
 * placeholder's `content` names a `$n` argument, `$NAME$` in the message is
 * case-insensitive, and a missing key answers with `""`.
 *
 * Only `runtime.id` rides along, because `webext()` refuses to answer without
 * it. Tests that install their own richer fake (`test/fake-browser.js`) simply
 * overwrite this one for as long as they need it.
 */

import { readFileSync } from "node:fs";

/** @type {Record<string, { message: string, placeholders?: Record<string, { content: string }> }>} */
const catalogue = JSON.parse(
  readFileSync(new URL("../src/_locales/en/messages.json", import.meta.url), "utf8"),
);

/**
 * @param {string} name
 * @param {string | string[]} [substitutions]
 * @returns {string}
 */
export function getMessage(name, substitutions) {
  const entry = catalogue[name];
  if (entry === undefined) return "";

  const args = typeof substitutions === "string" ? [substitutions] : (substitutions ?? []);

  /** @type {Map<string, string>} */
  const values = new Map();
  for (const [placeholder, { content }] of Object.entries(entry.placeholders ?? {})) {
    const resolved = content.replace(/\$(\d)/g, (_, digit) => args[Number(digit) - 1] ?? "");
    values.set(placeholder.toLowerCase(), resolved);
  }

  return entry.message
    .replace(/\$([a-zA-Z0-9_@]+)\$/g, (whole, placeholder) => {
      return values.get(placeholder.toLowerCase()) ?? whole;
    })
    .replace(/\$\$/g, "$");
}

if (globalThis.browser === undefined) {
  globalThis.browser = /** @type {any} */ ({
    runtime: { id: "test" },
    i18n: { getMessage },
  });
}
