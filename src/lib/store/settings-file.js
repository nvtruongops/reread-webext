/**
 * The settings as the backup of everything carries them (D213): the config
 * as the settings page keeps it - the pair, the reader's dress, the
 * switches, the voices, the custom CSS, the sites switched off - in the
 * reading list's file's shape. Never the published platform: that is where
 * the file is read, not where it was written.
 *
 * Restoring is a patch, not a replacement: only the keys the file holds
 * move, and each of them passes the gate every stored value passes
 * (`withDefaults`), so a hand-edited file can plant nothing the settings
 * page could not - a rate out of range is clamped, a theme nobody knows
 * falls back, half a pair is no pair. A key the file does not hold keeps
 * what the reader has here: a file written by an older version restores
 * what it knew and nothing else.
 *
 * Everything here is a value in and a value out; `storage.local` lives in
 * `config.js`.
 */

import { withDefaults } from "../config.js";

/** @typedef {import("../config.js").Config} Config */
/** @typedef {import("../config.js").ConfigPatch} ConfigPatch */

/** What the file says it is, and the first thing reading one checks. */
const FORMAT = "reread-settings";

/**
 * Written for whoever reads this file after the format grows. Reading
 * ignores it today: whether a key is a setting is decided key by key.
 */
const VERSION = 1;

/** The entry's name inside the backup of everything. */
export const SETTINGS_ENTRY = "settings.json";

/**
 * The whole file, as one string: the config exactly as it stands.
 *
 * @param {Config} config
 * @returns {string}
 */
export function toSettingsFile(config) {
  return JSON.stringify({ format: FORMAT, version: VERSION, settings: config }, null, 2) + "\n";
}

/**
 * Reads what `toSettingsFile` writes, as the patch `writeConfig` takes: the
 * keys the file holds, each already healed by `withDefaults` - the pair
 * only whole, the reader's dress key by key. A text that is not this file
 * at all - not JSON, no marker, no settings - is null rather than an empty
 * patch: the page says so, instead of restoring nothing quietly.
 *
 * @param {string} text
 * @returns {ConfigPatch | null}
 */
export function fromSettingsFile(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { format, settings } = /** @type {Record<string, unknown>} */ (parsed);
  if (format !== FORMAT || typeof settings !== "object" || settings === null) return null;

  const raw = /** @type {Record<string, unknown>} */ (settings);
  const clean = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (withDefaults(raw)));
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const key of Object.keys(raw)) {
    if (key === "sourceLang" || key === "targetLang") {
      // The pair only ever travels whole - `withDefaults` reads half a
      // pair as none, and none is not a patch.
      if (clean["sourceLang"] !== null && clean["targetLang"] !== null) {
        patch["sourceLang"] = clean["sourceLang"];
        patch["targetLang"] = clean["targetLang"];
      }
      continue;
    }
    if (key === "reader") {
      const dress = raw["reader"];
      if (typeof dress !== "object" || dress === null) continue;
      const healed = /** @type {Record<string, unknown>} */ (clean["reader"]);
      /** @type {Record<string, unknown>} */
      const sub = {};
      for (const name of Object.keys(dress)) if (name in healed) sub[name] = healed[name];
      patch["reader"] = sub;
      continue;
    }
    if (key in clean) patch[key] = clean[key];
  }
  return /** @type {ConfigPatch} */ (patch);
}
