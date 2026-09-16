/**
 * The copy of the vocabulary that content scripts are allowed to read.
 *
 * The database is the background's, and a page must not have to wake the
 * background to find out whether the word under the cursor is one the reader
 * kept. That would be a message on every navigation, on every page, forever -
 * the opposite of what `<all_urls>` was justified with. So the background keeps
 * a derived copy in `storage.local`, and a page reads it in the same call it
 * reads the settings with.
 *
 * Two properties make a cache like this safe to have:
 *
 *   - one writer. Only the background writes it, always in full, always from
 *     what the database just said. It has no history of its own to drift from.
 *   - it says which pair it is for. A copy left over from another language pair
 *     is not stale data to be shown anyway, it is a reason to ask the background
 *     for the real thing - and that is the only time a page sends a message
 *     about vocabulary before the reader touches anything.
 *
 * One thing in it is not read off the database: the other forms of the
 * saved words (D208, `forms`), which come out of the installed dictionaries
 * and cost a dozen point reads per word. Those the background computes once
 * per word and carries from one mirror to the next, under a stamp of the
 * dictionaries that vouched for them (`formsStamp`) - the one history the
 * mirror has, and one it checks against the shelf on every rebuild
 * (`store/forms.js`). A page may use them only while the switch that asks
 * for them is on; with it off the background writes none.
 *
 * No mirror at all means the background has never written one, which means
 * nothing has ever been saved. A page that finds nothing does nothing: an
 * install with an empty vocabulary costs exactly one storage read per page.
 */

import { webext } from "../browser.js";

/** @typedef {import("../protocol.js").VocabEntry} VocabEntry */

/**
 * @typedef {object} VocabMirror
 * @property {string} from
 * @property {string} to
 * @property {VocabEntry[]} entries
 * @property {Record<string, string[]>} forms the other forms of a saved word
 *   (D208), by its key: the ones a dictionary of the language vouched for,
 *   an empty list for a word that has none - which is worth writing down,
 *   because it is the answer of a dozen reads. Only single words of the one
 *   language with rules ever have a line here, and nothing does while the
 *   switch is off.
 * @property {string} formsStamp what the forms were computed from
 *   (`dict/forms.js`, `formsStamp`); empty when there are none
 */

/** The key in `storage.local`. `config` is the other one, and there are no more. */
export const MIRROR_KEY = "vocabIndex";

/** What a mirror carries for forms when nothing computed any. */
const NO_FORMS = Object.freeze({ forms: {}, stamp: "" });

/**
 * An unchosen pair mirrors as the empty string on both sides: the mirror's
 * shape stays two strings and a list, and a page comparing it against the
 * pairless settings (`mirrorMatches`) finds them agreeing - so a fresh
 * install reads one empty mirror and goes quiet, instead of reading a
 * mismatch and asking the background for a vocabulary that cannot exist.
 *
 * @param {import("../config.js").Config} config
 * @param {import("./phrase.js").Phrase[]} phrases
 * @param {{ forms: Record<string, string[]>, stamp: string }} [known] the
 *   forms of the words and the stamp they stand under (D208), from
 *   `store/forms.js`; none when nothing asked for them
 * @returns {VocabMirror}
 */
export function mirrorOf(config, phrases, known = NO_FORMS) {
  return {
    from: config.sourceLang ?? "",
    to: config.targetLang ?? "",
    entries: phrases.map((phrase) => [phrase.normalized, phrase.translations]),
    forms: known.forms,
    formsStamp: known.stamp,
  };
}

/**
 * The forms as stored, or as much of them as really maps a key to a list of
 * words. A line that makes no sense is dropped, an empty list is kept: it
 * says the word was asked about and has no forms, which the next rebuild
 * must not ask again.
 *
 * @param {unknown} value
 * @returns {Record<string, string[]>}
 */
function asForms(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  /** @type {Record<string, string[]>} */
  const forms = {};
  for (const [key, list] of Object.entries(value)) {
    if (key.length === 0 || !Array.isArray(list)) continue;
    forms[key] = list.filter((one) => typeof one === "string" && one.length > 0);
  }
  return forms;
}

/**
 * Narrows whatever was in storage - which is to say, anything at all: an older
 * version of this extension wrote it, or somebody edited it by hand. A row that
 * does not make sense is dropped rather than shown, and a shape that does not
 * make sense is no mirror at all. A mirror from before the forms (D208) has
 * none, which reads as none computed.
 *
 * @param {unknown} stored
 * @returns {VocabMirror | null}
 */
export function asMirror(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { from, to, entries, forms, formsStamp } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(entries)) return null;

  /** @type {VocabEntry[]} */
  const clean = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [normalized, translations] = entry;
    if (typeof normalized !== "string" || normalized.length === 0) continue;
    if (!Array.isArray(translations)) continue;
    const meanings = translations.filter((one) => typeof one === "string" && one.length > 0);
    if (meanings.length === 0) continue;
    clean.push([normalized, meanings]);
  }

  return {
    from,
    to,
    entries: clean,
    forms: asForms(forms),
    formsStamp: typeof formsStamp === "string" ? formsStamp : "",
  };
}

/**
 * @param {VocabMirror} mirror
 * @param {import("../config.js").Config} config
 * @returns {boolean} whether it describes the pair that is being read now -
 *   an unchosen pair (`null`, mirrored as `""`) matching the empty mirror is
 *   deliberate, see `mirrorOf`
 */
export function mirrorMatches(mirror, config) {
  return mirror.from === (config.sourceLang ?? "") && mirror.to === (config.targetLang ?? "");
}

/**
 * The forms as a page matches them (D208): each form to the key it stands
 * for, so that `reading` found on the page opens the bubble of the saved
 * `read`. A form that is itself a saved key is nobody's alias - the reader's
 * own entry for it answers; a form two keys claim goes to the first of them,
 * in the order the entries stand (oldest first, as the background lists
 * them); a form of a key that is not among the entries is dropped, because
 * a key not in the vocabulary has no bubble to open.
 *
 * @param {VocabEntry[]} entries
 * @param {Record<string, string[]>} forms
 * @returns {Map<string, string>} form to key
 */
export function formAliases(entries, forms) {
  const keys = new Set(entries.map(([key]) => key));
  /** @type {Map<string, string>} */
  const aliases = new Map();
  for (const [key] of entries) {
    for (const form of forms[key] ?? []) {
      if (keys.has(form) || aliases.has(form)) continue;
      aliases.set(form, key);
    }
  }
  return aliases;
}

/**
 * @param {VocabMirror} mirror
 * @returns {Promise<void>}
 */
export async function writeMirror(mirror) {
  await webext().storage.local.set({ [MIRROR_KEY]: mirror });
}
