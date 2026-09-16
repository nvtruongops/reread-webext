/**
 * Which language pairs the popup offers.
 *
 * Only pairs whose model is on this device, because the popup is for switching
 * between things that work - downloading what does not is the settings page's
 * job, a screen with room to say what it costs. Plus the configured pair even
 * when its model is not here: a control must never disagree with the settings
 * it shows, and silently displaying the first installed pair instead would be
 * exactly that disagreement.
 *
 * Pure and separate from the popup's DOM for the reason `withDefaults` is: the
 * rule is worth a test, and `node --test` has no popup to open.
 */

import { monolingualLastResort } from "../lib/pairs.js";

/**
 * @typedef {{ pair: string, from: string, to: string }} PairChoice
 */

/**
 * @param {{ sourceLang: string | null, targetLang: string | null }} config
 * @param {PairChoice[]} installed models on this device, in any order
 * @param {PairChoice[]} [extra] the pairs the dictionaries offer, handed in
 *   under the trim alone (D165): there they are what works, and a Polish
 *   page with a pl-en dictionary is read under pl -> en without a walk to
 *   the settings. A pair both a model and a dictionary offer is one row.
 * @returns {PairChoice[]} what the select shows - the configured pair always
 *   included once there is one; with none chosen, exactly the installed
 *   models, which on a fresh install is an empty list and an empty select
 */
export function pairChoices(config, installed, extra = []) {
  /** @type {Map<string, PairChoice>} */
  const byPair = new Map();
  for (const { pair, from, to } of [...installed, ...extra]) {
    if (!byPair.has(pair)) byPair.set(pair, { pair, from, to });
  }
  // A monolingual book's pair only as the last resort for its language
  // (D166, `lib/pairs.js`); the configured pair is put back below whatever
  // the rule said, so the shelf somebody stands on never vanishes.
  const rows = monolingualLastResort([...byPair.values()]).sort((a, b) => a.pair.localeCompare(b.pair));

  if (config.sourceLang === null || config.targetLang === null) return rows;
  const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
  if (known) return rows;

  return [
    { pair: `${config.sourceLang}${config.targetLang}`, from: config.sourceLang, to: config.targetLang },
    ...rows,
  ];
}
